# hood.dev subgraph (Goldsky)

> **🟢 LIVE — indexing every hood.dev contract.** Query the **stable `prod`
> tag**, never a pinned version:
> ```
> https://api.goldsky.com/api/public/project_cmg2x3lrvy37d01vq4bsnbtig/subgraphs/hooddev/prod/gn
> ```
> `prod` currently points at `hooddev/1.2.0` (Launcher v2 stack + the owner-triggered BuyBurnFeeModule v2, 2026-07-15). Shipping a new version is: deploy
> it, **wait for `Synced: 100%`**, then move the tag — no frontend change. The
> frontend already reads this URL from `frontend/src/lib/subgraph/config.ts`.
>
> Integration reference: `../contracts/docs/integration-spec.md` — every
> address, the full contract + subgraph surface, per-page query mapping, and the
> deploy runbook (§2c is the subgraph-version runbook).

Indexes hood.dev contracts on **Robinhood Chain** (Goldsky network slug:
`robinhood-mainnet`, chain ID 4663). **ONE subgraph for the whole platform** —
locker, launchpad and terminal share the `Token` and `User` entities, so
deployer-side and trader-side data join directly (e.g. "which of my launched
tokens has this trader touched, and what fees have they paid" is a single query).

Covers the **HoodLocker** (token/LP locks + vesting), the **FeeLocker +
V3FeeReceiver** (permanently locked launchpad V3 LP + fee capture), the
**HoodLauncher** (launches → `TokenLaunch` entities, with a per-token
`HoodToken` template that keeps creator-edited metadata current), the
**fee-policy system** (two FeePolicyManagers — token side + creator WETH side —
with burn/vesting/staking/buy-burn modules and a per-pool `TokenStakingPool`
template), the **TokenOwnerRegistry** (canonical token ownership on
`TokenLaunch.owner`), and the **V1TradeManager + TradeFeeReceiver** terminal
(per-swap indexing, per-user volume/fees/PnL).

Each data source starts at its own contract's deployment block (launchpad
9401710, terminal 9415883, locker 9423803).

> **When adding a data source for a NEW contract:** never point it at `0x0` with
> `startBlock: 0`. The indexer would crawl from genesis and find nothing,
> wrecking sync time for the whole subgraph. Wait until you have a real address
> and its deployment block (`DEPLOYMENT_ID=<id> npx hardhat run
> scripts/deploy-block.ts --network robinhood` prints both).

The launchpad UI reads `TokenLaunch` for the token list/pages: metadata
(image/description/socials/contractURI), pool + locked `position` link (fee
earnings), sniper-guard settings, and dev-buy amounts. `LauncherStats`
(id `"launcher"`) counts launches.

## Bonding progress (`bondedEth` / `bondTargetEth` / `hasBonded`)

Every other launchpad sells into a bonding curve and then "graduates" to a DEX.
We open on the DEX, so there was no goal to grind toward — these fields add one,
**without inventing anything**: the launch position already *is* a bonding curve.

`HoodLauncher._createPoolAndLock` mints the ENTIRE supply as one single-sided
position over `[startTick, MAX_USABLE_TICK]` with zero WETH in. Buyers walk the
price up that range and their ETH piles up inside the position — which means the
ETH in the curve is a closed form of the current price alone. No volume
accounting, no balance reads, no new events:

```
L         = supply · √P₀        (the upper bound is ~24 orders of magnitude
                                 away, so its term drops out entirely)
bondedEth = L · (√P − √P₀)
          = initialMcapEth · (√mcapGrowth − 1)
```

The mapping never actually takes a square root: the pool hands us `√P` directly
as `sqrtPriceX96`, and `√P₀ = 1.0001^(startTick/2)` is exact because
`HoodLauncher` rejects any tick that isn't a multiple of `TICK_SPACING = 200`.
**Don't relax that check without revisiting `sqrtPriceEthFromStartTick`.**

Verified against mainnet: across 12 launches on both venues, the formula
reproduced each pool's real WETH balance to within 0–0.011 ETH, always positive
and always <0.04% of volume — i.e. the residual is just uncollected 1% LP fees.

### Fact vs. policy

| Field | |
|---|---|
| `bondedEth` | **Fact.** ETH in the curve right now. Falls when price falls. |
| `bondTargetEth` | **Policy.** `max(5 ETH, initialMcapEth × (√3 − 1))`, stamped at launch. |
| `bondProgress` | `bondedEth / bondTargetEth`, capped at 1. |
| `hasBonded` | **Latched** — true once progress first hits 1, never false again. |
| `bondedAt` | Timestamp of that first crossing; null until then. |

The flat 5 ETH keeps "bonded" meaning the same thing across tokens — real,
permanently locked, exit-able depth. The `√3` floor (≥3x from launch) stops a
token launched near the top of the launcher's FDV band from opening
already-bonded. From a typical ~2.1 ETH opening FDV that's ~11x, bonding at
~24 ETH FDV with ~5 ETH locked; pump.fun graduates at ~$69k with ~$12k. Same
ballpark, arrived at honestly.

Both constants live in `src/launch-pool.ts`. **Changing them requires a redeploy
and full resync**, so if you need to re-tune in a hurry, re-derive progress off
`bondedEth` in the backend and let the stored fields catch up on the next
deploy — that's why `bondedEth` is stored raw and policy-free.

### Querying

```graphql
# "About to bond" rail
tokenLaunches(where: { hasBonded: false, bondProgress_gte: "0.6" },
              orderBy: bondProgress, orderDirection: desc) { id bondedEth bondTargetEth bondProgress }

# Bonded badge / filter
tokenLaunches(where: { hasBonded: true }, orderBy: bondedAt, orderDirection: desc) { id bondedAt }
```

For the terminal's dotted bond line, the price to draw it at is the inverse —
no extra field needed, it's a pure function of two values you already query:

```
bondPriceEth = lastPriceEth × ((1 + bondTargetEth / initialMcapEth)² / mcapGrowth)
# or straight from the launch:  P_bond = initialMcapEth × (1 + bondTargetEth/initialMcapEth)² / supply
```

### Gotchas

- **Dev buys are already included.** The atomic dev buy's `Swap` fires in the
  launch tx *before* `TokenLaunched`, but graph-node replays the block against
  the `LaunchPool` template created in that handler, so it lands through the
  normal swap path. Confirmed on prod (curve fill reconciles with `volumeEth`
  net of the 1% pool fee). Do not "fix" this by seeding from `devBuyEth` — you
  would double count.
- **Dev buys do NOT appear in `Trade`.** Unrelated mechanism: `Trade` rows come
  only from `TradeExecuted` on the TradeManagers, and `_devBuy` calls the venue
  router directly. Synthesizing one would pollute `TraderStats` / PnL, so it's
  deliberately left out.
- `bondProgress` is **not** monotonic — it drops on sells, same as pump.fun.
  `hasBonded` is the monotonic one; use it for badges.
- **`hasBonded` latches on the PEAK, `bondProgress` shows the present.** They
  disagree constantly and that is correct — a token can be `hasBonded: true` at
  20% progress. Don't compute "how many have bonded" by filtering on
  `bondProgress`; you'll undercount badly. Measured on the first 28 launches:
  1 was above target at that instant, **3 had crossed it at some point** — and
  the latch catches all 3 on resync, because graph-node replays every swap.
  A UI showing only live progress would silently lose two thirds of them.

## What the terminal UI queries (V1TradeManager)

- `Trade` rows (`User.trades`, ordered by timestamp) — Your Trade History.
- `TraderPosition` (id = user ++ token) — the PnL building block per token:
  `tokensBought/Sold`, `ethSpent` (gross), `ethReceived` (net of fee),
  `feesPaidEth`. Realized/unrealized PnL = ethReceived − ethSpent + current
  holdings priced via Codex.
- `TraderStats` (id = user address) — lifetime volume/fees/trade counts for
  leaderboards.
- `TerminalStats` (id `"terminal"`) — platform totals, incl. fee cross-checks
  from the TradeFeeReceiver (`feesReceivedEth` / `feesWithdrawnEth`).

## What the Locker page queries

- `User.locksOwned` / `User.locksWithdrawable` — the "Your locks" list
  (a lock appears under whichever address is owner and unlocker).
- `User.vestingsReceived` / `User.vestingsCreated` — vesting rows, with
  `claims` history per schedule.
- `Token.totalLocked` / `Token.totalVesting` — per-token proof-of-lock stats.
- `LockerStats` (id `"locker"`) — protocol-wide counters.

Status is derived client-side: `withdrawn` → withdrawn; otherwise
`unlockTime <= now` → unlockable; else locked.

Example query:

```graphql
{
  user(id: "0xYOURADDRESS") {
    locksOwned(orderBy: createdAt, orderDirection: desc) {
      id token { symbol decimals } amount unlockTime withdrawn extendCount
    }
    vestingsReceived {
      id token { symbol decimals } total released start duration interval
      claims { amount timestamp }
    }
  }
}
```

Note: address-typed IDs (`User`, `Token`) are stored as `Bytes` — query them
lowercased.

## What the fee/earnings UI queries

- `LockedPosition` — one per launched token's locked V3 position: lifetime
  `totalCollected0/1` (raw pool fees), `creatorEarned0/1` and
  `protocolEarned0/1` (post-split, from the v1 in-kind receiver), current
  `creator` and immutable `creatorBps`.
- `User.lockedPositions` — a creator's positions with their earnings (the
  creator-earnings leaderboard is `LockedPosition` ordered by earned fields).
- `FeeCollection` / `FeeDistribution` — per-crank history rows for activity
  feeds ("collected X WETH + Y TOKEN, creator got ...").
- `ClaimableFeeBalance` — pull-fallback balances a recipient still needs to
  `claim()` on the V3FeeReceiver.
- `FeeLockerStats` (id `"fee-locker"`) — counters + current receiver address.

Convention: `token0`/`token1` follow Uniswap pool ordering — check which side
is WETH via the `Token` entity rather than assuming.

## What the fee-policy + ownership UI queries

- `TokenLaunch.owner` — the CANONICAL token owner (TokenOwnerRegistry); a
  zero-address owner means renounced. `User.tokensOwned` lists a wallet's
  tokens. Metadata control, the FeeLocker creator recipient, and the vesting
  recipient all follow this one owner.
- `TokenFeePolicy` (id = token address) — the token-side policy: `policyId`
  (1 burn / 2 vesting / 3 staking), `module`, `venue`, raw `configData`,
  lifetime `totalFeesHandled`, `totalBurned` (burn policy). Linked both ways
  with `TokenLaunch.feePolicy`.
- `CreatorFeePolicy` (id = token address) — the creator WETH-share policy:
  `policyId` (2 buy-burn / 3 staking; the reward-creator default has no
  entity), `pendingWeth`, `totalWethSpent`, `totalTokensBurned`, and
  `buybacks` (`BuybackExecution` rows: wethIn, tokensBurned, timestamp).
- `FeeDelegation` rows + `LockedPosition.delegatedEarned0/1` — per-collect
  history of amounts handed to the policy system (asset = the token or WETH).
- `FeeVesting` (id = token) — vault state for vesting tokens: `recipient`,
  `dailyReleaseBps`, `accrued`, `totalAccrued`, `released`, `lastClaimAt`
  (next claim = +86400), plus `claims` (`FeeVestingClaim`) rows.
  `User.feeVestingsReceived` lists them per wallet.
- `StakingPool` (id = pool address) — per-token dual-reward pool:
  `totalStaked`, `stakerCount`, and PER ASSET `queuedRewards` /
  `queuedWethRewards`, `totalRewardsAdded` / `totalWethRewardsAdded`,
  `totalRewardsPaid` / `totalWethRewardsPaid`. Find a token's pool with
  `stakingPools(where: {token: "0xtoken"})` or via the policy `venue`.
- `StakingPosition` (id = pool ++ user) — a staker's `amount`, `lockedUntil`
  (24h deposit lock), `totalDeposited` / `totalWithdrawn`, and
  `rewardsClaimed` + `wethRewardsClaimed` (realized profits per asset).
  `User.stakingPositions` lists a wallet's stakes across all pools.
- `StakingAction` — immutable DEPOSIT / WITHDRAW / CLAIM rows (with `asset`)
  for activity feeds.
- `FeePolicyType` (id = `"token-N"` / `"creator-N"`) — current module per
  policy id per manager side + how many tokens launched with it.

When a new fee-receiver policy contract is installed via `setFeeReceiver`, add
a data source block for it in `subgraph.yaml` (or convert the receiver section
to a data-source template) so distributions keep indexing.

## Build & deploy

```bash
npm install
npm run codegen     # after any schema.graphql / ABI change
npm run build
```

Deploying to Goldsky:

1. Deploy `HoodLocker` first (`../contracts`), then set `source.address` and
   `startBlock` (deployment block) in `subgraph.yaml`.
2. If the ABI changed, re-export it: `cd ../contracts && npm run abi:export`.
3. Install the Goldsky CLI (`curl https://goldsky.com | sh`) and log in with
   `goldsky login` (API key from app.goldsky.com).
4. `npm run deploy:goldsky` (deploys as `hooddev/1.0.0` — bump the version on
   each schema/mapping change).

Goldsky serves a GraphQL endpoint per deployment
(`https://api.goldsky.com/api/public/<project>/subgraphs/hooddev/1.0.0/gn`);
point the frontend's locker data hooks at it.

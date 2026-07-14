# hood.dev subgraph (Goldsky)

> Integration reference: `../contracts/docs/integration-spec.md` covers the
> full contract + subgraph surface, per-page query mapping, and the deploy
> runbook (contracts are NOT deployed yet; all data-source addresses are
> placeholders).

Indexes hood.dev contracts on **Robinhood Chain** (Goldsky network slug:
`robinhood-mainnet`, chain ID 4663). Covers the **HoodLocker** (locks +
vesting), the **FeeLocker + V3FeeReceiver** (permanently locked launchpad V3
LP + fee capture), the **HoodLauncher** (launches → `TokenLaunch`
entities, with a per-token `HoodToken` template that keeps creator-edited
metadata current), the **fee-policy system** (two FeePolicyManagers — token
side + creator WETH side — with burn/vesting/staking/buy-burn modules and a
per-pool `TokenStakingPool` template), the **TokenOwnerRegistry** (canonical
token ownership on `TokenLaunch.owner`), and the **V1TradeManager** terminal
(per-swap indexing).

The launchpad UI reads `TokenLaunch` for the token list/pages: metadata
(image/description/socials/contractURI), pool + locked `position` link (fee
earnings), sniper-guard settings, and dev-buy amounts. `LauncherStats`
(id `"launcher"`) counts launches.

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

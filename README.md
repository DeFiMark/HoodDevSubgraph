# hood.dev subgraph (Goldsky)

Indexes hood.dev contracts on **Robinhood Chain** (Goldsky network slug:
`robinhood-mainnet`, chain ID 4663). Covers the **HoodLocker** (locks +
vesting) and the **FeeLocker + V3FeeReceiver** (permanently locked launchpad
V3 LP + fee capture); launchpad/terminal entities are sketched in
`schema.graphql` and will be added as data sources once those contracts are
specced.

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

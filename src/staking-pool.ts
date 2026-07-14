import { Address, BigInt, Bytes, ethereum } from '@graphprotocol/graph-ts'
import { RewardAdded, RewardPaid, RewardQueued, Staked, Withdrawn } from '../generated/templates/TokenStakingPool/TokenStakingPool'
import { StakingAction, StakingPool, StakingPosition } from '../generated/schema'
import { getUser } from './helpers'

function positionId(pool: Address, user: Address): Bytes {
  return pool.concat(user)
}

function getPosition(pool: StakingPool, user: Address, timestamp: BigInt): StakingPosition {
  const id = positionId(Address.fromBytes(pool.id), user)
  let position = StakingPosition.load(id)
  if (position == null) {
    position = new StakingPosition(id)
    position.pool = pool.id
    position.user = getUser(user).id
    position.amount = BigInt.zero()
    position.lockedUntil = BigInt.zero()
    position.totalDeposited = BigInt.zero()
    position.totalWithdrawn = BigInt.zero()
    position.rewardsClaimed = BigInt.zero()
    position.wethRewardsClaimed = BigInt.zero()
    position.firstStakedAt = timestamp
  }
  return position
}

/// The pool's reward events carry the asset (staked token or WETH).
function isTokenSide(pool: StakingPool, asset: Address): boolean {
  return pool.token.toHexString() == asset.toHexString()
}

function recordAction(
  event: ethereum.Event,
  pool: StakingPool,
  user: Address,
  kind: string,
  asset: Bytes,
  amount: BigInt,
): void {
  const action = new StakingAction(event.transaction.hash.concatI32(event.logIndex.toI32()))
  action.pool = pool.id
  action.user = getUser(user).id
  action.kind = kind
  action.asset = asset
  action.amount = amount
  action.timestamp = event.block.timestamp
  action.tx = event.transaction.hash
  action.save()
}

export function handleStaked(event: Staked): void {
  const pool = StakingPool.load(event.address)
  if (pool == null) return

  const position = getPosition(pool, event.params.user, event.block.timestamp)
  if (position.amount.isZero()) pool.stakerCount += 1

  position.amount = event.params.userStake
  position.lockedUntil = event.params.lockedUntil
  position.totalDeposited = position.totalDeposited.plus(event.params.amount)
  position.lastActionAt = event.block.timestamp
  position.save()

  pool.totalStaked = pool.totalStaked.plus(event.params.amount)
  pool.depositCount += 1
  pool.save()

  recordAction(event, pool, event.params.user, 'DEPOSIT', pool.token, event.params.amount)
}

export function handleWithdrawn(event: Withdrawn): void {
  const pool = StakingPool.load(event.address)
  if (pool == null) return

  const position = getPosition(pool, event.params.user, event.block.timestamp)
  position.amount = event.params.userStake
  position.totalWithdrawn = position.totalWithdrawn.plus(event.params.amount)
  position.lastActionAt = event.block.timestamp
  position.save()

  if (position.amount.isZero()) pool.stakerCount -= 1
  pool.totalStaked = pool.totalStaked.minus(event.params.amount)
  pool.withdrawCount += 1
  pool.save()

  recordAction(event, pool, event.params.user, 'WITHDRAW', pool.token, event.params.amount)
}

export function handleRewardPaid(event: RewardPaid): void {
  const pool = StakingPool.load(event.address)
  if (pool == null) return

  const position = getPosition(pool, event.params.user, event.block.timestamp)
  if (isTokenSide(pool, event.params.asset)) {
    position.rewardsClaimed = position.rewardsClaimed.plus(event.params.amount)
    pool.totalRewardsPaid = pool.totalRewardsPaid.plus(event.params.amount)
  } else {
    position.wethRewardsClaimed = position.wethRewardsClaimed.plus(event.params.amount)
    pool.totalWethRewardsPaid = pool.totalWethRewardsPaid.plus(event.params.amount)
  }
  position.lastActionAt = event.block.timestamp
  position.save()

  pool.claimCount += 1
  pool.save()

  recordAction(event, pool, event.params.user, 'CLAIM', event.params.asset, event.params.amount)
}

export function handleRewardAdded(event: RewardAdded): void {
  const pool = StakingPool.load(event.address)
  if (pool == null) return
  // `amount` is the freshly received portion (0 for a pure queue release at
  // the first stake); any queued balance was folded into this distribution.
  if (isTokenSide(pool, event.params.asset)) {
    pool.totalRewardsAdded = pool.totalRewardsAdded.plus(event.params.amount)
    pool.queuedRewards = BigInt.zero()
  } else {
    pool.totalWethRewardsAdded = pool.totalWethRewardsAdded.plus(event.params.amount)
    pool.queuedWethRewards = BigInt.zero()
  }
  pool.save()
}

export function handleRewardQueued(event: RewardQueued): void {
  const pool = StakingPool.load(event.address)
  if (pool == null) return
  if (isTokenSide(pool, event.params.asset)) {
    pool.totalRewardsAdded = pool.totalRewardsAdded.plus(event.params.amount)
    pool.queuedRewards = event.params.queued
  } else {
    pool.totalWethRewardsAdded = pool.totalWethRewardsAdded.plus(event.params.amount)
    pool.queuedWethRewards = event.params.queued
  }
  pool.save()
}

import { BigInt } from '@graphprotocol/graph-ts'
import { StakingPoolCreated } from '../generated/StakingFeeModule/StakingFeeModule'
import { StakingPool } from '../generated/schema'
import { TokenStakingPool as TokenStakingPoolTemplate } from '../generated/templates'
import { getToken } from './helpers'

export function handleStakingPoolCreated(event: StakingPoolCreated): void {
  const pool = new StakingPool(event.params.pool)
  pool.token = getToken(event.params.token).id
  pool.implementation = event.params.implementation
  pool.totalStaked = BigInt.zero()
  pool.queuedRewards = BigInt.zero()
  pool.queuedWethRewards = BigInt.zero()
  pool.totalRewardsAdded = BigInt.zero()
  pool.totalWethRewardsAdded = BigInt.zero()
  pool.totalRewardsPaid = BigInt.zero()
  pool.totalWethRewardsPaid = BigInt.zero()
  pool.stakerCount = 0
  pool.depositCount = 0
  pool.withdrawCount = 0
  pool.claimCount = 0
  pool.createdAt = event.block.timestamp
  pool.createdAtBlock = event.block.number
  pool.createdTx = event.transaction.hash
  pool.save()

  // Index the new pool's staking activity from here on.
  TokenStakingPoolTemplate.create(event.params.pool)
}

import { BigInt } from '@graphprotocol/graph-ts'
import {
  VestingFeesAccrued,
  VestingFeesClaimed,
  VestingPolicyRegistered,
  VestingRecipientUpdated,
} from '../generated/VestingFeeModule/VestingFeeModule'
import { FeeVesting, FeeVestingClaim } from '../generated/schema'
import { getToken, getUser } from './helpers'

export function handleVestingPolicyRegistered(event: VestingPolicyRegistered): void {
  const vesting = new FeeVesting(event.params.token)
  vesting.policy = event.params.token
  vesting.token = getToken(event.params.token).id
  vesting.recipient = getUser(event.params.recipient).id
  vesting.dailyReleaseBps = event.params.dailyReleaseBps
  vesting.accrued = BigInt.zero()
  vesting.totalAccrued = BigInt.zero()
  vesting.released = BigInt.zero()
  vesting.lastClaimAt = event.block.timestamp
  vesting.claimCount = 0
  vesting.createdAt = event.block.timestamp
  vesting.save()
}

export function handleVestingFeesAccrued(event: VestingFeesAccrued): void {
  const vesting = FeeVesting.load(event.params.token)
  if (vesting == null) return
  vesting.accrued = event.params.accrued
  vesting.totalAccrued = vesting.totalAccrued.plus(event.params.amount)
  vesting.save()
}

export function handleVestingFeesClaimed(event: VestingFeesClaimed): void {
  const vesting = FeeVesting.load(event.params.token)
  if (vesting == null) return

  vesting.accrued = event.params.accrued
  vesting.released = vesting.released.plus(event.params.amount)
  vesting.lastClaimAt = event.block.timestamp
  vesting.claimCount += 1
  vesting.save()

  const claim = new FeeVestingClaim(event.transaction.hash.concatI32(event.logIndex.toI32()))
  claim.vesting = vesting.id
  claim.recipient = event.params.recipient
  claim.amount = event.params.amount
  claim.remaining = event.params.accrued
  claim.timestamp = event.block.timestamp
  claim.tx = event.transaction.hash
  claim.save()
}

export function handleVestingRecipientUpdated(event: VestingRecipientUpdated): void {
  const vesting = FeeVesting.load(event.params.token)
  if (vesting == null) return
  vesting.recipient = getUser(event.params.newRecipient).id
  vesting.save()
}

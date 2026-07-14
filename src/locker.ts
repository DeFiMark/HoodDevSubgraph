import { Address, BigInt } from '@graphprotocol/graph-ts'
import {
  LockCreated,
  LockExtended,
  LockWithdrawn,
  VestingClaimed,
  VestingCreated,
} from '../generated/HoodLocker/HoodLocker'
import { LockerStats, Token, TokenLock, VestingClaim, VestingSchedule } from '../generated/schema'
import { getToken, getUser } from './helpers'

const STATS_ID = 'locker'

function getStats(): LockerStats {
  let stats = LockerStats.load(STATS_ID)
  if (stats == null) {
    stats = new LockerStats(STATS_ID)
    stats.lockCount = 0
    stats.activeLockCount = 0
    stats.vestingCount = 0
    stats.claimCount = 0
  }
  return stats
}

// --------------------------------------------------------------------- locks

export function handleLockCreated(event: LockCreated): void {
  const token = getToken(event.params.token)
  const owner = getUser(event.params.owner)
  const unlockerUser = getUser(Address.fromBytes(event.params.unlocker))

  const lock = new TokenLock(event.params.lockId.toString())
  lock.token = token.id
  lock.owner = owner.id
  lock.unlocker = event.params.unlocker
  lock.unlockerUser = unlockerUser.id
  lock.amount = event.params.amount
  lock.unlockTime = event.params.unlockTime
  lock.withdrawn = false
  lock.extendCount = 0
  lock.createdAt = event.block.timestamp
  lock.createdAtBlock = event.block.number
  lock.createdTx = event.transaction.hash
  lock.save()

  token.totalLocked = token.totalLocked.plus(event.params.amount)
  token.save()

  const stats = getStats()
  stats.lockCount += 1
  stats.activeLockCount += 1
  stats.save()
}

export function handleLockExtended(event: LockExtended): void {
  const lock = TokenLock.load(event.params.lockId.toString())
  if (lock == null) return

  lock.unlockTime = event.params.newUnlockTime
  lock.extendCount += 1
  lock.save()
}

export function handleLockWithdrawn(event: LockWithdrawn): void {
  const lock = TokenLock.load(event.params.lockId.toString())
  if (lock == null) return

  lock.withdrawn = true
  lock.withdrawnAt = event.block.timestamp
  lock.save()

  const token = Token.load(lock.token)
  if (token != null) {
    token.totalLocked = token.totalLocked.minus(event.params.amount)
    token.save()
  }

  const stats = getStats()
  stats.activeLockCount -= 1
  stats.save()
}

// ------------------------------------------------------------------- vesting

export function handleVestingCreated(event: VestingCreated): void {
  const token = getToken(event.params.token)
  const creator = getUser(Address.fromBytes(event.params.creator))
  const beneficiary = getUser(event.params.beneficiary)

  const schedule = new VestingSchedule(event.params.vestingId.toString())
  schedule.token = token.id
  schedule.creator = creator.id
  schedule.beneficiary = beneficiary.id
  schedule.total = event.params.total
  schedule.released = BigInt.zero()
  schedule.start = event.params.start
  schedule.duration = event.params.duration
  schedule.interval = event.params.interval
  schedule.fullyClaimed = false
  schedule.createdAt = event.block.timestamp
  schedule.createdAtBlock = event.block.number
  schedule.createdTx = event.transaction.hash
  schedule.save()

  token.totalVesting = token.totalVesting.plus(event.params.total)
  token.save()

  const stats = getStats()
  stats.vestingCount += 1
  stats.save()
}

export function handleVestingClaimed(event: VestingClaimed): void {
  const schedule = VestingSchedule.load(event.params.vestingId.toString())
  if (schedule == null) return

  schedule.released = event.params.totalReleased
  schedule.fullyClaimed = event.params.totalReleased.equals(schedule.total)
  schedule.save()

  const claim = new VestingClaim(
    event.transaction.hash.concatI32(event.logIndex.toI32()),
  )
  claim.schedule = schedule.id
  claim.beneficiary = event.params.beneficiary
  claim.amount = event.params.amount
  claim.totalReleased = event.params.totalReleased
  claim.timestamp = event.block.timestamp
  claim.tx = event.transaction.hash
  claim.save()

  const token = Token.load(schedule.token)
  if (token != null) {
    token.totalVesting = token.totalVesting.minus(event.params.amount)
    token.save()
  }

  const stats = getStats()
  stats.claimCount += 1
  stats.save()
}

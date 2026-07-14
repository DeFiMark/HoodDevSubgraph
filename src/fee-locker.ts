import { BigInt, Bytes } from '@graphprotocol/graph-ts'
import {
  CreatorRecipientUpdated,
  FeesCollected,
  FeeReceiverUpdated,
  PositionLocked,
} from '../generated/FeeLocker/FeeLocker'
import { FeeCollection, FeeLockerStats, LockedPosition } from '../generated/schema'
import { getToken, getUser } from './helpers'

const STATS_ID = 'fee-locker'

function getStats(): FeeLockerStats {
  let stats = FeeLockerStats.load(STATS_ID)
  if (stats == null) {
    stats = new FeeLockerStats(STATS_ID)
    stats.positionCount = 0
    stats.collectCount = 0
    stats.feeReceiver = Bytes.empty()
  }
  return stats
}

export function handlePositionLocked(event: PositionLocked): void {
  const token0 = getToken(event.params.token0)
  const token1 = getToken(event.params.token1)
  const creator = getUser(event.params.creator)

  const position = new LockedPosition(event.params.tokenId.toString())
  position.pool = event.params.pool
  position.token0 = token0.id
  position.token1 = token1.id
  position.creator = creator.id
  position.creatorBps = event.params.creatorBps
  position.collectCount = 0
  position.totalCollected0 = BigInt.zero()
  position.totalCollected1 = BigInt.zero()
  position.creatorEarned0 = BigInt.zero()
  position.creatorEarned1 = BigInt.zero()
  position.protocolEarned0 = BigInt.zero()
  position.protocolEarned1 = BigInt.zero()
  position.delegatedEarned0 = BigInt.zero()
  position.delegatedEarned1 = BigInt.zero()
  position.createdAt = event.block.timestamp
  position.createdAtBlock = event.block.number
  position.createdTx = event.transaction.hash
  position.save()

  const stats = getStats()
  stats.positionCount += 1
  stats.save()
}

export function handleFeesCollected(event: FeesCollected): void {
  const position = LockedPosition.load(event.params.tokenId.toString())
  if (position == null) return

  position.collectCount += 1
  position.totalCollected0 = position.totalCollected0.plus(event.params.amount0)
  position.totalCollected1 = position.totalCollected1.plus(event.params.amount1)
  position.save()

  const collection = new FeeCollection(event.transaction.hash.concatI32(event.logIndex.toI32()))
  collection.position = position.id
  collection.amount0 = event.params.amount0
  collection.amount1 = event.params.amount1
  collection.receiver = event.params.receiver
  collection.timestamp = event.block.timestamp
  collection.tx = event.transaction.hash
  collection.save()

  const stats = getStats()
  stats.collectCount += 1
  stats.save()
}

export function handleCreatorRecipientUpdated(event: CreatorRecipientUpdated): void {
  const position = LockedPosition.load(event.params.tokenId.toString())
  if (position == null) return

  position.creator = getUser(event.params.newCreator).id
  position.save()
}

export function handleFeeReceiverUpdated(event: FeeReceiverUpdated): void {
  const stats = getStats()
  stats.feeReceiver = event.params.newReceiver
  stats.save()
}

import { Address, BigInt, Bytes } from '@graphprotocol/graph-ts'
import { FeeCredited, FeesClaimed, FeesDelegated, FeesDistributed } from '../generated/V3FeeReceiver/V3FeeReceiver'
import { ClaimableFeeBalance, FeeDelegation, FeeDistribution, LockedPosition } from '../generated/schema'
import { getToken } from './helpers'

export function handleFeesDistributed(event: FeesDistributed): void {
  const position = LockedPosition.load(event.params.tokenId.toString())
  if (position == null) return

  const token = getToken(event.params.token)

  const distribution = new FeeDistribution(event.transaction.hash.concatI32(event.logIndex.toI32()))
  distribution.position = position.id
  distribution.token = token.id
  distribution.creator = event.params.creator
  distribution.creatorAmount = event.params.creatorAmount
  distribution.protocolAmount = event.params.protocolAmount
  distribution.timestamp = event.block.timestamp
  distribution.tx = event.transaction.hash
  distribution.save()

  if (position.token0.toHexString() == token.id.toHexString()) {
    position.creatorEarned0 = position.creatorEarned0.plus(event.params.creatorAmount)
    position.protocolEarned0 = position.protocolEarned0.plus(event.params.protocolAmount)
  } else {
    position.creatorEarned1 = position.creatorEarned1.plus(event.params.creatorAmount)
    position.protocolEarned1 = position.protocolEarned1.plus(event.params.protocolAmount)
  }
  position.save()
}

export function handleFeesDelegated(event: FeesDelegated): void {
  const position = LockedPosition.load(event.params.tokenId.toString())
  if (position == null) return

  // `asset` is the launched token (token-side policy) or WETH (creator side).
  const token = getToken(event.params.asset)

  const delegation = new FeeDelegation(event.transaction.hash.concatI32(event.logIndex.toI32()))
  delegation.position = position.id
  delegation.token = token.id
  delegation.manager = event.params.manager
  delegation.amount = event.params.amount
  delegation.timestamp = event.block.timestamp
  delegation.tx = event.transaction.hash
  delegation.save()

  if (position.token0.toHexString() == token.id.toHexString()) {
    position.delegatedEarned0 = position.delegatedEarned0.plus(event.params.amount)
  } else {
    position.delegatedEarned1 = position.delegatedEarned1.plus(event.params.amount)
  }
  position.save()
}

function balanceId(recipient: Address, token: Address): Bytes {
  return recipient.concat(token)
}

export function handleFeeCredited(event: FeeCredited): void {
  const id = balanceId(event.params.recipient, event.params.token)
  let balance = ClaimableFeeBalance.load(id)
  if (balance == null) {
    balance = new ClaimableFeeBalance(id)
    balance.recipient = event.params.recipient
    balance.token = getToken(event.params.token).id
    balance.amount = BigInt.zero()
  }
  balance.amount = balance.amount.plus(event.params.amount)
  balance.updatedAt = event.block.timestamp
  balance.save()
}

export function handleFeesClaimed(event: FeesClaimed): void {
  const balance = ClaimableFeeBalance.load(balanceId(event.params.recipient, event.params.token))
  if (balance == null) return

  balance.amount = balance.amount.minus(event.params.amount)
  balance.updatedAt = event.block.timestamp
  balance.save()
}

import { Address, BigInt } from '@graphprotocol/graph-ts'
import {
  ReferralAttributed,
  ReferralFeeAccrued,
  ReferralClaimed,
} from '../generated/ReferralManager/ReferralManager'
import { Referral, ReferralClaim, ReferralEarning, Referrer } from '../generated/schema'
import { getToken, getUser } from './helpers'

function getReferrer(address: Address): Referrer {
  let referrer = Referrer.load(address)
  if (referrer == null) {
    referrer = new Referrer(address)
    referrer.user = getUser(address).id
    referrer.pendingEth = BigInt.zero()
    referrer.lifetimeEarnedEth = BigInt.zero()
    referrer.claimedEth = BigInt.zero()
    referrer.refereeCount = 0
  }
  return referrer
}

/** First-touch trader→referrer edge; emitted at most once per trader on-chain. */
export function handleReferralAttributed(event: ReferralAttributed): void {
  const referrer = getReferrer(event.params.referrer)
  referrer.refereeCount += 1
  referrer.save()

  const referral = new Referral(event.params.trader)
  referral.trader = getUser(event.params.trader).id
  referral.referrer = referrer.id
  referral.attributedAt = event.block.timestamp
  referral.save()
}

export function handleReferralFeeAccrued(event: ReferralFeeAccrued): void {
  const referrer = getReferrer(event.params.referrer)
  referrer.pendingEth = referrer.pendingEth.plus(event.params.amount)
  referrer.lifetimeEarnedEth = referrer.lifetimeEarnedEth.plus(event.params.amount)
  referrer.save()

  const earning = new ReferralEarning(event.transaction.hash.concatI32(event.logIndex.toI32()))
  earning.referrer = referrer.id
  earning.trader = getUser(event.params.trader).id
  earning.token = getToken(event.params.token).id
  earning.amountEth = event.params.amount
  earning.timestamp = event.block.timestamp
  earning.tx = event.transaction.hash
  earning.save()
}

export function handleReferralClaimed(event: ReferralClaimed): void {
  const referrer = getReferrer(event.params.referrer)
  referrer.pendingEth = referrer.pendingEth.minus(event.params.amount)
  referrer.claimedEth = referrer.claimedEth.plus(event.params.amount)
  referrer.save()

  const claim = new ReferralClaim(event.transaction.hash.concatI32(event.logIndex.toI32()))
  claim.referrer = referrer.id
  claim.to = event.params.to
  claim.amountEth = event.params.amount
  claim.timestamp = event.block.timestamp
  claim.tx = event.transaction.hash
  claim.save()
}

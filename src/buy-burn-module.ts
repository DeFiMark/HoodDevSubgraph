import { BuybackExecuted, BuyBurnFeesAccrued } from '../generated/BuyBurnFeeModule/BuyBurnFeeModule'
import { BuybackExecution, CreatorFeePolicy } from '../generated/schema'

export function handleBuyBurnFeesAccrued(event: BuyBurnFeesAccrued): void {
  const policy = CreatorFeePolicy.load(event.params.token)
  if (policy == null) return
  policy.pendingWeth = event.params.pending
  policy.save()
}

export function handleBuybackExecuted(event: BuybackExecuted): void {
  const policy = CreatorFeePolicy.load(event.params.token)
  if (policy == null) return

  policy.pendingWeth = event.params.pendingRemaining
  policy.totalWethSpent = policy.totalWethSpent.plus(event.params.wethIn)
  policy.totalTokensBurned = policy.totalTokensBurned.plus(event.params.tokensBurned)
  policy.lastBuybackAt = event.block.timestamp // resets the 90-day public clock
  policy.save()

  const buyback = new BuybackExecution(event.transaction.hash.concatI32(event.logIndex.toI32()))
  buyback.policy = policy.id
  buyback.token = policy.token
  buyback.wethIn = event.params.wethIn
  buyback.tokensBurned = event.params.tokensBurned
  buyback.pendingRemaining = event.params.pendingRemaining
  buyback.caller = event.params.caller
  buyback.isPublic = event.params.isPublic
  buyback.timestamp = event.block.timestamp
  buyback.tx = event.transaction.hash
  buyback.save()
}

import { FeesBurned } from '../generated/BurnFeeModule/BurnFeeModule'
import { TokenFeePolicy } from '../generated/schema'

export function handleFeesBurned(event: FeesBurned): void {
  const policy = TokenFeePolicy.load(event.params.token)
  if (policy == null) return
  policy.totalBurned = event.params.totalBurned
  policy.save()
}

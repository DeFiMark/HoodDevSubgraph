import { BigInt } from '@graphprotocol/graph-ts'
import { ModuleSet, TokenFeesHandled, TokenPolicySet } from '../generated/CreatorFeeManager/FeePolicyManager'
import { CreatorFeePolicy, FeePolicyType, TokenLaunch } from '../generated/schema'
import { getToken } from './helpers'

const SIDE = 'creator'

export function handleModuleSet(event: ModuleSet): void {
  const id = SIDE + '-' + event.params.policyId.toString()
  let policyType = FeePolicyType.load(id)
  if (policyType == null) {
    policyType = new FeePolicyType(id)
    policyType.side = SIDE
    policyType.policyId = event.params.policyId
    policyType.tokenCount = 0
  }
  policyType.module = event.params.newModule
  policyType.updatedAt = event.block.timestamp
  policyType.save()
}

export function handleTokenPolicySet(event: TokenPolicySet): void {
  const token = getToken(event.params.token)

  const policy = new CreatorFeePolicy(event.params.token)
  policy.token = token.id
  policy.policyId = event.params.policyId
  policy.module = event.params.module
  policy.venue = event.params.venue
  policy.configData = event.params.data
  policy.totalFeesHandled = BigInt.zero()
  policy.handleCount = 0
  policy.pendingWeth = BigInt.zero()
  policy.totalWethSpent = BigInt.zero()
  policy.totalTokensBurned = BigInt.zero()
  policy.lastBuybackAt = event.block.timestamp // launch starts the public clock
  policy.createdAt = event.block.timestamp
  policy.createdAtBlock = event.block.number
  policy.createdTx = event.transaction.hash

  const launch = TokenLaunch.load(event.params.token)
  if (launch != null) {
    policy.launch = launch.id
    launch.creatorFeePolicy = policy.id
    launch.save()
  }
  policy.save()

  const policyType = FeePolicyType.load(SIDE + '-' + event.params.policyId.toString())
  if (policyType != null) {
    policyType.tokenCount += 1
    policyType.save()
  }
}

export function handleTokenFeesHandled(event: TokenFeesHandled): void {
  const policy = CreatorFeePolicy.load(event.params.token)
  if (policy == null) return
  policy.totalFeesHandled = policy.totalFeesHandled.plus(event.params.amount)
  policy.handleCount += 1
  policy.save()
}

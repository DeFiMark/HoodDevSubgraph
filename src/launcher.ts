import { TokenLaunched } from '../generated/HoodLauncher/HoodLauncher'
import { HoodToken } from '../generated/HoodLauncher/HoodToken'
import { CreatorFeePolicy, LauncherStats, LockedPosition, TokenFeePolicy, TokenLaunch } from '../generated/schema'
import { HoodToken as HoodTokenTemplate } from '../generated/templates'
import { getToken, getUser } from './helpers'

const STATS_ID = 'launcher'

export function handleTokenLaunched(event: TokenLaunched): void {
  const token = getToken(event.params.token)
  const creator = getUser(event.params.creator)

  const launch = new TokenLaunch(event.params.token)
  launch.token = token.id
  launch.creator = creator.id
  launch.owner = creator.id // initial registry owner; updated on transfers
  launch.pool = event.params.pool
  launch.positionId = event.params.positionId
  launch.supply = event.params.supply
  launch.startTick = event.params.startTick
  launch.creatorBps = event.params.creatorBps
  launch.maxWalletBps = event.params.maxWalletBps
  launch.restrictionBlocks = event.params.restrictionBlocks
  launch.metadataURI = event.params.metadataURI
  launch.devBuyEth = event.params.devBuyEth
  launch.devBuyTokens = event.params.devBuyTokens
  launch.createdAt = event.block.timestamp
  launch.createdAtBlock = event.block.number
  launch.createdTx = event.transaction.hash

  // PositionLocked (FeeLocker) logs before TokenLaunched in the same tx.
  const position = LockedPosition.load(event.params.positionId.toString())
  if (position != null) launch.position = position.id

  // TokenPolicySet (both FeePolicyManagers) logs earlier in the same tx.
  const feePolicy = TokenFeePolicy.load(event.params.token)
  if (feePolicy != null) {
    launch.feePolicy = feePolicy.id
    feePolicy.launch = launch.id
    feePolicy.save()
  }
  const creatorFeePolicy = CreatorFeePolicy.load(event.params.token)
  if (creatorFeePolicy != null) {
    launch.creatorFeePolicy = creatorFeePolicy.id
    creatorFeePolicy.launch = launch.id
    creatorFeePolicy.save()
  }

  // On-chain metadata getters — not in the event, read once at launch.
  const hoodToken = HoodToken.bind(event.params.token)
  const image = hoodToken.try_image()
  launch.image = image.reverted ? '' : image.value
  const description = hoodToken.try_description()
  launch.description = description.reverted ? '' : description.value
  const socials = hoodToken.try_socials()
  launch.socials = socials.reverted ? '' : socials.value

  launch.save()

  // Track creator-editable metadata updates from here on.
  HoodTokenTemplate.create(event.params.token)

  let stats = LauncherStats.load(STATS_ID)
  if (stats == null) {
    stats = new LauncherStats(STATS_ID)
    stats.launchCount = 0
  }
  stats.launchCount += 1
  stats.save()
}

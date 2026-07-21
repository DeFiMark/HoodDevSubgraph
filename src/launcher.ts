import { Address, BigInt, Bytes, DataSourceContext, ethereum } from '@graphprotocol/graph-ts'
import { TokenLaunched } from '../generated/HoodLauncher/HoodLauncher'
import { HoodToken } from '../generated/HoodLauncher/HoodToken'
import { CreatorFeePolicy, LauncherStats, LockedPosition, TokenFeePolicy, TokenLaunch } from '../generated/schema'
import { HoodToken as HoodTokenTemplate, LaunchPool as LaunchPoolTemplate } from '../generated/templates'
import { positionEntityId } from './fee-locker'
import { getToken, getUser } from './helpers'
import { ONE_BD, ZERO_BD, priceEthFromStartTick, supplyTokens } from './launch-pool'

const STATS_ID = 'launcher'

/** WETH on Robinhood Chain (4663) — the quote side of every launch pool. */
const WETH = Address.fromString('0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73')

/** Launcher v2's single FeeLocker — every v2 launch locked here. */
const LEGACY_FEE_LOCKER = Address.fromString('0x0606a93703B13A65997E439A713729c28e4bf883')

/** Venue ids follow the V4TradeManager dexId space; v2 launches are all Uniswap V3. */
const VENUE_UNISWAP_V3 = 1

/** Shared launch processing for both launcher generations. `venue` is the
 *  V4TradeManager dexId; `locker` is the FeeLocker the LP NFT landed in
 *  (needed because LockedPosition ids are locker-scoped). */
export function processTokenLaunch(
  tokenAddr: Address,
  creatorAddr: Address,
  poolAddr: Address,
  venue: i32,
  locker: Address,
  positionId: BigInt,
  supply: BigInt,
  startTick: i32,
  creatorBps: i32,
  maxWalletBps: i32,
  restrictionBlocks: BigInt,
  metadataURI: string,
  devBuyEth: BigInt,
  devBuyTokens: BigInt,
  block: ethereum.Block,
  txHash: Bytes,
): void {
  const token = getToken(tokenAddr)
  const creator = getUser(creatorAddr)

  const launch = new TokenLaunch(tokenAddr)
  launch.token = token.id
  launch.creator = creator.id
  launch.owner = creator.id // initial registry owner; updated on transfers
  launch.venue = venue
  launch.pool = poolAddr
  launch.positionId = positionId
  launch.supply = supply
  launch.startTick = startTick
  launch.creatorBps = creatorBps
  launch.maxWalletBps = maxWalletBps
  launch.restrictionBlocks = restrictionBlocks
  launch.metadataURI = metadataURI
  launch.devBuyEth = devBuyEth
  launch.devBuyTokens = devBuyTokens
  launch.createdAt = block.timestamp
  launch.createdAtBlock = block.number
  launch.createdTx = txHash

  // Live-market seed state — kept current per swap by the LaunchPool
  // template. startTick is token0-is-new-token oriented, so the seed price
  // needs no flip; tokenIsToken0 records the POOL's real ordering for the
  // swap handler's sqrtPriceX96 math.
  launch.tokenIsToken0 = tokenAddr.toHexString() < WETH.toHexString()
  const openPrice = priceEthFromStartTick(startTick)
  launch.initialMcapEth = openPrice.times(supplyTokens(supply))
  launch.lastPriceEth = openPrice
  launch.currentMcapEth = launch.initialMcapEth
  launch.mcapGrowth = ONE_BD
  launch.lastTradeAt = BigInt.zero()
  launch.poolTxCount = 0
  launch.poolBuys = 0
  launch.poolSells = 0
  launch.volumeEth = ZERO_BD

  // PositionLocked (the venue's FeeLocker) logs before TokenLaunched in the
  // same tx; LockedPosition ids are locker-scoped.
  const position = LockedPosition.load(positionEntityId(locker, positionId))
  if (position != null) launch.position = position.id

  // TokenPolicySet (both FeePolicyManagers) logs earlier in the same tx.
  const feePolicy = TokenFeePolicy.load(tokenAddr)
  if (feePolicy != null) {
    launch.feePolicy = feePolicy.id
    feePolicy.launch = launch.id
    feePolicy.save()
  }
  const creatorFeePolicy = CreatorFeePolicy.load(tokenAddr)
  if (creatorFeePolicy != null) {
    launch.creatorFeePolicy = creatorFeePolicy.id
    creatorFeePolicy.launch = launch.id
    creatorFeePolicy.save()
  }

  // On-chain metadata getters — not in the event, read once at launch.
  const hoodToken = HoodToken.bind(tokenAddr)
  const image = hoodToken.try_image()
  launch.image = image.reverted ? '' : image.value
  const description = hoodToken.try_description()
  launch.description = description.reverted ? '' : description.value
  const socials = hoodToken.try_socials()
  launch.socials = socials.reverted ? '' : socials.value

  launch.save()

  // Track creator-editable metadata updates from here on.
  HoodTokenTemplate.create(tokenAddr)

  // Watch the launch pool's swaps; the context carries the token address so
  // the swap handler can load this TokenLaunch (pools key by pool address).
  // SushiSwap V3 pools emit the byte-identical Swap event, so one template
  // covers every venue.
  const poolCtx = new DataSourceContext()
  poolCtx.setBytes('token', tokenAddr)
  LaunchPoolTemplate.createWithContext(poolAddr, poolCtx)

  let stats = LauncherStats.load(STATS_ID)
  if (stats == null) {
    stats = new LauncherStats(STATS_ID)
    stats.launchCount = 0
  }
  stats.launchCount += 1
  stats.save()
}

/** Launcher v2 (pre multi-venue): always Uniswap V3, always the legacy locker. */
export function handleTokenLaunched(event: TokenLaunched): void {
  processTokenLaunch(
    event.params.token,
    event.params.creator,
    event.params.pool,
    VENUE_UNISWAP_V3,
    LEGACY_FEE_LOCKER,
    event.params.positionId,
    event.params.supply,
    event.params.startTick,
    event.params.creatorBps,
    event.params.maxWalletBps,
    event.params.restrictionBlocks,
    event.params.metadataURI,
    event.params.devBuyEth,
    event.params.devBuyTokens,
    event.block,
    event.transaction.hash,
  )
}

import { Address } from '@graphprotocol/graph-ts'
import { HoodLauncher as HoodLauncherV3, TokenLaunched as TokenLaunchedV3 } from '../generated/HoodLauncherV3/HoodLauncher'
import { processTokenLaunch } from './launcher'

/**
 * Launcher v3 (multi-venue): TokenLaunched gains `venueId` (V4TradeManager
 * dexId space — 1 = Uniswap V3, 5 = SushiSwap V3). The venue's FeeLocker is
 * resolved from the launcher's own registry so the locker-scoped
 * LockedPosition link stays correct for every venue.
 */
export function handleTokenLaunchedV3(event: TokenLaunchedV3): void {
  const launcher = HoodLauncherV3.bind(event.address)
  const venue = launcher.try_getVenue(event.params.venueId)
  const locker = venue.reverted ? Address.zero() : Address.fromBytes(venue.value.feeLocker)

  processTokenLaunch(
    event.params.token,
    event.params.creator,
    event.params.pool,
    event.params.venueId,
    locker,
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

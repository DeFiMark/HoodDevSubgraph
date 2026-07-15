import { Address } from '@graphprotocol/graph-ts'
import { TradeExecuted } from '../generated/V2TradeManager/V2TradeManager'
import { recordTrade } from './trade-manager'

/**
 * V2TradeManager variant of TradeExecuted: same core shape as V1 plus
 * `ref` + `refFee` (the referral carve-out OF the platform fee — `fee` stays
 * the total, so TerminalStats.feesEth remains comparable across generations).
 */
export function handleTradeExecutedV2(event: TradeExecuted): void {
  const ref = event.params.ref
  const hasRef = ref.notEqual(Address.zero())
  recordTrade(
    event,
    event.params.user,
    event.params.token,
    event.params.isBuy,
    event.params.dex,
    event.params.ethAmount,
    event.params.tokenAmount,
    event.params.fee,
    hasRef ? ref : null,
    event.params.refFee,
  )
}

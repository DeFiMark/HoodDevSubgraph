import { TradeFeeReceived, Withdrawn } from '../generated/TradeFeeReceiver/TradeFeeReceiver'
import { getTerminalStats } from './trade-manager'

export function handleTradeFeeReceived(event: TradeFeeReceived): void {
  const stats = getTerminalStats()
  stats.feesReceivedEth = stats.feesReceivedEth.plus(event.params.amount)
  stats.save()
}

export function handleWithdrawn(event: Withdrawn): void {
  const stats = getTerminalStats()
  stats.feesWithdrawnEth = stats.feesWithdrawnEth.plus(event.params.amount)
  stats.save()
}

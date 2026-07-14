import { Address, BigInt, Bytes } from '@graphprotocol/graph-ts'
import { TradeExecuted } from '../generated/V1TradeManager/V1TradeManager'
import { Token, Trade, TraderPosition, TraderStats, TerminalStats } from '../generated/schema'
import { getToken, getUser } from './helpers'

export const TERMINAL_STATS_ID = 'terminal'

export function getTerminalStats(): TerminalStats {
  let stats = TerminalStats.load(TERMINAL_STATS_ID)
  if (stats == null) {
    stats = new TerminalStats(TERMINAL_STATS_ID)
    stats.tradeCount = 0
    stats.volumeEth = BigInt.zero()
    stats.feesEth = BigInt.zero()
    stats.feesReceivedEth = BigInt.zero()
    stats.feesWithdrawnEth = BigInt.zero()
  }
  return stats
}

export function handleTradeExecuted(event: TradeExecuted): void {
  const token = getToken(event.params.token)
  const user = getUser(event.params.user)
  const isBuy = event.params.isBuy
  const ethAmount = event.params.ethAmount
  const fee = event.params.fee

  const trade = new Trade(event.transaction.hash.concatI32(event.logIndex.toI32()))
  trade.user = user.id
  trade.token = token.id
  trade.isBuy = isBuy
  trade.dex = event.params.dex
  trade.ethAmount = ethAmount
  trade.tokenAmount = event.params.tokenAmount
  trade.fee = fee
  trade.timestamp = event.block.timestamp
  trade.block = event.block.number
  trade.tx = event.transaction.hash
  trade.save()

  // Lifetime per-user aggregates.
  let stats = TraderStats.load(event.params.user)
  if (stats == null) {
    stats = new TraderStats(event.params.user)
    stats.user = user.id
    stats.tradeCount = 0
    stats.volumeEth = BigInt.zero()
    stats.feesPaidEth = BigInt.zero()
    stats.firstTradeAt = event.block.timestamp
  }
  stats.tradeCount += 1
  stats.volumeEth = stats.volumeEth.plus(ethAmount)
  stats.feesPaidEth = stats.feesPaidEth.plus(fee)
  stats.lastTradeAt = event.block.timestamp
  stats.save()

  // Per-user-per-token position (PnL raw material).
  const positionId = event.params.user.concat(event.params.token)
  let position = TraderPosition.load(positionId)
  if (position == null) {
    position = new TraderPosition(positionId)
    position.user = user.id
    position.token = token.id
    position.tradeCount = 0
    position.buyCount = 0
    position.sellCount = 0
    position.tokensBought = BigInt.zero()
    position.tokensSold = BigInt.zero()
    position.ethSpent = BigInt.zero()
    position.ethReceived = BigInt.zero()
    position.feesPaidEth = BigInt.zero()
  }
  position.tradeCount += 1
  if (isBuy) {
    position.buyCount += 1
    position.tokensBought = position.tokensBought.plus(event.params.tokenAmount)
    position.ethSpent = position.ethSpent.plus(ethAmount) // gross: fee is a real cost
  } else {
    position.sellCount += 1
    position.tokensSold = position.tokensSold.plus(event.params.tokenAmount)
    position.ethReceived = position.ethReceived.plus(ethAmount.minus(fee)) // net: what the user got
  }
  position.feesPaidEth = position.feesPaidEth.plus(fee)
  position.lastTradeAt = event.block.timestamp
  position.save()

  const terminal = getTerminalStats()
  terminal.tradeCount += 1
  terminal.volumeEth = terminal.volumeEth.plus(ethAmount)
  terminal.feesEth = terminal.feesEth.plus(fee)
  terminal.save()
}

import { Address, BigInt, Bytes, ethereum } from '@graphprotocol/graph-ts'
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
    stats.referralFeesEth = BigInt.zero()
  }
  return stats
}

/**
 * Shared trade recorder for both trade-manager generations. V1 passes
 * referrer = null and refFee = 0; V2 passes its event's referral fields.
 * `fee` is the TOTAL platform fee (protocol + referral carve-out).
 */
export function recordTrade(
  event: ethereum.Event,
  userAddr: Address,
  tokenAddr: Address,
  isBuy: boolean,
  dex: i32,
  ethAmount: BigInt,
  tokenAmount: BigInt,
  fee: BigInt,
  referrer: Address | null,
  refFee: BigInt,
): void {
  const token = getToken(tokenAddr)
  const user = getUser(userAddr)

  const trade = new Trade(event.transaction.hash.concatI32(event.logIndex.toI32()))
  trade.user = user.id
  trade.token = token.id
  trade.isBuy = isBuy
  trade.dex = dex
  trade.ethAmount = ethAmount
  trade.tokenAmount = tokenAmount
  trade.fee = fee
  trade.referrer = referrer === null ? null : Bytes.fromByteArray(referrer)
  trade.refFee = refFee
  trade.timestamp = event.block.timestamp
  trade.block = event.block.number
  trade.tx = event.transaction.hash
  trade.save()

  // Lifetime per-user aggregates.
  let stats = TraderStats.load(userAddr)
  if (stats == null) {
    stats = new TraderStats(userAddr)
    stats.user = user.id
    stats.tradeCount = 0
    stats.volumeEth = BigInt.zero()
    stats.feesPaidEth = BigInt.zero()
    stats.referralFeesGeneratedEth = BigInt.zero()
    stats.firstTradeAt = event.block.timestamp
  }
  stats.tradeCount += 1
  stats.volumeEth = stats.volumeEth.plus(ethAmount)
  stats.feesPaidEth = stats.feesPaidEth.plus(fee)
  stats.referralFeesGeneratedEth = stats.referralFeesGeneratedEth.plus(refFee)
  stats.lastTradeAt = event.block.timestamp
  stats.save()

  // Per-user-per-token position (PnL raw material).
  const positionId = userAddr.concat(tokenAddr)
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
    position.tokensBought = position.tokensBought.plus(tokenAmount)
    position.ethSpent = position.ethSpent.plus(ethAmount) // gross: fee is a real cost
  } else {
    position.sellCount += 1
    position.tokensSold = position.tokensSold.plus(tokenAmount)
    position.ethReceived = position.ethReceived.plus(ethAmount.minus(fee)) // net: what the user got
  }
  position.feesPaidEth = position.feesPaidEth.plus(fee)
  position.lastTradeAt = event.block.timestamp
  position.save()

  const terminal = getTerminalStats()
  terminal.tradeCount += 1
  terminal.volumeEth = terminal.volumeEth.plus(ethAmount)
  terminal.feesEth = terminal.feesEth.plus(fee)
  terminal.referralFeesEth = terminal.referralFeesEth.plus(refFee)
  terminal.save()
}

export function handleTradeExecuted(event: TradeExecuted): void {
  recordTrade(
    event,
    event.params.user,
    event.params.token,
    event.params.isBuy,
    event.params.dex,
    event.params.ethAmount,
    event.params.tokenAmount,
    event.params.fee,
    null,
    BigInt.zero(),
  )
}

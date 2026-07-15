import { BigDecimal, BigInt, dataSource } from '@graphprotocol/graph-ts'
import { Swap } from '../generated/templates/LaunchPool/UniswapV3Pool'
import { LaunchHourData, TokenLaunch } from '../generated/schema'

/**
 * Live market state for launched tokens, from the canonical launch pool's
 * swaps. Every price figure is ETH per WHOLE token: HoodTokens and WETH are
 * both 18 decimals, so the pool's base-unit ratio IS the whole-token ratio —
 * no decimal shifting anywhere here.
 */

export const ZERO_BD = BigDecimal.fromString('0')
export const ONE_BD = BigDecimal.fromString('1')
const E18 = BigDecimal.fromString('1000000000000000000')
const Q96 = BigDecimal.fromString('79228162514264337593543950336') // 2^96
const TICK_BASE = BigDecimal.fromString('1.0001')

/**
 * base^exp by squaring (graph-node BigDecimal caps significant digits, so the
 * intermediate squares stay bounded). Negative exponents invert at the end —
 * launch ticks are large negatives (token priced far below 1 ETH).
 */
export function bigDecimalPow(base: BigDecimal, exp: i32): BigDecimal {
  let result = ONE_BD
  let b = base
  let e = exp < 0 ? -exp : exp
  while (e > 0) {
    if (e % 2 == 1) result = result.times(b)
    e = e / 2
    if (e > 0) b = b.times(b)
  }
  return exp < 0 ? ONE_BD.div(result) : result
}

/** Pool-opening price from the stored tick (token0-is-new-token orientation). */
export function priceEthFromStartTick(tick: i32): BigDecimal {
  return bigDecimalPow(TICK_BASE, tick)
}

/** `supply` (18-dec base units) as whole tokens. */
export function supplyTokens(supply: BigInt): BigDecimal {
  return supply.toBigDecimal().div(E18)
}

export function handleLaunchPoolSwap(event: Swap): void {
  // The template is created with the token address in its context — pools
  // key by pool address but TokenLaunch keys by token.
  const token = dataSource.context().getBytes('token')
  const launch = TokenLaunch.load(token)
  if (launch == null) return

  // sqrtPriceX96 → price of token1 in token0 terms: (sqrt/2^96)^2, then
  // orient so the figure is always "ETH per token".
  const sqrt = event.params.sqrtPriceX96.toBigDecimal().div(Q96)
  const rawPrice = sqrt.times(sqrt) // token1 per token0
  let price: BigDecimal
  if (launch.tokenIsToken0) {
    price = rawPrice // quote (WETH) per base (token) directly
  } else {
    price = rawPrice.equals(ZERO_BD) ? ZERO_BD : ONE_BD.div(rawPrice)
  }

  launch.lastPriceEth = price
  launch.currentMcapEth = price.times(supplyTokens(launch.supply))
  launch.mcapGrowth = launch.initialMcapEth.equals(ZERO_BD)
    ? ZERO_BD
    : launch.currentMcapEth.div(launch.initialMcapEth)

  // Volume counts the ETH side; a "buy" is the pool paying out the token
  // (its token-side amount is negative).
  const wethAmount = launch.tokenIsToken0 ? event.params.amount1 : event.params.amount0
  const tokenAmount = launch.tokenIsToken0 ? event.params.amount0 : event.params.amount1
  const volEth = wethAmount.abs().toBigDecimal().div(E18)
  const isBuy = tokenAmount.lt(BigInt.zero())

  launch.volumeEth = launch.volumeEth.plus(volEth)
  launch.poolTxCount += 1
  if (isBuy) launch.poolBuys += 1
  else launch.poolSells += 1
  launch.lastTradeAt = event.block.timestamp
  launch.save()

  const hourIndex = event.block.timestamp.toI32() / 3600
  const id = token.concatI32(hourIndex)
  let hour = LaunchHourData.load(id)
  if (hour == null) {
    hour = new LaunchHourData(id)
    hour.launch = launch.id
    hour.hourStart = BigInt.fromI32(hourIndex * 3600)
    hour.volumeEth = ZERO_BD
    hour.txCount = 0
    hour.buys = 0
    hour.sells = 0
  }
  hour.volumeEth = hour.volumeEth.plus(volEth)
  hour.txCount += 1
  if (isBuy) hour.buys += 1
  else hour.sells += 1
  hour.save()
}

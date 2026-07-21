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

/**
 * √(opening price) — the other half of the bonding math, computed EXACTLY as
 * 1.0001^(startTick/2) rather than by taking a square root (BigDecimal has no
 * sqrt, and going through f64 would bleed precision into a number we display).
 *
 * The halving is lossless because HoodLauncher rejects any tick that isn't a
 * multiple of TICK_SPACING = 200 (`_validate` → `InvalidTick`), so startTick/2
 * is always a whole multiple of 100. Do not relax that check without revisiting
 * this.
 */
export function sqrtPriceEthFromStartTick(tick: i32): BigDecimal {
  return bigDecimalPow(TICK_BASE, tick / 2)
}

/**
 * The bond goal, in ETH. Flat for the launches everyone actually does, with a
 * floor tied to the opening FDV so a token launched near the top of the
 * launcher's FDV band can't open already-bonded.
 *
 * Both are POLICY. `bondedEth` is the underlying fact — re-derive progress off
 * that if these move, rather than paying for a resync.
 */
const BOND_TARGET_ETH = BigDecimal.fromString('5')
/** √3 − 1: the floor makes bonding mean "≥3x from launch" as well as "≥5 ETH in". */
const BOND_MIN_MULTIPLE_TERM = BigDecimal.fromString('0.732050807568877293527446341505872')

export function bondTargetEthFor(initialMcapEth: BigDecimal): BigDecimal {
  const floor = initialMcapEth.times(BOND_MIN_MULTIPLE_TERM)
  return floor.gt(BOND_TARGET_ETH) ? floor : BOND_TARGET_ETH
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

  // ---- bonding progress --------------------------------------------------
  // The launch position holds the ENTIRE supply single-sided over
  // [startTick, MAX_TICK], so it IS a bonding curve and the WETH inside it is
  // a closed form of price — no volume accounting, no pool balance read:
  //
  //   L      = supply · √P₀            (the upper bound is ~24 orders of
  //                                     magnitude away, so its term vanishes)
  //   weth   = L · (√P − √P₀)
  //
  // and the pool already handed us √P as sqrtPriceX96, so this is exact.
  // Note it tracks price BOTH ways: sells pull ETH back out and the bar drops.
  const sqrtP0 = sqrtPriceEthFromStartTick(launch.startTick)
  const sqrtP = launch.tokenIsToken0 ? sqrt : sqrt.equals(ZERO_BD) ? ZERO_BD : ONE_BD.div(sqrt)
  const bonded = supplyTokens(launch.supply).times(sqrtP0).times(sqrtP.minus(sqrtP0))
  launch.bondedEth = bonded.gt(ZERO_BD) ? bonded : ZERO_BD

  const progress = launch.bondTargetEth.equals(ZERO_BD)
    ? ZERO_BD
    : launch.bondedEth.div(launch.bondTargetEth)
  launch.bondProgress = progress.gt(ONE_BD) ? ONE_BD : progress
  // Latch on the UNCLAMPED value, and only once — bondedAt is the moment it
  // first crossed, not the last time it was above water.
  if (!launch.hasBonded && progress.ge(ONE_BD)) {
    launch.hasBonded = true
    launch.bondedAt = event.block.timestamp
  }

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

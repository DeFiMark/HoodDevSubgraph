import { Address, BigInt } from '@graphprotocol/graph-ts'
import { ERC20 } from '../generated/HoodLocker/ERC20'
import { Token, User } from '../generated/schema'

export function getUser(address: Address): User {
  let user = User.load(address)
  if (user == null) {
    user = new User(address)
    user.save()
  }
  return user
}

export function getToken(address: Address): Token {
  let token = Token.load(address)
  if (token == null) {
    token = new Token(address)
    const erc20 = ERC20.bind(address)

    const symbol = erc20.try_symbol()
    token.symbol = symbol.reverted ? 'UNKNOWN' : symbol.value
    const name = erc20.try_name()
    token.name = name.reverted ? 'Unknown Token' : name.value
    const decimals = erc20.try_decimals()
    token.decimals = decimals.reverted ? 18 : decimals.value

    token.totalLocked = BigInt.zero()
    token.totalVesting = BigInt.zero()
    token.save()
  }
  return token
}

import { TokenOwnershipTransferred } from '../generated/TokenOwnerRegistry/TokenOwnerRegistry'
import { TokenLaunch } from '../generated/schema'
import { getUser } from './helpers'

export function handleTokenOwnershipTransferred(event: TokenOwnershipTransferred): void {
  // Initial registration fires before TokenLaunched in the launch tx; the
  // launcher handler sets the initial owner, so a missing launch is fine here.
  const launch = TokenLaunch.load(event.params.token)
  if (launch == null) return
  launch.owner = getUser(event.params.newOwner).id // zero address = renounced
  launch.save()
}

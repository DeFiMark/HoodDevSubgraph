import { dataSource } from '@graphprotocol/graph-ts'
import {
  ContractURIUpdated,
  DescriptionUpdated,
  HoodToken,
  ImageUpdated,
  SocialsUpdated,
} from '../generated/templates/HoodToken/HoodToken'
import { TokenLaunch } from '../generated/schema'

function loadLaunch(): TokenLaunch | null {
  return TokenLaunch.load(dataSource.address())
}

export function handleContractURIUpdated(event: ContractURIUpdated): void {
  const launch = loadLaunch()
  if (launch == null) return

  // ERC-7572: the event carries no args — re-read the URI.
  const uri = HoodToken.bind(event.address).try_contractURI()
  if (!uri.reverted) {
    launch.metadataURI = uri.value
    launch.save()
  }
}

export function handleImageUpdated(event: ImageUpdated): void {
  const launch = loadLaunch()
  if (launch == null) return
  launch.image = event.params.image
  launch.save()
}

export function handleDescriptionUpdated(event: DescriptionUpdated): void {
  const launch = loadLaunch()
  if (launch == null) return
  launch.description = event.params.description
  launch.save()
}

export function handleSocialsUpdated(event: SocialsUpdated): void {
  const launch = loadLaunch()
  if (launch == null) return
  launch.socials = event.params.socials
  launch.save()
}

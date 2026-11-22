import { useContext } from 'react'
import { onProfilesList, type ProfilesView } from '../rpc/profiles.js'
import { usePolled } from '../lib/use-async.js'
import { PROFILES_PAGE } from '../lib/use-route.js'
import { HostServicesContext, INERT_HOST_SERVICES } from '../lib/host-services.js'
import { LinePart, counted } from './LinePart.js'

// The Overview's line on the person's profiles: how many, by name on a hover, and their page a press
// away. The Profiles page's own read, kept under its name, so either shows the other's at once.

/** Read again this seldom: profiles change when the person changes them, on their page. */
const EVERY_MS = 60_000

export function YourProfilesPart() {
  const services = useContext(HostServicesContext) ?? INERT_HOST_SERVICES
  const { value } = usePolled<ProfilesView | undefined>(onProfilesList, undefined, EVERY_MS, [], { remember: 'profiles' })
  return (
    <LinePart reading={value === undefined} note={value?.profiles.map(profile => profile.name).join(', ')} href={`/${PROFILES_PAGE}`} onClick={() => services.openPage(PROFILES_PAGE)}>
      {counted(value?.profiles.length ?? 0, 'agent profile', 'agent profiles', 'no agent profiles')}
    </LinePart>
  )
}

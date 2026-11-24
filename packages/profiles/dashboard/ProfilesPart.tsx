import { LinePart, counted, useModuleHost } from '@openagt/ui/module'
import { PROFILES_PAGE, useProfiles } from './calls.js'

// The Overview's line on the person's profiles (`overview.line`): how many, by name on a hover, and
// their page a press away. The Profiles page's own read, kept under its name, so either shows the
// other's at once.

export function ProfilesPart() {
  const host = useModuleHost()
  const { read } = useProfiles(host)
  return (
    <LinePart reading={read === undefined} note={read?.profiles.map(profile => profile.name).join(', ')} href={host.pageHref(PROFILES_PAGE)} onClick={() => host.openPage(PROFILES_PAGE)}>
      {counted(read?.profiles.length ?? 0, 'agent profile', 'agent profiles', 'no agent profiles')}
    </LinePart>
  )
}

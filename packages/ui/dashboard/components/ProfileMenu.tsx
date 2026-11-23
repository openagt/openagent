import { useContext } from 'react'
import { Bot, Check, Settings2 } from 'lucide-react'
import type { Profile } from '../rpc/profiles.js'
import { DEFAULT_PROFILE } from '../../src/client.js'
import { PROFILES_PAGE } from '../lib/use-route.js'
import { HostServicesContext, INERT_HOST_SERVICES } from '../lib/host-services.js'
import { cn } from '../lib/utils.js'
import { SetupLine, SetupSaid } from './SessionSetup.js'
import { useProfileName } from './ProfilesPage.js'
import { DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator } from './ui/dropdown-menu.js'

/**
 * The "Profile" line of the launcher's gear menu, its first: which profile the session is on, by name.
 * Its options are the session's where the session picks none: the accounts it works as, and the
 * project's own skills it gets. The pick is saved, as the model's is, and "Manage profiles…" opens
 * the Profiles page. Drawn once the profiles are read, so the name lands whole.
 */
export function ProfileMenu({ profiles, picked, onPick }: { profiles: readonly Profile[] | undefined; picked: string | undefined; onPick: (id: string) => void }) {
  const services = useContext(HostServicesContext) ?? INERT_HOST_SERVICES
  if (!profiles) return null
  const on = profiles.find(profile => profile.id === picked) ?? profiles[0]
  if (!on) return null
  return (
    <SetupLine icon={<Bot aria-hidden />} label="Profile" value={<span className="truncate">{on.name}</span>} className="min-w-[14rem]">
      <DropdownMenuGroup>
        <DropdownMenuLabel>Profile</DropdownMenuLabel>
        {/* The tick leads here: the row's end is for the GitHub account a profile works as. */}
        {profiles.map(profile => (
          <DropdownMenuItem key={profile.id} onClick={() => onPick(profile.id)}>
            <Check className={cn('h-3.5 w-3.5 shrink-0', profile.id === on.id ? 'opacity-100' : 'opacity-0')} aria-hidden />
            <span className="flex-1 truncate">{profile.name}</span>
            {profile.options.github?.account !== undefined && <span className="shrink-0 text-xs text-muted-foreground">{`@${profile.options.github.account}`}</span>}
          </DropdownMenuItem>
        ))}
      </DropdownMenuGroup>
      <DropdownMenuSeparator />
      <DropdownMenuItem onClick={() => services.openPage(PROFILES_PAGE)}>
        <Settings2 className="h-3.5 w-3.5 shrink-0 opacity-70" aria-hidden />
        Manage profiles…
      </DropdownMenuItem>
    </SetupLine>
  )
}

/**
 * A session's "Profile" line, in the launcher's place, said and not offered: the profile the session
 * is on, as its record says, Default where it names none. Drawn once the profiles are read, as the menu is.
 */
export function ProfileOff({ profile }: { profile: string | undefined }) {
  const name = useProfileName(profile ?? DEFAULT_PROFILE)
  if (name === undefined) return null
  return <SetupSaid icon={<Bot aria-hidden />} label="Profile" value={<span className="truncate">{name}</span>} tip={`This session is on the profile ${name}: its accounts, and the project skills it gets`} />
}

import { useContext } from 'react'
import { Bot, Check, Settings2 } from 'lucide-react'
import type { Profile } from '../rpc/profiles.js'
import { DEFAULT_PROFILE } from '../../src/client.js'
import { PROFILES_PAGE } from '../lib/use-route.js'
import { HostServicesContext, INERT_HOST_SERVICES } from '../lib/host-services.js'
import { cn } from '../lib/utils.js'
import { RowSaid, rowButtonClass, RowChevron } from './ui/row-item.js'
import { useProfileName } from './ProfilesPage.js'
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip.js'
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from './ui/dropdown-menu.js'

/**
 * The launcher's "Profile" menu, first under the box: which profile the session is on, by name. Its
 * options are the session's where the session picks none: the accounts it works as, and the
 * project's own skills it gets. The pick is saved, as the model's is, and "Manage profiles…" opens
 * the Profiles page. Drawn once the profiles are read, so the name lands whole.
 */
export function ProfileMenu({ profiles, picked, busy, onPick }: { profiles: readonly Profile[] | undefined; picked: string | undefined; busy: boolean; onPick: (id: string) => void }) {
  const services = useContext(HostServicesContext) ?? INERT_HOST_SERVICES
  if (!profiles) return null
  const on = profiles.find(profile => profile.id === picked) ?? profiles[0]
  if (!on) return null
  const account = on.options.github?.account
  const said = `This session is on the profile ${on.name}${account !== undefined ? `, as @${account} on GitHub` : ''}`
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger render={<DropdownMenuTrigger type="button" disabled={busy} aria-label={`Profile: ${on.name}`} className={rowButtonClass} />}>
          <Bot className="size-4 shrink-0" aria-hidden />
          <span className="max-w-32 truncate @max-xl:max-w-20">{on.name}</span>
          <RowChevron />
        </TooltipTrigger>
        <TooltipContent>{said}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="start" className="min-w-[14rem]">
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
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/**
 * The session page's "Profile", in the launcher's place, as words, not a press: the profile the session
 * is on, as its record says, Default where it names none. Drawn once the profiles are read, as the menu is.
 */
export function ProfileOff({ profile }: { profile: string | undefined }) {
  const name = useProfileName(profile ?? DEFAULT_PROFILE)
  if (name === undefined) return null
  return (
    <RowSaid tip={`This session is on the profile ${name}: its accounts, and the project skills it gets`}>
      <Bot className="size-4 shrink-0" aria-hidden />
      <span className="sr-only">Profile: </span>
      <span className="max-w-32 truncate @max-xl:max-w-20">{name}</span>
    </RowSaid>
  )
}

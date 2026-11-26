import { useEffect } from 'react'
import { Bot, Settings2 } from 'lucide-react'
import { MenuTick, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, SetupLine, SetupSaid, cn, tellNextRunPicked, useModuleHost, type UiComposerControlProps } from '@openagt/ui/module'
import { DEFAULT_PROFILE } from '@openagt/hooks'
import { PROFILES_PAGE, pickProfile, useProfiles } from './calls.js'

/**
 * The "Profile" line of the gear's menu under the message box, its first (`composer.control` at
 * `setup`): which profile the session is on, by name. Its options are the session's where the
 * session picks none. In the launcher it picks the profile of every next run on this computer,
 * saved as the computer's pick, and "Manage profiles…" opens the Profiles page; in a session it says
 * the profile the session's record names, and offers none; in a profile's editor it is not drawn.
 * Drawn once the profiles are read, so the name lands whole.
 */
export function ProfileControl(props: UiComposerControlProps) {
  if (props.in === 'profile') return null
  return props.in === 'session' ? <SessionProfile {...props} /> : <PickedProfile {...props} />
}

/** Says `name` for the gear's hover while it is drawn, and nothing once it goes. */
function Said({ say, name }: Pick<UiComposerControlProps, 'say'> & { name: string | undefined }) {
  useEffect(() => say(name === undefined ? undefined : { words: `Profile ${name}` }), [say, name])
  return null
}

function PickedProfile({ say, busy }: UiComposerControlProps) {
  const host = useModuleHost()
  const { read, reload } = useProfiles(host)
  const on = read && (read.profiles.find(profile => profile.id === read.picked) ?? read.profiles[0])
  const pick = async (id: string) => {
    if (id === on?.id) return
    await pickProfile(host, id)
    tellNextRunPicked()
    await reload()
  }
  return (
    <>
      <Said say={say} name={on?.name} />
      {read && on && (
        <SetupLine icon={<Bot aria-hidden />} label="Profile" value={<span className="truncate">{on.name}</span>} disabled={busy} className="min-w-[14rem]">
          <DropdownMenuGroup>
            <DropdownMenuLabel>Profile</DropdownMenuLabel>
            {read.profiles.map(profile => (
              <DropdownMenuItem key={profile.id} onClick={() => void pick(profile.id)}>
                <span className="flex-1 truncate">{profile.name}</span>
                <MenuTick on={profile.id === on.id} />
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => host.openPage(PROFILES_PAGE)}>
            <Settings2 className="h-3.5 w-3.5 shrink-0 opacity-70" aria-hidden />
            Manage profiles…
          </DropdownMenuItem>
        </SetupLine>
      )}
    </>
  )
}

/**
 * A session's "Profile" line, in the launcher's place, said and not offered: the profile the session
 * is on, as its record says, Default where it names none; the id itself for one this computer does
 * not have.
 */
function SessionProfile({ options, say }: UiComposerControlProps) {
  const host = useModuleHost()
  const { read } = useProfiles(host)
  const id = options.profiles?.profile ?? DEFAULT_PROFILE
  const name = read ? (read.profiles.find(profile => profile.id === id)?.name ?? id) : undefined
  return (
    <>
      <Said say={say} name={name} />
      {name !== undefined && <SetupSaid icon={<Bot aria-hidden />} label="Profile" value={<span className="truncate">{name}</span>} tip={`This session is on the profile ${name}: its accounts, and the project skills it gets`} />}
    </>
  )
}

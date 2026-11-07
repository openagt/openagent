import { openPermissions } from '../lib/use-route.js'
import { useState } from 'react'
import { CircleAlert, Settings } from 'lucide-react'
import type { Person } from '../rpc/person.js'
import { usePerson } from '../lib/use-person.js'
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from './ui/dropdown-menu.js'
import { ThemeSubmenu } from './ThemeSubmenu.js'
import { NotificationsSubmenu } from './NotificationsSubmenu.js'
import { useMissing } from './Logins.js'

// The foot of the sidebar: the person at this dashboard, their picture and first name, as one row
// that opens their menu (his pick, over a row of three icons): the theme, the notifications, and
// Settings, under their whole name. The accounts a run takes are picked where the run is started,
// beside the message box, for the computer it goes to: the agent's in the agent picker, the git
// host's after the branch; not here a second time. A dot on the picture says something runs need is missing; the menu says what. The gear at the row's end says what the row opens. The name and
// the picture are the person's own, set in Settings › Profile (`onPerson`); with no picture, their initials.

/** The first word of a name: what the row says, the whole name being in the menu. */
export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name
}

/** Up to two initials of a name: "Suleiman Shahbari" is "SS", "octo" is "O". */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  return (words.length > 1 ? `${words[0]![0]}${words.at(-1)![0]}` : (words[0]?.[0] ?? '?')).toUpperCase()
}

/** A person's picture, or their initials; `dot` says something runs need is missing. */
export function Avatar({ person, dot = false, size = 'h-6 w-6 text-[10px]' }: { person: Person | null; dot?: boolean; size?: string }) {
  // A picture that does not load leaves the initials, never a broken image.
  const [broken, setBroken] = useState(false)
  const picture = person?.avatar && !broken ? person.avatar : undefined
  return (
    <span aria-hidden className="relative shrink-0">
      <span className={`flex ${size} items-center justify-center overflow-hidden rounded-full bg-muted font-medium text-muted-foreground`}>
        {picture ? <img src={picture} alt="" referrerPolicy="no-referrer" className="h-full w-full object-cover" onError={() => setBroken(true)} /> : person ? initials(person.name) : null}
      </span>
      {dot && <span data-testid="missing-dot" className="absolute -top-0.5 -right-0.5 size-2 rounded-full bg-warning ring-2 ring-sidebar" />}
    </span>
  )
}

export function PersonMenu({ onSettings }: { onSettings: (entry?: string) => void }) {
  const { person } = usePerson()
  const { missing } = useMissing()
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`${person ? `${person.name}: settings` : 'Settings'}${missing.length > 0 ? ', something is missing' : ''}`}
        className="flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm outline-none hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-sidebar-ring data-[popup-open]:bg-sidebar-accent"
      >
        <Avatar person={person} dot={missing.length > 0} />
        <span className="min-w-0 flex-1 truncate">{person ? firstName(person.name) : ''}</span>
        <Settings className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[14rem]">
        {person && (
          <>
            <DropdownMenuGroup>
              <DropdownMenuLabel className="flex flex-col">
                <span className="truncate text-foreground">{person.name}</span>
                {person.github && <span className="truncate font-normal">@{person.github}</span>}
              </DropdownMenuLabel>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
          </>
        )}
        {missing.length > 0 && (
          <>
            {missing.map(item => (
              <DropdownMenuItem key={item.key} onClick={openPermissions} className="text-warning">
                <CircleAlert className="h-3.5 w-3.5 shrink-0" aria-hidden />
                <span className="flex-1 truncate">{item.words}</span>
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
          </>
        )}
        <ThemeSubmenu />
        <NotificationsSubmenu />
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => onSettings()}>
          <Settings className="h-3.5 w-3.5 shrink-0 opacity-70" aria-hidden />
          Settings
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

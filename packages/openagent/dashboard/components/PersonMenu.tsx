import { useState } from 'react'
import { Settings } from 'lucide-react'
import { onPerson, type Person } from '../rpc/person.js'
import { useLoaded } from '../lib/use-async.js'
import { cn } from '../lib/utils.js'
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from './ui/dropdown-menu.js'
import { ThemeSubmenu } from './ThemeSubmenu.js'
import { NotificationsSubmenu } from './NotificationsSubmenu.js'

// The foot of the sidebar: the person at this dashboard, their picture and first name, as one row
// that opens their menu (his pick, over a row of three icons): the theme, the notifications, and
// Settings, under their whole name. The gear at the row's end says what the row opens. The name is
// git's, the picture the git host's (`onPerson`); with no picture, their initials.

/** The first word of a name: what the row says, the whole name being in the menu. */
export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name
}

/** Up to two initials of a name: "Suleiman Shahbari" is "SS", "octo" is "O". */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  return (words.length > 1 ? `${words[0]![0]}${words.at(-1)![0]}` : (words[0]?.[0] ?? '?')).toUpperCase()
}

function Avatar({ person }: { person: Person | null }) {
  // A picture that does not load leaves the initials, never a broken image.
  const [broken, setBroken] = useState(false)
  const picture = person?.avatar && !broken ? person.avatar : undefined
  return (
    <span aria-hidden className="flex h-6 w-6 shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted text-[10px] font-medium text-muted-foreground">
      {picture ? <img src={picture} alt="" referrerPolicy="no-referrer" className="h-full w-full object-cover" onError={() => setBroken(true)} /> : person ? initials(person.name) : null}
    </span>
  )
}

export function PersonMenu({ atSettings, onSettings }: { atSettings?: boolean | undefined; onSettings: () => void }) {
  const person = useLoaded<Person | null>(() => onPerson().catch(() => null), null, [])
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={person ? `${person.name}: settings` : 'Settings'}
        aria-current={atSettings ? 'page' : undefined}
        className={cn(
          'flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm outline-none hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-sidebar-ring data-[popup-open]:bg-sidebar-accent',
          atSettings && 'bg-sidebar-accent text-sidebar-accent-foreground',
        )}
      >
        <Avatar person={person} />
        <span className="min-w-0 flex-1 truncate">{person ? firstName(person.name) : ''}</span>
        <Settings className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[14rem]">
        {person && (
          <>
            <DropdownMenuGroup>
              <DropdownMenuLabel className="flex flex-col">
                <span className="truncate text-foreground">{person.name}</span>
                {person.login && <span className="truncate font-normal">@{person.login}</span>}
              </DropdownMenuLabel>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
          </>
        )}
        <ThemeSubmenu />
        <NotificationsSubmenu />
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={onSettings}>
          <Settings className="h-3.5 w-3.5 shrink-0 opacity-70" aria-hidden />
          Settings
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

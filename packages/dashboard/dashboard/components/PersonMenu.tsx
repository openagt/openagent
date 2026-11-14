import { openPermissions } from '../lib/use-route.js'
import { useState } from 'react'
import { CircleAlert, Settings } from 'lucide-react'
import type { Person } from '../rpc/person.js'
import { usePerson } from '../lib/use-person.js'
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from './ui/dropdown-menu.js'
import { ThemeSubmenu } from './ThemeSubmenu.js'
import { NotificationsSubmenu } from './NotificationsSubmenu.js'
import { useMissing } from './Logins.js'
import { useBackup } from '../lib/use-backup.js'
import { AGENT_DATA_ENTRY } from './AgentDataSettings.js'
import { cn } from '../lib/utils.js'

// The foot of the sidebar: the person at this dashboard, their picture and first name, as one row
// that opens their menu (his pick, over a row of three icons): the theme, the notifications, and
// Settings, under their whole name. The accounts a run takes are picked where the run is started,
// beside the message box, for the computer it goes to: the agent's in the agent picker, the git
// host's after the branch; not here a second time. A dot on the picture says something runs need is missing, or that the agents' data is not backed up; the menu says what. The gear at the row's end says what the row opens. The name and
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
export function Avatar({ person, dot = false, size = 'size-5 text-xs', className }: { person: Person | null; dot?: boolean; size?: string; className?: string }) {
  // A picture that does not load leaves the initials, never a broken image.
  const [broken, setBroken] = useState(false)
  const picture = person?.avatar && !broken ? person.avatar : undefined
  return (
    <span aria-hidden className={cn('relative shrink-0', className)}>
      <span className={`flex ${size} items-center justify-center overflow-hidden rounded-full bg-muted-foreground/15 font-medium text-muted-foreground`}>
        {picture ? <img src={picture} alt="" referrerPolicy="no-referrer" className="h-full w-full object-cover" onError={() => setBroken(true)} /> : person ? initials(person.name) : null}
      </span>
      {/* On the circle's edge, at its top right. */}
      {dot && <span data-testid="missing-dot" className="absolute -top-px -right-px size-2 rounded-full bg-warning ring-2 ring-sidebar" />}
    </span>
  )
}

export function PersonMenu({ onSettings }: { onSettings: (entry?: string) => void }) {
  const { person } = usePerson()
  const { missing } = useMissing()
  const { view: backup } = useBackup()
  const notBackedUp = (backup?.gaps.length ?? 0) > 0
  const needs = missing.length > 0 || notBackedUp
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`${person ? `${person.name}: settings` : 'Settings'}${needs ? ', something is missing' : ''}`}
        // A row of the sidebar's: 32 high (44 on a phone), the text's colour at 4% under the pointer, at 8% while its menu is open.
        className="focus-ring flex w-full min-w-0 items-center gap-2 rounded-md px-1.5 text-left text-sm transition-colors hover:bg-foreground/4 active:bg-foreground/8 data-[popup-open]:bg-foreground/8 md:h-8 max-md:h-11"
      >
        {/* 20 wide, laid out as 16, so its centre is on the icons' axis and the name on their labels' edge. */}
        <Avatar person={person} dot={needs} className="-mx-0.5" />
        <span className="min-w-0 flex-1 truncate">{person ? firstName(person.name) : ''}</span>
        <Settings className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
      </DropdownMenuTrigger>
      {/* As wide as the row it opens from: a long line is cut, and said whole on its own page. */}
      <DropdownMenuContent align="start" className="w-(--anchor-width)">
        {person && (
          <>
            <DropdownMenuGroup>
              <DropdownMenuLabel className="flex flex-col font-normal">
                <span className="truncate font-medium text-foreground">{person.name}</span>
                {person.github && <span className="truncate font-normal">@{person.github}</span>}
              </DropdownMenuLabel>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
          </>
        )}
        {needs && (
          <>
            {missing.map(item => (
              <DropdownMenuItem key={item.key} onClick={openPermissions}>
                <CircleAlert className="size-4 shrink-0 text-warning" aria-hidden />
                <span className="flex-1 truncate">{item.words}</span>
              </DropdownMenuItem>
            ))}
            {notBackedUp && (
              <DropdownMenuItem onClick={() => onSettings(AGENT_DATA_ENTRY)}>
                <CircleAlert className="size-4 shrink-0 text-warning" aria-hidden />
                <span className="flex-1 truncate">Agent data not backed up</span>
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
          </>
        )}
        <ThemeSubmenu />
        <NotificationsSubmenu />
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => onSettings()}>
          <Settings className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          Settings
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

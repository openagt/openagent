import { openPermissions } from '../lib/use-route.js'
import { CircleAlert, Settings } from 'lucide-react'
import type { Person } from '../rpc/person.js'
import { usePerson } from '../lib/use-person.js'
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from './ui/dropdown-menu.js'
import { ThemeSubmenu } from './ThemeSubmenu.js'
import { NotificationsSubmenu } from './NotificationsSubmenu.js'
import { useMissing } from './Logins.js'
import { useBackup } from '../lib/use-backup.js'
import { AGENT_DATA_ENTRY } from './AgentDataSettings.js'
import { PersonMark } from './PersonMark.js'

// The foot of the sidebar: the person at this dashboard, their picture and first name, as one row
// that opens their menu (his pick, over a row of three icons): the theme, the notifications, and
// Settings, under their whole name. The accounts a run takes are picked where the run is started,
// beside the message box, for the computer it goes to: the agent's in the agent picker, the git
// host's after the branch; not here a second time. A dot on the picture says something runs need is missing, or that the agents' data is not backed up; the menu says what. The gear at the row's end says what the row opens. The name and
// the picture are the person's own, set in Settings › Profile (`onPerson`); with no picture, the two letters
// their mark has everywhere else.

/** The first word of a name: what the row says, the whole name being in the menu. */
export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name
}

/** The person's mark, as every list of people draws it (`PersonMark`): their picture, else two letters of their name; `dot` says something runs need is missing. */
export function Avatar({ person, dot = false, className = 'size-6' }: { person: Person | null; dot?: boolean; className?: string }) {
  return (
    <span aria-hidden className="relative shrink-0">
      <PersonMark email={person?.email} name={person?.name} picture={person?.avatar} className={className} />
      {dot && <span data-testid="missing-dot" className="absolute -top-0.5 -right-0.5 size-2 rounded-full bg-warning ring-2 ring-sidebar" />}
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
        className="flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm outline-none hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-sidebar-ring data-[popup-open]:bg-sidebar-accent"
      >
        <Avatar person={person} dot={needs} />
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
        {needs && (
          <>
            {missing.map(item => (
              <DropdownMenuItem key={item.key} onClick={openPermissions} className="text-warning">
                <CircleAlert className="h-3.5 w-3.5 shrink-0" aria-hidden />
                <span className="flex-1 truncate">{item.words}</span>
              </DropdownMenuItem>
            ))}
            {notBackedUp && (
              <DropdownMenuItem onClick={() => onSettings(AGENT_DATA_ENTRY)} className="text-warning">
                <CircleAlert className="h-3.5 w-3.5 shrink-0" aria-hidden />
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
          <Settings className="h-3.5 w-3.5 shrink-0 opacity-70" aria-hidden />
          Settings
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

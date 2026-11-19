import { PERMISSIONS_PAGE } from '../lib/use-route.js'
import { HostServicesContext, INERT_HOST_SERVICES } from '../lib/host-services.js'
import { useState, useContext } from 'react'
import { CircleAlert, Settings } from 'lucide-react'
import type { Person } from '../rpc/person.js'
import { usePerson } from '../lib/use-person.js'
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from './ui/dropdown-menu.js'
import { ThemeSubmenu } from './ThemeSubmenu.js'
import { useMissing } from './Logins.js'
import { useBackup } from '../lib/use-backup.js'
import { AGENT_DATA_ENTRY } from './AgentDataSettings.js'
import { personLetters } from './PersonMark.js'
import { cn } from '../lib/utils.js'

// The foot of the sidebar: the person at this dashboard, their picture and first name, as one row
// that opens their menu (his pick, over a row of three icons): the theme and
// Settings, under their whole name. The accounts a run takes are picked where the run is started,
// beside the message box, for the computer it goes to: the agent's in the agent picker, the git
// host's after the branch; not here a second time. A dot on the picture says something runs need is missing, or that the agents' data is not backed up; the menu says what fixes it. The gear at the row's end says what the row opens. The name and
// the picture are the person's own, set in Settings › Profile (`onPerson`); with no picture, the two letters their runs are marked with.

/** The first word of a name: what the row says, the whole name being in the menu. */
export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name
}

/** A person's picture, or the letters of their mark beside their runs; `dot` says something runs need is missing. */
export function Avatar({ person, dot = false, size = 'size-5 text-xs', className }: { person: Person | null; dot?: boolean; size?: string; className?: string }) {
  // A picture that does not load leaves the letters, never a broken image.
  const [broken, setBroken] = useState(false)
  const picture = person?.avatar && !broken ? person.avatar : undefined
  return (
    <span aria-hidden className={cn('relative shrink-0', className)}>
      <span className={`flex ${size} items-center justify-center overflow-hidden rounded-full bg-muted-foreground/15 font-medium text-foreground`}>
        {picture ? <img src={picture} alt="" referrerPolicy="no-referrer" className="h-full w-full object-cover" onError={() => setBroken(true)} /> : person ? personLetters(person.name) : null}
      </span>
      {/* On the circle's edge, at its top right. */}
      {dot && <span data-testid="missing-dot" className="absolute -top-px -right-px size-2 rounded-full bg-warning ring-2 ring-sidebar" />}
    </span>
  )
}

export function PersonMenu({ onSettings }: { onSettings: (entry?: string) => void }) {
  const services = useContext(HostServicesContext) ?? INERT_HOST_SERVICES
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
        className="focus-ring flex w-full min-w-0 items-center gap-3 rounded-md px-2 text-left text-sm transition-colors hover:bg-foreground/4 active:bg-foreground/8 data-[popup-open]:bg-foreground/8 md:h-10 max-md:h-11"
      >
        {/* 24 wide, laid out as 16, so its centre is on the icons' axis and the name on their labels' edge. */}
        <Avatar person={person} dot={needs} size="size-6 text-xs" />
        <span className="min-w-0 flex-1 truncate">{person ? firstName(person.name) : ''}</span>
        <Settings className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
      </DropdownMenuTrigger>
      {/* As wide as its longest line, from the row's width up to 320: a longer line goes onto a second one, never cut. */}
      <DropdownMenuContent align="start" className="w-max min-w-(--anchor-width) max-w-80">
        {person && (
          <>
            <DropdownMenuGroup>
              <DropdownMenuLabel className="flex flex-col font-normal">
                <span className="font-medium text-foreground">{person.name}</span>
                {person.github && <span className="font-normal">@{person.github}</span>}
              </DropdownMenuLabel>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
          </>
        )}
        {needs && (
          <>
            {missing.map(item => (
              <DropdownMenuItem key={item.key} onClick={() => services.openPage(PERMISSIONS_PAGE)}>
                <CircleAlert className="size-4 shrink-0 text-warning" aria-hidden />
                <span className="flex-1">{item.action}</span>
              </DropdownMenuItem>
            ))}
            {notBackedUp && (
              <DropdownMenuItem onClick={() => onSettings(AGENT_DATA_ENTRY)}>
                <CircleAlert className="size-4 shrink-0 text-warning" aria-hidden />
                <span className="flex-1">Back up your agent data…</span>
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
          </>
        )}
        <ThemeSubmenu />
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => onSettings()}>
          <Settings className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          Settings
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

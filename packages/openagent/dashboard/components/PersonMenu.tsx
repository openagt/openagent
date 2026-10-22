import { useState } from 'react'
import { CircleAlert, Settings } from 'lucide-react'
import { onPerson, type Person } from '../rpc/person.js'
import { useLoaded } from '../lib/use-async.js'
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from './ui/dropdown-menu.js'
import { ThemeSubmenu } from './ThemeSubmenu.js'
import { NotificationsSubmenu } from './NotificationsSubmenu.js'
import { AGENT_ACCOUNTS_ENTRY, AgentAccountsSubmenu } from './AgentAccounts.js'
import { GitHostsSubmenu } from './GitHosts.js'
import { useMissing } from './Logins.js'

// The foot of the sidebar: the person at this dashboard, their picture and first name, as one row
// that opens their menu (his pick, over a row of three icons): the Claude account runs use first,
// the git host account they push with, the theme, the notifications, and Settings, under their
// whole name. A dot on the picture says something runs need is missing; the menu says what. The gear at the row's end says what the row opens. The name is
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

function Avatar({ person, dot }: { person: Person | null; dot: boolean }) {
  // A picture that does not load leaves the initials, never a broken image.
  const [broken, setBroken] = useState(false)
  const picture = person?.avatar && !broken ? person.avatar : undefined
  return (
    <span aria-hidden className="relative shrink-0">
      <span className="flex h-6 w-6 items-center justify-center overflow-hidden rounded-full bg-muted text-[10px] font-medium text-muted-foreground">
        {picture ? <img src={picture} alt="" referrerPolicy="no-referrer" className="h-full w-full object-cover" onError={() => setBroken(true)} /> : person ? initials(person.name) : null}
      </span>
      {dot && <span data-testid="missing-dot" className="absolute -top-0.5 -right-0.5 size-2 rounded-full bg-warning ring-2 ring-sidebar" />}
    </span>
  )
}

export function PersonMenu({ onSettings }: { onSettings: (entry?: string) => void }) {
  const person = useLoaded<Person | null>(() => onPerson().catch(() => null), null, [])
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
                {person.login && <span className="truncate font-normal">@{person.login}</span>}
              </DropdownMenuLabel>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
          </>
        )}
        {missing.length > 0 && (
          <>
            {missing.map(item => (
              <DropdownMenuItem key={item.key} onClick={() => onSettings(item.entry)} className="text-warning">
                <CircleAlert className="h-3.5 w-3.5 shrink-0" aria-hidden />
                <span className="flex-1 truncate">{item.words}</span>
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
          </>
        )}
        {/* The accounts runs use: the git host's first, as the plan has it, then each agent's, with the line under them. */}
        <GitHostsSubmenu onSettings={onSettings} />
        <AgentAccountsSubmenu agent="claude" onAdd={() => onSettings(AGENT_ACCOUNTS_ENTRY)} />
        <AgentAccountsSubmenu agent="codex" onAdd={() => onSettings(AGENT_ACCOUNTS_ENTRY)} />
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

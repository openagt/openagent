import { HostServicesContext, INERT_HOST_SERVICES } from '../lib/host-services.js'
import { useState, useContext } from 'react'
import { ChevronDown, CircleAlert, CircleArrowUp, LogOut, Settings } from 'lucide-react'
import type { Person } from '../rpc/person.js'
import { usePerson } from '../lib/use-person.js'
import { signOut, useTeam } from '../lib/team.js'
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from './ui/dropdown-menu.js'
import { ThemeSubmenu } from './ThemeSubmenu.js'
import { personLetters } from './PersonMark.js'
import { cn } from '../lib/utils.js'
import { useMenuActions } from './Places.js'
import { useAttention } from '../lib/use-attention.js'
import { attentionDetail, attentionKey, useAttentionFixes } from './Attention.js'

// The foot of the sidebar: the person at this dashboard, their picture and first name, as one row
// that opens their menu (his pick, over a row of three icons): the theme and
// Settings, under their whole name. The accounts a run takes are picked where the run is started,
// beside the message box, for the computer it goes to: the agent's in the agent picker, the git
// host's after the branch; not here a second time. A dot on the picture says something runs need is missing, or what a module says needs setting up on this computer (the agents' data not backed up, say), in the warning colour; or, in blue, what a module offers here (a coding agent's newer version); the menu says what fixes it. The chevron at the row's end says the row opens a menu, as Claude Code's does. The name and
// the picture are the person's own, set in Settings › Profile (`onPerson`); with no picture, the two letters their runs are marked with.

/** The first word of a name: what the row says, the whole name being in the menu. */
export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name
}

/** A person's picture, or the letters of their mark beside their runs; `dot` says something runs need is missing (`warning`), or that something is offered (`info`: a newer version of a coding agent). */
export function Avatar({ person, dot = false, size = 'size-5 text-xs', className }: { person: Person | null; dot?: boolean | 'warning' | 'info'; size?: string; className?: string }) {
  // A picture that does not load leaves the letters, never a broken image.
  const [broken, setBroken] = useState(false)
  const picture = person?.avatar && !broken ? person.avatar : undefined
  return (
    <span aria-hidden className={cn('relative shrink-0', className)}>
      <span className={`flex ${size} items-center justify-center overflow-hidden rounded-full bg-muted-foreground/15 font-medium text-foreground`}>
        {picture ? <img src={picture} alt="" referrerPolicy="no-referrer" className="h-full w-full object-cover" onError={() => setBroken(true)} /> : person ? personLetters(person.name) : null}
      </span>
      {/* On the circle's edge, at its top right. */}
      {dot && <span data-testid="missing-dot" className={cn('absolute -top-px -right-px size-2 rounded-full ring-2 ring-sidebar', dot === 'info' ? 'bg-info' : 'bg-warning')} />}
    </span>
  )
}

export function PersonMenu({ onSettings }: { onSettings: (entry?: string) => void }) {
  const services = useContext(HostServicesContext) ?? INERT_HOST_SERVICES
  const own = usePerson().person
  // On a machine shared by a team, the person is who signed in with GitHub.
  const { team } = useTeam()
  const signedIn = team.on ? team.person : undefined
  const person: Person | null = signedIn ? { name: signedIn.name ?? signedIn.login, login: signedIn.login, ...(signedIn.avatar ? { avatar: signedIn.avatar } : {}) } : own
  // What the modules say needs the person on this computer (`app.attention`): listed here, each opening its fix, and the dot on the picture.
  // Beside them, what a module offers on this computer: a note with a press (a coding agent's newer version, and its update).
  const about = (useAttention(null) ?? []).filter(item => item.scope === 'computer')
  const missing = about.filter(item => item.kind === 'setup')
  const notes = about.filter(item => item.kind === 'note' && item.fix !== undefined)
  const attention = [...missing, ...notes]
  const fixes = useAttentionFixes(undefined)
  const needs = attention.length > 0
  // What the modules offer in the person's menu (`person.menu`), asked again as it opens.
  const [open, setOpen] = useState(false)
  const offered = useMenuActions('person.menu', NOTHING_ON, undefined, open)
  return (
    <>
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger
        aria-label={`${person ? `${person.name}: settings` : 'Settings'}${missing.length > 0 ? ', something is missing' : notes.length > 0 ? ', an update is out' : ''}`}
        // As Claude Code's (his ask, 2026-11-26, measured there): 28 high (44 on a phone), corners 8, the picture 2 in from
        // its left and a chevron 12 in from its right; the text's colour at 4% under the pointer, at 8% while its menu is open.
        className="focus-ring flex w-full min-w-0 items-center gap-2 rounded-lg py-1 pr-3 pl-0.5 text-left text-sm transition-colors hover:bg-foreground/4 active:bg-foreground/8 data-[popup-open]:bg-foreground/8 md:h-7 max-md:h-11"
      >
        <Avatar person={person} dot={missing.length > 0 ? 'warning' : notes.length > 0 && 'info'} size="size-5 text-[9px]" />
        <span className="min-w-0 flex-1 truncate">{person ? firstName(person.name) : ''}</span>
        <ChevronDown className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      </DropdownMenuTrigger>
      {/* As wide as its longest line, from the row's width up to 320: a longer line goes onto a second one, never cut. */}
      <DropdownMenuContent align="start" className="w-max min-w-(--anchor-width) max-w-80">
        {person && (
          <>
            <DropdownMenuGroup>
              <DropdownMenuLabel className="flex flex-col font-normal">
                <span className="font-medium text-foreground">{person.name}</span>
                {person.login && <span className="font-normal">@{person.login}</span>}
              </DropdownMenuLabel>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
          </>
        )}
        {needs && (
          <>
            {attention.map(item => {
              const fix = fixes.fixOf(item)
              return (
                <DropdownMenuItem key={attentionKey(item)} {...(fix ? { onClick: fix } : { disabled: true })} {...(attentionDetail(item) !== undefined ? { title: attentionDetail(item) } : {})}>
                  {item.kind === 'note' ? <CircleArrowUp className="size-4 shrink-0 text-info" aria-hidden /> : <CircleAlert className="size-4 shrink-0 text-warning" aria-hidden />}
                  <span className="flex-1">{item.fix?.label ?? item.words}</span>
                </DropdownMenuItem>
              )
            })}
            <DropdownMenuSeparator />
          </>
        )}
        {offered.offered > 0 && (
          <>
            {offered.items}
            <DropdownMenuSeparator />
          </>
        )}
        <ThemeSubmenu />
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => onSettings()}>
          <Settings className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          Settings
        </DropdownMenuItem>
        {signedIn && team.on && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => void signOut()}>
              <LogOut className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              Sign out of {team.name}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
    {offered.overlay}
    {fixes.overlay}
    </>
  )
}

/** The person's menu acts on nothing but the person. */
const NOTHING_ON = {}

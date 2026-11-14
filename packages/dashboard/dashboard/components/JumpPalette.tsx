import { useEffect, useMemo, useRef, useState } from 'react'
import { Dialog as BaseDialog } from '@base-ui/react/dialog'
import { Autocomplete } from '@base-ui/react/autocomplete'
import { Search } from 'lucide-react'
import type { AgentMeta, FoundAgent, Intervention, ProjectSummary } from '../../src/index.js'
import { onAllAgents } from '../rpc/reads.js'
import type { Route } from '../lib/route.js'
import { jumpGroups, type JumpRow } from '../lib/jump.js'
import { agentLabel } from '../lib/agent-label.js'
import { inPlace } from '../lib/in-place.js'
import { pressed, shortcut, shortcutKeys, useShortcut } from '../lib/shortcut.js'
import { useProjectLabel } from '../lib/project-labels.js'
import { cn } from '../lib/utils.js'
import { needsWord } from './HumanQueueList.js'
import { KeyCaps } from './ShortcutList.js'
import { BACKDROP_CLASS } from './ui/dialog.js'
import { Button } from './ui/button.js'
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip.js'

// The jump: ⌘K or Ctrl+K from anywhere, a few letters, and Enter is on the run, the page or the
// project meant. What this page has read already is searched in the frame of the key; every run
// of every project is read as it opens, and what that read adds comes in under what is shown, so
// no row moves under a press. It only goes somewhere: each row is a link with its address.

/** A place to jump to, with where it takes the page. */
interface Place extends JumpRow {
  /** Quieter, at the right: the project, what the run waits on, its pull request. */
  meta?: string
  to: Route
}

/** Where the runs last opened are kept, newest first, in this browser. */
const OPENED_KEY = 'oa.jump-opened'
const OPENED_KEPT = 20

function readOpened(): string[] {
  try {
    const kept: unknown = JSON.parse(localStorage.getItem(OPENED_KEY) ?? '[]')
    return Array.isArray(kept) ? kept.filter((key): key is string => typeof key === 'string') : []
  } catch {
    return []
  }
}

function keepOpened(key: string): void {
  try {
    localStorage.setItem(OPENED_KEY, JSON.stringify([key, ...readOpened().filter(kept => kept !== key)].slice(0, OPENED_KEPT)))
  } catch {
    // A browser that keeps nothing lists the newest runs as the recent ones.
  }
}

/** Who opens the jump when its button is pressed: the one mounted. */
const openers = new Set<() => void>()

/** Opens the jump, as ⌘K or Ctrl+K does. */
export function openJump(): void {
  for (const open of openers) open()
}

/** The jump's press, for a screen with no keyboard: it says its shortcut under a pointer. */
export function JumpButton() {
  return (
    <Tooltip>
      {/* A press of 28 whose hit area is 44 on a phone. */}
      <TooltipTrigger render={<Button variant="ghost" size="icon-sm" className="relative shrink-0 text-muted-foreground max-md:after:absolute max-md:after:-inset-2" aria-label="Jump to" onClick={openJump} />}>
        <Search className="size-4" aria-hidden />
      </TooltipTrigger>
      <TooltipContent>
        Jump to <span className="text-muted-foreground">{shortcut('K')}</span>
      </TooltipContent>
    </Tooltip>
  )
}

const runKey = (projectId: string, agentId: string): string => `${projectId}/${agentId}`

/** The runs last opened, and the newest after them, that the jump lists before anything is typed. */
const RECENT_SHOWN = 5

export function JumpPalette({ waiting, runs, pages, projects, scope, here, hrefOf, go }: {
  /** The Human Queue, in its order. */
  waiting: readonly Intervention[]
  /** The runs this page has read: the picked project's and every project's newest, newest first. */
  runs: readonly { projectId: string; projectName: string; agent: AgentMeta }[]
  /** The pages of the dashboard and its modules that the sidebar lists. */
  pages: readonly { segment: string; label: string }[]
  projects: readonly ProjectSummary[]
  /** The project picked in the sidebar, or none. */
  scope: string | null
  /** The run on the page now. */
  here: { projectId: string | null; agentId: string | null }
  hrefOf: (to: Route) => string
  go: (to: Route) => void
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  useShortcut('jump', () => setOpen(true))
  useEffect(() => {
    const show = () => setOpen(true)
    openers.add(show)
    return () => void openers.delete(show)
  }, [])

  const hereKey = here.projectId !== null && here.agentId !== null ? runKey(here.projectId, here.agentId) : null
  useEffect(() => {
    if (hereKey !== null) keepOpened(hereKey)
  }, [hereKey])

  // Every run of every project, read at each opening; the last read is kept for the next.
  // `before`: the runs the read before it had, which stay among the rest when it comes.
  const [read, setRead] = useState<{ runs: FoundAgent[]; for: string; before: ReadonlySet<string> } | null>(null)
  const typed = useRef(query)
  typed.current = query
  useEffect(() => {
    if (!open) return
    let shown = true
    onAllAgents().then(
      all => shown && setRead(last => ({ runs: all, for: typed.current, before: new Set(last?.runs.map(run => runKey(run.projectId, run.agent.id))) })),
      () => {},
    )
    return () => {
      shown = false
    }
  }, [open])

  const label = useProjectLabel()
  const runPlace = (projectId: string, projectName: string, agent: FoundAgent['agent']): Place => {
    const pr = agent.pr && `#${agent.pr.number}`
    return {
      key: runKey(projectId, agent.id),
      name: agentLabel(agent),
      also: [agent.branch, pr].filter((text): text is string => text !== undefined),
      meta: [scope === null && projectName ? label(projectId, projectName) : undefined, pr].filter(Boolean).join(' · '),
      to: { projectId, agentId: agent.id },
    }
  }

  const groups = useMemo(() => {
    if (!open) return []
    const pageRuns = runs.map(run => runPlace(run.projectId, run.projectName, run.agent))
    const known = new Map(pageRuns.map(place => [place.key, place]))
    const waitingRows = waiting.flatMap((item): Place[] => {
      if (item.agentId === undefined) return []
      const pr = item.number !== undefined ? `#${item.number}` : undefined
      return [{
        key: runKey(item.projectId, item.agentId),
        name: item.title,
        also: [item.branch, pr].filter((text): text is string => text !== undefined),
        meta: [scope === null ? label(item.projectId, item.projectName) : undefined, needsWord(item.kind, item.gitHost)].filter(Boolean).join(' · '),
        to: { projectId: item.projectId, agentId: item.agentId },
      }]
    })
    const opened = readOpened().flatMap(key => known.get(key) ?? [])
    // Not the run on the page, nor one listed as waiting.
    const taken = new Set([hereKey, ...waitingRows.map(place => place.key)])
    const recent = [...new Map([...opened, ...pageRuns].filter(place => !taken.has(place.key)).map(place => [place.key, place])).values()].slice(0, RECENT_SHOWN)
    const pageRows: Place[] = [{ segment: '', label: 'Overview' }, ...pages].map(page => ({
      key: `page:${page.segment}`,
      name: page.label,
      to: page.segment ? { projectId: null, agentId: null, page: page.segment } : { projectId: null, agentId: null },
    }))
    const projectRows: Place[] = projects
      .filter(project => project.id !== scope)
      .map(project => ({ key: `project:${project.id}`, name: label(project.id, project.name), to: { projectId: project.id, agentId: null } }))
    const readRows = (read?.runs ?? []).filter(run => scope === null || run.projectId === scope).map(run => runPlace(run.projectId, run.projectName, run.agent))
    // What the read added while this was typed comes under what was shown; typed after it came, it is among the rest.
    const cameNow = read !== null && read.for === query
    const added = new Set(cameNow ? readRows.filter(place => !read.before.has(place.key)) : [])
    return jumpGroups<Place>(
      [
        { label: 'Waiting on you', rows: waitingRows, limit: 5 },
        { label: 'Recent', rows: recent, limit: RECENT_SHOWN },
        { label: 'Pages', rows: pageRows, limit: 10 },
        { label: 'Projects', rows: projectRows, limit: 8 },
        { label: 'Runs', rows: [...pageRuns, ...readRows.filter(place => !added.has(place))], later: [...added], limit: 20, typedOnly: true },
      ],
      query,
    )
    // The places are drawn from what the props say; `label` and `runPlace` read them too.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, query, read, runs, waiting, pages, projects, scope, hereKey])
  const count = groups.reduce((sum, group) => sum + group.items.length, 0)

  // A pick lands on its page, which puts the focus where it puts it; closed without one, the focus is back where it was.
  const picked = useRef(false)
  const marked = useRef<Place | undefined>(undefined)
  const close = (next: boolean) => {
    setOpen(next)
    if (next) return
    setQuery('')
  }
  const pick = (place: Place) => {
    picked.current = true
    close(false)
    go(place.to)
  }
  const input = useRef<HTMLInputElement>(null)

  return (
    <BaseDialog.Root
      open={open}
      onOpenChange={next => {
        if (next) picked.current = false
        close(next)
      }}
    >
      <BaseDialog.Portal>
        <BaseDialog.Backdrop className={BACKDROP_CLASS} />
        <BaseDialog.Popup
          aria-label="Jump to"
          initialFocus={input}
          finalFocus={() => !picked.current}
          className={cn(
            'fixed z-50 flex flex-col overflow-hidden border border-hairline bg-card text-card-foreground shadow-lg outline-none',
            'md:top-24 md:left-1/2 md:w-[min(36rem,calc(100vw-2rem))] md:-translate-x-1/2 md:rounded-lg',
            'max-md:inset-x-2 max-md:top-2 max-md:rounded-lg',
            'origin-top transition-[opacity,scale] duration-180 data-[ending-style]:duration-120 data-[starting-style]:scale-97 data-[starting-style]:opacity-0 data-[ending-style]:scale-97 data-[ending-style]:opacity-0',
          )}
        >
          <Autocomplete.Root
            inline
            open
            mode="none"
            items={groups}
            value={query}
            onValueChange={setQuery}
            autoHighlight="always"
            itemToStringValue={(place: Place) => place.name}
            onItemHighlighted={(place: Place | undefined) => {
              marked.current = place
            }}
          >
            <div className="flex h-12 shrink-0 items-center gap-2 border-b border-hairline px-4">
              <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              <Autocomplete.Input
                ref={input}
                aria-label="Jump to"
                placeholder="Jump to a run, a project or a page"
                className="h-full min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-faint-foreground max-md:text-base"
                onKeyDown={event => {
                  const place = marked.current
                  // Base UI leaves a key held with ⌘ or Ctrl to the page.
                  if (!place || !pressed(event, 'newTab')) return
                  window.open(hrefOf(place.to), '_blank', 'noopener')
                }}
              />
            </div>
            {/* What a screen reader hears of the list; with nothing in it, the empty line says so. */}
            <Autocomplete.Status className="sr-only">{count === 0 ? '' : count === 1 ? '1 place' : `${count} places`}</Autocomplete.Status>
            {/* One height whatever it holds: the box keeps its size and its foot its place as a person types. */}
            <Autocomplete.List className="h-[min(26rem,60dvh)] scroll-py-1 overflow-y-auto overscroll-contain p-1 empty:hidden">
              {(group: (typeof groups)[number]) => (
                <Autocomplete.Group key={group.label} items={group.items} className="pb-1">
                  <Autocomplete.GroupLabel className="flex h-7 items-center px-2 text-xs font-medium text-muted-foreground">{group.label}</Autocomplete.GroupLabel>
                  <Autocomplete.Collection>
                    {(place: Place) => (
                      <Autocomplete.Item
                        key={place.key}
                        value={place}
                        render={<a href={hrefOf(place.to)} onClick={inPlace(() => pick(place))} />}
                        className="flex cursor-pointer items-center gap-3 rounded-md px-2 text-sm outline-none select-none md:h-9 max-md:h-11 data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground"
                      >
                        <span className="min-w-0 flex-1 truncate">{place.name}</span>
                        {place.meta && <span className="max-w-[45%] shrink-0 truncate text-xs text-muted-foreground">{place.meta}</span>}
                      </Autocomplete.Item>
                    )}
                  </Autocomplete.Collection>
                  {group.more > 0 && <p className="flex h-7 items-center px-2 text-xs text-muted-foreground">{group.more} more: keep typing</p>}
                </Autocomplete.Group>
              )}
            </Autocomplete.List>
            <Autocomplete.Empty className="flex h-[min(26rem,60dvh)] items-start justify-center px-4 py-6 text-sm text-muted-foreground empty:hidden">Nothing matches “{query}”</Autocomplete.Empty>
            <div className="flex h-9 shrink-0 items-center gap-4 border-t border-hairline px-4 text-xs text-muted-foreground pointer-coarse:hidden">
              <span className="flex items-center gap-1.5">
                <KeyCaps keys={['Enter']} /> Go
              </span>
              <span className="flex items-center gap-1.5">
                <KeyCaps keys={shortcutKeys('newTab')} /> New tab
              </span>
              <span className="flex items-center gap-1.5">
                <KeyCaps keys={['Esc']} /> Close
              </span>
            </div>
          </Autocomplete.Root>
        </BaseDialog.Popup>
      </BaseDialog.Portal>
    </BaseDialog.Root>
  )
}

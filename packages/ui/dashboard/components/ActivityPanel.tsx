import { useEffect, useState, type ComponentType, type ReactNode } from 'react'
import { Bot, Folder, GitBranch, List as ListIcon, SquareTerminal } from 'lucide-react'
import type { BackgroundTask } from '@openagt/hooks'
import { EnvironmentRow, repoPath } from './EnvironmentRow.js'
import type { UiWorkProps } from '../module/index.js'
import { cn } from '../lib/utils.js'
import { tokenWords } from './ContextCircle.js'
import { ViewsAt } from './Places.js'
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip.js'
import { Button } from './ui/button.js'
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover.js'
import { Sheet, SheetContent, SheetTitle } from './ui/sheet.js'
import { usePanesShown } from './Panes.js'
import { setActivityShown, useActivityAsked, useActivityShown } from '../lib/panes.js'
import { useIsMobile } from '../lib/use-mobile.js'

// A session's Activity panel, as Claude Code on the web has its details: where the session runs
// and with what (its Environment: the machine, the project, the copied repos, the branch), how full
// its context is, what it does in the background while it does, and its changes, a row per repo
// with its next step (the modules' `chat.work` rows). It stands beside the chat while the side
// panel is closed; with the side panel open it is a pop-over from the top bar's list icon, and on a
// phone a sheet (AgentView).

/** One part of the panel: its name, over its rows. */
function Part({ name, children }: { name: string; children: ReactNode }) {
  return (
    <section aria-label={name} className="flex flex-col border-border not-first:border-t not-first:pt-3.5">
      <h3 className="mb-1.5 flex h-5 items-center text-[13px] font-medium">{name}</h3>
      {children}
    </section>
  )
}

/** How long something has gone on, as a short count: `34s`, `1m 12s`, `2h 5m`. */
function lasted(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${s % 60}s`
  return `${Math.floor(m / 60)}h ${m % 60}m`
}

/** The time now, a second at a time while `ticking`. */
function useNow(ticking: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!ticking) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [ticking])
  return now
}

/** A subagent working now, as the panel lists it. */
export interface WorkingSubagent {
  key: string
  name: string
  since?: string
}

export function ActivityPanel({
  runsOn,
  runsOnIcon: RunsOnIcon,
  project,
  branch,
  context,
  background,
  subagents,
  onOpenSubagent,
  work,
  className,
}: {
  /** Where the session runs: this machine, or a host by its name. */
  runsOn: string
  runsOnIcon: ComponentType<{ className?: string }>
  /** The session's project, by its name and its repository's address; none for a session with no project. */
  project?: { name: string; address?: string | undefined } | undefined
  /** The branch the session works on. */
  branch?: string | undefined
  /** How full the session's context is, as its last turn left it; none when nobody can measure it. */
  context?: { used: number; size: number } | undefined
  /** What the agent waits on in the background now. */
  background: readonly BackgroundTask[]
  /** Its subagents working now. */
  subagents: readonly WorkingSubagent[]
  onOpenSubagent?: ((key: string) => void) | undefined
  /** What the rows of the session's work are told. */
  work: UiWorkProps
  className?: string
}) {
  const now = useNow(background.length > 0 || subagents.length > 0)
  const part = context && context.size > 0 ? Math.min(Math.max(context.used, 0) / context.size, 1) : undefined
  return (
    <div aria-label="Activity" className={cn('flex flex-col gap-3.5 text-sm', className)}>
      <Part name="Environment">
        <EnvironmentRow icon={RunsOnIcon} title="Where the session runs">
          {runsOn}
        </EnvironmentRow>
        {project && (
          <EnvironmentRow icon={Folder} title={project.address ? `Project\n${project.address}` : 'Project'}>
            {project.address ? repoPath(project.address) : project.name}
          </EnvironmentRow>
        )}
        <ViewsAt place="chat.environment" projectId={work.projectId} props={{ projectId: work.projectId, agentId: work.agentId, working: work.working }} label="session's repos" />
        {branch && (
          <EnvironmentRow icon={GitBranch} title={`Branch\n${branch}`}>
            {branch}
          </EnvironmentRow>
        )}
      </Part>
      {context && part !== undefined && (
        <Part name="Context">
          <div className="flex items-baseline justify-between">
            <span>{`${Math.round(part * 100)}% used`}</span>
            <span className="text-[13px] text-muted-foreground">{`${tokenWords(context.used)} / ${tokenWords(context.size)}`}</span>
          </div>
          <div className="mt-1.5 mb-1 h-1 overflow-hidden rounded-full bg-muted" role="img" aria-label={`${Math.round(part * 100)}% of the context used`}>
            <div className={cn('h-full rounded-full', part >= 0.9 ? 'bg-danger' : part >= 0.75 ? 'bg-warning' : 'bg-primary')} style={{ width: `${part * 100}%` }} />
          </div>
          <p className="text-[13px] text-muted-foreground">As of the last turn.</p>
        </Part>
      )}
      {(background.length > 0 || subagents.length > 0) && (
        <Part name="Background tasks">
          {subagents.map(one => (
            <button key={one.key} type="button" className="text-left" onClick={() => onOpenSubagent?.(one.key)}>
              <EnvironmentRow icon={Bot} end={one.since !== undefined ? <span className="shrink-0 text-[13px] text-muted-foreground">{lasted(now - Date.parse(one.since))}</span> : undefined}>
                {one.name}
              </EnvironmentRow>
            </button>
          ))}
          {background.map(task => (
            <EnvironmentRow key={task.id} icon={SquareTerminal} title={task.command} end={<span className="shrink-0 text-[13px] text-muted-foreground">{lasted(now - Date.parse(task.since))}</span>}>
              {task.description ?? task.command ?? 'A background task'}
            </EnvironmentRow>
          ))}
        </Part>
      )}
      <Part name="Changes">
        <ViewsAt place="chat.work" projectId={work.projectId} props={work} label="session's work" />
        {/* No row says anything: the session has no work to hand off. */}
        <p className="hidden text-[13px] text-muted-foreground [section:not(:has([data-work-row]))>&]:block">No changes yet.</p>
      </Part>
    </div>
  )
}

/** Whether the window is wide enough for the Activity panel beside the chat: on a narrower one it is a pop-over. */
function useWideWindow(): boolean {
  const narrow = '(width < 64rem)'
  const [wide, setWide] = useState(() => typeof window === 'undefined' || typeof window.matchMedia !== 'function' || !window.matchMedia(narrow).matches)
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const media = window.matchMedia(narrow)
    const changed = () => setWide(!media.matches)
    media.addEventListener?.('change', changed)
    return () => media.removeEventListener?.('change', changed)
  }, [])
  return wide
}

/**
 * Where the Activity panel stands on this page: beside the chat (`column`), as Claude Code's
 * details are, while the side panel is closed on a wide window and the person has not put it away;
 * else it is a pop-over from the list icon, or on a phone a sheet.
 */
export function useActivityPlace(): { column: boolean; asColumn: boolean } {
  const panes = usePanesShown()
  const isMobile = useIsMobile()
  const wide = useWideWindow()
  const shown = useActivityShown()
  const asColumn = !isMobile && !panes && wide
  return { column: asColumn && shown, asColumn }
}

/**
 * The top bar's list icon: it puts the Activity panel beside the chat or away; where the panel
 * cannot stand there it opens it as a pop-over under the icon, or on a phone as a sheet.
 */
export function ActivityButton({ children }: { children: ReactNode }) {
  const { column, asColumn } = useActivityPlace()
  const isMobile = useIsMobile()
  const [open, setOpen] = useState(false)
  // Asked for from elsewhere on the page (the line above the box's "N more"): where it is no column, it opens.
  const asked = useActivityAsked()
  const [seen, setSeen] = useState(asked)
  if (asked !== seen) {
    setSeen(asked)
    if (!asColumn) setOpen(true)
  }
  const label = 'Activity'
  const button = (props: Record<string, unknown>) => (
    <Button variant="ghost" size="icon-bar" className={cn('text-muted-foreground', (asColumn ? column : open) && 'bg-accent text-accent-foreground')} aria-label={label} {...props}>
      <ListIcon className="h-4 w-4" />
    </Button>
  )
  if (asColumn) {
    return (
      <Tooltip>
        <TooltipTrigger render={button({ 'aria-pressed': column, onClick: () => setActivityShown(!column) })} />
        <TooltipContent>{column ? 'Hide activity' : 'Show activity'}</TooltipContent>
      </Tooltip>
    )
  }
  if (isMobile) {
    return (
      <>
        {button({ 'aria-expanded': open, onClick: () => setOpen(true) })}
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetContent side="right" className="overflow-y-auto px-4 pt-4 pb-6">
            <SheetTitle className="sr-only">Activity</SheetTitle>
            {children}
          </SheetContent>
        </Sheet>
      </>
    )
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger render={<PopoverTrigger render={button({})} />} />
        <TooltipContent>Activity</TooltipContent>
      </Tooltip>
      <PopoverContent align="end" className="w-80">
        {children}
      </PopoverContent>
    </Popover>
  )
}

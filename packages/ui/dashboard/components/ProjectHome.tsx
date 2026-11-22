import { useLayoutEffect, useRef } from 'react'
import { cn } from '../lib/utils.js'
import type { ProjectError, ProjectSummary, Waiting } from '../../src/index.js'
import { StartAgentForm } from './StartAgentForm.js'
import { ProjectActions } from './ProjectActions.js'
import { ComposerShape } from './Composer.js'
import { TopBar } from './Panes.js'
import { ProjectErrorBanner } from './ProjectErrorBanner.js'
import { WaitingList } from './WaitingList.js'
import { ScrollArea } from './ui/scroll-area.js'
import type { StartPicks } from '../lib/started-from.js'
import { useIsMobile } from '../lib/use-mobile.js'

// The project home / launcher: the "New agent session" page. It is never consumed by an agent: starting
// one appends an agent to the rail and adds that agent's own view (AgentView) alongside, and this
// page stays put, so you can launch again.
//
// The box to start an agent is what the page is for: with nothing waiting, from 768px up it stands at
// the page's optical centre under the page's question. What waits on the person (#1455 item 4), the Human
// Queue's own rows, comes first, in the chat's column, and the box at the bottom, where an agent's
// message box is; so on a phone. Starting a run carries the box to its place on the run's page (StartAgentForm). The
// project's Docs are not here: they are the Docs pane (Panes), on this page as on an agent's.
export function ProjectHome({
  projectId,
  projectName,
  waiting,
  onAgentStarted,
  files,
  context,
  addContext,
  removeContext,
  toggleContext,
  onOpenAgent,
  errors,
  onProjectRemoved,
  projects,
  onPickProject,
  onProjectAdded,
}: {
  projectId: string
  /** Every project, for the picker of where the session works. */
  projects: readonly ProjectSummary[]
  /** Open the "New agent session" page of another project, or of no project. */
  onPickProject: (projectId: string) => void
  /** A repo was added as a project from the picker. */
  onProjectAdded: () => void
  /** The project's name, for the launcher's chip; absent until the projects are read. */
  projectName?: string | null | undefined
  /** The Human Queue, already only the project picked in the sidebar's (#1513) when one is picked. */
  waiting: readonly Waiting[]
  /** Carries the started agent's id through to the shell; dropping it is what #1169 was. */
  onAgentStarted?: ((intent: string, agentId: string, runsOn?: string, picks?: StartPicks) => void) | undefined
  files: string[]
  /** The Context set and its edits, owned by the shell and shared with the file tree (#492). */
  context: Set<string>
  addContext: (path: string) => void
  removeContext: (path: string) => void
  toggleContext: (path: string) => void
  /** Open the session a row is about (#1455 item 4) — possibly another project's. */
  onOpenAgent: (projectId: string, agentId: string) => void
  /** What the daemon currently finds wrong with the project (#1500), off the shell's project list. */
  errors?: ProjectError[] | undefined
  /** Told once the project is off the list, so the shell leaves its page. */
  onProjectRemoved?: (() => void) | undefined
}) {
  // The list comes first, the box at the foot: while something waits, and on a phone.
  const isMobile = useIsMobile()
  const listFirst = waiting.length > 0 || isMobile
  // The room the top bar and its notices take, written for the page to start under it, as an
  // agent's page does (ChatPane, `--chat-top`).
  const room = useRef<HTMLDivElement>(null)
  const top = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const read = () => room.current!.style.setProperty('--home-top', `${top.current!.getBoundingClientRect().height}px`)
    read()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(read)
    observer.observe(top.current!)
    return () => observer.disconnect()
  }, [])
  return (
    <div ref={room} data-testid="home-room" className="relative isolate flex min-h-0 flex-1 flex-col">
      {/* Over the page's top, as an agent's page has it: what scrolls under it shows through, blurred.
          It stops short of the list's scroll bar (ui/scroll-area, 10 wide), which is drawn over the
          page's whole height; only the bar's line crosses it, to the page's edge. */}
      <div ref={top} data-testid="home-top" className="absolute top-0 right-2.5 left-0 z-20 bg-background/80 backdrop-blur-md">
        <ProjectActions projectId={projectId} onProjectRemoved={onProjectRemoved} />
        {/* Above everything, because an agent started on a project whose agent-data branch cannot
            reach origin (#1599) works from stale tickets and a queue nobody else will see. */}
        <ProjectErrorBanner errors={errors} />
      </div>
      <div aria-hidden className="pointer-events-none absolute top-[calc(2.75rem-1px)] right-0 z-20 h-px w-2.5 bg-border" />
      {/* What waits for the person comes first, and the box under it, at the bottom, as an agent's
          page has its chat (his pick); so on a phone, where the box is in the thumb's reach. With
          nothing waiting, from 768px up the box stands where the eye lands. No question stands over the
          box (his pick): the bar names the page, and the box says what it is for. The column keeps a scroll bar's room at its right, as the chat's does
          (ChatPane), so the box stands on a session's box's edges and is carried without a sideways step. */}
      <div className="scrollbar-thin scrollbar-gutter-stable flex min-h-0 flex-1 flex-col overflow-y-auto">
        {!listFirst && <Lift />}
        <div className={cn('shrink-0', listFirst && 'order-last')}>
          <StartAgentForm
            projectId={projectId}
            projectName={projectName}
            onAgentStarted={onAgentStarted}
            files={files}
            context={context}
            addContext={addContext}
            removeContext={removeContext}
            toggleContext={toggleContext}
            projects={projects}
            onPickProject={onPickProject}
            onProjectAdded={onProjectAdded}
          />
        </div>
        <ScrollArea className="min-h-0 flex-1" viewportClassName="h-full">
          {/* Its rows start under the top bar, which lies over the list's start, where the list is first. */}
          <div className={cn('mx-auto w-full max-w-3xl', listFirst && 'pt-(--home-top)')}>
            <div className="space-y-8 px-4 pt-6 pb-4 md:pt-4">
              {/* No part at all when nothing waits: an empty "Waiting on you" is noise on every launch. On
                  the box's edges, as an agent's chat is: its name and its card start where the box does. */}
              {waiting.length > 0 && (
                <section aria-label="Waiting on you">
                  <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Waiting on you · {waiting.length}</h2>
                  <WaitingList key={projectId} items={waiting} onOpenAgent={onOpenAgent} />
                </section>
              )}
            </div>
          </div>
        </ScrollArea>
      </div>
    </div>
  )
}

/** The room over the box when nothing waits, so the box stands where the eye lands (about a third down the page). */
function Lift() {
  return <div className="shrink-0 basis-[30%]" aria-hidden />
}

/**
 * The launcher while the projects are read, so the address cannot yet say which project it is: its
 * top bar's row and its box's shape where the box will stand.
 */
export function ProjectHomeShape() {
  const isMobile = useIsMobile()
  return (
    <div className="relative isolate flex min-h-0 flex-1 flex-col">
      <div className="absolute top-0 right-2.5 left-0 z-20">
        <TopBar>
          <div className="h-11" />
        </TopBar>
      </div>
      <div aria-hidden className="pointer-events-none absolute top-[calc(2.75rem-1px)] right-0 z-20 h-px w-2.5 bg-border" />
      <div className="scrollbar-thin scrollbar-gutter-stable flex min-h-0 flex-1 flex-col overflow-y-auto">
        {!isMobile && <Lift />}
        <div className={cn('mx-auto w-full max-w-3xl shrink-0 px-4 pt-2 pb-4', isMobile && 'order-last')}>
          <ComposerShape />
        </div>
        <div className="min-h-0 flex-1" />
      </div>
    </div>
  )
}

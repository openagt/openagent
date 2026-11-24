import { ArrowLeft } from 'lucide-react'
import type { AgentWorktree } from '../../src/index.js'
import type { RunEvent } from '@openagt/hooks'
import { formatBytes } from '../../src/client.js'
import { AgentActionsMenu } from './AgentActionsMenu.js'
import { AgentErrorCount } from './AgentErrorCount.js'
import { PaneToggles, TopBar } from './Panes.js'
import { ShowSidebarButton } from './SidebarToggle.js'
import { ProjectMenu } from './ProjectActions.js'
import { SESSIONS_ID } from '../../src/project-address.js'
import { runCell, runWord } from '../lib/run-words.js'
import { StatePill } from './ui/state.js'
import { Button } from './ui/button.js'

// One agent's top bar: on a phone a back arrow first, which goes to the page shown before; its name with a small ⌄, which is the session's menu (AgentActionsMenu), and
// its state in a word on the state's soft fill; and at the end the count of what it could not get
// past, the project's ⋮, and the icons of the page's panes (Panes), the ⋮ and the icons where the "New
// agent session" page has them. It says nothing of its tree: where it runs and its project are in
// the row above the message box (SessionRow), and its
// branch, what the branch holds and the next step in the panel above that (AgentWorkPanel). One bar for
// the session whether running or finished (AgentView), so the controls stay put when an agent
// reaches Done.
export function AgentActionBar({
  projectId,
  agentId,
  events,
  live = false,
  retainedWorktree = false,
  onWorktreeRemoved,
  onDeleted,
  onProjectRemoved,
  label,
  naming,
  expanded = false,
  onToggle,
  ready = true,
  checkout,
  status,
  onBack,
  resumeCommand,
}: {
  projectId: string
  /** Which run Stop addresses (#749). */
  agentId?: string | null | undefined
  events: RunEvent[]
  /** The run works, as its page knows it: its menu offers Stop. */
  live?: boolean
  /** The session's name: it leads the bar, and is the button of the session's menu. */
  label?: string | undefined
  /** The command that picks the session's agent session back up in a terminal, as its coding agent says it: the session's menu copies it. */
  resumeCommand?: string | undefined
  /** The name is still being made: see AgentActionsMenu. */
  naming?: boolean | undefined
  /** True when this finished agent still has a worktree on disk, so it can be removed (#737). */
  retainedWorktree?: boolean
  /** Told after that worktree is removed, so the menu item goes. */
  onWorktreeRemoved?: () => void
  /** Told after this session is deleted, so the caller can leave it (#1032). Given only for a
   * finished run: absent, no delete is offered. */
  onDeleted?: (() => void) | undefined
  /** Told once the project is off the list; given, the project's menu offers "Remove project". */
  onProjectRemoved?: (() => void) | undefined
  /** Whether the details strip the caller renders under this bar is shown. */
  expanded?: boolean
  /** Given, the session's menu shows and hides that strip. */
  onToggle?: (() => void) | undefined
  /**
   * Whether this run's own reads have answered. Until they have, the bar names the run and shows
   * none of its facts: shown one by one as each read landed, the bar filled in over several steps,
   * and a fact still on screen from the run before read as this one's.
   */
  ready?: boolean
  /** The agent's checkout as the page read it (`null`: not answered yet), read once for this bar and the one above the message box. */
  checkout: AgentWorktree | null
  /** The run's state as the run table names it (`shownStatus`), once it is known. */
  status?: string | undefined
  /** Given, a phone's bar starts with a back arrow that calls it: a phone's session page has no bar of pages. */
  onBack?: (() => void) | undefined
}) {
  // Only once nothing is writing to the worktree is there a size to say (#798).
  const size = ready ? formatBytes(checkout?.checkout?.sizeBytes, '') : ''
  return (
    // The row is as tall as the "New agent session" page's (ProjectActions) and as an
    // open pane's header, so the three stand level; unlike a pane's, it has no line under it.
    <TopBar>
      <div className="flex h-11 shrink-0 items-center gap-2 overflow-hidden pr-2 pl-4">
        {/* The arrow's glyph on the bar's 16 inset, the press pulled out by its padding (spacing.md 4). */}
        {onBack && (
          <Button variant="ghost" size="icon-bar" className="-ml-1.5 text-muted-foreground md:hidden" aria-label="Back" onClick={onBack}>
            <ArrowLeft className="size-4" aria-hidden />
          </Button>
        )}
        <ShowSidebarButton />
        {/* Which session this is: its name, which is the button of its menu and the one part that
            gives up width. */}
        <AgentActionsMenu
          projectId={projectId}
          agentId={agentId}
          events={events}
          live={live}
          label={label}
          {...(naming ? { naming } : {})}
          retainedWorktree={retainedWorktree}
          onWorktreeRemoved={onWorktreeRemoved}
          onDeleted={onDeleted}
          {...(onToggle ? { details: { open: expanded, onToggle } } : {})}
          size={size}
          resumeCommand={resumeCommand}
        />
        {/* The run's state after its name on a desktop; a phone's bar keeps its width for the name, and
            the first screenful shows the state (the failed end, the commits and their press, the question): a screen reader still hears it here. */}
        {status !== undefined && <StatePill state={runCell(status)} className="max-md:sr-only">{capitalized(runWord(status))}</StatePill>}
        {/* The spacer grows but never shrinks (#1030), so a tight row takes its width from the name. */}
        <div className="grow shrink-0" />
        {/* What the agent could not get past (#1500): the log scrolls, this row does not. It sits
            at the end rather than beside the name, which gives up width as the row fills: a
            count is only useful if it is whole. */}
        {ready && <AgentErrorCount events={events} />}
        {/* A session with no project has no project's menu. */}
        <PaneToggles before={projectId !== SESSIONS_ID && <ProjectMenu projectId={projectId} onProjectRemoved={onProjectRemoved} />} />
      </div>
    </TopBar>
  )
}

/** A word as a label starts it: "Working". */
function capitalized(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1)
}

import type { AgentWorktree, OpenAgentEvent } from '../../src/index.js'
import { formatBytes } from '../../src/client.js'
import { AgentActionsMenu } from './AgentActionsMenu.js'
import { AgentErrorCount } from './AgentErrorCount.js'
import { PaneMenu, PaneToggles } from './Panes.js'
import { ShowSidebarButton } from './SidebarToggle.js'
import { ProjectMenu } from './ProjectActions.js'
import { SESSIONS_ID } from '../../src/project-address.js'

// One agent's top bar: its name with a small ⌄, which is the session's menu (AgentActionsMenu); and
// at the end the count of what it could not get past, the project's ⋮, and the icons of the page's
// panes (Panes), the ⋮ and the icons where the "New agent session" page has them. It says nothing of the
// agent's state or of its tree: the feed and the message box say whether the agent works and how it
// ended, where it runs and its project are in the row above the message box (SessionRow), and its
// branch, what the branch holds and the next step in the bar above that (AgentWorkBar). One bar for
// the session whether running or finished (AgentView), so the controls stay put when an agent
// reaches Done.
export function AgentActionBar({
  projectId,
  agentId,
  events,
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
}: {
  projectId: string
  /** Which run Stop addresses (#749). */
  agentId?: string | null | undefined
  events: OpenAgentEvent[]
  /** The session's name: it leads the bar, and is the button of the session's menu. */
  label?: string | undefined
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
}) {
  // Only once nothing is writing to the worktree is there a size to say (#798).
  const size = ready ? formatBytes(checkout?.checkout?.sizeBytes, '') : ''
  return (
    // On a phone the row's start is kept free: the shell lays the menu's button over it
    // (MenuButton). Each left padding is under its own screen size, never a plain one with a
    // phone's over it: a module's stylesheet carries its own copy of the plain class, which comes
    // later and would win. The row is as tall as the "New agent session" page's (ProjectActions) and as an
    // open pane's header, so the three stand level; unlike a pane's, it has no line under it.
    <div className="flex h-11 shrink-0 items-center gap-2 overflow-hidden pr-2 md:pl-4 max-md:pl-11">
      <ShowSidebarButton />
      <PaneMenu />
      {/* Which session this is: its name, which is the button of its menu and the one part that
          gives up width. */}
      <AgentActionsMenu
        projectId={projectId}
        agentId={agentId}
        events={events}
        label={label}
        {...(naming ? { naming } : {})}
        retainedWorktree={retainedWorktree}
        onWorktreeRemoved={onWorktreeRemoved}
        onDeleted={onDeleted}
        {...(onToggle ? { details: { open: expanded, onToggle } } : {})}
        size={size}
      />
      {/* The spacer grows but never shrinks (#1030), so a tight row takes its width from the name. */}
      <div className="grow shrink-0" />
      {/* What the agent could not get past (#1500): the log scrolls, this row does not. It sits
          at the end rather than beside the name, which gives up width as the row fills: a
          count is only useful if it is whole. */}
      {ready && <AgentErrorCount events={events} />}
      {/* A session with no project has no project's menu. */}
      {projectId !== SESSIONS_ID && <ProjectMenu projectId={projectId} onProjectRemoved={onProjectRemoved} />}
      <PaneToggles />
    </div>
  )
}

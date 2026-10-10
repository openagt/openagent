import type { AgentWorktree, OpenAgentEvent } from '../../src/index.js'
import { formatBytes } from '../../src/client.js'
import { AgentActionsMenu } from './AgentActionsMenu.js'
import { AgentErrorCount } from './AgentErrorCount.js'

// One agent's top bar, as Claude Code on the web lays it out: its name with a small ⌄, which is
// the menu of what belongs to the session; beside it a grey chip with where it runs and its
// project; and at the end the count of what it could not get past and the ⋮ menu of what belongs
// to the project (both menus are AgentActionsMenu). It says nothing of
// the agent's state or of its tree: the feed and the message box say whether the agent works and
// how it ended, and its branch, what the branch holds and the next step are in the bar above the
// message box (AgentWorkBar). One bar for the session whether running or finished (AgentView), so
// the controls stay put when an agent reaches Done.
export function AgentActionBar({
  projectId,
  agentId: agentId,
  events,
  retainedWorktree = false,
  onWorktreeRemoved,
  onDeleted,
  label,
  projectName,
  runsOn = 'This machine',
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
  /** The session's project, said in the chip beside the name. */
  projectName?: string | null | undefined
  /** Where the session runs, in a few words: this machine, another machine by its name, the cloud. */
  runsOn?: string
  /** True when this finished agent still has a worktree on disk, so it can be removed (#737). */
  retainedWorktree?: boolean
  /** Told after that worktree is removed, so the menu item goes. */
  onWorktreeRemoved?: () => void
  /** Told after this session is deleted, so the caller can leave it (#1032). Given only for a
   * finished run: absent, no delete is offered. */
  onDeleted?: (() => void) | undefined
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
    <div className="@container flex items-center gap-2 overflow-hidden px-4 py-2">
      {/* Which session this is, as Claude Code on the web says it: its name, which is the button of
          its menu, and a grey chip with where it runs and its project. The name is the one part
          that gives up width; the chip is cut at a cap and drops out of a bar too narrow for it. It is
          shown by default and hidden by the narrow bar's own rule, with no class that sets how it
          is shown: a module's stylesheet carries its own copy of such classes (`hidden`), which
          comes later and won over the rule that showed the chip again, so it never showed. */}
      <AgentActionsMenu
        part="session"
        projectId={projectId}
        agentId={agentId}
        events={events}
        label={label}
        retainedWorktree={retainedWorktree}
        onWorktreeRemoved={onWorktreeRemoved}
        onDeleted={onDeleted}
        {...(onToggle ? { details: { open: expanded, onToggle } } : {})}
        size={size}
      />
      <span data-testid="runs-on" className="max-w-64 shrink-0 truncate rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground @max-md:hidden" title={projectName ? `${runsOn} · ${projectName}` : runsOn}>
        {projectName ? `${runsOn} · ${projectName}` : runsOn}
      </span>
      {/* What the session IS sits at the start; what belongs to its project sits at the end. The
          spacer grows but never shrinks (#1030), so a tight row takes its width from the name. */}
      <div className="grow shrink-0" />
      <div className="flex shrink-0 items-center gap-2">
        {/* What the agent could not get past (#1500): the log scrolls, this row does not. It sits
            at the end rather than beside the name, which gives up width as the row fills: a
            count is only useful if it is whole. */}
        {ready && <AgentErrorCount events={events} />}
        <AgentActionsMenu part="project" projectId={projectId} agentId={agentId} events={events} />
      </div>
    </div>
  )
}

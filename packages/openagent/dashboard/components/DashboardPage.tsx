import type { DashboardData, Intervention } from '../../src/index.js'
import { GitBranch, GitPullRequest, Inbox, MessageCircleQuestion } from 'lucide-react'
import { onDashboard } from '../rpc/reads.js'
import { interventionKey } from '../../src/client.js'
import { Quota } from './Quota.js'
import { Card, CardContent, CardHeader, CardTitle } from './ui/card.js'
import { Tooltip, TooltipTrigger, TooltipContent } from './ui/tooltip.js'
import { usePolled } from '../lib/use-async.js'
import { cn } from '../lib/utils.js'
import { usePreferences } from '../lib/preferences.js'
import { OnboardingChecklist } from './OnboardingChecklist.js'
import { Agents } from './Agents.js'
import { ModuleCards } from './ModuleCards.js'
import type { ProjectSummary } from '../../src/index.js'
import { ScrollArea } from './ui/scroll-area.js'

// The Overview landing page (#1139): a focused at-a-glance board — usage first, then what needs a
// human (Human Queue) beside the agents working now, then the cards the installed packages
// declare, in two columns (#1818: the queue package's AI Queue, the tickets package's hot tickets,
// the scheduler package's Automations). What is empty is not drawn: no card for no agent at work. OpenAgent's own cards are projections of the same .openagent files
// over the `onDashboard` RPC, polled so they stay live; selecting a row jumps into its project or
// straight into a session. With one project picked in the sidebar's project select (#1513), every
// part but the usage bar shows that project's only, and the cards of packages it does not have are
// not drawn.
//
// It replaced the denser board this started as (#471) — KPI tiles, a two-week activity chart, agent
// outcomes, and a projects table — cut here as redundant (#1139). The chart and the outcomes dial
// were kept as components afterwards, on the note that the chart was meant to return; they were
// rendered only by the design gallery from then on, and the daemon went on computing their inputs
// for nobody. Both are in the history, where a component nothing renders belongs.
export function DashboardPage({
  onSelectProject,
  onSelectAgent,
  onAgentStarted,
  interventions,
  projects,
  scope,
}: {
  onSelectProject: (id: string) => void
  /** Open one session (project + run): the Agents rows link straight to a session. */
  onSelectAgent: (projectId: string, agentId: string) => void
  /** Where a session the onboarding checklist starts lands (#1169): on that session. */
  onAgentStarted: (projectId: string, intent: string, agentId: string) => void
  /** The Human Queue's items, already only the picked project's when one is picked. */
  interventions: Intervention[]
  /** Every registered project. The usage bar is given all of them: usage is the account's, not a project's. */
  projects: ProjectSummary[]
  /** The one project the page shows (#1513), or null for all: the agents at work and the packages' cards show only its, and a card of a package it does not have is not drawn. */
  scope: string | null
}) {
  const { value: data } = usePolled<DashboardData | null>(onDashboard, null, 5000, [])
  // Its ✕ hides it (#958), and a switch in Settings › Appearance shows it again.
  const onboardingDismissed = usePreferences().onboardingDismissed ?? false
  const working = (data?.active ?? []).filter(agent => scope === null || agent.projectId === scope)
  const shownProjects = scope === null ? projects : projects.filter(project => project.id === scope)

  return (
    <ScrollArea className="min-h-0 flex-1">
      <div className="mx-auto max-w-6xl space-y-6 p-6">
        {!onboardingDismissed && (
          <OnboardingChecklist onAgentStarted={onAgentStarted} onSelectProject={onSelectProject} />
        )}

        {/* Usage first (#1139): the one figure that governs everything the agent may do next. */}
        <Quota projects={projects} />

        {/* What needs a person, beside who is working now. The agents' card is drawn only while
            one works: with none, what needs you takes the whole row. */}
        {/* One column that may shrink below its content: without it a long row pushes the cards past a phone's edge. */}
        <div className={cn('grid grid-cols-[minmax(0,1fr)] items-start gap-4', working.length > 0 && 'lg:grid-cols-2')}>
          <HumanQueue items={interventions} onSelectProject={onSelectProject} onSelectAgent={onSelectAgent} />
          {working.length > 0 && <Agents working={working} onSelectAgent={onSelectAgent} />}
        </div>

        {/* The cards the installed packages declare (#1818), in two columns that fill evenly whatever
            each card's height: a package's own summary of its data, only when one of the projects
            shown (every registered one, or the picked one alone) has the package. */}
        <div className="gap-4 lg:columns-2 [&>*]:mb-4 [&>*]:break-inside-avoid">
          <ModuleCards projects={shownProjects} />
        </div>
      </div>
    </ScrollArea>
  )
}

// The Human Queue (#632/#1139): the cross-project things only a person can clear. Three kinds: open
// PRs to review (proposals and finished work both surface as PRs) — merge to confirm, close to
// reject, so each links straight out to its PR; runs paused mid-flight on a question (#636), which
// jump into that project's live view to answer; and work a finished session left unpushed. #627
// notifications fire off the same set.
function HumanQueue({
  items,
  onSelectProject,
  onSelectAgent,
}: {
  items: Intervention[]
  onSelectProject: (id: string) => void
  onSelectAgent: (projectId: string, agentId: string) => void
}) {
  // Awaiting and unpushed both name an agent (#636/#860), so the row opens that session — which is what
  // its "Open the session" promise says. Only if the id is somehow absent does it fall back to the
  // project, rather than doing nothing.
  const openAgent = (item: Intervention) =>
    item.agentId ? onSelectAgent(item.projectId, item.agentId) : onSelectProject(item.projectId)
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Inbox className="h-4 w-4 text-muted-foreground" />
          Human Queue
          {items.length > 0 && (
            <span className="rounded-full bg-primary px-1.5 text-xs font-semibold text-primary-foreground tabular-nums">
              {items.length}
            </span>
          )}
        </CardTitle>
        <p className="text-xs text-muted-foreground">Agents awaiting your approval, review, or input</p>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <p className="py-2 text-sm text-muted-foreground">AI doesn&apos;t need you.</p>
        ) : (
          <ul className="divide-y divide-border">
            {items.map(item => (
              <li key={interventionKey(item)}>
                {item.kind === 'awaiting' ? (
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <button
                          type="button"
                          onClick={() => openAgent(item)}
                          className="flex w-full items-center gap-2.5 py-2 text-left hover:opacity-80"
                        />
                      }
                    >
                      <MessageCircleQuestion className="h-4 w-4 shrink-0 text-warning" />
                      <span className="shrink-0 text-xs font-medium text-warning">Awaiting</span>
                      <span className="truncate text-sm font-medium">{item.title}</span>
                      <span className="ml-auto shrink-0 text-xs text-muted-foreground">{item.projectName}</span>
                    </TooltipTrigger>
                    <TooltipContent>Open the agent to answer</TooltipContent>
                  </Tooltip>
                ) : item.kind === 'unpushed' ? (
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <button
                          type="button"
                          onClick={() => openAgent(item)}
                          className="flex w-full items-center gap-2.5 py-2 text-left hover:opacity-80"
                        />
                      }
                    >
                      <GitBranch className="h-4 w-4 shrink-0 text-info" />
                      <span className="shrink-0 text-xs font-medium text-info">Not published</span>
                      <span className="truncate text-sm font-medium">{item.title}</span>
                      {/* An unknown count says nothing rather than the contradictory "0 commits". */}
                      {item.commits !== undefined && item.commits > 0 && (
                        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                          {item.commits === 1 ? '1 commit' : `${item.commits} commits`}
                        </span>
                      )}
                      <span className="ml-auto shrink-0 text-xs text-muted-foreground">{item.projectName}</span>
                    </TooltipTrigger>
                    <TooltipContent>{`Open the session: work on ${item.branch ?? ''} is not published`}</TooltipContent>
                  </Tooltip>
                ) : (
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <a
                          href={item.url}
                          target="_blank"
                          rel="noreferrer"
                          className="flex items-center gap-2.5 py-2 hover:opacity-80"
                        />
                      }
                    >
                      <GitPullRequest className="h-4 w-4 shrink-0 text-success" />
                      <span className="shrink-0 text-xs font-medium tabular-nums text-muted-foreground">#{item.number}</span>
                      <span className="truncate text-sm font-medium">{item.title}</span>
                      <span className="ml-auto shrink-0 text-xs text-muted-foreground">{item.projectName}</span>
                    </TooltipTrigger>
                    <TooltipContent>{`Open PR #${item.number}`}</TooltipContent>
                  </Tooltip>

                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

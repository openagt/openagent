import type { ActiveAgent, Intervention } from '../../src/index.js'
import { useState } from 'react'
import { Inbox, SlidersHorizontal } from 'lucide-react'
import { Quota } from './Quota.js'
import { Card, CardContent, CardHeader, CardTitle } from './ui/card.js'
import { HumanQueueList } from './HumanQueueList.js'
import { updatePreferences, usePreferences, usePreferencesLoaded } from '../lib/preferences.js'
import { OnboardingChecklist } from './OnboardingChecklist.js'
import { AgentUpdates } from './AgentUpdates.js'
import { Agents } from './Agents.js'
import { useModuleCards, type OverviewCard } from './ModuleCards.js'
import { SkillsCard } from './SkillsCard.js'
import { CardGrid, EditOverview } from './CustomizeOverview.js'
import { Button } from './ui/button.js'
import { ALL_PROJECTS, arrangeCards } from '../../src/client.js'
import type { ProjectSummary } from '../../src/index.js'
import { Page } from './Page.js'
import { NEEDS_YOU_ID, StatTile, WORKING_ID, scrollToPart } from './StatTile.js'

// The Overview landing page (#1139): a focused at-a-glance board — usage first, then what needs a
// human (Human Queue) beside the agents working now, then the cards the installed packages
// declare, in two columns (#1818: the queue package's AI Queue, the tickets package's hot tickets,
// the scheduler package's Automations). What is empty is not drawn: no card for no agent at work. OpenAgent's own cards are projections of the same .openagent files
// over the shell's own polls (the agents at work, the Human Queue), so they stay live; selecting a row jumps into its project or
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
  interventionsStale,
  active,
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
  /** The Human Queue's items are only what an earlier visit read, not yet read again: its cards are faded. */
  interventionsStale: boolean
  /** Every agent going right now, across the projects, and whether that is only what an earlier visit read. */
  active: { active: ActiveAgent[]; stale: boolean }
  /** Every registered project. The usage bar is given all of them: usage is the account's, not a project's. */
  projects: ProjectSummary[]
  /** The one project the page shows (#1513), or null for all: the agents at work and the packages' cards show only its, and a card of a package it does not have is not drawn. */
  scope: string | null
}) {
  // Its ✕ hides it (#958), and a switch in Settings › Appearance shows it again.
  const onboardingDismissed = usePreferences().onboardingDismissed ?? false
  const working = active.active.filter(agent => scope === null || agent.projectId === scope)
  const shownProjects = scope === null ? projects : projects.filter(project => project.id === scope)
  // Every card the Overview can show here, each with the widths it stands at; the person's layout
  // for this page (the picked project's, else all projects') orders them, sizes them, and hides some.
  const moduleCards = useModuleCards(shownProjects)
  const questions = interventions.filter(item => item.kind === 'awaiting').length
  const cards: OverviewCard[] = [
    // How things stand, a number each: what needs the person, and who is at work. The queue's own
    // tile (what waits its turn) is its package's card, beside them by its order.
    {
      id: 'needs-you',
      stale: interventionsStale,
      label: 'Needs you',
      order: 1,
      width: '1/3',
      minWidth: '1/4',
      node: (
        <StatTile
          label="Needs you"
          value={interventions.length}
          tone="text-warning"
          note={interventions.length === 0 ? 'Nothing waits on you' : questions > 0 ? (questions === 1 ? '1 question to answer' : `${questions} questions to answer`) : 'Work to review or publish'}
          onClick={() => scrollToPart(NEEDS_YOU_ID)}
        />
      ),
    },
    {
      id: 'working-now',
      stale: active.stale,
      label: 'Working now',
      order: 2,
      width: '1/3',
      minWidth: '1/4',
      node: (
        <StatTile
          label="Working now"
          value={working.length}
          live={working.length > 0}
          note={working.length === 0 ? 'No agent is at work' : working.length === 1 ? '1 agent at work' : `${working.length} agents at work`}
          {...(working.length > 0 ? { onClick: () => scrollToPart(WORKING_ID) } : {})}
        />
      ),
    },
    // Usage (#1139): the one figure that governs everything the agent may do next.
    { id: 'usage', label: 'Usage', order: 5, width: '1', minWidth: '1/2', node: <Quota projects={projects} /> },
    {
      id: 'human-queue',
      stale: interventionsStale,
      label: 'Human Queue',
      order: 6,
      width: '1',
      minWidth: '1/2',
      node: (
        <div id={NEEDS_YOU_ID} className="flex scroll-mt-6 flex-col *:flex-1">
          <HumanQueue items={interventions} onSelectProject={onSelectProject} onSelectAgent={onSelectAgent} />
        </div>
      ),
    },
    {
      id: 'working',
      stale: active.stale,
      label: 'Agents at work',
      order: 7,
      width: '1/2',
      minWidth: '1/3',
      node: (
        <div id={WORKING_ID} className="flex scroll-mt-6 flex-col *:flex-1">
          <Agents working={working} onSelectAgent={onSelectAgent} />
        </div>
      ),
    },
    // How each project's skills stand: a newer version to take, skills not yet where agents start from.
    { id: 'skills', label: 'Skills', order: 8, width: '1/3', minWidth: '1/4', node: <SkillsCard projects={shownProjects} onSelectProject={onSelectProject} /> },
    // The cards the installed packages declare (#1818): a package's own summary of its data, only
    // when one of the projects shown (every registered one, or the picked one alone) has the package.
    ...moduleCards,
  ]
  // Until a layout names them, the cards stand by their order: the tiles first, then the cards.
  cards.sort((a, b) => a.order - b.order)
  const layoutKey = scope ?? ALL_PROJECTS
  const layouts = usePreferences().overviewLayouts
  // The cards are drawn once the person's layout is read: a card they took off is never drawn, and
  // so never reads anything, not even for the moment before the layout is known.
  const layoutRead = usePreferencesLoaded()
  const arranged = arrangeCards(cards, layouts, layoutKey)
  // Arranging the page, on its cards themselves: the layout of this page (the picked project's, else
  // all projects'), changed at once as the person moves, sizes and hides the cards.
  const [editing, setEditing] = useState(false)
  const scopeName = scope === null ? undefined : projects.find(project => project.id === scope)?.name
  const own = layouts?.[layoutKey] !== undefined
  const reset = (): void => {
    const { [layoutKey]: _dropped, ...rest } = layouts ?? {}
    updatePreferences({ overviewLayouts: rest })
  }

  return (
    <Page
      title="Overview"
      description="What needs you, the agents at work, and what comes next."
      actions={
        editing ? (
          <>
            {own && (
              <Button variant="ghost" size="sm" onClick={reset}>
                {layoutKey === ALL_PROJECTS ? 'Reset to the default layout' : 'Use the all-projects layout'}
              </Button>
            )}
            <Button size="sm" onClick={() => setEditing(false)}>
              Done
            </Button>
          </>
        ) : (
          <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground" onClick={() => setEditing(true)}>
            <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden />
            Customize
          </Button>
        )
      }
      bar={
        editing && (
          <p role="status" className="rounded-md bg-accent/60 px-3 py-2 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">{scopeName !== undefined ? `Arranging the layout for ${scopeName}.` : 'Arranging the layout for all projects.'}</span>{' '}
            {scopeName !== undefined ? 'Each project keeps its own; a project you never arranged uses the all-projects one.' : 'A project you never arranged on its own uses it too.'} Drag a card by its handle, pick its width, or take it off with ✕. On a phone every card is full width.
          </p>
        )
      }
    >
      <div className="space-y-4">
        {!onboardingDismissed && !editing && (
          <OnboardingChecklist onAgentStarted={onAgentStarted} onSelectProject={onSelectProject} />
        )}
        {!editing && <AgentUpdates />}
        {!layoutRead ? null : editing ? <EditOverview arranged={arranged} layouts={layouts} layoutKey={layoutKey} /> : arranged.some(({ hidden }) => !hidden) ? (
          <CardGrid cards={arranged.filter(({ hidden }) => !hidden)} />
        ) : (
          <p className="rounded-lg border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">Every card is off the Overview. Press Customize to put some back.</p>
        )}
      </div>
    </Page>
  )
}

// The Human Queue (#632/#1139): the cross-project things only a person can clear. Four kinds: open
// PRs to review (proposals and finished work both surface as PRs) — merge to confirm, close to
// reject — which open the session that made them, or the PR itself when no run here did; runs
// paused mid-flight on a question (#636), which jump into that project's live view to answer; and
// work a finished session left uncommitted or unpushed. #627 notifications fire off the same set.
function HumanQueue({
  items,
  onSelectProject,
  onSelectAgent,
}: {
  items: Intervention[]
  onSelectProject: (id: string) => void
  onSelectAgent: (projectId: string, agentId: string) => void
}) {
  const groups = KINDS.map(kind => ({ ...kind, items: items.filter(item => item.kind === kind.value) })).filter(group => group.items.length > 0)
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
          // One group per kind, under a quiet heading with how many: a few questions are not lost
          // among many checkouts left to commit. Each group shows its first rows and offers the rest.
          // Pulled out by the rows' own inset, so their text starts where the card's title does.
          <div className="-mx-2 space-y-3">
            {groups.map(group => (
              <section key={group.value} aria-label={group.label}>
                <h4 className="flex items-baseline gap-1.5 px-2 pb-0.5 text-xs font-medium text-muted-foreground">
                  {group.label}
                  <span className="tabular-nums opacity-70">{group.items.length}</span>
                </h4>
                <HumanQueueList grouped items={group.items} onOpenAgent={onSelectAgent} onOpenProject={onSelectProject} />
              </section>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

/** The kinds the card groups its rows by, in the order of how much they hold a run up: a question stops one. */
const KINDS: { value: Intervention['kind']; label: string }[] = [
  { value: 'awaiting', label: 'Questions' },
  { value: 'pr', label: 'Pull requests' },
  { value: 'unpushed', label: 'To publish' },
  { value: 'uncommitted', label: 'To commit' },
]

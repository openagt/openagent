import type { ActiveAgent, Intervention } from '../../src/index.js'
import { Fragment, useState, type ReactNode } from 'react'
import { SlidersHorizontal } from 'lucide-react'
import { Quota } from './Quota.js'
import { Section } from './ui/section.js'
import { RowsLoading } from './ui/card.js'
import { useSkeleton } from './ui/skeleton.js'
import { Button } from './ui/button.js'
import { HumanQueueList } from './HumanQueueList.js'
import { updatePreferences, usePreferences, usePreferencesLoaded } from '../lib/preferences.js'
import { OnboardingChecklist } from './OnboardingChecklist.js'
import { AgentUpdates } from './AgentUpdates.js'
import { Agents } from './Agents.js'
import { useModuleCards, type OverviewCard } from './ModuleCards.js'
import { SkillsCard } from './SkillsCard.js'
import { CardGrid, EditOverview, TakeOffMark } from './CustomizeOverview.js'
import { ALL_PROJECTS, arrangeCards } from '../../src/client.js'
import type { ProjectSummary } from '../../src/index.js'
import type { ReadState } from '../lib/use-async.js'
import { Page } from './Page.js'
import { LinePart, NEEDS_YOU_ID, WORKING_ID, counted, scrollToPart } from './LinePart.js'
import { YourAgentsPart } from './YourAgentsPart.js'

// The Overview landing page (#1139): a focused at-a-glance board — usage first, then what needs a
// human (Human Queue) beside the agents working now, then the cards the installed packages
// declare, in two columns (#1818: the queue package's AI Queue, the tickets package's hot tickets,
// the scheduler package's Automations). A card with nothing to show says so in a sentence ("No agent is at work."). OpenAgent's own cards are projections of the same .openagent files
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
  projectHref,
  onSelectAgent,
  onAgentStarted,
  interventions,
  interventionsState,
  active,
  projects,
  scope,
  onProjectAdded,
}: {
  onSelectProject: (id: string) => void
  /** The address `onSelectProject` goes to: a link's `href`. */
  projectHref: (id: string) => string
  /** Open one session (project + run): the Agents rows link straight to a session. */
  onSelectAgent: (projectId: string, agentId: string) => void
  /** Where a session the onboarding checklist starts lands (#1169): on that session. */
  onAgentStarted: (projectId: string, intent: string, agentId: string) => void
  /** The Human Queue's items, already only the picked project's when one is picked. */
  interventions: Intervention[]
  /** What is known of the Human Queue's items: until they are read, by this visit or an earlier one, its part has no count; while they are only an earlier visit's, its card is faded. */
  interventionsState: ReadState
  /** Every agent going right now, across the projects, and what is known of it. */
  active: { active: ActiveAgent[]; state: ReadState }
  /** Every registered project. The usage bar is given all of them: usage is the account's, not a project's. */
  projects: ProjectSummary[]
  /** The one project the page shows (#1513), or null for all: the agents at work and the packages' cards show only its, and a card of a package it does not have is not drawn. */
  scope: string | null
  /** A project was added from the first steps: the app reads its projects again. */
  onProjectAdded: () => void
}) {
  // Its ✕ hides it (#958), and a switch in Settings › Appearance shows it again.
  const onboardingDismissed = usePreferences().onboardingDismissed ?? false
  const namesRuns = usePreferences().nameRuns !== false
  const working = active.active.filter(agent => scope === null || agent.projectId === scope)
  const shownProjects = scope === null ? projects : projects.filter(project => project.id === scope)
  // Every card the Overview can show here, each with the widths it stands at; the person's layout
  // for this page (the picked project's, else all projects') orders them, sizes them, and hides some.
  const { cards: moduleCards, line: moduleLine } = useModuleCards(shownProjects)
  // What the number counts, kind by kind: "1 question, 1 to publish".
  const waiting = KINDS.map(kind => ({ kind, count: interventions.filter(item => item.kind === kind.value).length })).filter(({ count }) => count > 0)
  // How things stand, in one line under the title, each part a link to where it is: what needs the
  // person, who is at work, the queue's own part (its package's, by its order) and the person's agents.
  const line: { id: string; order: number; node: ReactNode }[] = [
    {
      id: 'needs-you',
      order: 1,
      node: (
        <LinePart
          reading={interventionsState === 'unknown'}
          note={waiting.length === 0 ? 'Nothing waits on you' : waiting.map(({ kind, count }) => kind.counted(count)).join(', ')}
          onClick={() => scrollToPart(NEEDS_YOU_ID)}
        >
          {interventions.length === 0 ? 'nothing needs you' : interventions.length === 1 ? '1 needs you' : `${interventions.length} need you`}
        </LinePart>
      ),
    },
    {
      id: 'working-now',
      order: 2,
      node: (
        <LinePart reading={active.state === 'unknown'} live={working.length > 0} note={counted(working.length, 'agent at work', 'agents at work', 'No agent is at work')} {...(working.length > 0 ? { onClick: () => scrollToPart(WORKING_ID) } : {})}>
          {working.length === 0 ? 'no agent working' : `${working.length} working`}
        </LinePart>
      ),
    },
    ...moduleLine,
    // The person's agents (Rom's design: an agent is a name, skills and accounts): how many, by name, a press from their page.
    { id: 'your-agents', order: 4, node: <YourAgentsPart /> },
  ].sort((one, other) => one.order - other.order)
  const cards: OverviewCard[] = [
    // Usage (#1139): the one figure that governs everything the agent may do next.
    { id: 'usage', label: 'Usage', order: 5, width: '1', minWidth: '1/2', node: <Quota projects={projects} /> },
    {
      id: 'human-queue',
      stale: interventionsState === 'kept',
      label: 'Human Queue',
      order: 6,
      width: '1',
      minWidth: '1/2',
      node: (
        <div id={NEEDS_YOU_ID} className="flex scroll-mt-6 flex-col *:flex-1">
          <HumanQueue items={interventions} loaded={interventionsState !== 'unknown'} onSelectProject={onSelectProject} onSelectAgent={onSelectAgent} />
        </div>
      ),
    },
    {
      id: 'working',
      stale: active.state === 'kept',
      label: 'Agents at work',
      order: 7,
      width: '1/2',
      minWidth: '1/3',
      node: (
        <div id={WORKING_ID} className="flex scroll-mt-6 flex-col *:flex-1">
          <Agents working={working} loaded={active.state !== 'unknown'} namesRuns={namesRuns} onSelectAgent={onSelectAgent} />
        </div>
      ),
    },
    // How each project's skills stand: a newer version to take, skills not yet where agents start from.
    { id: 'skills', label: 'Skills', order: 8, width: '1/3', minWidth: '1/4', node: <SkillsCard projects={shownProjects} onSelectProject={onSelectProject} projectHref={projectHref} /> },
    // The cards the installed packages declare (#1818): a package's own summary of its data, only
    // when one of the projects shown (every registered one, or the picked one alone) has the package.
    ...moduleCards,
  ]
  // Until a layout names them, the cards stand by their order.
  cards.sort((a, b) => a.order - b.order)
  const layoutKey = scope ?? ALL_PROJECTS
  const layouts = usePreferences().overviewLayouts
  // The cards are drawn once the person's layout is read: a card they took off is never drawn, and
  // so never reads anything, not even for the moment before the layout is known. A package's card,
  // mounted later, comes after the Overview's own (by its order), so it pushes none of them aside.
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
      width="wide"
      description={
        // In the sentence's place, wrapping as text on a phone.
        line.map((part, at) => (
          <Fragment key={part.id}>
            {at > 0 && <span aria-hidden className="mx-1.5">·</span>}
            {part.node}
          </Fragment>
        ))
      }
      actions={
        editing ? (
          <>
            {own && (
              <Button variant="ghost" onClick={reset}>
                {layoutKey === ALL_PROJECTS ? 'Reset to the default layout' : 'Use the all-projects layout'}
              </Button>
            )}
            {/* Focused as it takes Customize's place, which the press took away from the keyboard. */}
            <Button autoFocus onClick={() => setEditing(false)}>
              Done
            </Button>
          </>
        ) : (
          // Under the description on a phone: pulled back by its padding, so its icon lines up with the words above.
          <Button variant="ghost" className="gap-1.5 text-muted-foreground max-sm:-ml-3" onClick={() => setEditing(true)}>
            <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden />
            Customize
          </Button>
        )
      }
    >
      {/* Arranging moves nothing: the first steps and the updates stay, each part keeps its place, and what arranging adds comes after the parts. */}
      <div className="space-y-10">
        {!onboardingDismissed && <OnboardingChecklist projects={projects} onAgentStarted={onAgentStarted} onSelectProject={onSelectProject} onProjectAdded={onProjectAdded} />}
        <AgentUpdates />
        {!layoutRead ? null : editing ? (
          <EditOverview
            arranged={arranged}
            layouts={layouts}
            layoutKey={layoutKey}
            notice={
              <>
                <span className="font-medium text-foreground">{scopeName !== undefined ? `Arranging the layout for ${scopeName}.` : 'Arranging the layout for all projects.'}</span>{' '}
                {scopeName !== undefined ? 'Each project keeps its own; a project you never arranged uses the all-projects one.' : 'A project you never arranged on its own uses it too.'} Drag a card by its handle, pick its width, or take it off with <TakeOffMark />. On a phone every card is full width.
              </>
            }
          />
        ) : arranged.some(({ hidden }) => !hidden) ? (
          <CardGrid cards={arranged.filter(({ hidden }) => !hidden)} />
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-sm text-muted-foreground">Every card is off the Overview. Press Customize to put some back.</p>
            <Button variant="secondary" onClick={() => setEditing(true)}>
              Customize
            </Button>
          </div>
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
  loaded,
  onSelectProject,
  onSelectAgent,
}: {
  items: Intervention[]
  /** The items were read, by this visit or an earlier one: until then the card says it is loading, not that nothing waits. */
  loaded: boolean
  onSelectProject: (id: string) => void
  onSelectAgent: (projectId: string, agentId: string) => void
}) {
  const groups = KINDS.map(kind => ({ ...kind, items: items.filter(item => item.kind === kind.value) })).filter(group => group.items.length > 0)
  const reading = useSkeleton(!loaded)
  return (
    <Section title="Human Queue" count={items.length > 0 ? items.length : undefined}>
      <p className="-mt-1 mb-3 text-xs text-muted-foreground">Agents awaiting your approval, review, or input</p>
      {reading ? (
        <RowsLoading />
      ) : items.length === 0 ? (
        <p className="text-sm text-muted-foreground">AI doesn&apos;t need you.</p>
      ) : (
        // One group per kind, under a quiet heading with how many: a few questions are not lost
        // among many checkouts left to commit. Each group shows its first rows and offers the rest.
        // Pulled out by the rows' own inset, so their text starts where the heading does.
        <div className="-mx-3 space-y-3">
          {groups.map(group => (
            <section key={group.value} aria-label={group.label}>
              <h3 className="flex items-baseline gap-1.5 px-3 pb-0.5 text-xs font-medium text-muted-foreground">
                {group.label}
                <span className="tabular-nums">{group.items.length}</span>
              </h3>
              <HumanQueueList grouped items={group.items} onOpenAgent={onSelectAgent} onOpenProject={onSelectProject} />
            </section>
          ))}
        </div>
      )}
    </Section>
  )
}

/** The kinds the card groups its rows by, in the order of how much they hold a run up: a question stops one. */
const KINDS: { value: Intervention['kind']; label: string; counted: (count: number) => string }[] = [
  { value: 'awaiting', label: 'Questions', counted: count => (count === 1 ? '1 question' : `${count} questions`) },
  { value: 'pr', label: 'Pull requests', counted: count => (count === 1 ? '1 pull request' : `${count} pull requests`) },
  { value: 'unpushed', label: 'To publish', counted: count => `${count} to publish` },
  { value: 'uncommitted', label: 'To commit', counted: count => `${count} to commit` },
]

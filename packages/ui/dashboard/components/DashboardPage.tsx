import type { ActiveAgent, Waiting } from '../../src/index.js'
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { flushSync } from 'react-dom'
import { SlidersHorizontal } from 'lucide-react'
import { Quota } from './Quota.js'
import { Button } from './ui/button.js'
import { updatePreferences, usePreferences, usePreferencesLoaded } from '../lib/preferences.js'
import { OnboardingChecklist } from './OnboardingChecklist.js'
import { AgentUpdates } from './AgentUpdates.js'
import { Agents } from './Agents.js'
import { useRunsDoing } from '../lib/use-doing.js'
import { useModuleCards, type OverviewCard } from './ModuleCards.js'
import { CardGrid, EditOverview, TakeOffMark, UNDER, UnderCards, type Under } from './CustomizeOverview.js'
import { ALL_PROJECTS, arrangeCards } from '../../src/client.js'
import type { ProjectSummary } from '../../src/index.js'
import type { ReadState } from '../lib/use-async.js'
import type { ListedPage } from '../lib/use-modules.js'
import { Page } from './Page.js'
import { overlayOpen, pressed } from '../lib/shortcut.js'
import { LinePart, NEEDS_YOU_ID, WORKING_ID, counted, scrollToPart } from './LinePart.js'
import { YourProfilesPart } from './YourProfilesPart.js'
import { useIsMobile } from '../lib/use-mobile.js'

/**
 * The place in the line under the title that the Overview leaves for the packages' parts: its own
 * stand at 1, 2 and from 4 on. A package's part that names another order still stands there; this is
 * only where the line waits for them.
 */
const PACKAGES_PLACE = 3

// The Overview landing page (#1139): the box that starts a session first, then a focused at-a-glance
// board — what needs a human (the Human Queue, `ui-card-waiting`'s card), the first steps under it, then usage and the agents
// working now, then the other cards the installed packages declare, in two columns (#1818: the
// queue package's AI Queue, the tickets package's hot tickets, the scheduler package's
// Automations). A card with nothing to show says so in its middle, a sentence under a quiet glyph ("No agent is at work.").
// OpenAgent's own cards are projections of the same .openagent files over the shell's own polls
// (the agents at work, what waits on the person), so they stay live; selecting a row jumps into its project or
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
  waiting,
  waitingState,
  active,
  projects,
  scope,
  onProjectAdded,
  listedPages,
  start,
}: {
  /** The box that starts a session (StartAgentForm), the page's first part: in the picked project, else in none. */
  start: ReactNode
  onSelectProject: (id: string) => void
  /** Open one session (project + run): the Agents rows link straight to a session. */
  onSelectAgent: (projectId: string, agentId: string) => void
  /** Where a session the onboarding checklist starts lands (#1169): on that session. */
  onAgentStarted: (projectId: string, intent: string, agentId: string) => void
  /** What waits on the person, already only the picked project's when one is picked. */
  waiting: readonly Waiting[]
  /** What is known of what waits on the person: until it is read, by this visit or an earlier one, its part of the line has no count, and no card is drawn after the card of it. */
  waitingState: ReadState
  /** Every agent going right now, across the projects, and what is known of it. */
  active: { active: ActiveAgent[]; state: ReadState }
  /** Every registered project. The usage bar is given all of them: usage is the account's, not a project's. */
  projects: ProjectSummary[]
  /** The one project the page shows (#1513), or null for all: the agents at work and the packages' cards show only its, and a card of a package it does not have is not drawn. */
  scope: string | null
  /** A project was added from the first steps: the app reads its projects again. */
  onProjectAdded: () => void
  /** The modules' pages as the sidebar lists them, null where none is known yet: which projects have the Queue and the Tickets, before the packages' code is in. */
  listedPages: readonly ListedPage[] | null
}) {
  // Its ✕ hides it (#958), and a switch in Settings › Appearance shows it again.
  const onboardingDismissed = usePreferences().onboardingDismissed ?? false
  const namesRuns = usePreferences().nameRuns !== false
  const working = active.active.filter(agent => scope === null || agent.projectId === scope)
  const doing = useRunsDoing(working)
  const shownProjects = scope === null ? projects : projects.filter(project => project.id === scope)
  // Every card the Overview can show here, each with the widths it stands at; the person's layout
  // for this page (the picked project's, else all projects') orders them, sizes them, and hides some.
  const { cards: moduleCards, line: moduleLine, loaded: modulesLoaded } = useModuleCards(shownProjects)
  const queueComing = !modulesLoaded && moduleLine.length === 0 && listedPages?.some(page => page.id === 'queue' && shownProjects.some(project => page.projects.includes(project.id))) === true
  // Until the pages are known (a browser's first visit) nor any package's part is in, whether the queue's part comes is
  // not known: the parts after its place wait, so a part coming in before them pushes nothing.
  const placeKnown = modulesLoaded || moduleLine.length > 0 || listedPages !== null
  // What the number counts, mark by mark: "1 question, 1 to publish".
  const counts = waitingCounts(waiting)
  // The card of what needs the person, a module's: the first steps stand under it, and the cards after
  // it wait for what it shows, and for its code while its room is held.
  const needsYouCard = moduleCards.find(card => card.needsYou)
  const needsYou = needsYouCard?.id
  const needsYouWaits = needsYouCard !== undefined && (waitingState === 'unknown' || needsYouCard.holding === true)
  // How things stand, in one line under the title, each part a link to where it is: what needs the
  // person, who is at work, the queue's own part (its package's, by its order) and the person's agents.
  const line: { id: string; order: number; node: ReactNode }[] = [
    {
      id: 'needs-you',
      order: 1,
      node: (
        <LinePart
          reading={waitingState === 'unknown'}
          shape="2 need you"
          note={counts.length === 0 ? 'Nothing waits on you' : counts.join(', ')}
          {...(needsYou !== undefined ? { onClick: () => scrollToPart(NEEDS_YOU_ID) } : {})}
        >
          {waiting.length === 0 ? 'nothing needs you' : waiting.length === 1 ? '1 needs you' : `${waiting.length} need you`}
        </LinePart>
      ),
    },
    {
      id: 'working-now',
      order: 2,
      node: (
        <LinePart reading={active.state === 'unknown'} shape="1 working" live={working.length > 0} note={counted(working.length, 'agent at work', 'agents at work', 'No agent is at work')} {...(working.length > 0 ? { onClick: () => scrollToPart(WORKING_ID) } : {})}>
          {working.length === 0 ? 'no agent working' : `${working.length} working`}
        </LinePart>
      ),
    },
    // Until the packages' code is in, the queue's part waits in its place, as wide as it, where the sidebar's pages say a
    // shown project has the Queue: a part that came after the line was drawn would lengthen it (on a phone pushing the
    // Customize press and the page under it), and a place no part takes would shorten it.
    ...(queueComing ? [{ id: 'packages', order: PACKAGES_PLACE, node: <LinePart reading shape="4 queued">{null}</LinePart> }] : moduleLine),
    // The person's agents (Rom's design: an agent is a name, skills and accounts): how many, by name, a press from their page.
    ...(placeKnown ? [{ id: 'your-profiles', order: 4, node: <YourProfilesPart /> }] : []),
  ].sort((one, other) => one.order - other.order)
  const cards: OverviewCard[] = [
    // Under what needs the person, what is at work and the usage a half each (his pick: the usage's sentence needs the room), then a column two thirds wide down the page's left and one a third wide
    // beside it, the packages' cards taking their turns in both: each third comes after the card it
    // stands beside (the hot tickets beside what is at work, the account's usage, the one figure that
    // governs everything the agent may do next (#1139), beside the queue), so the first steps under
    // what needs the person never move the thirds to the left.
    {
      id: 'working',
      stale: active.state === 'kept',
      label: 'At work',
      order: 6,
      width: '1/2',
      minWidth: '1/2',
      node: (
        <div id={WORKING_ID} className="flex scroll-mt-6 flex-col *:flex-1">
          <Agents working={working} state={active.state} namesRuns={namesRuns} doing={doing} projectsNamed={scope === null} onSelectAgent={onSelectAgent} />
        </div>
      ),
    },
    { id: 'usage', label: 'Usage', order: 9, width: '1/2', minWidth: '1/3', node: <Quota projects={projects} /> },
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
  // Done, or Esc unless it closes something open first; the keyboard goes back to Customize, drawn in Done's place.
  const customize = useRef<HTMLButtonElement>(null)
  const done = (): void => {
    flushSync(() => setEditing(false))
    customize.current?.focus()
  }
  useEffect(() => {
    if (!editing) return
    const onKey = (event: KeyboardEvent): void => {
      if (!event.defaultPrevented && pressed(event, 'leaveCustomize') && !overlayOpen()) done()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [editing])
  const scopeName = scope === null ? undefined : projects.find(project => project.id === scope)?.name
  const own = layouts?.[layoutKey] !== undefined
  const resetWords = layoutKey === ALL_PROJECTS ? 'Reset to the default layout' : 'Use the all-projects layout'
  const phone = useIsMobile()
  const reset = (): void => {
    const { [layoutKey]: _dropped, ...rest } = layouts ?? {}
    updatePreferences({ overviewLayouts: rest })
  }

  // What needs the person leads; what a new install still has to do comes right under it, wherever the layout puts it.
  const [firstStepsRead, setFirstStepsRead] = useState(false)
  const firstStepsHaveRead = useCallback(() => setFirstStepsRead(true), [])
  const firstSteps: Under = {
    card: needsYou,
    node: (
      <>
        {!onboardingDismissed && <OnboardingChecklist projects={projects} onAgentStarted={onAgentStarted} onSelectProject={onSelectProject} onProjectAdded={onProjectAdded} onRead={firstStepsHaveRead} listedPages={listedPages} />}
        <AgentUpdates />
      </>
    ),
  }

  return (
    <Page
      title="Overview"
      line={
        // Each part stands whole after its dot, and a part that starts a line (on a phone) shows no
        // dot: the dots stand in the room the row is pulled left by, which the edge cuts off. The
        // edge leaves a press's focus ring its room.
        <span className="-m-1 block overflow-hidden p-1">
          <span className="-ml-4 flex flex-wrap">
            {line.map(part => (
              <span key={part.id} className="whitespace-nowrap">
                <span aria-hidden className="inline-block w-4 text-center">
                  ·
                </span>
                {part.node}
              </span>
            ))}
          </span>
        </span>
      }
      actions={
        editing ? (
          <>
            {own && !phone && (
              <Button variant="ghost" onClick={reset}>
                {resetWords}
              </Button>
            )}
            {/* Focused as it takes Customize's place, which the press took away from the keyboard. */}
            <Button autoFocus onClick={done}>
              Done
            </Button>
          </>
        ) : (
          // Pulled out by its own padding, so its words (on a phone its mark alone, the line beside it keeping the width) end on the cards' edge.
          <Button ref={customize} variant="ghost" className="-mr-3 gap-1.5 text-muted-foreground max-md:size-10 max-md:px-0" onClick={() => setEditing(true)}>
            <SlidersHorizontal className="h-3.5 w-3.5 max-md:size-4" aria-hidden />
            <span className="max-md:sr-only">Customize</span>
          </Button>
        )
      }
    >
      {/* Arranging keeps the parts in their order and where they stand: the first steps and the updates stay, and what arranging adds comes after the parts. */}
      <div className="space-y-10">
        {/* The page's own, before every card (his and Rom's pick): arranging the cards neither moves it nor takes it off. */}
        {start}
        {!layoutRead ? null : editing ? (
          <EditOverview
            arranged={arranged}
            under={firstSteps}
            layouts={layouts}
            layoutKey={layoutKey}
            notice={
              <>
                <span className="font-medium text-foreground">{scopeName !== undefined ? `Arranging the layout for ${scopeName}.` : 'Arranging the layout for all projects.'}</span>{' '}
                {scopeName !== undefined ? 'Each project keeps its own; a project you never arranged uses the all-projects one.' : 'A project you never arranged on its own uses it too.'} Drag a card by its handle, pick its width, or take it off with <TakeOffMark />. On a phone every card is full width.
              </>
            }
            // On a phone the head has room for Done alone beside the line under the title: the reset stands here, under the tray's words.
            {...(own && phone
              ? {
                  reset: (
                    <Button variant="secondary" className="h-11" onClick={reset}>
                      {resetWords}
                    </Button>
                  ),
                }
              : {})}
          />
        ) : arranged.some(({ hidden }) => !hidden) ? (
          // On a first visit the parts come in from the top: none is drawn under the Human Queue or the first steps until they have answered, as either grows from its waiting room by more than a line.
          <CardGrid cards={arranged.filter(({ hidden }) => !hidden)} under={firstSteps} until={needsYouWaits ? needsYou : !onboardingDismissed && !firstStepsRead ? UNDER : undefined} />
        ) : (
          <>
            <UnderCards under={firstSteps} />
            <div className="flex flex-wrap items-center gap-3">
              <p className="text-sm text-muted-foreground">Every card is off the Overview. Press Customize to put some back.</p>
              <Button variant="secondary" onClick={() => setEditing(true)}>
                Customize
              </Button>
            </div>
          </>
        )}
      </div>
    </Page>
  )
}

/** The marks of what waits on the person, in the order of how much they hold a run up (a question stops one), as the line under the title counts them. */
const COUNTED: { mark: Waiting['mark']; counted: (count: number) => string }[] = [
  { mark: 'question', counted: count => (count === 1 ? '1 question' : `${count} questions`) },
  { mark: 'pull-request', counted: count => (count === 1 ? '1 pull request' : `${count} pull requests`) },
  { mark: 'branch', counted: count => `${count} to publish` },
  { mark: 'changes', counted: count => `${count} to commit` },
  { mark: undefined, counted: count => `${count} more` },
]

/** What the line's number counts, mark by mark: "1 question", "1 to publish"; nothing for a mark none has. */
function waitingCounts(waiting: readonly Waiting[]): string[] {
  return COUNTED.flatMap(({ mark, counted }) => {
    const count = waiting.filter(item => item.mark === mark).length
    return count > 0 ? [counted(count)] : []
  })
}

import { useContext, useState, type ReactNode } from 'react'
import type { DashboardData, ProjectSummary } from '../../src/index.js'
import { Check, Info, X } from 'lucide-react'
import { onDashboard } from '../rpc/reads.js'
import { usePolled } from '../lib/use-async.js'
import { cn } from '../lib/utils.js'
import { Button, buttonVariants } from './ui/button.js'
import { useMountedModules } from '../lib/use-modules.js'
import { useAgentAccounts } from './AgentAccounts.js'
import { ModuleSlot } from './ModulePageView.js'
import { inPlace } from '../lib/in-place.js'
import { Facts, Panel, PanelGroup, StepNumber } from './ui/panel.js'
import { Skeleton } from './ui/skeleton.js'
import { usePreferences, updatePreferences } from '../lib/preferences.js'
import { startPicks, useStartAgent } from '../lib/use-start-agent.js'
import { AddProjectEffects } from './AddProjectEffects.js'
import { ProjectPicker } from './ProjectPicker.js'
import { UpdateTicketsButton, UPDATE_TICKETS_PROMPT } from './UpdateTicketsButton.js'
import { HostFix } from './AddGitAccount.js'
import { AgentFix, agentLoginState, hostLoginState, hostWords, useAgentState, useGitHosts } from './Logins.js'
import { Tooltip, TooltipTrigger, TooltipContent } from './ui/tooltip.js'
import { HostServicesContext, INERT_HOST_SERVICES } from '../lib/host-services.js'
import type { ListedPage } from '../lib/use-modules.js'

// "Discover OpenAgent", the Overview's first steps (#958): what a new install can set up, each with
// the state it is actually in rather than a static list to read past.
//
// Every "done" is derived from a real fact — a login, a registered project, a non-empty queue, a
// ticket on disk — so a step cannot be ticked by clicking it, and a step done outside the dashboard
// shows up ticked anyway. Numbered, not boxes: a box invites a
// click that can tick nothing.
//
// One step is open at a time (his pick): the next one to do, its words and its button at the row's
// end; a step done is one line with a ✓ and what was done; the steps after it, only their titles,
// each a press from open. A step stays once shown, done or not, so the count never moves under a
// person: "Connect GitHub" turns into a ✓, it does not vanish.
//
// It is the Overview's first part, above the box that starts a session, while a step is open (his
// pick). With every step done it is gone: the box is how a session starts. Its ✕ hides it, and the
// "Discover OpenAgent on the Overview" switch in Settings › Appearance brings it back: what the ✕
// promises.

/** What the ✕ says it does. */
const HIDE = 'Hide; Settings › Appearance brings it back'

/** The coding agents a session can run on: each one's CLI, its list of accounts, and its name on the press that connects it. */
const AGENTS = [
  { driver: 'claude-code', list: 'claude', name: 'Claude' },
  { driver: 'codex', list: 'codex', name: 'Codex' },
] as const

/** One step: what it is, whether it is done, and what to do about it. */
interface Step {
  key: string
  label: string
  /** What the step is, said while it is open. */
  description?: ReactNode
  /** More of what it does, behind an ⓘ beside its title: read on a hover, not in the way. */
  info?: ReactNode
  done: boolean
  /** What was done, beside a done step's title: the account, the project. */
  doneNote?: string
  /**
   * Nothing breaks if this one is never done (#1139). Marked per step rather than by position, so
   * the list can be reordered without the promise moving with it.
   */
  optional?: boolean
  /** The press that does it, at the row's end while the step is open. */
  action?: ReactNode
}

export function OnboardingChecklist({
  projects,
  onAgentStarted,
  onSelectProject,
  onProjectAdded,
  listedPages,
}: {
  /** The projects as the app read them: the picker sees one it added land, and closes on it. */
  projects: readonly ProjectSummary[]
  /**
   * Told about the session a step started, so the shell can land on it (#1169). The project
   * travels with it: this renders on the Overview, which has none selected. Required, so a new mounting surface cannot quietly drop the navigation.
   */
  onAgentStarted: (projectId: string, intent: string, agentId: string) => void
  /** Where "Configure first, then run" lands (#1507): the launcher of the project the steps act on. */
  onSelectProject: (id: string) => void
  /** A project was added here: the app reads its projects again. */
  onProjectAdded: () => void
  /** The modules' pages as the sidebar lists them, null where none is known yet: which projects have the Queue and the Tickets. */
  listedPages: readonly ListedPage[] | null
}) {
  // Slower than the Overview's own 5s poll: these change at human speed, and this read fans out
  // over every project to answer the tickets question.
  // Kept for the next visit: the steps open where they stood, not as titles that then grow.
  const { value: data, reload, state } = usePolled<DashboardData | null>(onDashboard, null, 10_000, [], { remember: 'onboarding:dashboard', stored: true })
  const preferences = usePreferences()
  const { start, busy: starting, error: startError } = useStartAgent()
  const services = useContext(HostServicesContext) ?? INERT_HOST_SERVICES
  // What sessions need on this computer: a coding agent with an account, and an account at each git host.
  const claude = useAgentState('claude-code')
  const codex = useAgentState('codex')
  const accounts = { claude: useAgentAccounts('claude').view, codex: useAgentAccounts('codex').view }
  const { view: hosts, reload: reloadHosts } = useGitHosts()
  const agents = AGENTS.map(agent => ({ ...agent, ...(agent.driver === 'claude-code' ? claude : codex) }))
  const reloadAgents = (): void => void Promise.all(agents.map(agent => agent.reload()))
  // The press that connects an agent is its package's (`agent.connect`): the window the Permissions page adds an account in.
  const { views, loaded: modulesLoaded } = useMountedModules()
  const connect = views['agent.connect'][0]
  // The step the person opened; by default, the first one not done.
  const [picked, setPicked] = useState<string | undefined>()

  // The project the steps act on: the only/most recent one. A first-session flow rarely has a second.
  const targetProjectId = data?.projects[0]?.projectId ?? null

  // Before the projects are read, the app's own list says whether there is one.
  const projectCount = data?.totals.projects ?? projects.length
  const hasTickets = data?.projects.some(p => p.hasTickets) ?? false

  const populateTickets = async () => {
    if (!targetProjectId) return
    const started = await start(targetProjectId, UPDATE_TICKETS_PROMPT, startPicks(preferences))
    // Land on the session doing the import, not the project's launcher (#1169): its id is what
    // the shell needs to show the live output. A refusal keeps you here, with `startError` shown.
    if (started) onAgentStarted(targetProjectId, UPDATE_TICKETS_PROMPT, started.agentId)
  }

  const connected = agents.filter(agent => agent.state?.ready)
  // One connected: which, and whose account. Both: which.
  const whose = connected.length === 1 ? accounts[connected[0]!.list]?.accounts.find(account => !account.loggedOut)?.name : undefined
  const agentStep: Step = {
    key: 'agent',
    label: 'Connect a coding agent',
    description: 'Sessions run on Claude Code or Codex, with your own account. One is enough; add the other any time.',
    done: connected.length > 0,
    doneNote: [connected.map(agent => agent.name).join(', '), whose].filter(Boolean).join(' · '),
    // A press an agent, Claude's the primary: the agent sessions start on unless a person picks another. An agent whose
    // program this computer does not have is installed first.
    action: (
      <div className="flex max-w-full flex-wrap items-center gap-2">
        {agents.map((agent, at) =>
          agent.state && agentLoginState(agent.state) === 'not-installed' ? (
            <AgentFix key={agent.driver} state={agent.state} onChanged={reloadAgents} {...(at === 0 ? {} : { variant: 'secondary' as const })} />
          ) : connect ? (
            <ModuleSlot key={agent.driver} package={connect.package} label={`connect ${agent.name}`}>
              <connect.View agent={agent.list} primary={at === 0} onConnected={reloadAgents} />
            </ModuleSlot>
          ) : (
            // Until the agents' package is in, its press's shape holds its place: nothing in the row moves when it comes.
            !modulesLoaded && <Skeleton key={agent.driver} className="h-8 w-22 max-md:h-11" />
          ),
        )}
      </div>
    ),
  }
  const hostSteps: Step[] = (hosts?.hosts ?? []).flatMap(row => {
    const p = row.provider
    if (!p) return []
    const done = hostLoginState(row) === 'connected'
    const runs = p.accounts.find(account => account.runs && account.ok)?.login ?? p.accounts.find(account => account.ok)?.login
    return [
      {
        key: `host:${row.host}`,
        label: `Connect ${p.name}`,
        description: p.installed && p.accounts.length === 0 ? `OpenAgent pushes and opens ${p.requestWord}s with an account of its own, never your own login.` : hostWords(row),
        done,
        ...(runs ? { doneNote: `@${runs}` } : {}),
        action: <HostFix row={row} onChanged={reloadHosts} size="default" />,
      },
    ]
  })

  const steps: Step[] = [
    agentStep,
    ...hostSteps,
    {
      key: 'project',
      label: 'Add your first project',
      description: 'A git repo your agents work in, each in its own copy and on its own branch. Your files and your branch stay as they are.',
      info: <AddProjectEffects />,
      done: projectCount > 0,
      ...(projects.length > 0 ? { doneNote: projects.map(project => project.name).join(', ') } : {}),
      // The picker of the sidebar and the box: the repos on this computer and at GitHub, another folder, an address.
      action: (
        <ProjectPicker
          look="add"
          none={{ label: 'Add a project' }}
          picked={null}
          projects={projects}
          onPick={() => void reload()}
          onProjectAdded={() => {
            onProjectAdded()
            void reload()
          }}
        />
      ),
    },
    // Only when some project has a queue at all (#1774): a project gets one from a package it
    // depends on, and a step asking to fill a queue no project has would ask for nothing.
    ...((data?.queue.length ?? 0) > 0
      ? [
          {
            key: 'todos',
            label: 'Populate the queue of AI tasks',
            description: 'The agent queue: each entry is work the agent picks up on its own, so a filled queue is what lets it keep going without you.',
            done: (data?.totals.openTodos ?? 0) > 0,
            // A press to a page, so a modified click opens it where the browser would.
            action: (
              <a href={services.pageHref('queue')} onClick={inPlace(() => services.openPage('queue'))} className={buttonVariants({ variant: 'outline' })}>
                Open the Queue
              </a>
            ),
          },
        ]
      : []),
    // Only when some project can have tickets at all (#1774): a project gets them from a package it
    // depends on, and a step asking to populate tickets no project provides would ask for nothing.
    ...(data?.projects.some(p => p.providesTickets)
      ? [
          {
            key: 'tickets',
            label: 'Populate the tickets',
            description: (
              <p className="text-xs text-muted-foreground">
                <code className="rounded-sm bg-muted px-1">tickets/</code> holds the bigger things to work on, in the repo. The agent researches and plans them, and they are the input the queue is filled from.
              </p>
            ),
            done: hasTickets,
            optional: true,
            action: (
              <div className="flex flex-col items-end gap-1">
                <UpdateTicketsButton
                  variant="default"
                  busy={starting}
                  disabled={!targetProjectId}
                  onStart={() => void populateTickets()}
                  onConfigure={() => targetProjectId && onSelectProject(targetProjectId)}
                />
                {!targetProjectId && <span className="text-xs text-muted-foreground">Add a project first</span>}
                {startError && <span className="text-xs text-destructive">{startError}</span>}
              </div>
            ),
          },
        ]
      : []),
  ]

  // No step before its reads have said where it stands: an unread project count is not "no project".
  const loginsRead = claude.state !== undefined && codex.state !== undefined && hosts !== undefined
  const reading = state === 'unknown' || !loginsRead
  const open = picked !== undefined && steps.some(step => step.key === picked && !step.done) ? picked : steps.find(step => !step.done)?.key

  const doneCount = steps.filter(step => step.done).length
  // While the projects are not read: the queue's and the tickets' steps hold their places at the end exactly where the
  // sidebar's pages say a project has the Queue or the Tickets, as the same packages bring the page and the step. Until
  // those pages are known (a browser's first visit) the frame is not drawn.
  const listed = (segment: string) => listedPages?.some(page => page.id === segment && page.projects.length > 0) === true
  const coming = [...(listed('queue') ? [{ key: 'todos', done: false }] : []), ...(listed('tickets') ? [{ key: 'tickets', done: false }] : [])]
  const frame: { key: string; label?: string; description?: ReactNode; done: boolean }[] = [
    ...steps.map(step => ({ key: step.key, label: step.label, description: step.description, done: step.done })),
    ...(data === null ? coming : []),
  ]
  // Every step done: nothing to discover, and the box under it is how a session starts. The same while the steps are
  // read, where every one known so far is done: no frame is drawn that the answer would take away.
  if ((reading ? frame : steps).every(step => step.done)) return null
  return (
    <PanelGroup
      bare
      title="Discover OpenAgent"
      // Where the steps stand, in words: the numbers below say which is which.
      count={
        reading ? (
          // As wide as the words it stands for (the steps drawn below, none done yet), drawn unseen before it (not text of the page, nor said).
          <span aria-hidden data-shape={`0 of ${frame.length}`} className="inline-block h-4 animate-skeleton rounded-md bg-accent align-middle leading-4 before:invisible before:content-[attr(data-shape)] motion-reduce:animate-skeleton-still" />
        ) : (
          `${doneCount} of ${steps.length}`
        )
      }
      action={
        <>
          {/* Pulled out by its own padding, so its ✕ ends on the column's edge. */}
          <Tooltip>
            <TooltipTrigger render={<Button variant="ghost" size="icon-sm" onClick={() => updatePreferences({ onboardingDismissed: true })} aria-label={HIDE} className="-mr-1.5 text-muted-foreground" />}>
              <X className="h-4 w-4" aria-hidden />
            </TooltipTrigger>
            <TooltipContent>{HIDE}</TooltipContent>
          </Tooltip>
        </>
      }
    >
      {reading ? (
        <>
          <p className="sr-only">Loading…</p>
          {/* The steps as they will stand once read, so nothing in them moves when the answer comes: each its mark and its
              title, the open step its words under its name (read with the git hosts, or fixed) and
              its presses' shapes at the row's end, centred on the row; the steps only the projects' read can add (the
              queue's, the tickets') hold their places as shapes. Only once the coding agent and the git hosts are read
              (each can add a step at the top, which would push the rows drawn), and the sidebar's pages are known where
              the projects' read is not in (they say which places to hold): nothing under the steps is drawn before they
              are, so the frame coming late pushes nothing. */}
          {loginsRead && (data !== null || listedPages !== null) && (
            <Panel ordered aria-hidden>
              {frame.map((step, at) => (
                <li key={step.key} className={STEP_ROW}>
                  {step.label === undefined ? <MarkShape /> : step.done ? <DoneMark /> : <StepNumber at={at} current={step.key === open} />}
                  {step.label === undefined ? (
                    <span className="flex h-5 items-center">
                      <Skeleton className="h-4 w-48" />
                    </span>
                  ) : step.key === open ? (
                    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-2">
                      <div className="min-w-0 flex-[1_1_16rem] space-y-1">
                        <span className="block text-sm font-medium">{step.label}</span>
                        {typeof step.description === 'string' ? <p className="text-xs text-muted-foreground">{step.description}</p> : step.description}
                      </div>
                      <div className="flex max-w-full shrink-0 flex-wrap items-center gap-3">
                        {/* The coding agent's step has a press an agent. */}
                        {step.key === 'agent' ? (
                          <>
                            <Skeleton className="h-8 w-22 max-md:h-11" />
                            <Skeleton className="h-8 w-22 max-md:h-11" />
                          </>
                        ) : (
                          <Skeleton className="h-8 w-36" />
                        )}
                      </div>
                    </div>
                  ) : (
                    <span className="text-sm text-muted-foreground">{step.label}</span>
                  )}
                </li>
              ))}
            </Panel>
          )}
        </>
      ) : (
        <Panel ordered aria-label={`${doneCount} of ${steps.length} done`}>
          {steps.map((step, at) => {
            const isOpen = step.key === open
            // A later step is a press that opens it: the whole row is, lit under the pointer.
            const press = !step.done && !isOpen
            return (
              <li
                key={step.key}
                aria-label={step.label}
                aria-current={isOpen ? 'step' : undefined}
                className={cn(
                  STEP_ROW,
                  press && 'pointer-fine:hover:bg-foreground/4 pointer-fine:hover:before:opacity-0 pointer-fine:[&:hover+li]:before:opacity-0 has-[[data-cover]:active]:bg-foreground/8',
                  press && 'has-[[data-cover]:focus-visible]:ring-2 has-[[data-cover]:focus-visible]:ring-focus has-[[data-cover]:focus-visible]:ring-inset has-[[data-cover]:focus-visible]:before:opacity-0',
                )}
              >
                {step.done ? (
                  <DoneMark />
                ) : (
                  <StepNumber at={at} current={isOpen} />
                )}
                {/* The action goes under the words until it fits whole beside them with the words 16rem wide or more, so a
                    command is cut only where the row has no room for it. Beside them it is centred on the row and the title
                    stays on the row's first line, with the step's number; a command goes under its press where the two do
                    not fit one line. */}
                <div className="flex min-w-0 flex-1 flex-wrap items-start gap-x-3 gap-y-2">
                  <div className="min-w-0 flex-[1_1_16rem] space-y-1">
                    <div className="flex flex-wrap items-center gap-x-2">
                      <button
                        type="button"
                        disabled={!press}
                        onClick={() => setPicked(step.key)}
                        {...(press ? { 'data-cover': true } : {})}
                        className={cn('flex flex-wrap items-center gap-x-2 text-left text-sm', press && 'outline-none after:absolute after:inset-0', step.done ? 'text-muted-foreground' : isOpen ? 'font-medium' : 'text-muted-foreground hover:text-foreground')}
                      >
                        {/* What was done after its name, as every line of facts joins them. */}
                        <Facts oneLine facts={[step.label, step.done && step.doneNote && { fact: step.doneNote, className: 'text-xs text-muted-foreground' }]} />
                        {step.optional && !step.done && <span className="text-xs font-normal text-muted-foreground">Optional</span>}
                      </button>
                      {isOpen && step.info && (
                        <Tooltip>
                          <TooltipTrigger render={<button type="button" aria-label={`More on ${step.label}`} className="relative text-muted-foreground after:absolute after:-inset-1.5 hover:text-foreground" />}>
                            <Info className="h-3.5 w-3.5" aria-hidden />
                          </TooltipTrigger>
                          <TooltipContent className="max-w-sm">{step.info}</TooltipContent>
                        </Tooltip>
                      )}
                    </div>
                    {isOpen && step.description && (typeof step.description === 'string' ? <p className="text-xs text-muted-foreground">{step.description}</p> : step.description)}
                  </div>
                  {isOpen && step.action && <div className="flex max-w-full shrink-0 self-center">{step.action}</div>}
                </div>
              </li>
            )
          })}
        </Panel>
      )}
    </PanelGroup>
  )
}

/** A step's row, as a panel's: 16 in from every edge, its mark on the title's line, a hairline from inset to inset over every row but the first. */
const STEP_ROW = 'relative flex items-start gap-3 px-4 py-3 before:absolute before:top-0 before:right-4 before:left-4 before:h-px not-first:before:bg-hairline'

/** A step done: a ✓ in the press's colour. */
function DoneMark() {
  return (
    <span aria-label="Done" className="flex h-5 w-4 shrink-0 items-center text-primary">
      <Check className="size-4" aria-hidden />
    </span>
  )
}

/** A step the projects' read may add: a shape in its mark's place. */
function MarkShape() {
  return (
    <span className="flex h-5 w-4 shrink-0 items-center">
      <Skeleton className="size-4 rounded-full" />
    </span>
  )
}

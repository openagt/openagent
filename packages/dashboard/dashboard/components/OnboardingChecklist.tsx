import { useContext, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import type { DashboardData, ProjectSummary } from '../../src/index.js'
import { Check, Info, X } from 'lucide-react'
import { onDashboard } from '../rpc/reads.js'
import { usePolled } from '../lib/use-async.js'
import { usePerson } from '../lib/use-person.js'
import { cn } from '../lib/utils.js'
import { Button } from './ui/button.js'
import { Panel, PanelGroup } from './ui/panel.js'
import { Skeleton } from './ui/skeleton.js'
import { usePreferences, updatePreferences, notificationsEnabled } from '../lib/preferences.js'
import { setBrowserNotifications, useNotificationPermission } from '../lib/notification-permission.js'
import { startPicks, useStartAgent } from '../lib/use-start-agent.js'
import { AddProjectEffects } from './AddProjectEffects.js'
import { ProjectPicker } from './ProjectPicker.js'
import { UpdateTicketsButton, UPDATE_TICKETS_PROMPT } from './UpdateTicketsButton.js'
import { HostFix } from './AddGitAccount.js'
import { hostLoginState, hostWords, useMissing } from './Logins.js'
import { firstName } from './PersonMenu.js'
import { Tooltip, TooltipTrigger, TooltipContent } from './ui/tooltip.js'
import { HostServicesContext, INERT_HOST_SERVICES } from '../lib/host-services.js'

// The Overview's first steps (#958): what a new install needs, each with the state it is actually
// in rather than a static list to read past.
//
// Every "done" is derived from a real fact — a login, a registered project, a non-empty queue, a
// ticket on disk, a granted browser permission — so a step cannot be ticked by clicking it, and a
// step done outside the dashboard shows up ticked anyway. Numbered, not boxes: a box invites a
// click that can tick nothing.
//
// One step is open at a time (his pick): the next one to do, its words and its button at the row's
// end; a step done is one line with a ✓ and what was done; the steps after it, only their titles,
// each a press from open. A step stays once shown, done or not, so the count never moves under a
// person: "Connect GitHub" turns into a ✓, it does not vanish.
//
// It renders on the Overview under what needs the person, greeting them by the time of day. Its ✕ hides it,
// and the "Onboarding on the Overview" switch in Settings › Appearance brings it back: what the ✕
// promises. With every step a session needs done, it says so, and its button starts the first one.

/** What the ✕ says it does. */
const HIDE = 'Hide; Settings › Appearance brings it back'

/** The greeting for an hour of the day: morning until noon, afternoon until six, then evening. */
export function greeting(hour: number): string {
  return hour >= 5 && hour < 12 ? 'Good morning' : hour >= 12 && hour < 18 ? 'Good afternoon' : 'Good evening'
}

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
  onRead,
}: {
  /** The projects as the app read them: the picker sees one it added land, and closes on it. */
  projects: readonly ProjectSummary[]
  /**
   * Told about the session a step started, so the shell can land on it (#1169). The project
   * travels with it: this renders on the Overview, which has none selected. Required, so a new mounting surface cannot quietly drop the navigation.
   */
  onAgentStarted: (projectId: string, intent: string, agentId: string) => void
  /** Where "Configure first, then run" and "Start your first session" land (#1507): the launcher of the project the steps act on. */
  onSelectProject: (id: string) => void
  /** A project was added here: the app reads its projects again. */
  onProjectAdded: () => void
  /** Told once the steps stand where their reads say, before that frame is drawn: what the page holds back under them can come. */
  onRead: () => void
}) {
  // Slower than the Overview's own 5s poll: these change at human speed, and this read fans out
  // over every project to answer the tickets question.
  // Kept for the next visit: the steps open where they stood, not as titles that then grow.
  const { value: data, reload, state } = usePolled<DashboardData | null>(onDashboard, null, 10_000, [], { remember: 'onboarding:dashboard', stored: true })
  const preferences = usePreferences()
  const permission = useNotificationPermission()
  const { start, busy: starting, error: startError } = useStartAgent()
  const { person } = usePerson()
  const services = useContext(HostServicesContext) ?? INERT_HOST_SERVICES
  // What runs need on this computer: the coding agent's login, and an account at each git host.
  const { missing, hosts, loaded: missingLoaded, reload: reloadMissing } = useMissing()
  // The steps shown once stay, done or not: the coding agent's is there only once it was missing.
  const seen = useRef(new Set<string>())
  // The step the person opened; by default, the first one not done.
  const [picked, setPicked] = useState<string | undefined>()

  // The project the steps act on: the only/most recent one. A first-session flow rarely has a second.
  const targetProjectId = data?.projects[0]?.projectId ?? null

  const projectCount = data?.totals.projects ?? 0
  const hasTickets = data?.projects.some(p => p.hasTickets) ?? false
  const browserGranted = permission === 'granted' && notificationsEnabled(preferences)

  const enableBrowserNotifications = () => setBrowserNotifications(true)

  const populateTickets = async () => {
    if (!targetProjectId) return
    const started = await start(targetProjectId, UPDATE_TICKETS_PROMPT, startPicks(preferences))
    // Land on the session doing the import, not the project's launcher (#1169): its id is what
    // the shell needs to show the live output. A refusal keeps you here, with `startError` shown.
    if (started) onAgentStarted(targetProjectId, UPDATE_TICKETS_PROMPT, started.agentId)
  }

  const agentMissing = missing.find(item => item.key === 'agent')
  if (agentMissing) seen.current.add('agent')
  const agentStep: Step[] = seen.current.has('agent')
    ? [{ key: 'agent', label: `Set up ${agentMissing?.name ?? 'your coding agent'}`, description: agentMissing?.words, done: !agentMissing, doneNote: 'Ready', ...(agentMissing ? { action: agentMissing.fix } : {}) }]
    : []
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
        action: <HostFix row={row} onChanged={reloadMissing} size="default" />,
      },
    ]
  })

  const steps: Step[] = [
    ...agentStep,
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
            action: (
              <Button variant="outline" onClick={() => services.openPage('queue')}>
                Open the Queue
              </Button>
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
    {
      key: 'browser-notification',
      label: 'Turn on notifications',
      description: 'Desktop pings while the dashboard is open, so a session waiting on you does not sit unnoticed.',
      done: browserGranted,
      optional: true,
      action:
        permission === 'denied' ? (
          <span className="text-xs text-muted-foreground">Blocked in your browser settings</span>
        ) : permission === 'unsupported' ? (
          <span className="text-xs text-muted-foreground">Not supported by this browser</span>
        ) : (
          <Button variant="outline" onClick={enableBrowserNotifications}>
            Turn on
          </Button>
        ),
    },
  ]

  // No step before its reads have said where it stands: an unread project count is not "no project".
  const reading = state === 'unknown' || !missingLoaded
  useLayoutEffect(() => {
    if (!reading) onRead()
  }, [reading, onRead])
  const open = picked !== undefined && steps.some(step => step.key === picked && !step.done) ? picked : steps.find(step => !step.done)?.key
  const ready = !reading && steps.every(step => step.done || step.optional)
  const name = person ? `, ${firstName(person.name)}` : ''

  const doneCount = steps.filter(step => step.done).length
  // While the projects are not read: whether a project is there is not known, and the queue's and the tickets'
  // steps, which only some projects have, hold their places before the last step.
  const frame: { key: string; label?: string; description?: ReactNode; known: boolean; done: boolean }[] = steps.flatMap(step => [
    ...(data === null && step.key === 'browser-notification' ? [{ key: 'todos', known: false, done: false }, { key: 'tickets', known: false, done: false }] : []),
    { key: step.key, label: step.label, description: step.description, known: data !== null || step.key !== 'project', done: step.done },
  ])
  return (
    <PanelGroup
      bare
      title={ready ? `You're all set${name}` : `${greeting(new Date().getHours())}${name}`}
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
          {ready && targetProjectId && (
            <Button
              onClick={() => {
                updatePreferences({ onboardingDismissed: true })
                onSelectProject(targetProjectId)
              }}
            >
              Start your first session
            </Button>
          )}
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
          {/* The steps as they will stand once read, so nothing in them moves when the answer comes: the open step its
              words under its name (read with the coding agent and the git hosts, or fixed) and its presses' shapes at the
              row's end, centred on the row; a step whose state is not
              read yet has a shape for its mark; the steps only the projects' read can add (the queue's, the tickets')
              hold their places as shapes. Only once the coding agent and the git hosts are read: each can add a step at
              the top, which would push the rows drawn. */}
          {missingLoaded && (
            <Panel ordered aria-hidden>
              {frame.map((step, at) => (
                <li key={step.key} className={STEP_ROW}>
                  {step.label === undefined || !step.known ? <MarkShape /> : step.done ? <DoneMark /> : <StepMark at={at} open={step.key === open} />}
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
                        <Skeleton className="h-8 w-36" />
                        {/* The coding agent's press comes with the command that does the same in a terminal. */}
                        {step.key === 'agent' && <Skeleton className="h-7 w-92 max-w-full max-md:h-12" />}
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
                  <StepMark at={at} open={isOpen} />
                )}
                {/* The action goes under the words until it fits beside them with the words 16rem wide or more; beside them it is centred on the row, and a command goes under its press where the two do not fit one line. */}
                <div className="@container flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-2">
                  <div className="min-w-0 flex-[1_1_16rem] space-y-1">
                    <div className="flex flex-wrap items-center gap-x-2">
                      <button
                        type="button"
                        disabled={!press}
                        onClick={() => setPicked(step.key)}
                        {...(press ? { 'data-cover': true } : {})}
                        className={cn('flex flex-wrap items-center gap-x-2 text-left text-sm', press && 'outline-none after:absolute after:inset-0', step.done ? 'text-muted-foreground' : isOpen ? 'font-medium' : 'text-muted-foreground hover:text-foreground')}
                      >
                        <span>{step.label}</span>
                        {step.done && step.doneNote && <span className="truncate text-xs text-muted-foreground">· {step.doneNote}</span>}
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
                  {isOpen && step.action && <div className="flex max-w-full shrink-0 @xl:max-w-[calc(100%-16.75rem)]">{step.action}</div>}
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

/** A step whose state is not read yet: a shape in its mark's place. */
function MarkShape() {
  return (
    <span className="flex h-5 w-4 shrink-0 items-center">
      <Skeleton className="size-4 rounded-full" />
    </span>
  )
}

/** A step not done: its number, in the press's colour while it is the open one. */
function StepMark({ at, open = false }: { at: number; open?: boolean }) {
  return (
    <span aria-hidden className={cn('flex h-5 w-4 shrink-0 items-center text-xs tabular-nums', open ? 'font-medium text-primary' : 'text-faint-foreground')}>
      {at + 1}
    </span>
  )
}

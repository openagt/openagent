import { useRef, useState, type ReactNode } from 'react'
import type { DashboardData, ProjectSummary } from '../../src/index.js'
import { Check, Info, X } from 'lucide-react'
import { onDashboard } from '../rpc/reads.js'
import { usePolled } from '../lib/use-async.js'
import { usePerson } from '../lib/use-person.js'
import { cn } from '../lib/utils.js'
import { Button } from './ui/button.js'
import { Card, CardContent, CardHeader } from './ui/card.js'
import { usePreferences, updatePreferences, notificationsEnabled } from '../lib/preferences.js'
import { useNotificationPermission } from '../lib/notification-permission.js'
import { startPicks, useStartAgent } from '../lib/use-start-agent.js'
import { AddProjectEffects } from './AddProjectEffects.js'
import { ProjectPicker } from './ProjectPicker.js'
import { UpdateTicketsButton, UPDATE_TICKETS_PROMPT } from './UpdateTicketsButton.js'
import { HostFix } from './AddGitAccount.js'
import { hostLoginState, hostWords, useMissing } from './Logins.js'
import { firstName } from './PersonMenu.js'
import { Tooltip, TooltipTrigger, TooltipContent } from './ui/tooltip.js'

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
// It renders at the top of the Overview, greeting the person by the time of day. Its ✕ hides it,
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
}) {
  // Slower than the Overview's own 5s poll: these change at human speed, and this read fans out
  // over every project to answer the tickets question.
  const { value: data, reload } = usePolled<DashboardData | null>(onDashboard, null, 10_000, [])
  const preferences = usePreferences()
  const permission = useNotificationPermission()
  const { start, busy: starting, error: startError } = useStartAgent()
  const { person } = usePerson()
  // What runs need on this computer: the coding agent's login, and an account at each git host.
  const { missing, hosts, reload: reloadMissing } = useMissing()
  // The steps shown once stay, done or not: the coding agent's is there only once it was missing.
  const seen = useRef(new Set<string>())
  // The step the person opened; by default, the first one not done.
  const [picked, setPicked] = useState<string | undefined>()

  // The project the steps act on: the only/most recent one. A first-session flow rarely has a second.
  const targetProjectId = data?.projects[0]?.projectId ?? null

  const projectCount = data?.totals.projects ?? 0
  const hasTickets = data?.projects.some(p => p.hasTickets) ?? false
  const browserGranted = permission === 'granted' && notificationsEnabled(preferences)

  const enableBrowserNotifications = () => {
    updatePreferences({ notifyBrowser: true })
    // Asking for permission must ride this user gesture.
    if (permission === 'default') void Notification.requestPermission()
  }

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
        action: <HostFix row={row} onChanged={reloadMissing} size="sm" />,
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
          },
        ]
      : []),
    // Only when some project can have tickets at all (#1774): a project gets them from a package it
    // depends on, and a step asking to populate tickets no project provides would ask for nothing.
    ...(data?.projects.some(p => p.providesTickets)
      ? [
          {
            key: 'tickets',
            label: 'Populate tickets/',
            description: 'tickets/ holds the bigger things to work on, in the repo. The agent researches and plans them, and they are the input the queue is filled from.',
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
          <Button size="sm" variant="outline" onClick={enableBrowserNotifications}>
            Turn on
          </Button>
        ),
    },
  ]

  const open = picked !== undefined && steps.some(step => step.key === picked && !step.done) ? picked : steps.find(step => !step.done)?.key
  const ready = data !== null && steps.every(step => step.done || step.optional)
  const name = person ? `, ${firstName(person.name)}` : ''

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <h2 className="min-w-0 text-lg font-semibold tracking-tight">{ready ? `You're all set${name}` : `${greeting(new Date().getHours())}${name}`}</h2>
        <div className="flex shrink-0 items-center gap-3">
          {/* Where the steps stand, one dash each: the numbers below say which is which. */}
          <ol aria-label={`${steps.filter(step => step.done).length} of ${steps.length} done`} className="flex items-center gap-1.5">
            {steps.map(step => (
              <li key={step.key} aria-hidden className={cn('h-1.5 w-6 rounded-full', step.done ? 'bg-[var(--color-primary)]' : step.key === open ? 'bg-[var(--color-primary)]/40' : 'bg-muted-foreground/20')} />
            ))}
          </ol>
          {ready && targetProjectId && (
            <Button
              size="sm"
              onClick={() => {
                updatePreferences({ onboardingDismissed: true })
                onSelectProject(targetProjectId)
              }}
            >
              Start your first session
            </Button>
          )}
          <Tooltip>
            <TooltipTrigger render={<Button variant="ghost" size="sm" onClick={() => updatePreferences({ onboardingDismissed: true })} aria-label={HIDE} />}>
              <X className="h-4 w-4" aria-hidden />
            </TooltipTrigger>
            <TooltipContent>{HIDE}</TooltipContent>
          </Tooltip>
        </div>
      </CardHeader>
      <CardContent>
        <ol className="divide-y divide-border">
          {steps.map((step, at) => {
            const isOpen = step.key === open
            return (
              <li key={step.key} aria-label={step.label} aria-current={isOpen ? 'step' : undefined} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
                {step.done ? (
                  <span aria-label="Done" className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-[var(--color-primary)] text-[var(--color-primary-foreground)]">
                    <Check className="h-3.5 w-3.5" aria-hidden />
                  </span>
                ) : (
                  <span aria-hidden className={cn('mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border text-xs font-medium tabular-nums', isOpen ? 'border-[var(--color-primary)] text-[var(--color-primary)]' : 'border-border text-muted-foreground')}>
                    {at + 1}
                  </span>
                )}
                <div className="flex min-w-0 flex-1 gap-3 max-sm:flex-col sm:items-start">
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="mt-1 flex flex-wrap items-center gap-x-2">
                      <button
                        type="button"
                        disabled={step.done || isOpen}
                        onClick={() => setPicked(step.key)}
                        className={cn('flex flex-wrap items-center gap-x-2 text-left text-sm', step.done ? 'text-muted-foreground' : isOpen ? 'font-medium' : 'text-muted-foreground hover:text-foreground')}
                      >
                        <span>{step.label}</span>
                        {step.done && step.doneNote && <span className="truncate text-xs text-muted-foreground">· {step.doneNote}</span>}
                        {step.optional && !step.done && <span className="rounded-full border border-border px-1.5 py-0.5 text-[10px] font-normal uppercase tracking-wide text-muted-foreground">Optional</span>}
                      </button>
                      {isOpen && step.info && (
                        <Tooltip>
                          <TooltipTrigger render={<button type="button" aria-label={`More on ${step.label}`} className="text-muted-foreground hover:text-foreground" />}>
                            <Info className="h-3.5 w-3.5" aria-hidden />
                          </TooltipTrigger>
                          <TooltipContent className="max-w-sm">{step.info}</TooltipContent>
                        </Tooltip>
                      )}
                    </div>
                    {isOpen && step.description && (typeof step.description === 'string' ? <p className="text-xs text-muted-foreground">{step.description}</p> : step.description)}
                  </div>
                  {isOpen && step.action && <div className="flex shrink-0 sm:justify-end">{step.action}</div>}
                </div>
              </li>
            )
          })}
        </ol>
      </CardContent>
    </Card>
  )
}

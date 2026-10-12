import { useState, type ReactNode } from 'react'
import type { DashboardData, OnboardingSuggestion } from '../../src/index.js'
import { Square, SquareCheckBig, X } from 'lucide-react'
import { onDashboard } from '../rpc/reads.js'
import { onOnboarding } from '../rpc/projects.js'
import { usePolled } from '../lib/use-async.js'
import { usePreferences, updatePreferences, notificationsEnabled } from '../lib/preferences.js'
import { useNotificationPermission } from '../lib/notification-permission.js'
import { startPicks, useStartAgent } from '../lib/use-start-agent.js'
import { AddProjectEffects } from './AddProjectEffects.js'
import { AddProjectPanel } from './AddProjectPanel.js'
import { UpdateTicketsButton, UPDATE_TICKETS_PROMPT } from './UpdateTicketsButton.js'
import { Button } from './ui/button.js'
import { Card, CardContent, CardHeader, CardTitle } from './ui/card.js'
import { Tooltip, TooltipTrigger, TooltipContent } from './ui/tooltip.js'

// The Onboarding checklist (#958): the integrations a new install needs, each with the state it
// is actually in rather than a static list to read past.
//
// Every "done" is derived from a real fact — a registered project, a non-empty queue, a ticket on
// disk, a granted browser permission — so a step cannot be ticked by clicking it, and a step done
// outside the dashboard shows up ticked anyway.
//
// It renders in two places: the Overview, where it can be dismissed, and the settings page, where
// it cannot — that is what dismissing it promises you can come back to.

/** One checklist row: what it is, whether it is done, and what to do about it. */
interface Step {
  key: string
  label: string
  /** What the step is: a sentence, or more when the step changes something of the person's. */
  description: ReactNode
  done: boolean
  /**
   * Nothing breaks if this one is never done (#1139).
   *
   * Marked per step rather than by position, so the list can be reordered without the promise
   * moving with it. Only the two steps the agent cannot work without are left unmarked.
   */
  optional?: boolean
  /** The action(s) offered while it is not done. */
  action?: React.ReactNode
}

export function OnboardingChecklist({
  dismissible = false,
  onAgentStarted,
  onSelectProject,
}: {
  /** The Overview offers to hide it; the settings page always shows it. */
  dismissible?: boolean
  /**
   * Told about the session a step started, so the shell can land on it (#1169). The project
   * travels with it: this renders on the Overview and the settings page, neither of which has
   * one selected. Required, so a new mounting surface cannot quietly drop the navigation.
   */
  onAgentStarted: (projectId: string, intent: string, agentId: string) => void
  /** Where "Configure first, then run" lands (#1507): the launcher of the project the checklist
   *  acts on. Required for the same reason `onAgentStarted` is — a new mounting surface must not
   *  quietly leave the chevron with nowhere to go. */
  onSelectProject: (id: string) => void
}) {
  // Slower than the Overview's own 5s poll: onboarding state changes at human speed, and this
  // read fans out over every project to answer the tickets question.
  const { value: data, reload } = usePolled<DashboardData | null>(onDashboard, null, 10_000, [])
  const { value: suggestion, reload: reloadSuggestion } = usePolled<OnboardingSuggestion | null>(onOnboarding, null, 30_000, [])
  const preferences = usePreferences()
  const permission = useNotificationPermission()
  const { start, busy: starting, error: startError } = useStartAgent()

  // The Add dialog: open with the folder the dashboard runs in, open to pick one, open to take a repository's address, or closed.
  const [addingProject, setAddingProject] = useState<{ folder?: string; fromAddress?: boolean } | null>(null)

  // The project onboarding acts on: the one this server runs in when it is registered, else the
  // only/most recent one. Onboarding is a first-agent flow, so there is rarely a second candidate.
  const targetProjectId = suggestion?.cwdProjectId ?? data?.projects[0]?.projectId ?? null

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

  // The folder the dashboard runs in, while it is not a project yet: the first step offers it.
  const here = suggestion?.cwd && !suggestion.cwdProjectId ? suggestion.cwd : undefined

  const steps: Step[] = [
    {
      key: 'project',
      label: 'Add a project',
      // Said before the button is pressed: what adding does to the folder. Once a project is
      // added the step is done, and one sentence says what a project is. Until the first read
      // lands nobody knows which, so the tall text does not flash at a person who has projects.
      description: data && projectCount === 0 ? <AddProjectEffects /> : 'A project is a git repo OpenAgent may work in.',
      done: projectCount > 0,
      action: (
        <div className="flex flex-wrap justify-end gap-2">
          {here && (
            // A folder's path can be longer than the card: the button then takes more lines, not more width.
            <Button size="sm" className="h-auto min-h-8 max-w-full whitespace-normal py-1 text-left [overflow-wrap:anywhere]" onClick={() => setAddingProject({ folder: here })}>
              {`Add ${here} as project…`}
            </Button>
          )}
          {/* Not on a computer with no screen: the folder dialog has nowhere to open. */}
          {suggestion?.canPickFolder !== false && (
            <Button size="sm" variant="outline" onClick={() => setAddingProject({})}>
              Select &amp; add project directory
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={() => setAddingProject({ fromAddress: true })}>
            Add from a GitHub address
          </Button>
        </div>
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
            description:
              'tickets/ holds the bigger things to work on, in the repo. The agent researches and plans them, and they are the input the queue is filled from.',
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
      label: 'Add browser notifications',
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
            Enable
          </Button>
        ),
    },
  ]

  const doneCount = steps.filter(s => s.done).length

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <div>
          <CardTitle className="text-base">Onboarding</CardTitle>
          <p className="text-xs text-muted-foreground">
            {doneCount} of {steps.length} set up.
          </p>
        </div>
        {dismissible && (
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => updatePreferences({ onboardingDismissed: true })}
                  aria-label="Remove, you can resume the onboarding on the settings page"
                />
              }
            >
              <X className="h-4 w-4" aria-hidden />
            </TooltipTrigger>
            <TooltipContent>Remove, you can resume the onboarding on the settings page</TooltipContent>
          </Tooltip>
        )}
      </CardHeader>
      <CardContent>
        <ul className="divide-y divide-border">
          {steps.map(step => (
            // The action drops under the text when the row cannot hold both at a readable width:
            // a long folder name on the first step's button would squeeze its text to a strip.
            // It is never wider than the row, so on a phone its buttons go one under the other.
            <li key={step.key} className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 py-3 first:pt-0 last:pb-0">
              <div className="flex min-w-0 grow basis-96 items-start gap-3">
                {/* A checkbox, not a circle: an outlined circle reads as a radio button, i.e. as
                    one of a set you pick between, when these are independent things to tick (#1139). */}
                {step.done ? (
                  <SquareCheckBig className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-primary)]" aria-label="Done" />
                ) : (
                  <Square className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-label="Not done" />
                )}
                <div className="min-w-0">
                  <p className={step.done ? 'text-sm text-muted-foreground line-through' : 'text-sm'}>
                    {step.label}
                    {step.optional && (
                      <span className="ml-2 rounded-full border border-border px-1.5 py-0.5 align-middle text-[10px] font-normal uppercase tracking-wide text-muted-foreground">
                        Optional
                      </span>
                    )}
                  </p>
                  {typeof step.description === 'string' ? <p className="text-xs text-muted-foreground">{step.description}</p> : <div className="mt-1">{step.description}</div>}
                </div>
              </div>
              {!step.done && step.action && <div className="max-w-full shrink-0">{step.action}</div>}
            </li>
          ))}
        </ul>
      </CardContent>

      {addingProject && (
        <AddProjectPanel
          folder={addingProject.folder}
          fromAddress={addingProject.fromAddress === true}
          onAdded={() => {
            void reload()
            reloadSuggestion()
          }}
          onClose={() => setAddingProject(null)}
        />
      )}
    </Card>
  )
}

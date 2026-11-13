import { useEffect, useRef, useState } from 'react'
import { Bot, ClipboardPlus, ExternalLink, LockOpen, Play } from 'lucide-react'
import { Badge, Button, ConfirmDialog, LinkActions, Markdown, StartAgentButton, cn, formatAge, formatDateTime, useAction, usePolled, useModuleHost, useOpenAgentDown } from '@openagt/dashboard/module'
import { claimState, heldBack, holderAgent, planTicketPrompt, readShown, ticketBody, ticketLink, withHolder, workOnTicketPrompt } from '../src/module.js'
import { holdingRun } from './lib/holding-run.js'
import type { WorkspaceTicketDetail } from './lib/types.js'
import { TicketPageShell, TicketPageNote } from './TicketPageShell.js'
import { releaseClaim } from './lib/release.js'
import { useBackToList } from './lib/back-to-list.js'
import { priorityTone } from './lib/ticket-priority.js'

/** The page's read: the ticket, or nothing (no such ticket), or why the command failed. */
/** The ticket, and how the run holding its claim stands when the claim is one of the project's runs. */
type Read = { ticket: WorkspaceTicketDetail | null; holderStatus?: string } | { error: string }

// One ticket's own page: its whole text, not just the head the list row reads — and where the
// actions on the ticket live now that the list is one-liners: the ticket is shown as a link, and
// the installed modules' link actions ("Add to queue" when the project has a queue package) sit
// beside it. `slug` is the same filename the list row and the URL carry, so this is a direct read
// by identity (`tickets show <file> --local`) rather than a search through the list.
export function TicketDetailPage({
  projectId,
  slug,
}: {
  projectId: string
  /** The ticket's filename inside `tickets/`, same as `WorkspaceTicket.file`. */
  slug: string
}) {
  const host = useModuleHost()
  // The claim's holder resolved against the project's runs: a lock names a run's id, so a claim a
  // run made links to its page and reads as its session name; anyone else is shown as written.
  const { value: read, loaded } = usePolled<Read | null>(
    async () => {
      const [shown, agents] = await Promise.all([host.runCommand(projectId, ['show', slug, '--local']).then(readShown), host.agents(projectId).catch(() => [])])
      if ('error' in shown) return shown
      if (!shown.shown) return { ticket: null }
      const agent = holderAgent(agents, shown.shown.ticket.lockedBy)
      return { ticket: withHolder(shown.shown.ticket, holdingRun(agent)), ...(agent ? { holderStatus: agent.status } : {}) }
    },
    null,
    10_000,
    [projectId, slug],
  )
  const ticket = read && 'ticket' in read ? read.ticket : null
  const { busy, error, run } = useAction()
  const down = useOpenAgentDown()
  const onBack = useBackToList(host, [slug])
  const onOpenAgent = (agentId: string) => host.openAgent(projectId, agentId)

  // The manual lock release (`releaseClaim`): a dead agent's claim stands until a person lifts it
  // here. `released` bridges the gap until the next poll.
  const [released, setReleased] = useState(false)
  const claimed = Boolean(ticket?.locked) && !released
  const holder = ticket?.lockedByAgent?.name ?? ticket?.lockedBy
  const holderStatus = read && 'ticket' in read ? read.holderStatus : undefined
  const working = claimState(holderStatus) === 'working'
  // Released, the press is gone: the focus goes to the ticket's title, not to the page's body. Once
  // the page is drawn without the press, so a dialog that asked is closed and takes no focus back.
  const title = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    if (released) title.current?.focus()
  }, [released])
  const release = async () => {
    if (!ticket) return
    const outcome = await run(() => releaseClaim(host, projectId, ticket.file), 'The lock could not be released.')
    if (outcome.ok) setReleased(true)
  }
  // Which start is in flight, by its prompt: one `busy` holds every start back, and only this one spins.
  const [starting, setStarting] = useState<string | null>(null)
  const workPrompt = ticket ? workOnTicketPrompt(ticket.file) : ''
  const planPrompt = ticket ? planTicketPrompt(ticket.file) : ''
  const startSession = async (prompt: string, failure: string) => {
    setStarting(prompt)
    await run(() => host.startRun(projectId, prompt), failure)
    setStarting(null)
  }
  const releaseLock = (
    <Button size="sm" variant="outline" disabled={busy || down} onClick={working ? undefined : () => void release()} title={holder ? `Claimed by ${holder}` : undefined} className="gap-1.5">
      <LockOpen className="h-3.5 w-3.5" /> Release lock
    </Button>
  )

  return (
    <TicketPageShell onBack={onBack}>
      {!loaded ? (
        <TicketPageNote>Loading…</TicketPageNote>
      ) : read && 'error' in read ? (
        <TicketPageNote>
          <span role="alert">Could not read the ticket: {read.error}</span>
        </TicketPageNote>
      ) : !ticket ? (
        // Deleted between the list read and this one, or a stale/hand-typed link.
        <TicketPageNote>This ticket does not exist.</TicketPageNote>
      ) : (
        <>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <h1 ref={title} tabIndex={-1} className="text-lg font-semibold outline-none">
              {ticket.title}
            </h1>
            <div className="flex shrink-0 items-center gap-1.5">
              {/* The run holding the claim, one press away: at work (or waiting on an answer) it is
                  looked at; stopped, failed or ended, it is gone on with, in its own chat. */}
              {claimed && ticket.lockedByAgent && (
                <Button size="sm" variant="outline" onClick={() => onOpenAgent(ticket.lockedByAgent!.id)} className="gap-1.5" title={`The run that claimed it: ${holder}`}>
                  {working ? <Bot className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                  {working ? 'Open the run' : 'Continue'}
                </Button>
              )}
              {/* A run at work on it keeps working: the ticket is then free for another agent, so the press asks first. */}
              {claimed &&
                (working ? (
                  <ConfirmDialog
                    trigger={releaseLock}
                    title="An agent is working on this ticket. Release it anyway?"
                    body={`${holder ?? 'The agent'} goes on working, and the ticket can be started or queued again.`}
                    confirmLabel="Release"
                    confirmBusyLabel="Releasing…"
                    onConfirm={async () => {
                      const outcome = await releaseClaim(host, projectId, ticket.file)
                      if (!outcome.ok) throw new Error(outcome.error)
                    }}
                    onSuccess={() => setReleased(true)}
                    fallbackError="The lock could not be released."
                  />
                ) : (
                  releaseLock
                ))}
              {/* The row's two starts, offered where the row offers them: neither on a claimed ticket nor on one in review or waiting. */}
              {!heldBack(ticket) && !claimed && (
                <>
                  <StartAgentButton
                    size="sm"
                    icon={<Play className="h-3.5 w-3.5" aria-hidden />}
                    label="Start"
                    menuAriaLabel={`Other ways to work on ${ticket.title}`}
                    tooltip="Start an agent working on this ticket"
                    busy={busy}
                    starting={starting === workPrompt}
                    onStart={() => void startSession(workPrompt, 'The work agent could not be started.')}
                    onConfigure={() => host.configureRun(projectId, workPrompt)}
                    prompt={workPrompt}
                    configureDescription="Opens the launcher with this ticket's prompt, so you can set the model and where it runs."
                  />
                  {!ticket.planned && (
                    <StartAgentButton
                      size="sm"
                      icon={<ClipboardPlus className="h-3.5 w-3.5" aria-hidden />}
                      label="Plan"
                      menuAriaLabel={`Other ways to plan ${ticket.title}`}
                      tooltip="Plan this ticket — starts an agent to write its plan"
                      busy={busy}
                      starting={starting === planPrompt}
                      onStart={() => void startSession(planPrompt, 'The planning agent could not be started.')}
                      onConfigure={() => host.configureRun(projectId, planPrompt)}
                      prompt={planPrompt}
                      configureDescription="Opens the launcher with the plan prompt, so you can set the model and where it runs."
                    />
                  )}
                </>
              )}
              {/* The ticket as a link, for whatever the installed modules offer on one (#1774);
                  none for a ticket in review or waiting, which is never queued, nor for a claimed
                  one: an agent the queue hands it to finds it taken. Released, it is offered. */}
              {!heldBack(ticket) && !claimed && <LinkActions projects={[projectId]} targets={[{ projectId, links: [ticketLink(ticket)] }]} resetKey={ticket.file} disabled={busy} />}
            </div>
          </div>
          {/* All meta under the title, above the text that holds its one-line summary (#1144/#1265): date, priority,
              then the issue link lead in that order, followed by the rest of what is known about the ticket. */}
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <span className="text-[10px] text-muted-foreground/70" title={formatDateTime(ticket.date)}>
              {formatAge(ticket.date)}
            </span>
            {ticket.priority && (
              <Badge className={cn('border-transparent px-0 text-[10px]', priorityTone(ticket.priority))}>
                Priority {ticket.priority}
              </Badge>
            )}
            {ticket.issue && (
              <a
                href={ticket.issue.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground hover:underline"
              >
                <ExternalLink className="h-4 w-4" aria-hidden />
                {ticket.issue.label}
              </a>
            )}
            {ticket.topics?.map(topic => (
              <Badge key={topic} className="border-border px-1.5 text-[10px] text-muted-foreground">
                {topic}
              </Badge>
            ))}
            {ticket.planned && <Badge className="border-transparent px-0 text-[10px] uppercase">planned</Badge>}
            {ticket.pr && (
              <a href={ticket.pr.url} target="_blank" rel="noreferrer" className="text-[10px] text-info hover:underline">
                <span className="uppercase">in review</span> · {ticket.pr.label}
              </a>
            )}
            {ticket.waiting && (
              <Badge className="border-transparent px-0 text-[10px] text-warning">
                <span className="uppercase">waiting</span>&nbsp;· {ticket.waiting}
              </Badge>
            )}
            {/* The holder inline (#1420): the detail page has the room, so the name is plainly
                readable instead of hiding behind a native tooltip. One of this project's agents
                (#1748) is named by its session and opens its page; anyone else is shown as written. */}
            {claimed && (
              <Badge className="border-transparent px-0 text-[10px] text-warning">
                <span className="uppercase">claimed</span>
                {holder &&
                  (ticket.lockedByAgent ? (
                    <>
                      &nbsp;·{' '}
                      <button type="button" className="hover:underline" onClick={() => onOpenAgent(ticket.lockedByAgent!.id)}>
                        {holder}
                      </button>
                      {holderStatus !== undefined && <>&nbsp;· {standing(holderStatus)}</>}
                    </>
                  ) : (
                    <>&nbsp;· {holder}</>
                  ))}
              </Badge>
            )}
            {ticket.effort !== undefined && (
              <Badge className="border-transparent px-0 text-[10px] text-muted-foreground">Effort: {ticket.effort}</Badge>
            )}
            {ticket.uncertainty !== undefined && (
              <Badge className="border-transparent px-0 text-[10px] text-muted-foreground">Uncertainty: {ticket.uncertainty}</Badge>
            )}
            <span className="text-[10px] text-muted-foreground/70">{ticket.file}</span>
          </div>
          {error && <p className="mt-2 text-xs text-danger">{error}</p>}
          <div className="mt-4">
            <Markdown text={ticketBody(ticket.content)} />
          </div>
        </>
      )}
    </TicketPageShell>
  )
}

/** How the run holding the claim stands, as the claim's badge says it after the run's name. */
function standing(holderStatus: string): string {
  const state = claimState(holderStatus)
  if (state === 'working') return holderStatus === 'waiting' ? 'waits on your answer' : 'at work'
  return state === 'offline' ? 'its computer is offline' : `run ${holderStatus}`
}

import { useState } from 'react'
import { ExternalLink, LockOpen, MoreHorizontal, Pencil } from 'lucide-react'
import {
  Badge,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  cn,
  formatAge,
  formatDateTime,
  useAction,
  useModuleHost,
} from '@openagt/dashboard/module'
import { claimState, heldBack } from '../src/module.js'
import type { WorkspaceTicketDetail } from './lib/types.js'
import { releaseClaim } from './lib/release.js'
import { priorityTone } from './lib/ticket-priority.js'
import { TicketStartActions } from './TicketStartActions.js'
import { TicketSessions, type TicketSession } from './TicketSessions.js'

/** Which of a ticket's two pages is shown under its header. */
export type TicketTab = 'ticket' | 'plan'

/**
 * The head both of a ticket's pages share, so moving between them keeps one's place: its title
 * with its next step (one button, the rest in its menu) and the rarer actions behind "More", what
 * is known about it on one line, its two pages as tabs, and the sessions that planned and worked it.
 */
export function TicketHeader({
  projectId,
  ticket,
  holderStatus,
  sessions,
  tab,
  onEdit,
  onChanged,
}: {
  projectId: string
  ticket: WorkspaceTicketDetail
  /** How the run holding its claim stands, when one of the project's runs holds it. */
  holderStatus?: string | undefined
  sessions: readonly TicketSession[]
  tab: TicketTab
  /** Edit the ticket by hand; none where the page does not edit it. */
  onEdit?: (() => void) | undefined
  /** The ticket changed here (its claim lifted): read it again. */
  onChanged: () => void
}) {
  const host = useModuleHost()
  const { busy, error, run } = useAction()
  // A lifted claim bridges the gap until the next read says so.
  const [released, setReleased] = useState(false)
  const claimed = Boolean(ticket.locked) && !released
  const holder = ticket.lockedByAgent?.name ?? ticket.lockedBy
  const offered = !heldBack(ticket) && !claimed
  const release = async () => {
    const outcome = await run(() => releaseClaim(host, projectId, ticket.file), 'The claim could not be lifted.')
    if (outcome.ok) {
      setReleased(true)
      onChanged()
    }
  }
  const open = (path: string[]) => host.openPage('tickets', path, projectId)
  const more = [
    ...(onEdit ? [{ label: 'Edit ticket', Icon: Pencil, onSelect: onEdit }] : []),
    ...(claimed ? [{ label: 'Release the claim', Icon: LockOpen, onSelect: () => void release() }] : []),
  ]

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
        <h1 className="min-w-0 text-lg font-semibold" title={ticket.file}>
          {ticket.title}
        </h1>
        <div className="flex shrink-0 items-center gap-1.5">
          {/* The next step, now or queued: none for a ticket in review or waiting, which is never
              handed to an agent, nor for a claimed one, which an agent holds. Released, it is offered. */}
          {offered && (
            <TicketStartActions
              projectId={projectId}
              ticket={ticket}
              busy={busy}
              onStart={(prompt, failure) => void run(() => host.startRun(projectId, prompt), failure)}
              onConfigure={prompt => host.configureRun(projectId, prompt)}
            />
          )}
          {more.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger aria-label="More" className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground">
                <MoreHorizontal className="h-4 w-4" aria-hidden />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {more.map(item => (
                  <DropdownMenuItem key={item.label} onClick={item.onSelect} disabled={busy} className="gap-2">
                    <item.Icon className="h-3.5 w-3.5" aria-hidden /> {item.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>
      <TicketFacts ticket={ticket} claimed={claimed} holder={holder} holderStatus={holderStatus} onOpenAgent={agentId => host.openAgent(projectId, agentId)} />
      {error && <p className="mt-2 text-xs text-danger">{error}</p>}
      {/* The ticket's two pages, as tabs: what it asks, and how it will be done. */}
      <div role="tablist" className="mt-4 flex gap-4 border-b border-border text-sm">
        {(['ticket', 'plan'] as const).map(name => (
          <button
            key={name}
            type="button"
            role="tab"
            aria-selected={tab === name}
            onClick={() => tab !== name && open(name === 'ticket' ? [ticket.file] : [ticket.file, 'plan'])}
            className={cn('-mb-px border-b-2 px-0.5 pb-2 font-medium', tab === name ? 'border-foreground text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground')}
          >
            {name === 'ticket' ? 'Ticket' : 'Plan'}
            {name === 'plan' && !ticket.planned && <span className="ml-1.5 text-xs font-normal text-muted-foreground">none yet</span>}
          </button>
        ))}
      </div>
      {sessions.length > 0 && (
        <div className="mt-4">
          <TicketSessions sessions={sessions} onOpen={agentId => host.openAgent(projectId, agentId)} />
        </div>
      )}
    </div>
  )
}

/**
 * What is known about the ticket, on one line under its title (#1144/#1265): its issue, age and
 * priority lead, then where it stands, then what its plan says of the work, then its topics.
 */
function TicketFacts({
  ticket,
  claimed,
  holder,
  holderStatus,
  onOpenAgent,
}: {
  ticket: WorkspaceTicketDetail
  claimed: boolean
  holder: string | undefined
  holderStatus: string | undefined
  onOpenAgent: (agentId: string) => void
}) {
  const dot = <span aria-hidden>·</span>
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-muted-foreground">
      {ticket.issue && (
        <>
          <a href={ticket.issue.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:text-foreground hover:underline">
            <ExternalLink className="h-3.5 w-3.5" aria-hidden />
            {ticket.issue.label}
          </a>
          {dot}
        </>
      )}
      <span title={formatDateTime(ticket.date)}>{formatAge(ticket.date)}</span>
      {ticket.priority && (
        <>
          {dot}
          <span className={priorityTone(ticket.priority)}>Priority {ticket.priority}</span>
        </>
      )}
      {ticket.pr && (
        <>
          {dot}
          <a href={ticket.pr.url} target="_blank" rel="noreferrer" className="text-info hover:underline">
            In review · {ticket.pr.label}
          </a>
        </>
      )}
      {ticket.waiting && (
        <>
          {dot}
          <span className="text-warning">Waiting · {ticket.waiting}</span>
        </>
      )}
      {/* The holder inline (#1420): one of this project's agents (#1748) is named by its session
          and opens its page; anyone else is shown as written. */}
      {claimed && (
        <>
          {dot}
          <span className="text-warning">
            Claimed
            {holder &&
              (ticket.lockedByAgent ? (
                <>
                  {' · '}
                  <button type="button" className="hover:underline" onClick={() => onOpenAgent(ticket.lockedByAgent!.id)}>
                    {holder}
                  </button>
                  {holderStatus !== undefined && ` · ${standing(holderStatus)}`}
                </>
              ) : (
                ` · ${holder}`
              ))}
          </span>
        </>
      )}
      {ticket.effort !== undefined && (
        <>
          {dot}
          <span>Effort {ticket.effort}/10</span>
        </>
      )}
      {ticket.uncertainty !== undefined && (
        <>
          {dot}
          <span>Uncertainty {ticket.uncertainty}/10</span>
        </>
      )}
      {ticket.outdated && (
        <>
          {dot}
          <span className="text-warning">Plan outdated</span>
        </>
      )}
      {ticket.topics && ticket.topics.length > 0 && (
        <span className="ml-1 flex flex-wrap gap-1">
          {ticket.topics.map(topic => (
            <Badge key={topic} className="border-border px-1.5 text-[10px] text-muted-foreground">
              {topic}
            </Badge>
          ))}
        </span>
      )}
    </div>
  )
}

/** How the run holding the claim stands, as the facts say it after the run's name. */
function standing(holderStatus: string): string {
  const state = claimState(holderStatus)
  if (state === 'working') return holderStatus === 'waiting' ? 'waits on your answer' : 'at work'
  return state === 'offline' ? 'its computer is offline' : `run ${holderStatus}`
}

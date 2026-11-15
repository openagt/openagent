import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react'
import { LockOpen, MoreHorizontal, Pencil } from 'lucide-react'
import {
  Badge,
  Button,
  ConfirmDialog,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  PriorityBadge,
  cn,
  formatDateTime,
  runSaid,
  useAction,
  useModuleHost,
  useOpenAgentDown,
} from '@openagt/dashboard/module'
import { claimState, heldBack } from '../src/module.js'
import { TICKETS_DIR } from '../src/names.js'
import type { WorkspaceTicketDetail } from './lib/types.js'
import { releaseClaim } from './lib/release.js'
import { parsePriority } from './lib/ticket-priority.js'
import { STAGE_LABEL, ticketStage } from './lib/ticket-stage.js'
import { TicketStartActions } from './TicketStartActions.js'
import { TicketSessions, type TicketSession } from './TicketSessions.js'
import { StageWord } from './TicketsPanel.js'

/** Which of a ticket's two pages is shown under its head. */
export type TicketTab = 'ticket' | 'plan'

/** A ticket's file as the crumb names it: its name without the date it was written on and `.md`. */
export function ticketSlug(file: string): string {
  return file.replace(/\.md$/, '').replace(/^\d{4}-\d{2}-\d{2}_/, '')
}

/**
 * The head both of a ticket's pages share, so moving between them keeps one's place: its title,
 * (on a narrow screen its priority and stage under it), its next step now or queued and the rarer
 * actions behind "More", then its two pages as tabs.
 */
export function TicketHeader({
  projectId,
  ticket,
  holderStatus,
  tab,
  onEdit,
  onReleased,
}: {
  projectId: string
  ticket: WorkspaceTicketDetail
  /** How the run holding its claim stands, when one of the project's runs holds it. */
  holderStatus?: string | undefined
  tab: TicketTab
  /** Edit the ticket by hand; none where the page does not edit it. */
  onEdit?: (() => void) | undefined
  /** Its claim was lifted here. */
  onReleased: () => void
}) {
  const host = useModuleHost()
  const { busy, error, run } = useAction()
  const down = useOpenAgentDown()
  const [released, setReleased] = useState(false)
  const claimed = Boolean(ticket.locked)
  const holder = ticket.lockedByAgent?.name ?? ticket.lockedBy
  const offered = !heldBack(ticket) && !claimed
  const working = claimState(holderStatus) === 'working'
  const lifted = () => {
    setReleased(true)
    onReleased()
  }
  const release = async () => {
    const outcome = await run(() => releaseClaim(host, projectId, ticket.file), 'The claim could not be lifted.')
    if (outcome.ok) lifted()
  }
  // A run at work on it keeps working, and the ticket is then free for another agent: the release asks first.
  const [asking, setAsking] = useState(false)
  // Released, its press is gone: the focus goes to the ticket's title, not to the page's body.
  const title = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    if (released) title.current?.focus()
  }, [released])
  // Which start is in flight, by its prompt: only that one spins.
  const [starting, setStarting] = useState<string | null>(null)
  const start = async (prompt: string, failure: string) => {
    setStarting(prompt)
    await run(() => host.startRun(projectId, prompt), failure)
    setStarting(null)
  }
  const open = (path: string[]) => host.openPage('tickets', path, projectId)
  const more = onEdit ? [{ label: 'Edit ticket', Icon: Pencil, onSelect: onEdit }] : []
  const priority = parsePriority(ticket.priority)
  const stage = ticketStage(ticket)

  return (
    <div>
      <h1 ref={title} tabIndex={-1} className="text-2xl font-semibold tracking-tight outline-none max-md:text-xl" title={ticket.file}>
        {ticket.title}
      </h1>
      {/* What decides the next step, under the title where the facts are not beside it. */}
      <p className="mt-2 flex items-center gap-2 text-sm text-muted-foreground lg:hidden">
        {priority !== undefined && (
          <>
            <span className="font-medium tabular-nums">P{priority}</span>
            <span aria-hidden className="text-faint-foreground">·</span>
          </>
        )}
        <span>{STAGE_LABEL[stage]}</span>
      </p>
      {(offered || claimed || more.length > 0) && (
        <div className="mt-6 flex flex-wrap items-center gap-2 max-md:mt-4">
          {/* The next step, now or queued: none for a ticket in review or waiting, which is never
              handed to an agent, nor for a claimed one, which an agent holds: its step is the release. */}
          {offered && (
            <TicketStartActions
              projectId={projectId}
              ticket={ticket}
              busy={busy}
              starting={starting}
              onStart={(prompt, failure) => void start(prompt, failure)}
              onConfigure={prompt => host.configureRun(projectId, prompt)}
            />
          )}
          {claimed && (
            <Button variant="secondary" disabled={busy || down} onClick={() => (working ? setAsking(true) : void release())}>
              <LockOpen className="size-4" aria-hidden /> Release the claim
            </Button>
          )}
          {more.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger render={<Button variant="ghost" size="icon" aria-label="More" className={cn('text-muted-foreground', !offered && !claimed && '-ml-2')} />}>
                <MoreHorizontal className="size-4" aria-hidden />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                {more.map(item => (
                  <DropdownMenuItem key={item.label} onClick={item.onSelect} disabled={busy || down}>
                    <item.Icon className="size-4 text-muted-foreground" aria-hidden /> {item.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      )}
      <ConfirmDialog
        open={asking}
        onOpenChange={setAsking}
        title="An agent is working on this ticket. Release it anyway?"
        body={`${holder ?? 'The agent'} goes on working, and the ticket can be started or queued again.`}
        confirmLabel="Release"
        confirmBusyLabel="Releasing…"
        onConfirm={async () => {
          const outcome = await releaseClaim(host, projectId, ticket.file)
          if (!outcome.ok) throw new Error(outcome.error)
        }}
        onSuccess={lifted}
        fallbackError="The claim could not be lifted."
      />
      {error && <p role="alert" className="mt-2 text-xs text-danger">{error}</p>}
      {/* The ticket's two pages, as tabs: what it asks, and how it will be done. */}
      <div role="tablist" className="mt-6 mb-6 flex gap-6 border-b border-hairline text-sm">
        {(['ticket', 'plan'] as const).map(name => (
          <button
            key={name}
            type="button"
            role="tab"
            aria-selected={tab === name}
            onClick={() => tab !== name && open(name === 'ticket' ? [ticket.file] : [ticket.file, 'plan'])}
            className={cn(
              'focus-ring -mb-px flex h-9 items-center rounded-t-sm border-b-2 font-medium transition-colors max-md:h-11',
              tab === name ? 'border-foreground text-foreground' : 'border-transparent text-muted-foreground pointer-fine:hover:text-foreground',
            )}
          >
            {name === 'ticket' ? 'Ticket' : 'Plan'}
          </button>
        ))}
      </div>
    </div>
  )
}

/**
 * What is known of a ticket, at the side of its page (under its text on a narrow screen): one fact a
 * line, a name and its value, then the runs that planned and worked it.
 */
export function TicketFacts({
  projectId,
  ticket,
  holderStatus,
  sessions,
}: {
  projectId: string
  ticket: WorkspaceTicketDetail
  holderStatus?: string | undefined
  sessions: readonly TicketSession[]
}) {
  const host = useModuleHost()
  const priority = parsePriority(ticket.priority)
  const holder = ticket.lockedByAgent?.name ?? ticket.lockedBy
  const withStatus = { ...ticket, ...(holderStatus !== undefined ? { holderStatus } : {}) }
  return (
    <aside aria-label="About this ticket" className="text-sm">
      <dl>
        {/* Priority and stage stand under the title where the facts are under the text. */}
        {priority !== undefined && (
          <Fact name="Priority" wide>
            <PriorityBadge priority={priority} className={cn(priority === 10 && 'text-danger')} />
          </Fact>
        )}
        <Fact name="Stage" wide>
          <StageWord ticket={withStatus} />
        </Fact>
        {ticket.locked && holder && (
          <Fact name="Claimed by">
            {ticket.lockedByAgent ? (
              <button type="button" className="focus-ring min-w-0 truncate rounded-sm text-left pointer-fine:hover:underline" onClick={() => host.openAgent(projectId, ticket.lockedByAgent!.id)}>
                {holder}
              </button>
            ) : (
              <span className="min-w-0 truncate">{holder}</span>
            )}
            {/* A run at it is said by the stage's turning mark; one that ended is said here. */}
            {holderStatus !== undefined && claimState(holderStatus) !== 'working' && <span className="text-faint-foreground">{standing(holderStatus)}</span>}
          </Fact>
        )}
        {ticket.pr && (
          <Fact name="In review">
            <a href={ticket.pr.url} target="_blank" rel="noreferrer" className="focus-ring rounded-sm text-info pointer-fine:hover:underline">
              {ticket.pr.label}
            </a>
          </Fact>
        )}
        {ticket.waiting && <Fact name="Waiting on">{ticket.waiting}</Fact>}
        {ticket.topics && ticket.topics.length > 0 && (
          <Fact name="Topics">
            {ticket.topics.map(topic => (
              <Badge key={topic}>{topic}</Badge>
            ))}
          </Fact>
        )}
        {ticket.issue && (
          <Fact name="Issue">
            <a href={ticket.issue.url} target="_blank" rel="noreferrer" className="focus-ring rounded-sm pointer-fine:hover:underline">
              {ticket.issue.label}
            </a>
          </Fact>
        )}
        {ticket.effort !== undefined && <Fact name="Effort">{ticket.effort} of 10</Fact>}
        {ticket.uncertainty !== undefined && <Fact name="Uncertainty">{ticket.uncertainty} of 10</Fact>}
        {ticket.outdated && (
          <Fact name="Plan">
            <span className="text-warning">Outdated</span>
          </Fact>
        )}
        <Fact name="Opened">
          <span title={formatDateTime(ticket.date)}>{longAge(ticket.date)}</span>
        </Fact>
        <Fact name="File">
          {/* It may break after a slash or an underscore, never inside a word. */}
          <span className="min-w-0 font-mono text-xs text-muted-foreground">
            {`${TICKETS_DIR}/${ticket.file}`.split(/(?<=[/_])/).map((part, at) => (
              <Fragment key={at}>
                {at > 0 && <wbr />}
                {part}
              </Fragment>
            ))}
          </span>
        </Fact>
      </dl>
      {sessions.length > 0 && (
        <div className="mt-4 border-t border-hairline pt-4">
          <h2 className="mb-2 text-xs font-medium text-faint-foreground">Runs on this ticket</h2>
          <TicketSessions sessions={sessions} onOpen={agentId => host.openAgent(projectId, agentId)} />
        </div>
      )}
    </aside>
  )
}

/** One fact of the side list: its name in a column of its own, its value beside it. `wide`: said under the title on a narrow screen instead. */
function Fact({ name, wide = false, children }: { name: string; wide?: boolean; children: ReactNode }) {
  return (
    <div className={cn('flex items-baseline gap-2 py-1.5', wide && 'max-lg:hidden')}>
      <dt className="w-20 shrink-0 text-faint-foreground">{name}</dt>
      <dd className="flex min-w-0 flex-wrap items-baseline gap-1">{children}</dd>
    </div>
  )
}

/** How the run holding the claim stands, said after its name. */
function standing(holderStatus: string): string {
  return claimState(holderStatus) === 'stale' ? `run ${holderStatus}` : runSaid(holderStatus)
}

/** An age in words, "18 weeks ago", for a fact that has the room. */
function longAge(iso: string): string {
  const days = Math.floor((Date.now() - Date.parse(iso)) / 86_400_000)
  const said = (n: number, unit: string) => `${n} ${unit}${n === 1 ? '' : 's'} ago`
  if (Number.isNaN(days)) return '—'
  if (days < 1) return 'Today'
  if (days < 7) return said(days, 'day')
  if (days < 365) return said(Math.floor(days / 7), 'week')
  return said(Math.floor(days / 365), 'year')
}

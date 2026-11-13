import { MessageSquare } from 'lucide-react'
import { Button, Tooltip, TooltipContent, TooltipTrigger, formatAge, type ModuleAgent } from '@openagt/dashboard/module'
import { holderAgent, planAgentFor, workAgentFor } from '../src/module.js'

/** One kind of session on a ticket: the one that wrote its plan, or the one that worked it. */
export interface TicketSession {
  kind: 'plan' | 'work'
  agent: ModuleAgent
}

/**
 * The sessions behind a ticket, from the project's runs: the one whose ask named its plan wrote it
 * (the plan file carries no marker), and the one that worked it — asked about its file, or holding
 * its claim now.
 */
export function sessionsOf(agents: readonly ModuleAgent[], ticket: { file: string; lockedBy?: string | undefined }): TicketSession[] {
  const plan = planAgentFor(agents, ticket.file)
  const work = holderAgent(agents, ticket.lockedBy) ?? workAgentFor(agents, ticket.file)
  return [...(plan ? [{ kind: 'plan' as const, agent: plan }] : []), ...(work && work.id !== plan?.id ? [{ kind: 'work' as const, agent: work }] : [])]
}

const WORDS = {
  plan: { label: 'Plan', running: 'Being written in', ended: 'Written in' },
  work: { label: 'Work', running: 'Being worked in', ended: 'Worked in' },
} as const

/**
 * The sessions behind a ticket, each named and one press away: the one that wrote its plan and the
 * one that worked it. A finished one is gone on with in its own chat — the same conversation, the
 * ticket and the plan already in its context; one still running is watched.
 */
export function TicketSessions({ sessions, onOpen }: { sessions: readonly TicketSession[]; onOpen: (agentId: string) => void }) {
  if (sessions.length === 0) return null
  return (
    <ul className="divide-y divide-border rounded-lg border border-border">
      {sessions.map(({ kind, agent }) => {
        const running = agent.status === 'running'
        const words = WORDS[kind]
        return (
          <li key={kind} className="flex items-center gap-3 px-3 py-2 text-xs">
            <span className="w-9 shrink-0 font-medium text-muted-foreground">{words.label}</span>
            <span className="min-w-0 flex-1 truncate text-muted-foreground">
              {running ? words.running : words.ended} <span className="font-medium text-foreground">{agent.title ?? agent.id}</span>
              {` · ${running ? 'at work' : agent.status} · ${formatAge(agent.endedAt ?? agent.startedAt)}`}
            </span>
            <Tooltip>
              <TooltipTrigger render={<Button variant="outline" size="xs" className="shrink-0 gap-1.5" onClick={() => onOpen(agent.id)} />}>
                <MessageSquare className="h-3 w-3" aria-hidden /> Open session
              </TooltipTrigger>
              <TooltipContent className="max-w-72">
                {running
                  ? 'Opens the session, so you can watch it or step in.'
                  : 'Opens the session. What you send there goes on with the same conversation: the ticket, the plan and the reasoning behind them are already in its context.'}
              </TooltipContent>
            </Tooltip>
          </li>
        )
      })}
    </ul>
  )
}

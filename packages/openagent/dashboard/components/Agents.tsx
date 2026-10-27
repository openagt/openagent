import type { ActiveAgent } from '../../src/index.js'
import { Bot } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from './ui/card.js'
import { Tooltip, TooltipTrigger, TooltipContent } from './ui/tooltip.js'
import { formatAge, formatDateTime } from '../lib/format-date.js'
import { OnComputer } from './MachineMark.js'

// The Overview's Agents card (#1139): the sessions working right now. Each row is the whole line,
// clickable straight into that session — its label is the one-liner the sidebar shows, and its age
// reads "22s ago" with the exact moment on hover. This is what replaced the old "Working now" list.
// The Recent column the card launched with is gone: finished sessions already live in the sidebar's
// session list, so a second copy here said nothing new.
//
// Its own file rather than inline in DashboardPage, like every other card on the Overview: opening
// a session from here is the behaviour #1189 exists to protect, and DashboardPage has no test file
// to pin it in.

export function Agents({
  working,
  onSelectAgent,
}: {
  /** The agents at work; none says so in one line. */
  working: ActiveAgent[]
  onSelectAgent: (projectId: string, agentId: string) => void
}) {
  return (
    <Card>
      <CardHeader>
        {/* The one-line description sits beside the title rather than under a "Current" eyebrow of
            its own: with the Recent column gone there is nothing left for column headers to tell
            apart. */}
        <CardTitle className="flex items-center gap-2 text-base">
          <Bot className="h-4 w-4 shrink-0 text-muted-foreground" />
          Agents
          <span className="truncate text-xs font-normal text-muted-foreground">Agents currently working</span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {working.length === 0 ? (
          <p className="text-sm text-muted-foreground">No agent is at work.</p>
        ) : (
          <ul className="space-y-0.5">
            {working.map(a => (
              <AgentRow
                key={`${a.projectId}:${a.agentId}`}
                label={activeLabel(a)}
                cloud={a.cloud}
                computer={a.computer}
                at={a.updatedAt}
                projectName={a.projectName}
                onOpen={() => onSelectAgent(a.projectId, a.agentId)}
              />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

function AgentRow({
  label,
  cloud,
  computer,
  at,
  projectName,
  onOpen,
}: {
  /** The session's one-liner, the same the sidebar shows. */
  label: string
  /** A web run's cloud side at work (#1668): say where it is, since no local process backs the row. */
  cloud?: 'in-cloud' | 'waiting' | undefined
  /** The computer it runs on, when that is not this one (#1648). */
  computer?: ActiveAgent['computer']
  /** ISO: the session's last activity. */
  at: string | undefined
  projectName: string
  /** Open the session — project and run both, never just the launcher (#1189). */
  onOpen: () => void
}) {
  return (
    <li>
      {/* No hint on the row itself: that a session row opens the session is the one thing this card
          says already, and a tooltip on the row would sit over the one on the age (#1149). */}
      <button
        type="button"
        onClick={onOpen}
        className="flex w-full items-baseline gap-2 rounded-md px-2 py-1.5 text-left hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
      >
        <span aria-hidden className="shrink-0 text-muted-foreground/50">•</span>
        <span className="min-w-0 flex-1 truncate text-sm">{label}</span>
        {cloud && <span className="shrink-0 text-[10px] uppercase text-muted-foreground">{cloud === 'waiting' ? 'waiting' : 'in cloud'}</span>}
        <span className="shrink-0 text-xs text-muted-foreground">{projectName}</span>
        {computer && <OnComputer computer={computer} />}

        {at && (
          <Tooltip>
            <TooltipTrigger
              render={<span className="shrink-0 whitespace-nowrap text-xs tabular-nums text-muted-foreground/80" />}
            >
              {formatAge(at)}
            </TooltipTrigger>
            <TooltipContent>{formatDateTime(at)}</TooltipContent>
          </Tooltip>
        )}
      </button>
    </li>
  )
}

// A working session's one-liner: what the sidebar would show for it. ActiveAgent carries no branch or
// start time to fall back to, but a live session almost always has an intent or a chosen name; its
// project is the last resort.
function activeLabel(a: ActiveAgent): string {
  return a.intent?.trim() || a.scope?.trim() || a.projectName
}

import { Bot, Check, ChevronDown, Settings2 } from 'lucide-react'
import type { AgentRecord } from '../rpc/agents.js'
import { openAgents } from '../lib/use-route.js'
import { cn } from '../lib/utils.js'
import { rowButtonClass } from './ui/row-item.js'
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip.js'
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from './ui/dropdown-menu.js'

/**
 * The launcher's "Agent" menu, first under the box: which agent the session is on, by name. Its
 * skills go into the session's checkout and its accounts are the session's. The pick is saved,
 * as the model's is, and "Manage agents…" opens the Agents page. Drawn once the agents are read,
 * so the name lands whole.
 */
export function AgentMenu({ agents, picked, busy, onPick }: { agents: readonly AgentRecord[] | undefined; picked: string | undefined; busy: boolean; onPick: (id: string) => void }) {
  if (!agents) return null
  const on = agents.find(agent => agent.id === picked) ?? agents[0]
  if (!on) return null
  const said = `This session is on the agent ${on.name}: ${on.skills.length === 1 ? 'one skill' : `${on.skills.length} skills`}${on.accounts.github !== undefined ? `, as @${on.accounts.github} on GitHub` : ''}`
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger render={<DropdownMenuTrigger type="button" disabled={busy} aria-label={`Agent: ${on.name}`} className={rowButtonClass} />}>
          <Bot className="h-3.5 w-3.5 shrink-0" aria-hidden />
          <span className="max-w-32 truncate">{on.name}</span>
          <ChevronDown className="h-3 w-3 shrink-0 opacity-70" aria-hidden />
        </TooltipTrigger>
        <TooltipContent>{said}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="start" className="min-w-[14rem]">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Agent</DropdownMenuLabel>
          {agents.map(agent => (
            <DropdownMenuItem key={agent.id} onClick={() => onPick(agent.id)}>
              <Check className={cn('h-3.5 w-3.5 shrink-0', agent.id === on.id ? 'opacity-100' : 'opacity-0')} aria-hidden />
              <span className="flex-1 truncate">{agent.name}</span>
              <span className="shrink-0 text-xs text-muted-foreground">{agent.skills.length === 1 ? '1 skill' : `${agent.skills.length} skills`}</span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={openAgents}>
          <Settings2 className="h-3.5 w-3.5 shrink-0 opacity-70" aria-hidden />
          Manage agents…
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

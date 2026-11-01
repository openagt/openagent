import { Check, Plus } from 'lucide-react'
import { onMachineAgentAccounts, sendMachineAgentAccountFirst } from '../rpc/machines.js'
import { onAgentAccounts, sendUseAgentAccountFirst, type AccountRow, type AccountWindow, type AccountsAgent, type AccountsView } from '../rpc/accounts.js'
import { AccountBar, readAhead, usePolled, cn } from '@openagt/skill-ui/module'
import { DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator } from './ui/dropdown-menu.js'

// The accounts runs use, per coding agent, as the run's own places read them. Adding and removing
// them is the skill's (`@openagt/skill-account-rotation`, its card on the Overview and in Settings ›
// Accounts). Here: the agent's part of the agent picker under the message box (which one is first,
// on the computer the run goes to) and the Overview's usage card (how full each added Claude one is).

/** How often a page that shows the accounts asks again. */
const SELDOM_MS = 30_000

/** An agent's accounts as the daemon has them, kept for the page's life: a place that opens later (the person's menu) shows them from its first frame. */
export function useAgentAccounts(agent: AccountsAgent): { view: AccountsView | undefined } {
  const { value } = usePolled<AccountsView | undefined>(() => onAgentAccounts(agent), undefined, SELDOM_MS, [agent], { remember: `agent-accounts:${agent}` })
  return { view: value }
}

/** How long until `until`: "2 h 10 min", "12 min", "20 days". */
export function freeIn(until: number, now: number): string {
  const minutes = Math.max(1, Math.ceil((until - now) / 60_000))
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  if (hours >= 48) return `${Math.round(hours / 24)} days`
  return hours === 0 ? `${rest} min` : rest === 0 ? `${hours} h` : `${hours} h ${rest} min`
}

/** The time a reading was taken, as a clock says it: "2:14 PM". */
function clock(at: number): string {
  return new Date(at).toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  })
}

/** The longest window an account says, the one its bar shows: the week, or Codex's month. */
export function longest(account: AccountRow): AccountWindow | undefined {
  return account.windows[account.windows.length - 1]
}

/** That window as a line: "62% this week", "7% this month", with when an added one's was said. */
export function usageWords(account: AccountRow): string | undefined {
  const window = longest(account)
  if (window === undefined) return account.own ? undefined : 'not used yet'
  return `${Math.round(window.percent)}% ${window.label === '5 h' ? 'of 5 h' : `this ${window.label}`}${account.asOf !== undefined ? ` · as of ${clock(account.asOf)}` : ''}`
}

/** Where a saved machine's accounts of an agent are remembered on the page: a switch back to it shows them at once. */
const machineAccountsKey = (machineId: string, agent: AccountsAgent): string => `machine-agent-accounts:${machineId}:${agent}`

/** Ask a saved machine for each agent's accounts before it is picked, so the pick shows them from its first frame. */
export function readMachineAccountsAhead(machineId: string): void {
  for (const agent of ['claude', 'codex'] as const) readAhead(machineAccountsKey(machineId, agent), () => onMachineAgentAccounts(machineId, agent))
}

/**
 * An agent's accounts on the computer a run goes to: this computer's, read as Settings reads them,
 * or a saved machine's, asked there; `unanswered` when that machine does not say. A pick makes one
 * the first its runs take, there, as Settings › Accounts does: the next run goes with it.
 */
export function useAccountsOn(
  agent: AccountsAgent,
  machineId: string | undefined,
  on = true,
): {
  view: AccountsView | undefined
  unanswered: boolean
  pick: (account: string) => Promise<void>
} {
  const own = usePolled<AccountsView | undefined>(on && machineId === undefined ? () => onAgentAccounts(agent) : null, undefined, SELDOM_MS, [agent, on, machineId === undefined], { remember: `agent-accounts:${agent}` })
  const theirs = usePolled<AccountsView | null | undefined>(on && machineId !== undefined ? () => onMachineAgentAccounts(machineId, agent) : null, undefined, SELDOM_MS, [agent, on, machineId], machineId !== undefined ? { remember: machineAccountsKey(machineId, agent) } : undefined)
  if (machineId === undefined) return { view: own.value, unanswered: false, pick: account => sendUseAgentAccountFirst(agent, account).then(own.reload) }
  return { view: theirs.value ?? undefined, unanswered: theirs.value === null, pick: account => sendMachineAgentAccountFirst(machineId, agent, account).then(theirs.reload) }
}

/** The accounts a run can take: the person's own is left out when the agent has no such login and another account is there. */
export function runAccounts(view: AccountsView): AccountRow[] {
  const there = view.accounts.filter(account => !account.loggedOut)
  return there.length > 0 ? there : view.accounts
}

/** The account an agent's runs take first, as its row in the agent picker says it: its name, and how full it is. */
export function firstAccount(view: AccountsView | undefined): { name: string; percent: string } | undefined {
  const first = view && runAccounts(view)[0]
  if (!first) return undefined
  const window = longest(first)
  return { name: first.name, percent: first.state === 'limited' ? ' · limited' : window !== undefined ? ` · ${Math.round(window.percent)}%` : '' }
}

/**
 * An agent's accounts in its part of the agent picker, under its models: the one its runs take
 * first checked, how full each is, and adding one. `on` names the computer they are another's of.
 * A pick keeps the menu open, so the check is seen to move.
 */
export function AgentAccountItems({ view, on, onPick, onAdd }: { view: AccountsView; on?: string | undefined; onPick: (account: string) => void; onAdd: () => void }) {
  return (
    <>
      <DropdownMenuSeparator />
      <DropdownMenuGroup>
        <DropdownMenuLabel>{on !== undefined ? `Accounts on ${on}` : 'Accounts'}</DropdownMenuLabel>
        {runAccounts(view).map((account, i) => (
          <DropdownMenuItem key={account.id} closeOnClick={false} onClick={() => onPick(account.id)}>
            <Check className={cn('h-3.5 w-3.5 shrink-0', i === 0 ? 'opacity-100' : 'opacity-0')} aria-hidden />
            <span className="flex-1 truncate">{account.name}</span>
            <span className="text-xs text-muted-foreground">{account.state === 'limited' ? 'limited' : longest(account) !== undefined ? `${Math.round(longest(account)!.percent)}%` : ''}</span>
          </DropdownMenuItem>
        ))}
        <DropdownMenuItem onClick={onAdd}>
          <Plus className="h-3.5 w-3.5 shrink-0 opacity-70" aria-hidden />
          Add account…
        </DropdownMenuItem>
      </DropdownMenuGroup>
    </>
  )
}

/** The usage card's rows for the added accounts, under the person's own bar: shown only when there are some. */
export function AddedAccountsUsage() {
  const { view } = useAgentAccounts('claude')
  const added = view && view.accounts.length > 1 ? view.accounts.filter(a => !a.own) : []
  if (added.length === 0) return null
  return (
    <div className="space-y-1.5 border-t border-border pt-3" aria-label="Other Claude accounts">
      {added.map(account => (
        <div key={account.id} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm">
          <span className="w-24 truncate">{account.name}</span>
          <AccountBar percent={longest(account)?.percent} />
          <span className="text-xs text-muted-foreground">
            {account.state === 'limited' && account.limitedUntil !== undefined ? `limited, free in ${freeIn(account.limitedUntil, view!.now)}` : (usageWords(account) ?? '')}
          </span>
        </div>
      ))}
    </div>
  )
}

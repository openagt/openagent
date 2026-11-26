import type { ReactNode } from 'react'
import { Plus } from 'lucide-react'
import { MenuTick, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, Facts, cn, useModuleHost } from '@openagt/ui/module'
import { AccountBar } from './account-bar.js'
import { longest, runAccounts, useAccounts, type AccountRow, type AccountsView } from './accounts.js'

// The accounts runs use, per coding agent, where the run's own places show them: the agent's part
// of the agent menu under the message box (which one is first), and the usage card (how full each
// added Claude one is). Adding and removing them is the accounts card's.

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

/** That window as a line: "62% this week", "7% this month", with when an added one's was said. */
function usageWords(account: AccountRow): ReactNode {
  const window = longest(account)
  if (window === undefined) return account.own ? undefined : 'not used yet'
  return <Facts facts={[`${Math.round(window.percent)}% ${window.label === '5 h' ? 'of 5 h' : `this ${window.label}`}`, account.asOf !== undefined && `as of ${clock(account.asOf)}`]} />
}

/**
 * An agent's accounts in its part of the agent menu, under its models: the one its runs take
 * first checked, how full each is, and adding one. A pick keeps the menu open, so the check is
 * seen to move.
 */
export function AgentAccountItems({ view, onPick, onAdd }: { view: AccountsView; onPick: (account: string) => void; onAdd: () => void }) {
  return (
    <>
      <DropdownMenuSeparator />
      <DropdownMenuGroup>
        <DropdownMenuLabel>Accounts</DropdownMenuLabel>
        {runAccounts(view).map((account, i) => (
          <DropdownMenuItem key={account.id} closeOnClick={false} onClick={() => onPick(account.id)}>
            <span className="flex-1 truncate">{account.name}</span>
            <span className="text-xs text-muted-foreground">{account.state === 'limited' ? 'limited' : longest(account) !== undefined ? `${Math.round(longest(account)!.percent)}%` : ''}</span>
            <MenuTick on={i === 0} />
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

/** The usage card's rows for the list's added accounts, under the person's own bar: shown only when there are some. */
export function AddedAccountsUsage({ list, label }: { list: string; /** Whose accounts they are: "Claude". */ label: string }) {
  const { view } = useAccounts(useModuleHost(), list)
  const added = view && view.accounts.length > 1 ? view.accounts.filter(a => !a.own) : []
  if (added.length === 0) return null
  return (
    <div className="space-y-1.5 border-t border-border pt-3" aria-label={`Other ${label} accounts`}>
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

import { useState } from 'react'
import { Check, Plus } from 'lucide-react'
import { onClaudeAccounts, sendAddClaudeAccount, sendRemoveClaudeAccount, sendUseClaudeAccountFirst, type AccountRow, type AccountsView } from '../rpc/accounts.js'
import { usePolled } from '../lib/use-async.js'
import { cn } from '../lib/utils.js'
import { ClaudeLogo } from './driver-logos.js'
import { Button } from './ui/button.js'
import { Input } from './ui/input.js'
import { DropdownMenuItem, DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger } from './ui/dropdown-menu.js'

// The Claude accounts runs use, in the order they try them (`claude-accounts.ts` in the Claude
// driver): the person's own login and the ones added beside it. When one hits its limit, the next
// free one takes the run over in the same conversation. Three places show them: Settings' "Agent
// accounts" (where they are added and removed), a row of the person's menu at the sidebar's foot
// (which one is first), and the Overview's usage card (how full each added one is).

/** The Settings entry the accounts are in: what "Add account…" in the person's menu opens. */
export const AGENT_ACCOUNTS_ENTRY = 'agent-accounts'

/** How often a page that shows the accounts asks again: often while one is being added, the browser yes being the person's. */
const OFTEN_MS = 2_000
const SELDOM_MS = 30_000

/** The accounts as the daemon has them, asked often while `often`. */
export function useClaudeAccounts(often = false): {
  view: AccountsView | undefined
  reload: () => Promise<void>
} {
  const { value, reload } = usePolled<AccountsView | undefined>(onClaudeAccounts, undefined, often ? OFTEN_MS : SELDOM_MS, [often])
  return { view: value, reload }
}

/** How long until `until`: "2 h 10 min", "12 min". */
export function freeIn(until: number, now: number): string {
  const minutes = Math.max(1, Math.ceil((until - now) / 60_000))
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return hours === 0 ? `${rest} min` : rest === 0 ? `${hours} h` : `${hours} h ${rest} min`
}

/** The time a reading was taken, as a clock says it: "2:14 PM". */
function clock(at: number): string {
  return new Date(at).toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  })
}

/** What an account's row says of it beside its name. */
function source(account: AccountRow): string {
  if (account.own) return "this computer's login"
  return account.added ? `added ${new Date(account.added).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}` : 'added'
}

/** The week as a line: "62% this week", with when an added one's was said. */
export function weekWords(account: AccountRow): string | undefined {
  if (account.weekPercent === undefined) return account.own ? undefined : 'not used yet'
  return `${Math.round(account.weekPercent)}% this week${account.asOf !== undefined ? ` · as of ${clock(account.asOf)}` : ''}`
}

/** A bar as thin as a line, filled as far as the week is gone; amber near the end, red at it. */
export function AccountBar({ percent, className }: { percent: number | undefined; className?: string }) {
  const used = Math.min(100, Math.max(0, percent ?? 0))
  return (
    <span aria-hidden className={cn('relative block h-1.5 w-20 shrink-0 overflow-hidden rounded-full bg-muted-foreground/15', className)}>
      <span className={cn('absolute inset-y-0 left-0 rounded-full', used >= 100 ? 'bg-danger' : used >= 80 ? 'bg-warning' : 'bg-success')} style={{ width: `${used}%` }} />
    </span>
  )
}

function StateWords({ account, now }: { account: AccountRow; now: number }) {
  if (account.state === 'limited' && account.limitedUntil !== undefined) return <span className="text-xs text-warning">limited, free in {freeIn(account.limitedUntil, now)}</span>
  if (account.state === 'in-use') return <span className="text-xs font-medium text-success">in use</span>
  if (account.state === 'next') return <span className="text-xs text-muted-foreground">next</span>
  return null
}

/** Settings › Agent accounts: one card per coding agent; Claude Code's for now. */
export function AgentAccountsSettings() {
  const [naming, setNaming] = useState(false)
  const [name, setName] = useState('')
  const [error, setError] = useState<string | undefined>()
  const [busy, setBusy] = useState(false)
  const { view, reload } = useClaudeAccounts(true)
  const adding = view?.adding

  const act = async (go: () => Promise<{ ok: true } | { ok: false; error: string }>): Promise<boolean> => {
    setBusy(true)
    setError(undefined)
    try {
      const done = await go()
      if (!done.ok) setError(done.error)
      await reload()
      return done.ok
    } finally {
      setBusy(false)
    }
  }
  const add = async () => {
    if (await act(() => sendAddClaudeAccount(name))) {
      setNaming(false)
      setName('')
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">Runs use these accounts in this order. When one hits its limit, the next free one takes the run over where it stopped.</p>
      <section aria-label="Claude Code" className="rounded-lg border border-border">
        <header className="flex items-center gap-2 border-b border-border px-3 py-2.5">
          <ClaudeLogo className="size-4 shrink-0" />
          <h3 className="flex-1 text-sm font-medium">Claude Code</h3>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-success/10 px-2 py-0.5 text-xs font-medium text-success">
            <span aria-hidden className="size-1.5 rounded-full bg-success" />
            Connected
          </span>
        </header>
        <ul className="divide-y divide-border">
          {(view?.accounts ?? []).map(account => (
            <li key={account.id} aria-label={account.name} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5">
              <div className="min-w-0 flex-1 max-sm:basis-full!">
                <p className="truncate text-sm">{account.name}</p>
                <p className="truncate text-xs text-muted-foreground">{source(account)}</p>
              </div>
              <div className="flex items-center gap-2">
                <AccountBar percent={account.weekPercent} />
                <span className="w-44 truncate text-xs text-muted-foreground max-sm:w-auto">{weekWords(account) ?? ''}</span>
              </div>
              <div className="flex w-36 items-center justify-end gap-2 max-sm:w-auto">
                {view && <StateWords account={account} now={view.now} />}
                {!account.own && (
                  <Button
                    size="xs"
                    variant="ghost"
                    disabled={busy}
                    aria-label={`Remove ${account.name}'s account`}
                    title="Runs no longer use it. Its login is not ended: take it back on claude.ai to end it."
                    onClick={() => void act(() => sendRemoveClaudeAccount(account.id))}
                  >
                    Remove
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
        <div className="border-t border-border px-3 py-2.5">
          {adding ? (
            <p role="status" className="text-xs text-muted-foreground">
              {`Adding ${adding.name}'s account: say yes in the page this computer's browser opened, signed in to ${adding.name}'s Claude account.`}
            </p>
          ) : naming ? (
            <form
              className="flex flex-wrap items-center gap-2"
              onSubmit={event => {
                event.preventDefault()
                void add()
              }}
            >
              <Input autoFocus aria-label="Whose account" placeholder="Whose account, e.g. Dani" value={name} onChange={event => setName(event.target.value)} className="h-8 w-56 max-sm:w-full" />
              <Button size="sm" type="submit" disabled={busy || name.trim() === ''}>
                Log in to Claude
              </Button>
              <Button size="sm" variant="ghost" type="button" onClick={() => (setNaming(false), setError(undefined))}>
                Cancel
              </Button>
            </form>
          ) : (
            <Button size="sm" variant="ghost" onClick={() => setNaming(true)}>
              <Plus className="size-3.5" aria-hidden />
              Add account
            </Button>
          )}
          {naming && !adding && (
            <p className="mt-1.5 text-xs text-muted-foreground">
              Opens this computer's browser, where you say yes once, signed in to that account. The login is kept on this computer alone and lasts a year.
            </p>
          )}
          {(error ?? view?.failed) !== undefined && (
            <p role="alert" className="mt-1.5 whitespace-pre-line text-xs text-danger">
              {error ?? view?.failed}
            </p>
          )}
        </div>
      </section>
    </div>
  )
}

/** The Claude row of the person's menu: which account runs use first and how full it is; its submenu picks another first. */
export function ClaudeAccountsSubmenu({ onAdd }: { onAdd: () => void }) {
  const { view, reload } = useClaudeAccounts()
  const accounts = view?.accounts ?? []
  const first = accounts[0]
  if (!first) return null
  const percent = first.weekPercent !== undefined ? ` · ${Math.round(first.weekPercent)}%` : ''
  // Its own line under it: no account read yet, no row and no line.
  return (
    <>
      <DropdownMenuSub>
        <DropdownMenuSubTrigger>
          <ClaudeLogo className="h-3.5 w-3.5 shrink-0" />
          <span className="flex-1">Claude</span>
          <span className="max-w-32 truncate text-muted-foreground">{`${first.name}${percent}`}</span>
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent className="min-w-[15rem]">
          {accounts.map((account, i) => (
            <DropdownMenuItem key={account.id} closeOnClick={false} onClick={() => void sendUseClaudeAccountFirst(account.id).then(reload)}>
              <Check className={cn('h-3.5 w-3.5 shrink-0', i === 0 ? 'opacity-100' : 'opacity-0')} aria-hidden />
              <span className="flex-1 truncate">{account.name}</span>
              <span className="text-xs text-muted-foreground">{account.state === 'limited' ? 'limited' : account.weekPercent !== undefined ? `${Math.round(account.weekPercent)}%` : ''}</span>
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={onAdd}>
            <Plus className="h-3.5 w-3.5 shrink-0 opacity-70" aria-hidden />
            Add account…
          </DropdownMenuItem>
        </DropdownMenuSubContent>
      </DropdownMenuSub>
      <DropdownMenuSeparator />
    </>
  )
}

/** The usage card's rows for the added accounts, under the person's own bar: shown only when there are some. */
export function AddedAccountsUsage() {
  const { view } = useClaudeAccounts()
  const added = view && view.accounts.length > 1 ? view.accounts.filter(a => !a.own) : []
  if (added.length === 0) return null
  return (
    <div className="space-y-1.5 border-t border-border pt-3" aria-label="Other Claude accounts">
      {added.map(account => (
        <div key={account.id} className="flex items-center gap-2 text-sm">
          <span className="w-24 truncate">{account.name}</span>
          <AccountBar percent={account.weekPercent} />
          <span className="truncate text-xs text-muted-foreground">
            {account.state === 'limited' && account.limitedUntil !== undefined ? `limited, free in ${freeIn(account.limitedUntil, view!.now)}` : (weekWords(account) ?? '')}
          </span>
        </div>
      ))}
    </div>
  )
}

import { useState } from 'react'
import { Check, Copy, Plus } from 'lucide-react'
import { onMachineAgentAccounts, sendMachineAgentAccountFirst } from '../rpc/machines.js'
import { onAgentAccounts, sendAddAgentAccount, sendAgentAccountCode, sendCancelAddingAccount, sendRemoveAgentAccount, sendUseAgentAccountFirst, type AccountAdding, type AccountRow, type AccountWindow, type AccountsAgent, type AccountsView } from '../rpc/accounts.js'
import type { DriverName } from '../../src/client.js'
import { AccountBar, ClaudeLogo, CodexLogo, readAhead, usePolled, cn, Button, Input } from '@openagt/skill-ui/module'
import { AgentFix, DeviceCode, StatePill, agentLoginState, agentWords, useAgentState } from './Logins.js'
import { LeftNotices, ServerNotes, SwitchNotice } from './ServerLogins.js'
import { DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator } from './ui/dropdown-menu.js'

// The accounts runs use, per coding agent, in the order they try them (`accounts.ts` in the driver
// core): the person's own login and the ones added beside it. When one hits its limit, the next free
// one takes the run over in the same conversation. Three places show them: Settings › Accounts
// (a card per agent, where they are added and removed), the agent's part of the agent picker under
// the message box (which one is first, on the computer the run goes to), and the Overview's usage
// card (how full each added Claude one is). Every agent's card and row are the same, with the agent's own words. A row never
// says "this computer", which reads as whichever computer the page is open on: it names the one.

/** How often a page that shows the accounts asks again: often while one is being added, the sign-in being the person's. */
const OFTEN_MS = 2_000
const SELDOM_MS = 30_000

/** What each agent's card and row say of it. */
const AGENTS: Record<AccountsAgent, { title: string; short: string; driver: DriverName; Logo: typeof ClaudeLogo; logIn: string; adding: (name: string) => string; help: string; remove: string }> = {
  claude: {
    title: 'Claude Code',
    short: 'Claude',
    driver: 'claude-code',
    Logo: ClaudeLogo,
    logIn: 'Log in to Claude',
    adding: name => `Adding ${name}'s account: say yes in the page this computer's browser opened, signed in to ${name}'s Claude account.`,
    help: "Opens this computer's browser, where you say yes once, signed in to that account. The login is kept on this computer alone and lasts a year.",
    remove: 'Runs no longer use it. Its login is not ended: take it back on claude.ai to end it.',
  },
  codex: {
    title: 'Codex',
    short: 'Codex',
    driver: 'codex',
    Logo: CodexLogo,
    logIn: 'Log in to Codex',
    adding: name => `Adding ${name}'s account: sign in to ${name}'s ChatGPT account in the page this computer's browser opened.`,
    help: "Opens this computer's browser, where you sign in once to that account. If the browser is signed in to another account, copy the link into a private window. The login is kept on this computer alone, and Codex renews it.",
    remove: 'Runs no longer use it, and its login is taken off this computer.',
  },
}

/** An agent's accounts as the daemon has them, asked often while `often`, and kept for the page's life: a place that opens later (the person's menu) shows them from its first frame. */
export function useAgentAccounts(
  agent: AccountsAgent,
  often = false,
): {
  view: AccountsView | undefined
  reload: () => Promise<void>
} {
  const { value, reload } = usePolled<AccountsView | undefined>(() => onAgentAccounts(agent), undefined, often ? OFTEN_MS : SELDOM_MS, [agent, often], { remember: `agent-accounts:${agent}` })
  return { view: value, reload }
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

/** What an account's row says of it beside its name: the computer it is a login of, or when it was added. */
function source(account: AccountRow, computer: string): string {
  if (account.own) return `login on ${computer}`
  if (account.from !== undefined) return `from ${account.from}`
  return account.added ? `added ${new Date(account.added).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}` : 'added'
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

function StateWords({ account, now }: { account: AccountRow; now: number }) {
  if (account.state === 'limited' && account.limitedUntil !== undefined) return <span className="text-xs text-warning">limited, free in {freeIn(account.limitedUntil, now)}</span>
  if (account.state === 'in-use') return <span className="text-xs font-medium text-success">in use</span>
  if (account.state === 'next') return <span className="text-xs text-muted-foreground">next</span>
  return null
}

/**
 * An account being added: in this computer's browser, or, on a computer with no browser, on the
 * person's own device: Codex's code typed at its page, or Claude's page opened and its code pasted back here.
 */
function Adding({ agent, adding, words }: { agent: AccountsAgent; adding: AccountAdding; words: string }) {
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | undefined>()
  if (adding.code !== undefined && adding.url !== undefined) return <DeviceCode code={adding.code} url={adding.url} />
  if (adding.paste && adding.url !== undefined) {
    const send = async () => {
      setError(undefined)
      const done = await sendAgentAccountCode(agent, code)
      if (!done.ok) setError(done.error)
    }
    return (
      <div role="status" className="space-y-2">
        <a href={adding.url} target="_blank" rel="noreferrer" className="inline-flex h-9 items-center rounded-md border border-border px-3 text-sm hover:bg-accent">
          {`1. Open Claude and press Authorize ↗`}
        </a>
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={event => {
            event.preventDefault()
            void send()
          }}
        >
          <Input aria-label="Code from Claude" placeholder="2. Paste the code it shows" value={code} onChange={event => setCode(event.target.value)} className="h-9 min-w-0 flex-1 basis-48 text-base sm:text-sm" />
          <Button size="sm" type="submit" disabled={code.trim() === '' || adding.checking === true}>
            {adding.checking ? 'Checking…' : 'Done'}
          </Button>
        </form>
        {(error !== undefined || adding.refused) && <p role="alert" className="text-xs text-danger">{error ?? "Claude didn't take that code. Copy it whole from its page, and paste it again."}</p>}
      </div>
    )
  }
  return (
    <div role="status" className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <p className="text-xs text-muted-foreground">{words}</p>
      {adding.url !== undefined && <CopyLink url={adding.url} />}
    </div>
  )
}

/** The page to sign in at, copied for a private window: the browser may be signed in to another account. */
function CopyLink({ url }: { url: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <Button
      size="xs"
      variant="ghost"
      onClick={() =>
        void navigator.clipboard.writeText(url).then(
          () => setCopied(true),
          () => {},
        )
      }
    >
      {copied ? <Check className="size-3.5" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
      {copied ? 'Copied' : 'Copy link for a private window'}
    </Button>
  )
}

/**
 * One agent's card: its state, its accounts in order, and adding one. One not installed shows only
 * its state and the press that installs it. The agent's own login has no row while it is logged in
 * to nothing and another account is there: a server mostly runs on the person's own computers' logins.
 */
export function AccountsCard({ agent }: { agent: AccountsAgent }) {
  const words = AGENTS[agent]
  const [naming, setNaming] = useState(false)
  const [name, setName] = useState('')
  const [error, setError] = useState<string | undefined>()
  const [busy, setBusy] = useState(false)
  const { view, reload } = useAgentAccounts(agent, true)
  const { state, reload: reloadState } = useAgentState(words.driver)
  const adding = view?.adding
  const absent = agentLoginState(state) === 'not-installed' && (view?.accounts.length ?? 0) < 2
  // Its own login is out: nothing of the agent's own to show, whether or not another account covers for it.
  const ownOut = state?.ownLoggedOut === true || agentLoginState(state) === 'step'
  const accounts = (view?.accounts ?? []).filter(account => !(account.own && (ownOut || account.loggedOut)))

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
    if (await act(() => sendAddAgentAccount(agent, name))) {
      setNaming(false)
      setName('')
    }
  }

  return (
    <section aria-label={words.title} className="rounded-lg border border-border">
      <header className={cn('flex items-center gap-2 px-3 py-2.5', !absent && 'border-b border-border')}>
        <words.Logo className="size-4 shrink-0" />
        <h3 className="flex-1 text-sm font-medium">{words.title}</h3>
        {state && <StatePill state={agentLoginState(state)!} />}
        {!absent && accounts.length > 0 && !naming && !adding && (
          <Button size="xs" variant="ghost" onClick={() => setNaming(true)}>
            <Plus className="size-3.5" aria-hidden />
            Add account
          </Button>
        )}
      </header>
      {state && !state.ready && (state.fix !== undefined || agentLoginState(state) === 'not-installed') && (
        <div className={cn('space-y-2 px-3 py-2.5', !absent && 'border-b border-border', absent && 'pt-0')}>
          <p className="text-xs text-muted-foreground">{agentWords(state)}</p>
          <AgentFix state={state} onChanged={() => void reloadState()} />
        </div>
      )}
      {!absent && (
        <>
          <ul className="divide-y divide-border">
            {accounts.map(account => (
              <li key={account.id} aria-label={account.name}>
                <div className="space-y-2 px-3 py-2.5">
                  <div>
                    <div className="flex min-h-7 items-center gap-2">
                      <p className="min-w-0 truncate text-sm">{account.name}</p>
                      {view && <StateWords account={account} now={view.now} />}
                      {!account.own && account.from === undefined && (
                        <Button size="xs" variant="ghost" className="ml-auto text-muted-foreground" disabled={busy} aria-label={`Remove ${account.name}'s account`} title={words.remove} onClick={() => void act(() => sendRemoveAgentAccount(agent, account.id))}>
                          Remove
                        </Button>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                      <p className="min-w-0 truncate text-xs text-muted-foreground">{source(account, view!.computer)}</p>
                      {/* A login with no reading of its usage has no bar: an empty one read as nothing used. */}
                      {usageWords(account) !== undefined && (
                        <div className="ml-auto flex items-center gap-2">
                          <span className="text-xs text-muted-foreground">{usageWords(account)}</span>
                          <AccountBar percent={longest(account)?.percent} />
                        </div>
                      )}
                    </div>
                  </div>
                  <ServerNotes row={{ kind: agent, source: account.own ? 'own' : account.id }} />
                </div>
                <SwitchNotice row={{ kind: agent, source: account.own ? 'own' : account.id }} />
              </li>
            ))}
          </ul>
          <LeftNotices kind={agent} />
          {/* The foot holds the account being added, or the first one's press: "Add account" is in the header once there is one. */}
          {(accounts.length === 0 || naming || adding || (error ?? view?.failed) !== undefined) && (
            <div className={cn('px-3 py-2.5', accounts.length > 0 && 'border-t border-border')}>
              {adding ? (
                <div className="space-y-2">
                  <Adding agent={agent} adding={adding} words={words.adding(adding.name)} />
                  <Button size="xs" variant="ghost" className="text-muted-foreground" disabled={busy} onClick={() => void act(() => sendCancelAddingAccount(agent))}>
                    Cancel
                  </Button>
                </div>
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
                    {words.logIn}
                  </Button>
                  <Button size="sm" variant="ghost" type="button" onClick={() => (setNaming(false), setError(undefined))}>
                    Cancel
                  </Button>
                </form>
              ) : (
                accounts.length === 0 && (
                  <Button size="sm" onClick={() => setNaming(true)}>
                    <Plus className="size-3.5" aria-hidden />
                    {words.logIn}
                  </Button>
                )
              )}
              {naming && !adding && <p className="mt-1.5 text-xs text-muted-foreground">{words.help}</p>}
              {(error ?? view?.failed) !== undefined && (
                <p role="alert" className="mt-1.5 whitespace-pre-line text-xs text-danger">
                  {error ?? view?.failed}
                </p>
              )}
            </div>
          )}
        </>
      )}
    </section>
  )
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

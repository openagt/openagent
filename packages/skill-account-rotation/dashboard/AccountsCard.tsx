import { useState } from 'react'
import { AccountBar, Button, Card, CardContent, CardHeader, CardTitle, ClaudeLogo, CodexLogo, Skeleton, usePolled, useSkillHost, type ModuleCardProps, type SkillHost } from '@openagt/skill-ui/module'

// The accounts each coding agent's runs try, in order: how full each one is, whether it is at a
// limit, and a press that puts it first. Adding and removing need a sign-in, so they stay with the
// command, and in OpenAgent with Settings › Accounts.

/** How often the order and the limits are asked again. */
const LIST_EVERY_MS = 30_000
/** How often how full each account is, is asked again: a slower answer, and Claude's own is kept for minutes anyway. */
const USAGE_EVERY_MS = 2 * 60_000

const AGENTS = [
  { id: 'claude', name: 'Claude Code', Logo: ClaudeLogo },
  { id: 'codex', name: 'Codex', Logo: CodexLogo },
] as const

type AgentId = (typeof AGENTS)[number]['id']

/** An account, as `account-rotation list` prints it. */
interface Account {
  /** What the commands know it by. */
  name: string
  /** Who it is, for the person's own login while they gave it no name: what to call it. */
  who?: string
  /** The agent has no login of the person's: this computer may not even have it. */
  signedOut?: true
  own: boolean
  /** The computer the person's own login is on. */
  computer?: string
  /** When an added one was added. */
  added?: string
  limitedUntil?: number
}

/** How full an account is, as `account-rotation usage` prints it. */
interface Usage {
  name: string
  /** Shortest first. */
  windows: { window: string; percentUsed: number }[]
  /** When this is what its last run saw, rather than a reading now. */
  at?: number
}

/** What a command answered: its output for each agent, or why there is none. A browser keeps this between visits, so a new version reads what an old one kept. */
type Read<T> = { ok: true; accounts: Record<AgentId, T[]> } | { ok: false; error: string }

async function read<T>(host: SkillHost, word: string): Promise<Read<T>> {
  const answer = await host.runComputerCommand([word])
  return answer.ok ? { ok: true, accounts: answer.output as Record<AgentId, T[]> } : answer
}

/** How long until `until`, in a few words. */
function inWords(until: number, now: number): string {
  const minutes = Math.ceil((until - now) / 60_000)
  if (minutes < 60) return `${Math.max(minutes, 1)} min`
  const hours = Math.round(minutes / 60)
  return hours < 48 ? `${hours} h` : `${Math.round(hours / 24)} days`
}

const WINDOW_WORDS: Record<string, string> = { five_hour: 'of 5 h', seven_day: 'this week', thirty_day: 'this month' }

/** How full an account is, in a line: its longest window, as Settings › Accounts says it. Undefined for the person's own login with nothing read. */
function usageWords(usage: Usage | undefined, own: boolean): string | undefined {
  const window = usage?.windows.at(-1)
  if (!window) return own ? undefined : 'not used yet'
  const asOf = usage?.at !== undefined ? ` · as of ${new Date(usage.at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}` : ''
  return `${Math.round(window.percentUsed)}% ${WINDOW_WORDS[window.window] ?? ''}${asOf}`
}

/** Where an account comes from, in a line. */
function source(account: Account): string {
  if (account.own) return account.computer !== undefined ? `login on ${account.computer}` : 'your login'
  return account.added !== undefined ? `added ${new Date(account.added).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}` : 'added'
}

/** Whether a limit keeps an account out now. */
const isLimited = (account: Account, now: number): boolean => account.limitedUntil !== undefined && account.limitedUntil > now

/** What runs do with an account, as Settings › Accounts says it: with one account there is no order to say. */
function StateWords({ account, accounts, now }: { account: Account; accounts: Account[]; now: number }) {
  if (isLimited(account, now)) return <span className="truncate text-xs text-warning">limited, free in {inWords(account.limitedUntil!, now)}</span>
  if (accounts.length < 2) return null
  const free = accounts.filter(each => !isLimited(each, now))
  if (free[0] === account) return <span className="shrink-0 text-xs font-medium text-success">in use</span>
  if (free[1] === account) return <span className="shrink-0 text-xs text-muted-foreground">next</span>
  return null
}

function AgentAccounts({ agent, accounts, usage, reading, onUseFirst, busy }: { agent: (typeof AGENTS)[number]; accounts: Account[]; usage: Usage[]; reading: boolean; onUseFirst: (name: string) => void; busy: boolean }) {
  const now = Date.now()
  return (
    <section aria-label={agent.name} className="rounded-lg border border-border">
      <header className="flex items-center gap-2 border-b border-border px-3 py-2.5">
        <agent.Logo className="size-4 shrink-0" />
        <h4 className="flex-1 text-sm font-medium">{agent.name}</h4>
      </header>
      <ul className="divide-y divide-border">
        {accounts.map((account, index) => {
          const reads = usage.find(each => each.name === account.name)
          const words = usageWords(reads, account.own)
          return (
            <li key={account.name} className="px-3 py-2.5">
              <div className="flex min-h-7 items-center gap-2">
                <p className="min-w-0 truncate text-sm">{account.who ?? account.name}</p>
                <StateWords account={account} accounts={accounts} now={now} />
                {index > 0 && (
                  <Button variant="ghost" size="xs" className="ml-auto shrink-0 text-muted-foreground" disabled={busy} aria-label={`Use ${account.who ?? account.name} first`} onClick={() => onUseFirst(account.name)}>
                    Use first
                  </Button>
                )}
              </div>
              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                <p className="min-w-0 truncate text-xs text-muted-foreground">{source(account)}</p>
                {reading ? (
                  <Skeleton className="ml-auto h-3 w-28" />
                ) : (
                  // A login with no reading of its usage has no bar: an empty one read as nothing used.
                  words !== undefined && (
                    <div className="ml-auto flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">{words}</span>
                      <AccountBar percent={reads?.windows.at(-1)?.percentUsed} />
                    </div>
                  )
                )}
              </div>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

export function AccountsCard(_props: ModuleCardProps) {
  const host = useSkillHost()
  const { value: list, loaded, reload } = usePolled<Read<Account> | undefined>(() => read<Account>(host, 'list'), undefined, LIST_EVERY_MS, [], { remember: 'account-rotation:list', stored: true })
  const { value: usage } = usePolled<Read<Usage> | undefined>(() => read<Usage>(host, 'usage'), undefined, USAGE_EVERY_MS, [], { remember: 'account-rotation:usage', stored: true })
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState<string>()

  const putFirst = (agent: AgentId, name: string): void => {
    setBusy(true)
    setFailed(undefined)
    void host
      .runComputerCommand(['use-first', agent, name])
      .then(answer => {
        if (!answer.ok) setFailed(answer.error)
        return reload()
      })
      .finally(() => setBusy(false))
  }

  // An agent with only a login that is not there says nothing: this computer may not have that agent.
  const shown = list?.ok ? AGENTS.filter(agent => (list.accounts[agent.id] ?? []).some(account => !account.signedOut)) : []
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Accounts</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {list === undefined && !loaded && <Skeleton className="h-16 w-full" />}
        {list?.ok === false && <p className="text-sm text-danger">{list.error}</p>}
        {list?.ok && shown.length === 0 && <p className="text-sm text-muted-foreground">No coding agent is logged in on this computer.</p>}
        {list?.ok &&
          shown.map(agent => (
            <AgentAccounts
              key={agent.id}
              agent={agent}
              accounts={list.accounts[agent.id] ?? []}
              usage={usage?.ok ? (usage.accounts[agent.id] ?? []) : []}
              reading={usage === undefined}
              busy={busy}
              onUseFirst={name => putFirst(agent.id, name)}
            />
          ))}
        {failed !== undefined && <p className="text-sm text-danger">{failed}</p>}
      </CardContent>
    </Card>
  )
}

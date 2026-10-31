import { useState } from 'react'
import { Button, Card, CardContent, CardHeader, CardTitle, Skeleton, usePolled, useSkillHost, type ModuleCardProps, type SkillHost } from '@openagt/skill-ui/module'

// The accounts each coding agent's runs try, in order: how full each one is, whether it is at a
// limit, and a press that puts it first. Adding and removing need a sign-in, so they stay with the
// command, and in OpenAgent with Settings › Accounts.

/** How often the card asks again: a turn's usage shows here within this. */
const EVERY_MS = 30_000

const AGENTS = [
  { id: 'claude', name: 'Claude Code' },
  { id: 'codex', name: 'Codex' },
] as const

type AgentId = (typeof AGENTS)[number]['id']

/** An account, as `account-rotation list` prints it. */
interface Account {
  /** What the commands know it by. */
  name: string
  /** Who it is, for the person's own login while they gave it no name: what to call it. */
  who?: string
  own: boolean
  limitedUntil?: number
  windows?: { window: string; percentUsed: number; resetsAt: number }[]
}

type Accounts = Record<AgentId, Account[]>

/** What the card shows: the accounts, or why there are none. */
type Read = { ok: true; accounts: Accounts } | { ok: false; error: string }

async function readAccounts(host: SkillHost): Promise<Read> {
  const answer = await host.runComputerCommand(['list'])
  return answer.ok ? { ok: true, accounts: answer.output as Accounts } : answer
}

/** How long until `until`, in a few words. */
function inWords(until: number, now: number): string {
  const minutes = Math.ceil((until - now) / 60_000)
  if (minutes < 60) return `${Math.max(minutes, 1)} min`
  const hours = Math.round(minutes / 60)
  return hours < 48 ? `${hours} h` : `${Math.round(hours / 24)} days`
}

/** The line under an account's name: at a limit, how full its fullest window that has not reset yet is, or nothing known. */
function standing(account: Account, now: number): { text: string; limited: boolean } {
  if (account.limitedUntil !== undefined && account.limitedUntil > now) return { text: `At its limit, frees in ${inWords(account.limitedUntil, now)}`, limited: true }
  const live = (account.windows ?? []).filter(window => window.resetsAt > now)
  if (live.length === 0) return { text: 'No usage seen yet', limited: false }
  const fullest = live.reduce((a, b) => (b.percentUsed > a.percentUsed ? b : a))
  return { text: `${Math.round(fullest.percentUsed)}% used, resets in ${inWords(fullest.resetsAt, now)}`, limited: false }
}

/** Whether an agent's list says more than that there is its own login: a computer may not have that agent at all, and the list cannot tell. */
function saysSomething(accounts: Account[]): boolean {
  return accounts.length > 1 || accounts.some(account => account.limitedUntil !== undefined || (account.windows ?? []).length > 0)
}

function AgentAccounts({ agent, accounts, onUseFirst, busy }: { agent: (typeof AGENTS)[number]; accounts: Account[]; onUseFirst: (name: string) => void; busy: boolean }) {
  const now = Date.now()
  return (
    <section className="flex flex-col gap-1">
      <h4 className="text-xs font-medium text-muted-foreground">{agent.name}</h4>
      <ul className="flex flex-col gap-1">
        {accounts.map((account, index) => {
          const { text, limited } = standing(account, now)
          return (
            <li key={account.name} className="flex items-center justify-between gap-2 text-sm">
              <div className="min-w-0">
                <div className="truncate">{account.who ?? account.name}</div>
                <div className={limited ? 'truncate text-xs text-danger' : 'truncate text-xs text-muted-foreground'}>{text}</div>
              </div>
              {index === 0 ? (
                accounts.length > 1 && <span className="shrink-0 text-xs text-muted-foreground">First</span>
              ) : (
                <Button variant="outline" size="xs" className="shrink-0" disabled={busy} aria-label={`Use ${account.who ?? account.name} first`} onClick={() => onUseFirst(account.name)}>
                  Use first
                </Button>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}

export function AccountsCard(_props: ModuleCardProps) {
  const host = useSkillHost()
  const { value: read, loaded, reload } = usePolled<Read | undefined>(() => readAccounts(host), undefined, EVERY_MS, [], { remember: 'account-rotation:list', stored: true })
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

  const shown = read?.ok ? AGENTS.filter(agent => saysSomething(read.accounts[agent.id] ?? [])) : []
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Accounts</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {read === undefined && !loaded && <Skeleton className="h-16 w-full" />}
        {read?.ok === false && <p className="text-sm text-danger">{read.error}</p>}
        {shown.length === 0 && read?.ok && <p className="text-sm text-muted-foreground">Only this computer's own logins, with no usage seen yet.</p>}
        {read?.ok && shown.map(agent => <AgentAccounts key={agent.id} agent={agent} accounts={read.accounts[agent.id] ?? []} busy={busy} onUseFirst={name => putFirst(agent.id, name)} />)}
        {failed !== undefined && <p className="text-sm text-danger">{failed}</p>}
      </CardContent>
    </Card>
  )
}

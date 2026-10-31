import { useEffect, useRef, useState } from 'react'
import { Check, Copy, Plus } from 'lucide-react'
import { AccountBar, Button, Card, CardContent, CardHeader, CardTitle, ClaudeLogo, CodexLogo, Input, Skeleton, cn, usePolled, useSkillHost, type ModuleCardProps, type SkillHost } from '@openagt/skill-ui/module'

// The accounts each coding agent's runs try, in order: how full each one is, whether it is at a
// limit, a press that puts it first, and adding one: the command's own sign-in, which goes on by
// itself while the card follows it. Removing stays with the command, and in OpenAgent with Settings ›
// Accounts.

/** How often the order and the limits are asked again. */
const LIST_EVERY_MS = 30_000
/** How often how full each account is, is asked again: a slower answer, and Claude's own is kept for minutes anyway. */
const USAGE_EVERY_MS = 2 * 60_000
/** How often a sign-in under way is followed. */
const ADDING_EVERY_MS = 2_000

const AGENTS = [
  {
    id: 'claude',
    name: 'Claude Code',
    Logo: ClaudeLogo,
    logIn: 'Log in to Claude',
    help: "Opens this computer's browser, where you say yes once, signed in to that account. The login is kept on this computer alone and lasts a year.",
    adding: (name: string) => `Adding ${name}'s account: say yes in the page this computer's browser opened, signed in to ${name}'s Claude account.`,
  },
  {
    id: 'codex',
    name: 'Codex',
    Logo: CodexLogo,
    logIn: 'Log in to Codex',
    help: "Opens this computer's browser, where you sign in once to that account. If the browser is signed in to another account, copy the link into a private window. The login is kept on this computer alone.",
    adding: (name: string) => `Adding ${name}'s account: sign in to ${name}'s ChatGPT account in the page this computer's browser opened.`,
  },
] as const

type AgentId = (typeof AGENTS)[number]['id']

/** An account, as `account-rotation list` prints it. */
interface Account {
  /** What the commands know it by. */
  name: string
  /** Who it is, for the person's own login while they gave it no name: what to call it. */
  who?: string
  /** The agent has no login of the person's: this computer may not even have it, and it has no row. */
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

/** How adding stands for one agent, as `account-rotation adding` prints it. Never kept in the browser: it may hold a page to sign in at. */
interface AddingNow {
  adding?: { name: string; url?: string; code?: string; paste?: true }
  failed?: string
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

/** A sign-in under way: this computer's browser, or on a computer with none, the person's own device: Codex's code typed at its page, or Claude's page opened and its code pasted back here. */
function SigningIn({ agent, adding, onChanged }: { agent: (typeof AGENTS)[number]; adding: NonNullable<AddingNow['adding']>; onChanged: () => void }) {
  const host = useSkillHost()
  const [code, setCode] = useState('')
  const [error, setError] = useState<string>()
  const [copied, setCopied] = useState(false)
  const send = async (): Promise<void> => {
    setError(undefined)
    const done = await host.runComputerCommand(['add-code', agent.id], undefined, code)
    if (!done.ok) setError(done.error)
    onChanged()
  }
  const copy = (text: string): void =>
    void navigator.clipboard?.writeText(text).then(
      () => setCopied(true),
      () => {},
    )
  const copyIcon = copied ? <Check className="size-3.5" aria-hidden /> : <Copy className="size-3.5" aria-hidden />
  if (adding.code !== undefined && adding.url !== undefined)
    return (
      <div role="status" className="space-y-1.5 text-xs">
        <p className="text-muted-foreground">Type this code at the page below, signed in to the account to add:</p>
        <div className="flex flex-wrap items-center gap-2">
          <code className="rounded bg-muted px-2 py-1 font-mono text-sm font-medium tracking-wider">{adding.code}</code>
          <Button size="xs" variant="ghost" aria-label="Copy the code" onClick={() => copy(adding.code!)}>
            {copyIcon}
          </Button>
          <a href={adding.url} target="_blank" rel="noreferrer" className="text-[var(--color-primary)] underline-offset-2 hover:underline">
            {adding.url.replace(/^https:\/\//, '')}
          </a>
        </div>
      </div>
    )
  if (adding.paste && adding.url !== undefined)
    return (
      <div role="status" className="space-y-2">
        <a href={adding.url} target="_blank" rel="noreferrer" className="inline-flex h-9 items-center rounded-md border border-border px-3 text-sm hover:bg-accent">
          1. Open Claude and press Authorize ↗
        </a>
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={event => {
            event.preventDefault()
            void send()
          }}
        >
          <Input aria-label="Code from Claude" placeholder="2. Paste the code it shows" value={code} onChange={event => setCode(event.target.value)} className="h-9 min-w-0 flex-1 basis-40 text-sm" />
          <Button size="sm" type="submit" disabled={code.trim() === ''}>
            Done
          </Button>
        </form>
        {error !== undefined && (
          <p role="alert" className="text-xs text-danger">
            {error}
          </p>
        )}
      </div>
    )
  return (
    <div role="status" className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <p className="text-xs text-muted-foreground">{agent.adding(adding.name)}</p>
      {adding.url !== undefined && (
        <Button size="xs" variant="ghost" onClick={() => copy(adding.url!)}>
          {copyIcon}
          {copied ? 'Copied' : 'Copy link for a private window'}
        </Button>
      )}
    </div>
  )
}

/** The foot of an agent's accounts: asking whose account to add, the sign-in under way, and why the last one did not go through. */
function AddAccount({ agent, now, naming, onNaming, onChanged }: { agent: (typeof AGENTS)[number]; now: AddingNow; naming: boolean; onNaming: (naming: boolean) => void; onChanged: () => void }) {
  const host = useSkillHost()
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const run = async (args: string[], then?: () => void): Promise<void> => {
    setBusy(true)
    setError(undefined)
    const done = await host.runComputerCommand(args)
    setBusy(false)
    if (done.ok) then?.()
    else setError(done.error)
    onChanged()
  }
  const shownError = error ?? now.failed
  if (!now.adding && !naming && shownError === undefined) return null
  return (
    <div className="space-y-2 border-t border-border px-3 py-2.5 first:border-t-0">
      {now.adding ? (
        <>
          <SigningIn agent={agent} adding={now.adding} onChanged={onChanged} />
          <Button size="xs" variant="ghost" className="text-muted-foreground" disabled={busy} onClick={() => void run(['add-cancel', agent.id])}>
            Cancel
          </Button>
        </>
      ) : (
        naming && (
          <>
            <form
              className="flex flex-wrap items-center gap-2"
              onSubmit={event => {
                event.preventDefault()
                void run(['add', agent.id, name], () => {
                  onNaming(false)
                  setName('')
                })
              }}
            >
              <Input autoFocus aria-label="Whose account" placeholder="Whose account, e.g. Dani" value={name} onChange={event => setName(event.target.value)} className="h-8 min-w-0 flex-1 basis-32" />
              <Button size="sm" type="submit" disabled={busy || name.trim() === ''}>
                {agent.logIn}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                type="button"
                onClick={() => {
                  onNaming(false)
                  setError(undefined)
                }}
              >
                Cancel
              </Button>
            </form>
            <p className="text-xs text-muted-foreground">{agent.help}</p>
          </>
        )
      )}
      {shownError !== undefined && (
        <p role="alert" className="whitespace-pre-line text-xs text-danger">
          {shownError}
        </p>
      )}
    </div>
  )
}

function AgentAccounts({ agent, accounts, usage, reading, adding, onUseFirst, onChanged, busy }: { agent: (typeof AGENTS)[number]; accounts: Account[]; usage: Usage[]; reading: boolean; adding: AddingNow; onUseFirst: (name: string) => void; onChanged: () => void; busy: boolean }) {
  const [naming, setNaming] = useState(false)
  const now = Date.now()
  return (
    <section aria-label={agent.name} className="rounded-lg border border-border">
      <header className={cn('flex items-center gap-2 px-3 py-2.5', accounts.length > 0 && 'border-b border-border')}>
        <agent.Logo className="size-4 shrink-0" />
        <h4 className="flex-1 text-sm font-medium">{agent.name}</h4>
        {!naming && !adding.adding && (
          <Button size="xs" variant="ghost" onClick={() => setNaming(true)}>
            <Plus className="size-3.5" aria-hidden />
            Add account
          </Button>
        )}
      </header>
      <ul className="divide-y divide-border empty:hidden">
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
      <AddAccount agent={agent} now={adding} naming={naming} onNaming={setNaming} onChanged={onChanged} />
    </section>
  )
}

export function AccountsCard(_props: ModuleCardProps) {
  const host = useSkillHost()
  const { value: list, loaded, reload } = usePolled<Read<Account> | undefined>(() => read<Account>(host, 'list'), undefined, LIST_EVERY_MS, [], { remember: 'account-rotation:list', stored: true })
  const { value: usage, reload: reloadUsage } = usePolled<Read<Usage> | undefined>(() => read<Usage>(host, 'usage'), undefined, USAGE_EVERY_MS, [], { remember: 'account-rotation:usage', stored: true })
  // Followed closely from a press until the sign-in has ended, which the person may take minutes over.
  const [following, setFollowing] = useState(false)
  const { value: adding, reload: reloadAdding } = usePolled<Partial<Record<AgentId, AddingNow>> | undefined>(
    async () => {
      const answer = await host.runComputerCommand(['adding'])
      return answer.ok ? (answer.output as Partial<Record<AgentId, AddingNow>>) : undefined
    },
    undefined,
    following ? ADDING_EVERY_MS : LIST_EVERY_MS,
    [following],
    'previous',
  )
  const underWay = AGENTS.some(agent => adding?.[agent.id]?.adding !== undefined)
  const wasUnderWay = useRef(false)
  useEffect(() => {
    if (underWay) setFollowing(true)
    else if (wasUnderWay.current) {
      setFollowing(false)
      void reload()
      void reloadUsage()
    }
    wasUnderWay.current = underWay
    // Only when a sign-in starts or ends: the reads are the same from render to render in what they do.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [underWay])
  const changed = (): void => {
    setFollowing(true)
    void reloadAdding()
  }
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

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Accounts</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {list === undefined && !loaded && <Skeleton className="h-16 w-full" />}
        {list?.ok === false && <p className="text-sm text-danger">{list.error}</p>}
        {list?.ok &&
          AGENTS.map(agent => (
            <AgentAccounts
              key={agent.id}
              agent={agent}
              // A login that is not there has no row: the agent still has its press to add one, a server's first included.
              accounts={(list.accounts[agent.id] ?? []).filter(account => !account.signedOut)}
              usage={usage?.ok ? (usage.accounts[agent.id] ?? []) : []}
              reading={usage === undefined}
              adding={adding?.[agent.id] ?? {}}
              busy={busy}
              onUseFirst={name => putFirst(agent.id, name)}
              onChanged={changed}
            />
          ))}
        {failed !== undefined && <p className="text-sm text-danger">{failed}</p>}
      </CardContent>
    </Card>
  )
}

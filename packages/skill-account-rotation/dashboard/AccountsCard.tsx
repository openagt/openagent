import { useEffect, useRef, useState } from 'react'
import { Check, ChevronDown, Copy, Info, KeyRound, MoreHorizontal, Plus } from 'lucide-react'
import { Button, Card, CardContent, CardHeader, CardTitle, ClaudeLogo, CodexLogo, Dialog, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, GaugeFace, Input, Skeleton, Tooltip, TooltipContent, TooltipTrigger, cn, useModuleHost, usePolled, type ModuleCardProps, type ModuleHost } from '@openagt/dashboard/module'

// The accounts each coding agent's runs try, in order: how full each one is, whether it is at a
// limit, adding one: the command's own sign-in, which goes on by itself while the card follows it,
// in a dialog the "Add" at the card's title opens (his pick over a sign-in unfolding inside the card).
// A row looks as the Overview's other cards' do: the agent's mark, who, where it comes from, and how
// full it is in rings as Devices has them. Pressing it opens what can be done with it: putting it
// first, removing it, logging out.

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
    helpNoBrowser: "Gives you a page to open on your own device: press Authorize there, signed in to that account, and paste the code it shows back here. The login is kept on this server alone and lasts a year.",
    easiest: (computer: string) => `Easiest: add it on ${computer}, and it comes here by itself.`,
    remove: 'Runs no longer use it. Its login is not ended: take it back on claude.ai to end it.',
    adding: (name: string) => `Adding ${name}'s account: say yes in the page this computer's browser opened, signed in to ${name}'s Claude account.`,
  },
  {
    id: 'codex',
    name: 'Codex',
    Logo: CodexLogo,
    logIn: 'Log in to Codex',
    help: "Opens this computer's browser, where you sign in once to that account. If the browser is signed in to another account, copy the link into a private window. The login is kept on this computer alone.",
    helpNoBrowser: "Gives you a code to type at ChatGPT's page on your own device, signed in to that account: in a private window if the browser is signed in to another. If it asks, first allow device code sign-in in ChatGPT's security settings. The login is kept on this server alone.",
    easiest: (computer: string) => `Easiest: add it on ${computer} and press Allow there, and it comes here.`,
    remove: 'Runs no longer use it, and its login is taken off this computer.',
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
  /** The computer of the person's that handed it to this server. */
  from?: string
  /** Removed here it would only be handed over again: it is removed on that computer. */
  comesBack?: true
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
  adding?: { name: string; url?: string; code?: string; paste?: true; checking?: true; refused?: true }
  failed?: string
  /** This computer has no browser, a server: the person signs in on their own device. */
  noBrowser?: true
}

/** What a command answered: its output for each agent, or why there is none. A browser keeps this between visits, so a new version reads what an old one kept. */
type Read<T> = { ok: true; accounts: Record<AgentId, T[]> } | { ok: false; error: string }

async function read<T>(host: ModuleHost, word: string): Promise<Read<T>> {
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

/** What each usage window is called under its ring, and in a sentence. */
const WINDOWS: Record<string, { label: string; said: string }> = {
  five_hour: { label: '5 h', said: 'of 5 hours' },
  seven_day: { label: 'week', said: 'this week' },
  thirty_day: { label: 'month', said: 'this month' },
}

/** Where an account comes from, in a line. */
function source(account: Account): string {
  if (account.own) return account.computer !== undefined ? `login on ${account.computer}` : 'your login'
  if (account.from !== undefined) return `from ${account.from}`
  return account.added !== undefined ? `added ${new Date(account.added).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}` : 'added'
}

/** What is known of an account past its row: what it opens on. */
function details(account: Account, usage: Usage | undefined, next: boolean): string {
  const asOf = usage?.at !== undefined ? `Usage as of ${new Date(usage.at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}.` : undefined
  const unused = !usage?.windows.length && !account.own ? 'Not used yet.' : undefined
  return [asOf, unused, next ? 'Next in line.' : undefined].filter(word => word !== undefined).join(' ')
}

/** Whether a limit keeps an account out now. */
const isLimited = (account: Account, now: number): boolean => account.limitedUntil !== undefined && account.limitedUntil > now

/** The accounts a limit does not keep out, in the order runs try them. */
const freeOnes = (accounts: Account[], now: number): Account[] => accounts.filter(each => !isLimited(each, now))

/** What a code Claude did not take is told as: its page still has the right one. */
const REFUSED_WORDS = "Claude didn't take that code. Copy it whole from its page, and paste it again."

/** A sign-in under way: this computer's browser, or on a computer with none, the person's own device: Codex's code typed at its page, or Claude's page opened and its code pasted back here. */
function SigningIn({ agent, adding, noBrowser, onChanged }: { agent: (typeof AGENTS)[number]; adding: NonNullable<AddingNow['adding']>; noBrowser: boolean; onChanged: () => void }) {
  const host = useModuleHost()
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
        <p className="text-muted-foreground">Type this code at the page below, signed in to the account to add. If it asks, first allow device code sign-in in ChatGPT's security settings.</p>
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
          <Button size="sm" type="submit" disabled={code.trim() === '' || adding.checking === true}>
            {adding.checking ? 'Checking…' : 'Done'}
          </Button>
        </form>
        {(error ?? (adding.refused ? REFUSED_WORDS : undefined)) !== undefined && (
          <p role="alert" className="text-xs text-danger">
            {error ?? REFUSED_WORDS}
          </p>
        )}
      </div>
    )
  return (
    <div role="status" className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <p className="text-xs text-muted-foreground">{noBrowser ? `Adding ${adding.name}'s account: getting the page to sign in at…` : agent.adding(adding.name)}</p>
      {adding.url !== undefined && (
        <Button size="xs" variant="ghost" onClick={() => copy(adding.url!)}>
          {copyIcon}
          {copied ? 'Copied' : 'Copy link for a private window'}
        </Button>
      )}
    </div>
  )
}

/**
 * What the dialog that adds an account holds: asking whose account it is, the sign-in under way,
 * and why the last one did not go through. On a server that uses a computer's logins, `from`,
 * adding it there is said first: signing in here is the longer way. `onClose` closes the dialog,
 * which gives up a sign-in under way.
 */
function AddAccount({ agent, now, failed, from, onChanged, onClose }: { agent: (typeof AGENTS)[number]; now: AddingNow; failed: string | undefined; from: string | undefined; onChanged: () => void; onClose: () => void }) {
  const host = useModuleHost()
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [here, setHere] = useState(false)
  const start = async (): Promise<void> => {
    setBusy(true)
    setError(undefined)
    const done = await host.runComputerCommand(['add', agent.id, name])
    setBusy(false)
    if (!done.ok) setError(done.error)
    onChanged()
  }
  const shownError = error ?? failed
  return (
    <div className="space-y-3">
      {now.adding ? (
        <SigningIn agent={agent} adding={now.adding} noBrowser={now.noBrowser === true} onChanged={onChanged} />
      ) : from !== undefined && !here ? (
        <>
          <p className="text-sm">{agent.easiest(from)}</p>
          <Button size="sm" variant="outline" onClick={() => setHere(true)}>
            Sign in here instead
          </Button>
        </>
      ) : (
        <>
          <form
            className="flex flex-wrap items-center gap-2"
            onSubmit={event => {
              event.preventDefault()
              void start()
            }}
          >
            <Input autoFocus aria-label="Whose account" placeholder="Whose account, e.g. Dani" value={name} onChange={event => setName(event.target.value)} className="h-8 min-w-0 flex-1 basis-32" />
            <Button size="sm" type="submit" disabled={busy || name.trim() === ''}>
              {agent.logIn}
            </Button>
          </form>
          <p className="text-xs text-muted-foreground">{now.noBrowser ? agent.helpNoBrowser : agent.help}</p>
        </>
      )}
      {shownError !== undefined && (
        <p role="alert" className="whitespace-pre-line text-xs text-danger">
          {shownError}
        </p>
      )}
      <div className="flex justify-end">
        <Button size="sm" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </div>
  )
}

/** An open row, and the press that waits for a yes in it: taking an account off is a sign-in to undo. */
type Opened = { asking?: 'remove' | 'logout' }

function AgentAccounts({ agent, accounts, usage, reading, where, onPress, busy }: { agent: (typeof AGENTS)[number]; accounts: Account[]; usage: Usage[]; reading: boolean; where: ModuleCardProps['accountWhere']; onPress: (args: string[]) => void; busy: boolean }) {
  // One row is open at a time.
  const [open, setOpen] = useState<{ name: string } & Opened>()
  const now = Date.now()
  const free = freeOnes(accounts, now)
  const press = (args: string[]): void => {
    setOpen(undefined)
    onPress(args)
  }
  return (
    <section aria-label={agent.name} className="space-y-1 empty:hidden">
      {accounts.length > 0 && (
        <ul className="space-y-1">
          {accounts.map((account, index) => (
            <AccountRow
              key={account.name}
              agent={agent}
              account={account}
              reads={usage.find(each => each.name === account.name)}
              reading={reading}
              now={now}
              inUse={accounts.length > 1 && free[0] === account}
              next={accounts.length > 1 && free[1] === account}
              first={index === 0}
              where={where}
              open={open?.name === account.name ? open : undefined}
              onOpen={opened => setOpen(opened && { ...opened, name: account.name })}
              onPress={press}
              busy={busy}
            />
          ))}
        </ul>
      )}
    </section>
  )
}

/** One account's row: who it is, where it comes from, how full it is; pressed, what can be done with it. */
function AccountRow({
  agent,
  account,
  reads,
  reading,
  now,
  inUse,
  next,
  first,
  where,
  open,
  onOpen,
  onPress,
  busy,
}: {
  agent: (typeof AGENTS)[number]
  account: Account
  reads: Usage | undefined
  reading: boolean
  now: number
  /** Runs are on it now, of two accounts or more. */
  inUse: boolean
  /** Runs go to it next, of two accounts or more. */
  next: boolean
  /** First in the order already. */
  first: boolean
  where: ModuleCardProps['accountWhere']
  /** Undefined while the row is closed. */
  open: Opened | undefined
  onOpen: (open: Opened | undefined) => void
  onPress: (args: string[]) => void
  busy: boolean
}) {
  const limited = isLimited(account, now)
  const shown = account.who ?? account.name
  const isOpen = open !== undefined
  const more = details(account, reads, next)
  return (
    <li>
      <button
        type="button"
        aria-label={`Details of ${shown}`}
        aria-expanded={isOpen}
        onClick={() => onOpen(isOpen ? undefined : {})}
        className="group -mx-2 flex w-[calc(100%+1rem)] min-w-0 items-center gap-2.5 rounded-md px-2 py-1 text-left transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
      >
        <agent.Logo className="size-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-1.5 text-sm">
            <span className="min-w-0 truncate font-medium">{shown}</span>
            {inUse && <span className="shrink-0 text-xs text-success">in use</span>}
          </span>
          <span className={cn('block truncate text-xs', limited ? 'text-warning' : 'text-muted-foreground')}>{limited ? `limited, free in ${inWords(account.limitedUntil!, now)}` : source(account)}</span>
        </span>
        <MoreHorizontal className={cn('size-4 shrink-0 text-muted-foreground transition-opacity', isOpen ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100')} aria-hidden />
        {reading ? (
          <Skeleton className="size-8 shrink-0 rounded-full" />
        ) : (reads?.windows.length ?? 0) > 0 ? (
          <span className="flex shrink-0 gap-1.5">
            {reads!.windows.map(window => {
              const words = WINDOWS[window.window]
              const share = Math.round(window.percentUsed)
              return (
                <span key={window.window} role="meter" aria-label={words?.label ?? window.window} aria-valuenow={share} aria-valuemin={0} aria-valuemax={100} title={`${share}% ${words?.said ?? ''}`} className="flex w-8 flex-col items-center">
                  <GaugeFace label={words?.label ?? window.window} share={share} />
                </span>
              )
            })}
          </span>
        ) : (
          // Every row has its ring, so a row with nothing to say still lines up; a dash claims no number.
          <span title={account.own ? 'No reading of its usage yet' : 'Not used yet'} className="flex w-8 shrink-0 flex-col items-center">
            <GaugeFace label="usage" share={undefined} />
          </span>
        )}
      </button>
      {/* Where it works, as the page it is on says it (the Permissions page: the person's devices). */}
      {where && <div className="pl-[1.625rem]">{where({ agent: agent.id, own: account.own, name: account.name })}</div>}
      {isOpen && (
        <div className="space-y-1.5 pb-1.5 pl-[1.625rem] pt-1">
          {open.asking ? (
            <>
              <p className="text-xs text-muted-foreground">
                {open.asking === 'logout' ? `Logs ${agent.name} out on ${account.computer ?? 'this computer'}, your terminal too.` : agent.remove}
                {open.asking === 'remove' && account.from !== undefined ? ` It stays off until you press Allow on ${account.from}.` : ''}
              </p>
              <div role="group" aria-label={open.asking === 'logout' ? `Log out ${shown}` : `Remove ${shown}'s account`} className="flex items-center gap-1">
                <Button size="xs" variant="destructive" disabled={busy} onClick={() => onPress(open.asking === 'logout' ? ['logout', agent.id] : ['remove', agent.id, account.name])}>
                  {open.asking === 'logout' ? 'Log out' : 'Remove'}
                </Button>
                <Button size="xs" variant="ghost" disabled={busy} onClick={() => onOpen({})}>
                  Cancel
                </Button>
              </div>
            </>
          ) : (
            <>
              {more !== '' && <p className="text-xs text-muted-foreground">{more}</p>}
              <div className="-ml-2 flex items-center gap-1">
                {!first && (
                  <Button variant="ghost" size="xs" disabled={busy} aria-label={`Use ${shown} first`} onClick={() => onPress(['use-first', agent.id, account.name])}>
                    Use first
                  </Button>
                )}
                {account.own && (
                  <Button variant="ghost" size="xs" className="hover:text-danger" disabled={busy} aria-label={`Log out ${shown}`} onClick={() => onOpen({ asking: 'logout' })}>
                    Log out
                  </Button>
                )}
                {/* One a computer hands over as it is would be back within a minute: it is removed there. */}
                {!account.own && !account.comesBack && (
                  <Button variant="ghost" size="xs" className="hover:text-danger" disabled={busy} aria-label={`Remove ${shown}'s account`} onClick={() => onOpen({ asking: 'remove' })}>
                    Remove
                  </Button>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </li>
  )
}

export function AccountsCard({ accountWhere }: ModuleCardProps) {
  const host = useModuleHost()
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
  // The agent an account is being added for: the dialog is open on it, from the press until the account is there or the dialog is closed.
  const [naming, setNaming] = useState<AgentId>()
  // Why the last sign-in did not go through, once the person closed the dialog on it: not said again when it opens next.
  const [dismissed, setDismissed] = useState<string>()
  const signingIn = AGENTS.find(agent => adding?.[agent.id]?.adding !== undefined)?.id
  const underWay = signingIn !== undefined
  const wasUnderWay = useRef(false)
  useEffect(() => {
    if (underWay) {
      setFollowing(true)
      // A sign-in found under way, started before this page was opened, is shown as it is.
      setNaming(now => now ?? signingIn)
    } else if (wasUnderWay.current) {
      setFollowing(false)
      // The account is there: the dialog closes on it. One that did not go through stays, with why.
      setNaming(now => (now !== undefined && adding?.[now]?.failed === undefined ? undefined : now))
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

  const press = (args: string[]): void => {
    setBusy(true)
    setFailed(undefined)
    void host
      .runComputerCommand(args)
      .then(answer => {
        if (!answer.ok) setFailed(answer.error)
        return reload()
      })
      .finally(() => setBusy(false))
  }

  /** Closing the dialog gives up the sign-in under way, as its Cancel does. */
  const close = (): void => {
    const agent = naming
    setNaming(undefined)
    if (agent === undefined) return
    setDismissed(adding?.[agent]?.failed)
    if (adding?.[agent]?.adding) void host.runComputerCommand(['add-cancel', agent]).then(changed)
  }

  // Rotation does something only for an agent with two accounts or more.
  const shown = (agent: AgentId): Account[] => (list?.ok ? (list.accounts[agent] ?? []).filter(account => !account.signedOut) : [])
  const rotates = AGENTS.some(agent => shown(agent.id).length > 1)
  const none = list?.ok === true && AGENTS.every(agent => shown(agent.id).length === 0)
  const namingAgent = AGENTS.find(agent => agent.id === naming)
  const namingNow = (naming !== undefined ? adding?.[naming] : undefined) ?? {}

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-base">
            <span className="inline-flex items-center gap-2">
              <KeyRound className="h-4 w-4 text-muted-foreground" aria-hidden />
              Coding agent accounts
              {/* What this card's package does with them, said only where it does something: an agent with two accounts or more. */}
              {rotates && (
                <Tooltip>
                  <TooltipTrigger render={<button type="button" aria-label="What happens at an account's limit" className="font-normal text-muted-foreground hover:text-foreground" />}>
                    <Info className="h-3.5 w-3.5" aria-hidden />
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs">When an account hits its limit, the next free one of the same agent takes the run over where it stopped.</TooltipContent>
                </Tooltip>
              )}
            </span>
          </CardTitle>
          {/* Another account, at the card's title: whose agent it is for, then its sign-in in a dialog. With none yet, the presses are in the card. */}
          {list?.ok && !none && (
            <DropdownMenu>
              <DropdownMenuTrigger render={<Button size="sm" variant="outline" aria-label="Add an account" />}>
                <Plus className="size-3.5" aria-hidden />
                Add
                <ChevronDown className="size-3 opacity-70" aria-hidden />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-[10rem]">
                {AGENTS.map(agent => (
                  <DropdownMenuItem key={agent.id} aria-label={`Add ${agent.name} account`} onClick={() => setNaming(agent.id)}>
                    <agent.Logo className="size-3.5" />
                    {agent.name}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-1">
        {list === undefined && !loaded && <Skeleton className="h-16 w-full" />}
        {list?.ok === false && <p className="text-sm text-danger">{list.error}</p>}
        {list?.ok &&
          AGENTS.map(agent => (
            <AgentAccounts
              key={agent.id}
              agent={agent}
              // A login that is not there has no row: the card says so below, with the press to add one, a server's first included.
              accounts={shown(agent.id)}
              usage={usage?.ok ? (usage.accounts[agent.id] ?? []) : []}
              reading={usage === undefined}
              where={accountWhere}
              busy={busy}
              onPress={press}
            />
          ))}
        {failed !== undefined && <p className="text-sm text-danger">{failed}</p>}
        {/* A sign-in that did not go through while nobody watched it, a page opened since: said here, as the dialog is closed. */}
        {AGENTS.map(agent => {
          const why = adding?.[agent.id]?.failed
          return why !== undefined && why !== dismissed && naming !== agent.id ? (
            <p key={agent.id} role="alert" className="whitespace-pre-line text-xs text-danger">
              {`${agent.name}: ${why}`}
            </p>
          ) : null
        })}
        {/* No account at all: the press is said in the card too, where a newcomer looks, not only at its corner. */}
        {none && (
          <div className="flex flex-wrap items-center gap-2">
            <p className="min-w-0 flex-1 basis-48 text-sm text-muted-foreground">No account yet. Runs need one to start.</p>
            {AGENTS.map(agent => (
              <Button key={agent.id} size="sm" variant="outline" onClick={() => setNaming(agent.id)}>
                <agent.Logo className="size-3.5" />
                {agent.logIn}
              </Button>
            ))}
          </div>
        )}
      </CardContent>
      <Dialog open={namingAgent !== undefined} onOpenChange={open => !open && close()} title={namingAgent ? `Add a ${namingAgent.name} account` : ''}>
        {namingAgent && (
          <AddAccount
            key={namingAgent.id}
            agent={namingAgent}
            now={namingNow}
            failed={namingNow.failed !== dismissed ? namingNow.failed : undefined}
            from={list?.ok ? AGENTS.flatMap(each => list.accounts[each.id] ?? []).find(account => account.from !== undefined)?.from : undefined}
            onChanged={changed}
            onClose={close}
          />
        )}
      </Dialog>
    </Card>
  )
}

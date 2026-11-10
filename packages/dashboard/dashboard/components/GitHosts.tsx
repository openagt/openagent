import { useState } from 'react'
import { Check, ChevronDown, GitBranch, Loader2, MoreHorizontal, Plus } from 'lucide-react'
import type { GitHostHome } from '../../src/index.js'
import { sendForgetGitHostAccount, sendUseGitHostAccount, type GitHostRow, type GitHostsView } from '../rpc/logins.js'
import { onMachineGitHosts } from '../rpc/machines.js'
import { readAhead, usePolled } from '../lib/use-async.js'
import { cn } from '../lib/utils.js'
import { Button } from './ui/button.js'
import { Card, CardContent, CardHeader, CardTitle } from './ui/card.js'
import { HostFix, useAddGitAccount } from './AddGitAccount.js'
import { PackageLogo, hostWords, useGitHosts } from './Logins.js'
import { AccountWhere, useServers } from './ServerLogins.js'
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from './ui/dropdown-menu.js'
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip.js'
import { RowOff, rowButtonClass } from './ui/row-item.js'

// The git hosts of the Permissions page: one card, "Git host accounts", with a section for each
// host the projects' remotes are on and the host of the git host package OpenAgent brings, drawn
// from what the host's package answers (its name and logo, its tool, OpenAgent's own accounts
// there, the one runs use), so a host added later is one more section. Its rows are as the coding
// agents' accounts are, each with where it works under it. The accounts are
// OpenAgent's, added here: the person's own tool and its logins are never used. A host no package
// answers for is one line; a project with no remote, none.

/** The git hosts' card: a section for each host, by its package's name and logo, with its accounts. */
export function GitHostsCard() {
  const { view, reload } = useGitHosts()
  const adding = useAddGitAccount(reload)
  // The hosts an account can be added at: the ones a package answers for. With no account at any, the
  // press is the one in the host's own section, where what is missing is said: not a second one here.
  const withPackage = (view?.hosts ?? []).filter(row => row.provider)
  const hosts = withPackage.some(row => row.provider!.installed && row.provider!.accounts.length > 0) ? withPackage : []
  return (
    <Card>
      <CardHeader className="gap-1">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-base">
            <span className="inline-flex items-center gap-2">
              <GitBranch className="h-4 w-4 text-muted-foreground" aria-hidden />
              Git host accounts
            </span>
          </CardTitle>
          {/* Another account, at the card's title as the coding agents' card has it: the one host's dialog at once, a menu of them with more. */}
          {hosts.length === 1 && (
            <Button size="sm" variant="outline" aria-label={`Add a ${hosts[0]!.provider!.name} account`} onClick={() => adding.add(hosts[0]!.host)}>
              <Plus className="size-3.5" aria-hidden />
              Add
            </Button>
          )}
          {hosts.length > 1 && (
            <DropdownMenu>
              <DropdownMenuTrigger render={<Button size="sm" variant="outline" aria-label="Add a git host account" />}>
                <Plus className="size-3.5" aria-hidden />
                Add
                <ChevronDown className="size-3 opacity-70" aria-hidden />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-[10rem]">
                {hosts.map(row => (
                  <DropdownMenuItem key={row.host} onClick={() => adding.add(row.host)}>
                    <PackageLogo svg={row.provider!.logo} className="size-3.5" />
                    {row.provider!.name}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
        <p className="text-sm text-muted-foreground">Runs push with the one in use at each host, never your own login.</p>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {view && view.hosts.length === 0 ? (
          <p className="text-sm text-muted-foreground">None of your projects has a remote yet. A project pushed to a git host gets its accounts here.</p>
        ) : (
          (view?.hosts ?? []).map(row => (row.provider ? <HostAccounts key={row.host} row={row} onChanged={reload} /> : <NoPackage key={row.host} row={row} />))
        )}
      </CardContent>
      {adding.dialog}
    </Card>
  )
}

function usedBy(row: GitHostRow): string {
  return row.projects.length > 0 ? `Used by ${row.projects.join(', ')}` : 'No project on it yet'
}

function NoPackage({ row }: { row: GitHostRow }) {
  return (
    <p aria-label={row.host} className="rounded-lg border border-dashed border-border px-3 py-2.5 text-sm text-muted-foreground">
      <span className="font-medium text-foreground">{row.host}</span>
      {` · ${usedBy(row)}. No package for it yet.`}
    </p>
  )
}

function HostAccounts({ row, onChanged }: { row: GitHostRow; onChanged: () => Promise<void> }) {
  const p = row.provider!
  const [error, setError] = useState<string | undefined>()
  const servers = useServers()
  // The account whose removal waits for the person's yes, and the press under way: its words say so until the answer.
  const [removing, setRemoving] = useState<string | undefined>()
  const [pending, setPending] = useState<{ login: string; press: 'use' | 'remove' } | undefined>()
  const act = async (login: string, press: 'use' | 'remove', go: () => Promise<{ ok: true } | { ok: false; error: string }>) => {
    setPending({ login, press })
    setError(undefined)
    try {
      const done = await go()
      if (!done.ok) setError(done.error)
      setRemoving(undefined)
      // What the servers said of an account goes with it.
      await Promise.all([onChanged(), servers.reload()])
    } finally {
      setPending(undefined)
    }
  }
  const empty = !p.installed || p.accounts.length === 0
  return (
    <section aria-label={p.name} className="space-y-2">
      <header className="flex min-w-0 items-center gap-2">
        <PackageLogo svg={p.logo} />
        <h3 className="text-sm font-medium">{p.name}</h3>
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{usedBy(row)}</span>
      </header>
      {p.accounts.length > 0 && (
        <ul className="space-y-2">
          {p.accounts.map(account => {
            const busy = pending?.login === account.login
            return (
              <li key={account.login} aria-label={`@${account.login}`} className="flex min-w-0 items-start gap-2.5">
                <Avatar src={account.avatar} login={account.login} />
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex min-w-0 items-center gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">@{account.login}</p>
                      <p className={cn('truncate text-xs', account.ok ? 'text-muted-foreground' : 'text-warning')}>
                        {!account.ok ? `${p.name} no longer takes this login: add it again` : account.from !== undefined ? `from ${account.from}` : 'added to OpenAgent'}
                      </p>
                    </div>
                    {account.runs && (
                      <span className="inline-flex shrink-0 items-center gap-1 text-xs text-success">
                        <Check className="size-3.5" aria-hidden />
                        Runs use this
                      </span>
                    )}
                    <DropdownMenu>
                      <DropdownMenuTrigger aria-label={`More for @${account.login}`} disabled={pending !== undefined} className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground">
                        {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <MoreHorizontal className="size-4" aria-hidden />}
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="min-w-[11rem]">
                        {!account.runs && (
                          <DropdownMenuItem disabled={!account.ok} onClick={() => void act(account.login, 'use', () => sendUseGitHostAccount(row.host, account.login))}>
                            Use for runs
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuItem className="text-danger" onClick={() => setRemoving(account.login)}>
                          Remove
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                  {removing === account.login && (
                    <div role="group" aria-label={`Remove @${account.login}`} className="flex flex-wrap items-center gap-2 rounded-md bg-muted px-2.5 py-2 text-xs">
                      <p className="min-w-0 flex-1 basis-60">
                        {account.runs
                          ? `Runs use @${account.login}. Without it they have no ${p.name} account until you add one.`
                          : `OpenAgent forgets @${account.login}. The login goes on working wherever else it is.`}
                      </p>
                      <Button size="xs" variant="destructive" disabled={busy} onClick={() => void act(account.login, 'remove', () => sendForgetGitHostAccount(row.host, account.login))}>
                        {busy ? 'Removing…' : 'Remove'}
                      </Button>
                      <Button size="xs" variant="ghost" disabled={busy} onClick={() => setRemoving(undefined)}>
                        Cancel
                      </Button>
                    </div>
                  )}
                  {/* Where it works: this computer, and the person's servers that use its logins. */}
                  <AccountWhere account={{ kind: 'git', host: row.host, login: account.login }} />
                </div>
              </li>
            )
          })}
        </ul>
      )}
      {empty && (
        // What is missing on the left, its press at the row's end, as the Overview's first steps have them (a phone stacks them).
        <div className="flex items-center gap-3 pt-1 max-sm:flex-col max-sm:items-start">
          <p className="min-w-0 flex-1 text-xs text-muted-foreground">{hostWords(row)}</p>
          <div className="shrink-0">
            <HostFix row={row} onChanged={onChanged} />
          </div>
        </div>
      )}
      {error !== undefined && (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
    </section>
  )
}

/** An account's picture at its host, as its package said it; its first letter while there is none, or it does not load. */
function Avatar({ src, login }: { src: string | undefined; login: string }) {
  const [broken, setBroken] = useState(false)
  return (
    <span aria-hidden className="mt-0.5 flex size-7 shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted text-xs font-medium text-muted-foreground">
      {src && !broken ? <img src={src} alt="" referrerPolicy="no-referrer" className="size-full object-cover" onError={() => setBroken(true)} /> : login[0]?.toUpperCase()}
    </span>
  )
}

/** Where a saved machine's git hosts are remembered on the page: a switch back to it shows its account at once. */
const machineGitHostsKey = (machineId: string): string => `machine-git-hosts:${machineId}`

/** Ask a saved machine for its git hosts before it is picked, so the pick shows its account from its first frame. */
export function readMachineGitHostsAhead(machineId: string): void {
  readAhead(machineGitHostsKey(machineId), () => onMachineGitHosts(machineId))
}

/** A git host's accounts on the computer a run goes to: this computer's, or a saved machine's, asked there. */
function useGitHostsOn(machineId: string | undefined): GitHostsView | undefined {
  const own = useGitHosts()
  const theirs = usePolled<GitHostsView | null | undefined>(machineId !== undefined ? () => onMachineGitHosts(machineId) : null, undefined, 30_000, [machineId], machineId !== undefined ? { remember: machineGitHostsKey(machineId) } : undefined)
  return machineId === undefined ? own.view : (theirs.value ?? undefined)
}

/**
 * The account a session works as at the project's host, on the computer the run goes to: the one
 * picked for this session, while that computer still has it; else the one that computer's runs
 * use. Undefined with no account there.
 */
export function useSessionAccount(address: string | undefined, machineId: string | undefined, picked: string | undefined): string | undefined {
  const view = useGitHostsOn(machineId)
  const host = address?.split('/')[0]
  const accounts = view?.hosts.find(one => one.host === host)?.provider?.accounts
  return (picked !== undefined && accounts?.some(account => account.login === picked && account.ok) ? picked : undefined) ?? accounts?.find(account => account.runs)?.login
}

/**
 * The git host account a session pushes and opens its pull request with, under the message box
 * at the right: the project's host, on the computer the run goes to. Its menu picks another of
 * the accounts there, for this session only: the computer's own pick, which the Permissions page
 * makes, stays what it is; or adds one. A host with no account logged in says so, and its press
 * goes where one is. Nothing for a project with no remote, or a host no package answers for.
 */
export function GitAccountMenu({ address, machineId, on, busy, picked, onPick, onAddThere }: { address: string | undefined; machineId: string | undefined; on: string | undefined; busy: boolean; picked: string | undefined; onPick: (login: string) => void; /** Where another computer's accounts are added: its own page. */ onAddThere: () => void }) {
  const view = useGitHostsOn(machineId)
  const account = useSessionAccount(address, machineId, picked)
  // One added from here is the one this session works as.
  const adding = useAddGitAccount(login => onPick(login))
  const host = address?.split('/')[0]
  const row = host === undefined ? undefined : view?.hosts.find(one => one.host === host)
  const p = row?.provider
  if (!row || !p) return null
  const onAdd = machineId === undefined ? () => adding.add(row.host) : onAddThere
  if (account === undefined)
    return (
      <>
        <button type="button" disabled={busy} onClick={onAdd} className={cn(rowButtonClass, 'text-warning')}>
          <PackageLogo svg={p.logo} className="size-3.5" />
          <span className="truncate">{p.installed ? `Add a ${p.name} account` : `${p.tool} not installed`}</span>
        </button>
        {adding.dialog}
      </>
    )
  const said = `This session pushes and opens pull requests as @${account}${on !== undefined ? ` on ${on}` : ''}`
  return (
    <>
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger render={<DropdownMenuTrigger type="button" disabled={busy} aria-label={`${p.name} account: @${account}`} className={rowButtonClass} />}>
          <PackageLogo svg={p.logo} className="size-3.5" />
          <span className="max-w-32 truncate">@{account}</span>
          <ChevronDown className="h-3 w-3 shrink-0 opacity-70" aria-hidden />
        </TooltipTrigger>
        <TooltipContent>{said}</TooltipContent>
      </Tooltip>
      {/* Opens rightward from its button, and the tick leads its rows (his picks). */}
      <DropdownMenuContent align="start" className="min-w-[14rem]">
        <DropdownMenuGroup>
          <DropdownMenuLabel>{`${p.name} account for this session${on !== undefined ? `, on ${on}` : ''}`}</DropdownMenuLabel>
          {p.accounts.map(login => (
            <DropdownMenuItem key={login.login} disabled={!login.ok} onClick={() => onPick(login.login)}>
              <Check className={cn('h-3.5 w-3.5 shrink-0', login.login === account ? 'opacity-100' : 'opacity-0')} aria-hidden />
              <span className="flex-1 truncate">@{login.login}</span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={onAdd}>
          <Plus className="h-3.5 w-3.5 shrink-0 opacity-70" aria-hidden />
          Add account…
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
    {adding.dialog}
    </>
  )
}

/**
 * The project's git host under a session's message box at the right, where the launcher has the
 * account's menu: the account this run worked as, which its record keeps. A run recorded before that was
 * kept says the host's name: the one its project's runs use today need not be the one it pushed as.
 * Nothing for a project with no page on a git host, and until the logo is read, so it lands whole.
 */
export function GitHostOff({ home, account }: { home: GitHostHome | null; account?: string | undefined }) {
  const { view } = useGitHosts()
  if (!home || !view) return null
  const logo = view.hosts.find(row => row.host === home.url.split('/')[2])?.provider?.logo
  return (
    <RowOff tip={account !== undefined ? `This run works as @${account} on ${home.name}` : `This project is on ${home.name}`}>
      <button type="button" disabled className={rowButtonClass}>
        <PackageLogo svg={logo} className="size-3.5" />
        <span className="max-w-32 truncate">{account !== undefined ? `@${account}` : home.name}</span>
        <ChevronDown className="h-3 w-3 shrink-0 opacity-70" aria-hidden />
      </button>
    </RowOff>
  )
}

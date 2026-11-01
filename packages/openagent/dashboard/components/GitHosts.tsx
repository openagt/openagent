import { useState } from 'react'
import { Check, ChevronDown, GitBranch, Loader2, MoreHorizontal, Plus } from 'lucide-react'
import { sendForgetGitHostAccount, sendUseGitHostAccount, type GitHostRow, type GitHostsView } from '../rpc/logins.js'
import { onMachineGitHosts, sendMachineGitHostAccount } from '../rpc/machines.js'
import { readAhead, usePolled, cn, Button, Card, CardContent, CardHeader, CardTitle } from '@openagt/skill-ui/module'
import { DeviceCode, HostFix, PackageLogo, StatePill, hostLoginState, hostWords, useGitHosts, useHostLogin } from './Logins.js'
import { useServers } from './ServerLogins.js'
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from './ui/dropdown-menu.js'
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip.js'
import { rowButtonClass } from './ui/row-item.js'

// The git hosts of Settings › Accounts: one card with each host the projects' remotes are on, and the
// host of the git host package OpenAgent brings, drawn from what the host's package answers (its
// name, its tool, the accounts the tool knows, the one runs use). Runs use the account picked here,
// whatever the terminal's tool has active, and a switch here leaves the terminal as it is. A host
// no package answers for is one line; a project with no remote, none.

/** The git hosts' card. */
export function GitHostsCard() {
  const { view, reload } = useGitHosts()
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          <span className="inline-flex items-center gap-2">
            <GitBranch className="h-4 w-4 text-muted-foreground" aria-hidden />
            Git hosts
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {view && view.hosts.length === 0 ? (
          <p className="text-sm text-muted-foreground">None of your projects has a remote yet. A project pushed to a git host gets its accounts here.</p>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">The accounts runs open pull requests and push with. A switch here changes what runs use; the terminal keeps its own.</p>
            {(view?.hosts ?? []).map(row => (row.provider ? <HostAccounts key={row.host} row={row} onChanged={reload} /> : <NoPackage key={row.host} row={row} />))}
          </>
        )}
      </CardContent>
    </Card>
  )
}

function usedBy(row: GitHostRow): string {
  return row.projects.length > 0 ? `used by ${row.projects.join(', ')}` : 'no project on it yet'
}

function NoPackage({ row }: { row: GitHostRow }) {
  return (
    <p aria-label={row.host} className="rounded-lg border border-dashed border-border px-3 py-2.5 text-sm text-muted-foreground">
      <span className="font-medium text-foreground">{row.host}</span>
      {` · ${usedBy(row)} · no package for it yet`}
    </p>
  )
}

function HostAccounts({ row, onChanged }: { row: GitHostRow; onChanged: () => Promise<void> }) {
  const p = row.provider!
  const state = hostLoginState(row)!
  const [error, setError] = useState<string | undefined>()
  const login = useHostLogin(onChanged)
  const servers = useServers()
  // The row that is open, and the press under way, on which account: its button says so until the answer.
  const [open, setOpen] = useState<string | undefined>()
  const [pending, setPending] = useState<{ login: string; press: 'use' | 'remove' } | undefined>()
  const act = async (login: string, press: 'use' | 'remove', go: () => Promise<{ ok: true } | { ok: false; error: string }>) => {
    setPending({ login, press })
    setError(undefined)
    try {
      const done = await go()
      if (!done.ok) setError(done.error)
      // What the servers said of an account goes with it.
      await Promise.all([onChanged(), servers.reload()])
    } finally {
      setPending(undefined)
    }
  }
  const pressing = (login: string, press: 'use' | 'remove'): boolean => pending?.login === login && pending.press === press
  const shownError = error ?? login.error
  return (
    <section aria-label={p.name} className="space-y-1">
      <header className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <PackageLogo svg={p.logo} />
        <h3 className="text-sm font-medium">{p.name}</h3>
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{`${row.host} · ${usedBy(row)}`}</span>
        <StatePill state={state} />
      </header>
      {p.accounts.length > 0 && (
        <ul className="space-y-1">
          {p.accounts.map(account => {
            const isOpen = open === account.login
            return (
              <li key={account.login} aria-label={`@${account.login}`}>
                <button
                  type="button"
                  aria-label={`Details of @${account.login}`}
                  aria-expanded={isOpen}
                  onClick={() => setOpen(isOpen ? undefined : account.login)}
                  className="group -mx-2 flex w-[calc(100%+1rem)] min-w-0 items-center gap-2.5 rounded-md px-2 py-1 text-left transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
                >
                  <span className="min-w-0 flex-1">
                    <span className="flex min-w-0 items-center gap-1.5 text-sm">
                      <span className="min-w-0 truncate font-medium">@{account.login}</span>
                      {account.runs && <span className="shrink-0 text-xs text-success">in use for runs</span>}
                    </span>
                    <span className={cn('block truncate text-xs', account.ok ? 'text-muted-foreground' : 'text-warning')}>
                      {!account.ok ? `${p.name} no longer takes this login: add it again` : account.from !== undefined ? `from ${account.from}` : account.terminal ? "the terminal's account" : `logged in to ${p.tool}`}
                    </span>
                  </span>
                  {!account.runs && <MoreHorizontal className={cn('size-4 shrink-0 text-muted-foreground transition-opacity', isOpen ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100')} aria-hidden />}
                </button>
                {isOpen && (
                  <div className="-ml-2 flex items-center gap-1 pb-1.5 pt-1">
                    {account.runs ? (
                      // The account runs use is never taken off: another is picked first.
                      <p className="pl-2 text-xs text-muted-foreground">Runs use this account. To take it off, pick another first.</p>
                    ) : (
                      <>
                        <Button size="xs" variant="ghost" disabled={pending !== undefined || !account.ok} onClick={() => void act(account.login, 'use', () => sendUseGitHostAccount(row.host, account.login))}>
                          {pressing(account.login, 'use') && <Loader2 className="size-3 animate-spin" aria-hidden />}
                          {pressing(account.login, 'use') ? 'Switching…' : 'Use for runs'}
                        </Button>
                        <Button size="xs" variant="ghost" className="hover:text-danger" disabled={pending !== undefined} aria-label={`Remove @${account.login}`} title={`${p.tool} on this computer forgets it. The login is not ended: it goes on working wherever else it is.`} onClick={() => void act(account.login, 'remove', () => sendForgetGitHostAccount(row.host, account.login))}>
                          {pressing(account.login, 'remove') && <Loader2 className="size-3 animate-spin" aria-hidden />}
                          {pressing(account.login, 'remove') ? 'Removing…' : 'Remove'}
                        </Button>
                      </>
                    )}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
      {!p.installed || p.accounts.length === 0 ? (
        <div className="space-y-2 pt-1">
          <p className="text-xs text-muted-foreground">{hostWords(row)}</p>
          <HostFix row={row} onChanged={onChanged} />
        </div>
      ) : p.loggingIn ? (
        <DeviceCode code={p.loggingIn.code} url={p.loggingIn.url} />
      ) : (
        <Button size="xs" variant="ghost" className="-ml-2 font-normal" disabled={login.busy} title={`Logs another account in to ${p.tool} with a code you type at ${p.name}. The terminal's account stays as it is.`} onClick={() => void login.start(row.host)}>
          {login.busy ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Plus className="size-3.5" aria-hidden />}
          Add account
        </Button>
      )}
      {shownError !== undefined && (
        <p role="alert" className="text-xs text-danger">
          {shownError}
        </p>
      )}
    </section>
  )
}

/** Where a saved machine's git hosts are remembered on the page: a switch back to it shows its account at once. */
const machineGitHostsKey = (machineId: string): string => `machine-git-hosts:${machineId}`

/** Ask a saved machine for its git hosts before it is picked, so the pick shows its account from its first frame. */
export function readMachineGitHostsAhead(machineId: string): void {
  readAhead(machineGitHostsKey(machineId), () => onMachineGitHosts(machineId))
}

/** A git host's accounts on the computer a run goes to: this computer's, or a saved machine's, asked there. A pick is the one its runs push with, there. */
export function useGitHostsOn(machineId: string | undefined): { view: GitHostsView | undefined; pick: (host: string, login: string) => Promise<void> } {
  const own = useGitHosts()
  const theirs = usePolled<GitHostsView | null | undefined>(machineId !== undefined ? () => onMachineGitHosts(machineId) : null, undefined, 30_000, [machineId], machineId !== undefined ? { remember: machineGitHostsKey(machineId) } : undefined)
  if (machineId === undefined) return { view: own.view, pick: (host, login) => sendUseGitHostAccount(host, login).then(own.reload) }
  return { view: theirs.value ?? undefined, pick: (host, login) => sendMachineGitHostAccount(machineId, host, login).then(theirs.reload) }
}

/**
 * The git host account a run pushes and opens its pull request with, at the end of the row above
 * the message box: the project's host, on the computer the run goes to. Its menu picks another of
 * the accounts there, the one its runs use from then on, as Settings › Accounts does; or adds one.
 * A host with no account logged in says so, and its press goes where one is. Nothing for a project
 * with no remote, or a host no package answers for.
 */
export function GitAccountMenu({ address, machineId, on, busy, onAdd }: { address: string | undefined; machineId: string | undefined; on: string | undefined; busy: boolean; onAdd: () => void }) {
  const { view, pick } = useGitHostsOn(machineId)
  const host = address?.split('/')[0]
  const row = host === undefined ? undefined : view?.hosts.find(one => one.host === host)
  const p = row?.provider
  if (!row || !p) return null
  const runs = p.accounts.find(account => account.runs)
  if (!runs)
    return (
      <button type="button" disabled={busy} onClick={onAdd} className={cn(rowButtonClass, 'text-warning')}>
        <PackageLogo svg={p.logo} className="size-3.5" />
        <span className="truncate">{p.installed ? `Log in to ${p.name}` : `${p.tool} not installed`}</span>
      </button>
    )
  const said = `Runs push and open pull requests as @${runs.login}${on !== undefined ? ` on ${on}` : ''}`
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger render={<DropdownMenuTrigger type="button" disabled={busy} aria-label={`${p.name} account: @${runs.login}`} className={rowButtonClass} />}>
          <PackageLogo svg={p.logo} className="size-3.5" />
          <span className="max-w-32 truncate">@{runs.login}</span>
          <ChevronDown className="h-3 w-3 shrink-0 opacity-70" aria-hidden />
        </TooltipTrigger>
        <TooltipContent>{said}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" className="min-w-[14rem]">
        <DropdownMenuGroup>
          <DropdownMenuLabel>{`${p.name} account${on !== undefined ? ` on ${on}` : ''}`}</DropdownMenuLabel>
          {p.accounts.map(account => (
            <DropdownMenuItem key={account.login} closeOnClick={false} disabled={!account.ok} onClick={() => void pick(row.host, account.login)}>
              <Check className={cn('h-3.5 w-3.5 shrink-0', account.runs ? 'opacity-100' : 'opacity-0')} aria-hidden />
              <span className="flex-1 truncate">@{account.login}</span>
              {account.terminal && <span className="text-xs text-muted-foreground">terminal</span>}
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
  )
}

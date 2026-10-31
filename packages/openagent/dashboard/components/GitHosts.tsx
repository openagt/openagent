import { useState } from 'react'
import { Check, ChevronDown, Loader2, Plus } from 'lucide-react'
import { sendForgetGitHostAccount, sendUseGitHostAccount, type GitHostRow, type GitHostsView } from '../rpc/logins.js'
import { onMachineGitHosts, sendMachineGitHostAccount } from '../rpc/machines.js'
import { readAhead, usePolled, cn, Button } from '@openagt/skill-ui/module'
import { DeviceCode, HostFix, PackageLogo, StatePill, hostLoginState, hostWords, useGitHosts, useHostLogin } from './Logins.js'
import { LeftNotices, ServerNotes, useServers } from './ServerLogins.js'
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from './ui/dropdown-menu.js'
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip.js'
import { rowButtonClass } from './ui/row-item.js'

// The git hosts of Settings › Accounts: one card per host the projects' remotes are on, and the
// host of the git host package OpenAgent brings, drawn from what the host's package answers (its
// name, its tool, the accounts the tool knows, the one runs use). Runs use the account picked here,
// whatever the terminal's tool has active, and a switch here leaves the terminal as it is. A host
// no package answers for is one line; a project with no remote, none.

/** The git hosts' cards. */
export function GitHostCards() {
  const { view, reload } = useGitHosts()
  if (view && view.hosts.length === 0) return <p className="text-sm text-muted-foreground">None of your projects has a remote yet. A project pushed to a git host gets its card here.</p>
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">The accounts runs open pull requests and push with. A switch here changes what runs use; the terminal keeps its own.</p>
      {(view?.hosts ?? []).map(row => (row.provider ? <HostCard key={row.host} row={row} onChanged={reload} /> : <NoPackage key={row.host} row={row} />))}
    </div>
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

function HostCard({ row, onChanged }: { row: GitHostRow; onChanged: () => Promise<void> }) {
  const p = row.provider!
  const state = hostLoginState(row)!
  const [error, setError] = useState<string | undefined>()
  const login = useHostLogin(onChanged)
  const servers = useServers()
  // The press under way, on which account: its button says so until the answer.
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
  return (
    <section aria-label={p.name} className="rounded-lg border border-border">
      <header className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-border px-3 py-2.5">
        <PackageLogo svg={p.logo} />
        <h3 className="text-sm font-medium">{p.name}</h3>
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{`${row.host} · ${usedBy(row)}`}</span>
        <StatePill state={state} />
        {p.installed && p.accounts.length > 0 && !p.loggingIn && (
          <Button size="xs" variant="ghost" disabled={login.busy} title={`Logs another account in to ${p.tool} with a code you type at ${p.name}. The terminal's account stays as it is.`} onClick={() => void login.start(row.host)}>
            {login.busy ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Plus className="size-3.5" aria-hidden />}
            Add account
          </Button>
        )}
      </header>
      {p.accounts.length > 0 && (
        <ul className="divide-y divide-border">
          {p.accounts.map(account => (
            <li key={account.login} aria-label={`@${account.login}`} className="space-y-2 px-3 py-2.5">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm">@{account.login}</p>
                  <p className={cn('truncate text-xs', account.ok ? 'text-muted-foreground' : 'text-warning')}>
                    {!account.ok ? `${p.name} no longer takes this login: add it again` : account.from !== undefined ? `from ${account.from}` : account.terminal ? "the terminal's account" : `logged in to ${p.tool}`}
                  </p>
                </div>
                {account.runs ? (
                  <span className="text-xs font-medium text-success">in use for runs</span>
                ) : (
                  <div className="flex items-center gap-1">
                    <Button size="xs" variant="ghost" disabled={pending !== undefined || !account.ok} onClick={() => void act(account.login, 'use', () => sendUseGitHostAccount(row.host, account.login))}>
                      {pressing(account.login, 'use') && <Loader2 className="size-3 animate-spin" aria-hidden />}
                      {pressing(account.login, 'use') ? 'Switching…' : 'Use for runs'}
                    </Button>
                    {/* The account runs use is never taken off: another is picked first. */}
                    <Button size="xs" variant="ghost" disabled={pending !== undefined} aria-label={`Remove @${account.login}`} title={`${p.tool} on this computer forgets it. The login is not ended: it goes on working wherever else it is.`} onClick={() => void act(account.login, 'remove', () => sendForgetGitHostAccount(row.host, account.login))}>
                      {pressing(account.login, 'remove') && <Loader2 className="size-3 animate-spin" aria-hidden />}
                      {pressing(account.login, 'remove') ? 'Removing…' : 'Remove'}
                    </Button>
                  </div>
                )}
              </div>
              <ServerNotes row={{ kind: 'git', host: row.host, source: account.login }} />
            </li>
          ))}
        </ul>
      )}
      <LeftNotices kind="git" host={row.host} />
      {/* The foot holds what is missing, or the code of the account being added: "Add account" is in the header once there is one. */}
      {(!p.installed || p.accounts.length === 0 || p.loggingIn || (error ?? login.error) !== undefined) && (
        <div className={cn('px-3 py-2.5', p.accounts.length > 0 && 'border-t border-border')}>
          {!p.installed || p.accounts.length === 0 ? (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">{hostWords(row)}</p>
              <HostFix row={row} onChanged={onChanged} />
            </div>
          ) : (
            p.loggingIn && <DeviceCode code={p.loggingIn.code} url={p.loggingIn.url} />
          )}
          {(error ?? login.error) !== undefined && (
            <p role="alert" className="mt-1.5 text-xs text-danger">
              {error ?? login.error}
            </p>
          )}
        </div>
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

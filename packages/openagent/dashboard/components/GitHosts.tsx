import { useState } from 'react'
import { Check, Plus } from 'lucide-react'
import { sendForgetGitHostAccount, sendUseGitHostAccount, type GitHostRow } from '../rpc/logins.js'
import { cn } from '../lib/utils.js'
import { ACCOUNTS_ENTRY, DeviceCode, HostFix, PackageLogo, StatePill, hostLoginState, hostWords, useGitHosts, useHostLogin } from './Logins.js'
import { LeftNotices, ServerNotes } from './ServerLogins.js'
import { Button } from './ui/button.js'
import { DropdownMenuItem, DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger } from './ui/dropdown-menu.js'

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
  const [busy, setBusy] = useState(false)
  const act = async (go: () => Promise<{ ok: true } | { ok: false; error: string }>) => {
    setBusy(true)
    setError(undefined)
    try {
      const done = await go()
      if (!done.ok) setError(done.error)
      await onChanged()
    } finally {
      setBusy(false)
    }
  }
  return (
    <section aria-label={p.name} className="rounded-lg border border-border">
      <header className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-border px-3 py-2.5">
        <PackageLogo svg={p.logo} />
        <h3 className="text-sm font-medium">{p.name}</h3>
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{`${row.host} · ${usedBy(row)}`}</span>
        <StatePill state={state} />
      </header>
      {p.accounts.length > 0 && (
        <ul className="divide-y divide-border">
          {p.accounts.map(account => (
            <li key={account.login} aria-label={`@${account.login}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5">
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
                  <Button size="xs" variant="ghost" disabled={busy || !account.ok} onClick={() => void act(() => sendUseGitHostAccount(row.host, account.login))}>
                    Use for runs
                  </Button>
                  {/* The account runs use is never taken off: another is picked first. */}
                  <Button size="xs" variant="ghost" disabled={busy} aria-label={`Remove @${account.login}`} title={`${p.tool} on this computer forgets it. The login is not ended: it goes on working wherever else it is.`} onClick={() => void act(() => sendForgetGitHostAccount(row.host, account.login))}>
                    Remove
                  </Button>
                </div>
              )}
              <ServerNotes row={{ kind: 'git', host: row.host, source: account.login }} />
            </li>
          ))}
        </ul>
      )}
      <LeftNotices kind="git" host={row.host} />
      <div className={cn('px-3 py-2.5', p.accounts.length > 0 && 'border-t border-border')}>
        {!p.installed || p.accounts.length === 0 ? (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">{hostWords(row)}</p>
            <HostFix row={row} onChanged={onChanged} />
          </div>
        ) : p.loggingIn ? (
          <DeviceCode code={p.loggingIn.code} url={p.loggingIn.url} />
        ) : (
          <>
            <Button size="sm" variant="ghost" disabled={login.busy} onClick={() => void login.start(row.host)}>
              <Plus className="size-3.5" aria-hidden />
              Add account
            </Button>
            <p className="mt-1.5 text-xs text-muted-foreground">{`Logs another account in to ${p.tool} with a code you type at ${p.name}. The terminal's account stays as it is.`}</p>
          </>
        )}
        {(error ?? login.error) !== undefined && (
          <p role="alert" className="mt-1.5 text-xs text-danger">
            {error ?? login.error}
          </p>
        )}
      </div>
    </section>
  )
}

/** The person's menu: a row per git host with an account, the one runs use; its submenu picks another, or adds one. */
export function GitHostsSubmenu({ onSettings }: { onSettings: (entry: string) => void }) {
  const { view, reload } = useGitHosts()
  const rows = (view?.hosts ?? []).filter(row => row.provider)
  if (rows.length === 0) return null
  return (
    <>
      {rows.map(row => {
        const p = row.provider!
        const runs = p.accounts.find(a => a.runs)
        if (!runs)
          return (
            <DropdownMenuItem key={row.host} onClick={() => onSettings(ACCOUNTS_ENTRY)}>
              <PackageLogo svg={p.logo} className="size-3.5" />
              <span className="flex-1">{p.name}</span>
              <span className="text-warning">{p.installed ? 'Log in' : 'Not installed'}</span>
            </DropdownMenuItem>
          )
        return (
          <DropdownMenuSub key={row.host}>
            <DropdownMenuSubTrigger>
              <PackageLogo svg={p.logo} className="size-3.5" />
              <span className="flex-1">{p.name}</span>
              <span className="max-w-32 truncate text-muted-foreground">@{runs.login}</span>
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="min-w-[14rem]">
              {p.accounts.map(account => (
                <DropdownMenuItem key={account.login} closeOnClick={false} disabled={!account.ok} onClick={() => void sendUseGitHostAccount(row.host, account.login).then(reload)}>
                  <Check className={cn('h-3.5 w-3.5 shrink-0', account.runs ? 'opacity-100' : 'opacity-0')} aria-hidden />
                  <span className="flex-1 truncate">@{account.login}</span>
                  {account.terminal && <span className="text-xs text-muted-foreground">terminal</span>}
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => onSettings(ACCOUNTS_ENTRY)}>
                <Plus className="h-3.5 w-3.5 shrink-0 opacity-70" aria-hidden />
                Add account…
              </DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        )
      })}
    </>
  )
}

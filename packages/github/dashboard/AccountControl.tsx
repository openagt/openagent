import { useEffect } from 'react'
import { Plus } from 'lucide-react'
import {
  MenuTick,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  NO_PROJECT,
  PackageLogo,
  SetupLine,
  SetupPress,
  SetupSaid,
  cn,
  nextRunAgain,
  tellNextRunPicked,
  useModuleHost,
  usePolled,
  type UiComposerControlProps,
} from '@openagt/ui/module'
import type { RunOptions } from '@openagt/hooks'
import { Avatar } from './Accounts.js'
import { useAddAccount } from './AddAccount.js'
import { server, useAccounts, type AccountsRead } from './calls.js'

// The GitHub account a session pushes and opens its pull request with, a line of the gear's menu
// under the message box (`composer.control` at `setup`). Drawn where the project is on GitHub, and
// for a session with no project, which may reach GitHub all the same: a clone, a new repository,
// the person's pull requests.
//
// In the launcher its list picks the account every next run on this computer works as (the
// catalog's `PICKED_GITHUB_ACCOUNT`, which a run reads where its options name none), or adds one;
// with none picked, the one runs use (Permissions › Use for runs). With no account, the line says
// so, and its press adds one. In a session it says the account its record keeps: a run recorded
// before that was kept says it was not. In a profile's editor it is the profile's account, or none,
// whatever the computer uses.

/** The run options with github's account set, or taken out. */
function withAccount(options: RunOptions, login: string | undefined): RunOptions {
  const { github: was, ...rest } = options
  const { account: _old, ...github } = was ?? {}
  const kept = login !== undefined ? { ...github, account: login } : github
  return Object.keys(kept).length > 0 ? { ...rest, github: kept } : rest
}

/** The account of `read` that `login` names and GitHub still takes; else the one runs use. */
function inForce(read: AccountsRead | undefined, login: string | undefined): string | undefined {
  const accounts = read?.accounts
  return (login !== undefined && accounts?.some(account => account.login === login && account.ok) ? login : undefined) ?? accounts?.find(account => account.runs)?.login
}

export function AccountControl(props: UiComposerControlProps) {
  const host = useModuleHost()
  const { accounts, reload } = useAccounts()
  // Whether the box's project is on GitHub: a session with no project may reach it too.
  const where = usePolled(() => server(host).where(props.projectId ?? NO_PROJECT, {}), undefined, 60_000, [props.projectId], { remember: `github:where:${props.projectId ?? ''}` }).value
  const shown = where?.github === true && accounts !== undefined
  if (!shown) return <Silent say={props.say} />
  if (props.in === 'session') return <SessionAccount accounts={accounts} account={props.options.github?.account} say={props.say} />
  if (props.in === 'profile') return <ProfileAccount {...props} accounts={accounts} onAdded={reload} />
  return <LauncherAccount {...props} accounts={accounts} onAdded={reload} />
}

/** Nothing drawn, and nothing said of it. */
function Silent({ say }: Pick<UiComposerControlProps, 'say'>) {
  useEffect(() => say(undefined), [say])
  return null
}

const LOGO = (read: AccountsRead) => <PackageLogo svg={read.logo} className="size-4" />

function Login({ read, login }: { read: AccountsRead; login: string }) {
  return (
    <>
      <Avatar src={read.accounts.find(one => one.login === login)?.avatar} login={login} />
      <span className="truncate">@{login}</span>
    </>
  )
}

/** The launcher's line: the account every next run works as, picked here. */
function LauncherAccount({ accounts: read, options, busy, say, onAdded }: UiComposerControlProps & { accounts: AccountsRead; onAdded: () => Promise<void> }) {
  const host = useModuleHost()
  const profile = options.profiles?.profile
  const { value: picked, reload } = usePolled(() => server(host).picked(NO_PROJECT, profile !== undefined ? { profile } : {}), undefined, 30_000, [profile], { remember: `github:picked:${profile ?? ''}`, stored: true }, nextRunAgain)
  const pick = async (login: string) => {
    await server(host).pick(NO_PROJECT, { login })
    tellNextRunPicked()
    await reload()
  }
  // One added from here is the one every next run works as.
  const adding = useAddAccount(async login => (await onAdded(), await pick(login)))
  const account = inForce(read, options.github?.account ?? picked?.login)
  const label = `${read.name} account`
  const said = account !== undefined ? `@${account}` : read.installed ? `no ${read.name} account` : `${read.tool} not installed`
  useEffect(() => say({ words: said, ...(account === undefined ? { warn: true } : {}) }), [say, said, account])
  if (account === undefined) {
    return (
      <>
        <SetupPress icon={LOGO(read)} label={label} value={read.installed ? 'Add one…' : `${read.tool} not installed`} onClick={adding.add} />
        {adding.dialog}
      </>
    )
  }
  return (
    <>
      <SetupLine icon={LOGO(read)} label={label} value={<Login read={read} login={account} />} className="min-w-[14rem]" disabled={busy}>
        <DropdownMenuGroup>
          <DropdownMenuLabel>{`${read.name} account for every next session`}</DropdownMenuLabel>
          {/* The tick at the row's end, as every menu's (his pick, 2026-11-27). */}
          {read.accounts.map(one => (
            <DropdownMenuItem key={one.login} disabled={!one.ok} onClick={() => void pick(one.login)}>
              <span className="flex-1 truncate">@{one.login}</span>
              <MenuTick on={one.login === account} />
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={adding.add}>
          <Plus className="h-3.5 w-3.5 shrink-0 opacity-70" aria-hidden />
          Add account…
        </DropdownMenuItem>
      </SetupLine>
      {adding.dialog}
    </>
  )
}

/** A session's line: the account its record keeps, said and not offered. */
function SessionAccount({ accounts: read, account, say }: { accounts: AccountsRead; account: string | undefined; say: UiComposerControlProps['say'] }) {
  useEffect(() => say(account !== undefined ? { words: `@${account}` } : undefined), [say, account])
  return (
    <SetupSaid
      icon={LOGO(read)}
      label={`${read.name} account`}
      value={account !== undefined ? <Login read={read} login={account} /> : 'Not recorded'}
      tip={account !== undefined ? `This run works as @${account} on ${read.name}` : `This project is on ${read.name}`}
    />
  )
}

/** What a profile's line says while it names no account. */
const COMPUTERS = 'None — whatever the computer uses'

/** A profile's line: the account its runs work as, or none, whatever the computer uses. */
function ProfileAccount({ accounts: read, options, onChange, busy, say, onAdded }: UiComposerControlProps & { accounts: AccountsRead; onAdded: () => Promise<void> }) {
  const account = options.github?.account
  // One added from here is the profile's.
  const adding = useAddAccount(async login => (await onAdded(), onChange(withAccount(options, login))))
  useEffect(() => say({ words: account !== undefined ? `@${account} on ${read.name}` : `${read.name}: whatever the computer uses` }), [say, account, read.name])
  // An account the computer no longer has stays named: a run on the profile is refused until it is back, or another is picked.
  const logins = [...new Set([...read.accounts.map(one => one.login), ...(account !== undefined ? [account] : [])])]
  return (
    <>
      <SetupLine icon={LOGO(read)} label={`${read.name} account`} value={account !== undefined ? <Login read={read} login={account} /> : 'None'} className="min-w-[14rem]" disabled={busy}>
        <DropdownMenuGroup>
          <DropdownMenuLabel title="Runs push and open pull requests as this account. An account this computer does not have refuses the start.">{`${read.name} account for this profile`}</DropdownMenuLabel>
          <DropdownMenuItem onClick={() => onChange(withAccount(options, undefined))}>
            <span className="flex-1 truncate">{COMPUTERS}</span>
            <MenuTick on={account === undefined} />
          </DropdownMenuItem>
          {logins.map(login => (
            <DropdownMenuItem key={login} onClick={() => onChange(withAccount(options, login))}>
              <span className="flex-1 truncate">@{login}</span>
              <MenuTick on={login === account} />
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={adding.add}>
          <Plus className="h-3.5 w-3.5 shrink-0 opacity-70" aria-hidden />
          Add account…
        </DropdownMenuItem>
      </SetupLine>
      {adding.dialog}
    </>
  )
}

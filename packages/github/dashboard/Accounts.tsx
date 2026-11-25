import { useState } from 'react'
import { Loader2, MoreHorizontal, Plus } from 'lucide-react'
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  FocusHome,
  NO_PROJECT,
  Panel,
  PanelGroup,
  PanelRow,
  PackageLogo,
  Slot,
  WordsShape,
  cn,
  useModuleHost,
} from '@openagt/ui/module'
import { AccountFix, useAddAccount } from './AddAccount.js'
import { missingWords, server, useAccounts, type AccountsRead, type Pressed } from './calls.js'

// GitHub's part of the Permissions page (`permissions.section`): "Git host accounts", OpenAgent's
// own accounts on GitHub, drawn from what gh answers (its logo, OpenAgent's accounts there, the
// one runs use). Its rows are as the coding agents' accounts are, and no account is a row that adds
// one (his pick). The accounts are OpenAgent's, added here: the person's own gh and its logins are
// never used.

/** What the part says while gh cannot be asked, and the room it waits in. */
const UNREAD = 'GitHub could not be asked for its accounts.'

/** The Permissions page's GitHub accounts, with the press that adds another. */
export function AccountsSection() {
  const { accounts, state, reload } = useAccounts()
  const adding = useAddAccount(reload)
  return (
    <PanelGroup
      bare
      title="Git host accounts"
      action={
        // Another account, at the heading as the coding agents' card has it. Unpainted, as a part's heading's presses are, pulled out by its own padding so its word ends on the cards' edge.
        accounts?.installed && (
          <Button variant="ghost" className="-mr-3" aria-label={`Add a ${accounts.name} account`} onClick={adding.add}>
            <Plus className="size-4" aria-hidden />
            Add
          </Button>
        )
      }
    >
      {/* Waits in the room of one sentence. */}
      <Slot
        of={{ value: accounts, state }}
        shape={
          <p className="text-sm">
            <WordsShape words={UNREAD} />
          </p>
        }
        className="flex flex-col gap-4"
      >
        {accounts => (accounts ? <Accounts accounts={accounts} onChanged={reload} /> : <p className="text-sm text-muted-foreground">{UNREAD}</p>)}
      </Slot>
      {adding.dialog}
    </PanelGroup>
  )
}

function Accounts({ accounts: p, onChanged }: { accounts: AccountsRead; onChanged: () => Promise<void> }) {
  const host = useModuleHost()
  const [error, setError] = useState<string | undefined>()
  // The account whose removal waits for the person's yes, and the press under way: its words say so until the answer.
  const [removing, setRemoving] = useState<string | undefined>()
  const [pending, setPending] = useState<{ login: string; press: 'use' | 'remove' } | undefined>()
  const act = async (login: string, press: 'use' | 'remove', go: () => Promise<Pressed>) => {
    setPending({ login, press })
    setError(undefined)
    try {
      const done = await go().catch((err: unknown): Pressed => ({ ok: false, error: err instanceof Error ? err.message : String(err) }))
      if (!done.ok) setError(done.error)
      setRemoving(undefined)
      await onChanged()
    } finally {
      setPending(undefined)
    }
  }
  const empty = !p.installed || p.accounts.length === 0
  return (
    <FocusHome as="section" aria-label={p.name}>
      {p.accounts.length > 0 && (
        <Panel>
          {p.accounts.map(account => {
            const busy = pending?.login === account.login
            return (
              <PanelRow
                key={account.login}
                aria-label={`@${account.login}`}
                state={<Avatar src={account.avatar} login={account.login} />}
                title={`@${account.login}`}
                meta={[
                  <span className={cn(!account.ok && 'text-warning')}>{!account.ok ? `${p.name} no longer takes this login: add it again` : 'Added to OpenAgent'}</span>,
                  account.runs && <span className="text-success">Runs use this</span>,
                ]}
                under={
                  <>
                    {removing === account.login && (
                      <span role="group" aria-label={`Remove @${account.login}`} className="mt-1 flex flex-wrap items-center gap-2">
                        <span className="min-w-0 grow basis-60 text-muted-foreground">
                          {account.runs
                            ? `Runs use @${account.login}. Without it they have no ${p.name} account until you add one.`
                            : `OpenAgent forgets @${account.login}. The login goes on working wherever else it is.`}
                        </span>
                        <Button size="sm" variant="destructive" loading={busy} onClick={() => void act(account.login, 'remove', () => server(host).forget(NO_PROJECT, { login: account.login }))}>
                          {busy ? 'Removing…' : 'Remove'}
                        </Button>
                        <Button size="sm" variant="ghost" disabled={busy} onClick={() => setRemoving(undefined)}>
                          Cancel
                        </Button>
                      </span>
                    )}
                  </>
                }
                // Its menu stands at rest, faint, on the inset: the row has no fact that could give way to it.
                actionsAtRest
                actions={
                  <DropdownMenu>
                    <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" className="-mr-1.5 text-faint-foreground hover:text-foreground" />} aria-label={`More for @${account.login}`} disabled={pending !== undefined}>
                      {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <MoreHorizontal className="size-4" aria-hidden />}
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="min-w-44">
                      {!account.runs && (
                        <DropdownMenuItem disabled={!account.ok} onClick={() => void act(account.login, 'use', () => server(host).useForRuns(NO_PROJECT, { login: account.login }))}>
                          Use for runs
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuItem className="text-danger" onClick={() => setRemoving(account.login)}>
                        Remove
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                }
              />
            )
          })}
        </Panel>
      )}
      {empty && (
        // No account keeps the host's place, as a row that adds one: its mark and name, what is missing, the press.
        <Panel>
          <PanelRow aria-label={p.name} state={<PackageLogo svg={p.logo} />} title={p.name} meta={[p.installed ? 'No account' : missingWords(p)]} actionsAtRest actions={<AccountFix accounts={p} label="Add account" variant="secondary" onChanged={onChanged} />} />
        </Panel>
      )}
      {error !== undefined && (
        <p role="alert" className="mt-2 text-xs text-danger">
          {error}
        </p>
      )}
    </FocusHome>
  )
}

/** An account's picture on GitHub; its first letter while there is none, or it does not load. */
export function Avatar({ src, login }: { src: string | undefined; login: string }) {
  const [broken, setBroken] = useState(false)
  return (
    <span aria-hidden className="flex size-4 shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted text-xs leading-none font-medium text-muted-foreground">
      {src && !broken ? <img src={src} alt="" referrerPolicy="no-referrer" className="size-full object-cover" onError={() => setBroken(true)} /> : login[0]?.toUpperCase()}
    </span>
  )
}

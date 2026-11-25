import { useState } from 'react'
import { Button, Input, ModuleFixPress, PathStrip, SendAs, SettingsRow, SettingsRowShapes, SettingsSection, Slot, firstSendAs, useAction, useModuleHost, usePolled } from '@openagt/ui/module'
import { typedRepository } from '@openagt/hooks/repository-address'
import type { HostAccounts } from '@openagt/hooks'
import { server, type PersonalFolderView } from './calls.js'
import { BackupNotice, accountsAt } from './BackupNotice.js'

/** Read again this often while the page is open: a sync of another computer's lands in the folder on its own. */
const EVERY_MS = 10_000

/**
 * Settings › Your agent data: the person's own folder, where the agents keep everything of the projects
 * not shared on their own repository, which may sync with a repository of theirs so each of their
 * computers has the same data. Where one project's data is, is that project's page. The folder
 * is sent as one of OpenAgent's own accounts at the repository's host, named here, never as the
 * person's own login.
 */
export function AgentDataSettings() {
  const host = useModuleHost()
  const read = usePolled<PersonalFolderView | null>(() => server(host).folder({}), null, EVERY_MS, [host])
  return (
    <Slot of={read} shape={<SettingsRowShapes rows={1} />}>
      {view => view && <PersonalFolder view={view} reload={read.reload} />}
    </Slot>
  )
}

/** Where your agent data is, and the presses that move it. */
function PersonalFolder({ view, reload }: { view: PersonalFolderView; reload: () => Promise<void> }) {
  const [asking, setAsking] = useState(false)
  const [address, setAddress] = useState('')
  const [picked, setPicked] = useState<string | undefined>()
  const { busy, error, reset, run } = useAction()
  const calls = server(useModuleHost())
  const personal = view

  // The host the typed address is on, and OpenAgent's accounts there; a folder on this disk asks no login.
  const typedHost = typedRepository(address)?.address.split('/')[0]?.toLowerCase()
  const typedAt: HostAccounts | undefined = typedHost !== undefined ? accountsAt(personal.hosts, typedHost) : undefined
  const sendAs = picked !== undefined && typedAt?.logins.includes(picked) ? picked : firstSendAs(typedAt)
  const remoteHost = personal.remoteUrl ? personal.remote?.split('/')[0]?.toLowerCase() : undefined
  const remoteAt = remoteHost !== undefined ? personal.hosts.find(row => row.host === remoteHost) : undefined

  const sync = () =>
    void run(() => calls.sync({ address, ...(sendAs !== undefined ? { login: sendAs } : {}) }), 'Could not sync with that repository.').then(async outcome => {
      if (!outcome.ok) return
      setAsking(false)
      setAddress('')
      await reload()
    })
  const sendAsOther = (login: string) =>
    void run(() => calls.sendAs({ login }), 'Could not change the account.').then(async outcome => {
      if (outcome.ok) await reload()
    })
  const stop = () =>
    void run(() => calls.stopSyncing({}), 'Could not stop syncing.').then(async outcome => {
      if (outcome.ok) await reload()
    })

  const holds = personal.projects.length > 0 ? ` · ${personal.projects.join(', ')}` : ''
  const unsent = personal.unsent > 0 ? ` ${personal.unsent} ${personal.unsent === 1 ? 'change' : 'changes'} waiting to back up.` : ''
  // At a git host with no account named: the notice above says so, with the fix.
  const unnamed = remoteHost !== undefined && !personal.account
  const remote = personal.remoteUrl ? (
    <a href={personal.remoteUrl} target="_blank" rel="noreferrer" className="text-primary hover:underline">
      {personal.remote}
    </a>
  ) : (
    personal.remote
  )
  const where = personal.remote ? (
    unnamed ? (
      <>Synced with {remote}, not backed up yet.</>
    ) : (
      <>
        Backed up to {remote}
        {personal.account ? ` as @${personal.account}` : ''}.{unsent}
      </>
    )
  ) : (
    'Only on this computer.'
  )

  return (
    <SettingsSection description="Everything your agents keep: what each was asked and answered, the tickets, the queue and plans.">
      <BackupNotice onChanged={() => void reload()} />
      <div>
        <SettingsRow
          label="Your folder"
          description={
            <>
              <PathStrip path={personal.path} />
              {holds}. {where}
            </>
          }
          control={
            personal.remote ? (
              <Button variant="secondary" loading={busy} onClick={stop}>
                Stop syncing
              </Button>
            ) : (
              !asking && (
                <Button variant="secondary" onClick={() => setAsking(true)}>
                  Sync with a repository
                </Button>
              )
            )
          }
        />
        {personal.remote && remoteHost !== undefined && !unnamed && (
          <div className="mt-2">
            <SendAs host={remoteAt ?? { host: remoteHost, logins: [] }} value={personal.account} onChange={sendAsOther} disabled={busy} label="Back up as" />
          </div>
        )}
        {asking && !personal.remote && (
          <form
            className="mt-3 space-y-2"
            onSubmit={event => {
              event.preventDefault()
              sync()
            }}
          >
            <p className="text-xs text-muted-foreground">
              Make an empty private repository, then paste its address. Each of your computers that syncs with the same one has the same
              records.
            </p>
            <div className="flex items-center gap-2">
              <Input
                name="repository-address"
                aria-label="Repository address"
                placeholder="github.com/you/agent"
                value={address}
                autoFocus
                disabled={busy}
                onChange={event => {
                  setAddress(event.target.value)
                  reset()
                }}
                className="min-w-0 flex-1"
              />
              <Button type="submit" disabled={address.trim() === '' || (typedAt !== undefined && sendAs === undefined)} loading={busy}>
                {busy ? 'Syncing…' : 'Sync'}
              </Button>
              <Button
                type="button"
                variant="ghost"
                disabled={busy}
                onClick={() => {
                  setAsking(false)
                  setAddress('')
                  reset()
                }}
              >
                Cancel
              </Button>
            </div>
            {typedAt &&
              (typedAt.logins.length === 0 && typedAt.add ? (
                // No account of OpenAgent's there: one is added here, by the press of the module answering for the host.
                <div className="space-y-1.5">
                  <p className="text-xs text-muted-foreground">{`OpenAgent backs up to ${typedAt.host} with an account of its own, never your own login. It has none there yet.`}</p>
                  <ModuleFixPress fix={typedAt.add} onFixed={() => void reload()} />
                </div>
              ) : (
                <SendAs host={typedAt} value={sendAs} onChange={setPicked} disabled={busy} label="Back up as" />
              ))}
          </form>
        )}
        {error && <p className="mt-2 text-xs text-danger">{error}</p>}
      </div>
    </SettingsSection>
  )
}

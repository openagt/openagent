import { useState } from 'react'
import { typedRepository } from '../../src/client.js'
import { onPersonalFolder, sendPersonalFolderAs, sendStopSyncingPersonalFolder, sendSyncPersonalFolder, type PersonalFolderView, type SendAsHost } from '../rpc/personal-folder.js'
import { usePolled } from '../lib/use-async.js'
import { useAction } from '../lib/use-action.js'
import { Button } from './ui/button.js'
import { Input } from './ui/input.js'
import { SettingsRow, SettingsSection } from './SettingsRows.js'
import { SendAs, firstSendAs } from './SendAs.js'
import { BackupNotice, accountsAt } from './BackupNotice.js'
import { HostFix } from './AddGitAccount.js'
import { useGitHosts } from './Logins.js'

/** The Settings entry's id. */
export const AGENT_DATA_ENTRY = 'agent-data'

/** Read again this often while the page is open: a sync of another computer's lands in the folder on its own. */
const EVERY_MS = 10_000

/**
 * Settings › Agent data: the person's own folder, where the agents keep everything of the projects
 * not shared on their own repository, which may sync with a repository of theirs so each of their
 * computers has the same data. Where one project's data is, is that project's page. The folder
 * is sent as one of OpenAgent's own accounts at the repository's host, named here, never as the
 * person's own login.
 */
export function AgentDataSettings() {
  const { value: view, reload } = usePolled<PersonalFolderView | null>(onPersonalFolder, null, EVERY_MS, [])
  const [asking, setAsking] = useState(false)
  const [address, setAddress] = useState('')
  const [picked, setPicked] = useState<string | undefined>()
  const { busy, error, reset, run } = useAction()
  // OpenAgent's accounts, read live: one added here is offered at once.
  const { view: gitHosts, reload: reloadGitHosts } = useGitHosts()
  if (!view) return null
  const personal = view

  // The host the typed address is on, and OpenAgent's accounts there; a folder on this disk asks no login.
  const typedHost = typedRepository(address)?.address.split('/')[0]?.toLowerCase()
  const typedRow = typedHost !== undefined ? gitHosts?.hosts.find(row => row.host === typedHost) : undefined
  const typedAt: SendAsHost | undefined = typedHost !== undefined ? (typedRow ? accountsAt(typedRow, typedHost) : (personal.hosts.find(row => row.host === typedHost) ?? { host: typedHost, logins: [] })) : undefined
  const sendAs = picked !== undefined && typedAt?.logins.includes(picked) ? picked : firstSendAs(typedAt)
  const remoteHost = personal.remoteUrl ? personal.remote?.split('/')[0]?.toLowerCase() : undefined
  const remoteAt = remoteHost !== undefined ? personal.hosts.find(row => row.host === remoteHost) : undefined

  const sync = () =>
    void run(() => sendSyncPersonalFolder(address, sendAs), 'Could not sync with that repository.').then(async outcome => {
      if (!outcome.ok) return
      setAsking(false)
      setAddress('')
      await reload()
    })
  const sendAsOther = (login: string) =>
    void run(() => sendPersonalFolderAs(login), 'Could not change the account.').then(async outcome => {
      if (outcome.ok) await reload()
    })
  const stop = () =>
    void run(() => sendStopSyncingPersonalFolder(), 'Could not stop syncing.').then(async outcome => {
      if (outcome.ok) await reload()
    })

  const holds = personal.projects.length > 0 ? ` · ${personal.projects.join(', ')}` : ''
  const unsent = personal.unsent > 0 ? ` ${personal.unsent} ${personal.unsent === 1 ? 'change' : 'changes'} waiting to back up.` : ''
  // At a git host with no account named: the notice above says so, with the fix.
  const unnamed = remoteHost !== undefined && !personal.account
  const remote = personal.remoteUrl ? (
    <a href={personal.remoteUrl} target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-foreground">
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
      <div className="py-3 first:pt-0 last:pb-0">
        <SettingsRow
          label="Your folder"
          description={
            <>
              {personal.path}
              {holds}. {where}
            </>
          }
          control={
            personal.remote ? (
              <Button variant="outline" size="sm" disabled={busy} onClick={stop}>
                Stop syncing
              </Button>
            ) : (
              !asking && (
                <Button variant="outline" size="sm" onClick={() => setAsking(true)}>
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
                aria-label="Repository address"
                placeholder="github.com/you/agent"
                value={address}
                autoFocus
                disabled={busy}
                onChange={event => {
                  setAddress(event.target.value)
                  reset()
                }}
                className="h-8"
              />
              <Button type="submit" size="sm" disabled={busy || address.trim() === '' || (typedAt !== undefined && sendAs === undefined)}>
                {busy ? 'Syncing…' : 'Sync'}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
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
              (typedAt.logins.length === 0 && typedRow ? (
                // No account of OpenAgent's there: one is added here, in its dialog.
                <div className="space-y-1.5">
                  <p className="text-xs text-muted-foreground">{`OpenAgent backs up to ${typedRow.provider?.name ?? typedAt.host} with an account of its own, never your own login. It has none there yet.`}</p>
                  <HostFix row={typedRow} onChanged={reloadGitHosts} size="xs" />
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

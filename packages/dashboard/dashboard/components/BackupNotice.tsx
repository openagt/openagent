import { useState } from 'react'
import { CircleAlert, Loader2 } from 'lucide-react'
import { sendBackUpAs, type BackupGap } from '../rpc/backup.js'
import type { GitHostRow } from '../rpc/logins.js'
import type { SendAsHost } from '../rpc/personal-folder.js'
import { backupChanged, useBackup } from '../lib/use-backup.js'
import { HostFix } from './AddGitAccount.js'
import { useGitHosts } from './Logins.js'
import { SendAs, firstSendAs } from './SendAs.js'
import { Button } from './ui/button.js'

// Settings › Agent data, at its top: the agents' data that is not backed up, and the fix, here
// (his pick over a trip to the Permissions page): with no account of OpenAgent's at the host, the
// press that adds one, in its dialog; with one, "Back up as" and the press that sends
// what waited. The person picks the account, even when there is only one: nothing is sent as an
// account they did not name.

/** OpenAgent's accounts at a host that the host still takes, as a "Back up as" select offers them. */
export function accountsAt(row: GitHostRow | undefined, host: string): SendAsHost {
  const accounts = row?.provider?.accounts.filter(account => account.ok) ?? []
  const runs = accounts.find(account => account.runs)?.login
  return { host, logins: accounts.map(account => account.login), ...(runs !== undefined ? { runs } : {}) }
}

export function BackupNotice({ onChanged }: { onChanged?: () => void }) {
  const { view } = useBackup()
  const { view: hosts, reload: reloadHosts } = useGitHosts()
  if (!view || view.gaps.length === 0) return null
  const byHost = new Map<string, BackupGap[]>()
  for (const gap of view.gaps) byHost.set(gap.host, [...(byHost.get(gap.host) ?? []), gap])
  return (
    <section aria-label="Not backed up" className="mb-4 space-y-3 rounded-lg border border-warning/40 bg-warning/5 p-3">
      <p className="flex items-center gap-2 text-sm font-medium text-warning">
        <CircleAlert className="h-4 w-4 shrink-0" aria-hidden />
        Not backed up
      </p>
      {[...byHost].map(([host, gaps]) => {
        const row = hosts?.hosts.find(one => one.host === host)
        const name = row?.provider?.name ?? host
        const at = accountsAt(row, host)
        return (
          <div key={host} className="space-y-2">
            <p className="text-xs text-muted-foreground">
              {`OpenAgent backs up to ${name} with an account of its own, never your own login. Until then, changes are kept on this computer.`}
            </p>
            {at.logins.length === 0 ? (
              <>
                <ul className="space-y-1">
                  {gaps.map(gap => (
                    <li key={gap.kind + (gap.projectId ?? '')} className="text-sm">
                      <GapWords gap={gap} />
                    </li>
                  ))}
                </ul>
                {row ? <HostFix row={row} onChanged={reloadHosts} size="xs" /> : <p className="text-xs text-muted-foreground">{`No package answers for ${host} yet.`}</p>}
              </>
            ) : (
              <ul className="space-y-2">
                {gaps.map(gap => (
                  <GapRow key={gap.kind + (gap.projectId ?? '')} gap={gap} at={at} onChanged={onChanged} />
                ))}
              </ul>
            )}
          </div>
        )
      })}
    </section>
  )
}

/** What is not backed up: whose data, where to, and what waits. */
function GapWords({ gap }: { gap: BackupGap }) {
  const whose = gap.kind === 'personal' ? 'Your agent data' : `${gap.project}’s shared data`
  const waiting = gap.waiting ? ` · ${gap.waiting} ${gap.waiting === 1 ? 'change' : 'changes'} waiting` : ''
  return (
    <>
      <span className="font-medium">{whose}</span>
      <span className="text-muted-foreground">
        {' to '}
        {gap.url ? (
          <a href={gap.url} target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-foreground">
            {gap.address}
          </a>
        ) : (
          gap.address
        )}
        {waiting}
      </span>
    </>
  )
}

function GapRow({ gap, at, onChanged }: { gap: BackupGap; at: SendAsHost; onChanged: (() => void) | undefined }) {
  const [picked, setPicked] = useState<string | undefined>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const login = picked !== undefined && at.logins.includes(picked) ? picked : firstSendAs(at)
  const backUp = async () => {
    if (login === undefined) return
    setBusy(true)
    setError(undefined)
    try {
      const done = await sendBackUpAs(gap.kind === 'project' ? { kind: 'project', projectId: gap.projectId! } : { kind: 'personal' }, login)
      if (!done.ok) setError(done.error)
      backupChanged()
      onChanged?.()
    } catch {
      setError('Could not back it up.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <li className="space-y-1.5 text-sm">
      <p>
        <GapWords gap={gap} />
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <SendAs host={at} value={login} onChange={setPicked} disabled={busy} label="Back up as" />
        <Button size="xs" disabled={busy || login === undefined} onClick={() => void backUp()}>
          {busy && <Loader2 className="size-3 animate-spin" aria-hidden />}
          {busy ? 'Backing up…' : 'Back up'}
        </Button>
      </div>
      {error !== undefined && (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
    </li>
  )
}

import { useState } from 'react'
import { onProjectAgentData, sendProjectDataAs, type KeptData, type ProjectAgentData } from '../rpc/project-agent-data.js'
import { sendShareRecords } from '../rpc/projects.js'
import { usePolled } from '../lib/use-async.js'
import { useAction } from '../lib/use-action.js'
import { openSettings } from '../lib/use-route.js'
import { ConfirmDialog } from './ui/confirm-dialog.js'
import { SettingsSection, SettingsSelectRow, SettingsRow } from './SettingsRows.js'
import { AGENT_DATA_ENTRY } from './AgentDataSettings.js'
import { SendAs, firstSendAs } from './SendAs.js'

/** The Settings entry's id: the project's own page, beside the person's own folder's `agent-data`. */
export const PROJECT_AGENT_DATA_ENTRY = 'project-agent-data'

/** Read again this often while the page is open: agents add runs and tickets as they work. */
const EVERY_MS = 10_000

/** Each kind of data, as a count reads. */
const KIND_WORDS: Record<KeptData['kind'], (n: number) => string> = {
  runs: n => `${n} ${n === 1 ? 'run' : 'runs'}`,
  tickets: n => `${n} ${n === 1 ? 'ticket' : 'tickets'}`,
  queue: n => `${n} queued`,
}

/**
 * Settings › Project › Agent data: where one project's agent data is, the person's own folder or
 * the project's own repository, switched here, and what the skills keep there. Kept in the
 * repository, it is sent as one of OpenAgent's own accounts at the remote's host, named here,
 * never as the person's own login.
 */
export function ProjectAgentDataSettings({ projectId }: { projectId: string }) {
  const { value: data, loaded, reload } = usePolled<ProjectAgentData | null>(() => onProjectAgentData(projectId), null, EVERY_MS, [projectId])
  const [confirmShare, setConfirmShare] = useState(false)
  const [picked, setPicked] = useState<string | undefined>()
  const { busy, error, run } = useAction()
  if (!loaded) return null
  if (!data) return <p className="text-sm text-muted-foreground">This project&rsquo;s agent data is on the computer the project is on.</p>

  const folder = (
    <>
      your folder{' '}
      <button type="button" className="underline underline-offset-2 hover:text-foreground" onClick={() => openSettings(AGENT_DATA_ENTRY)}>
        {data.folder.path}
      </button>
      {data.folder.remote ? (
        <>
          , synced with{' '}
          {data.folder.remoteUrl ? (
            <a href={data.folder.remoteUrl} target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-foreground">
              {data.folder.remote}
            </a>
          ) : (
            data.folder.remote
          )}
        </>
      ) : (
        ', only on this computer'
      )}
    </>
  )
  const where =
    data.place === 'repository' ? (
      <>
        In this project&rsquo;s repository, on the branch agent-data{data.account ? `, sent as @${data.account}` : ''}. Everyone who can read the repository can read it.
      </>
    ) : (
      <>In {folder}.</>
    )
  const kept = data.kept.filter(k => k.count > 0)
  // The account it goes as: the one kept while shared; on the way in, the one picked in the dialog.
  const sendAs = picked !== undefined && data.accounts?.logins.includes(picked) ? picked : firstSendAs(data.accounts, data.account)
  const noAccount = data.accounts !== undefined && sendAs === undefined

  const pick = (next: string) => {
    if (next === data.place || busy) return
    if (next === 'repository') setConfirmShare(true)
    else void run(() => sendShareRecords(projectId, false), 'Could not move the agent data.').then(() => reload())
  }

  return (
    <SettingsSection description="Where this project’s agent data is, and what the skills keep there.">
      <SettingsSelectRow
        label="Kept in"
        description={where}
        value={data.place}
        options={[
          { value: 'personal', label: 'Your folder' },
          { value: 'repository', label: data.canShare ? 'This project’s repository' : 'This project’s repository (it has no remote)', disabled: !data.canShare },
        ]}
        onChange={pick}
      />
      {data.place === 'repository' && data.accounts && (
        <div className="pb-3">
          <SendAs host={data.accounts} value={data.account} disabled={busy} onChange={login => void run(() => sendProjectDataAs(projectId, login), 'Could not change the account.').then(() => reload())} />
        </div>
      )}
      {error && <p className="py-3 text-xs text-danger">{error}</p>}
      <SettingsRow
        label="What is kept"
        description={kept.length > 0 ? kept.map(k => `${KIND_WORDS[k.kind](k.count)} (${k.skill})`).join(' · ') : 'Nothing yet.'}
        control={null}
      />
      <ConfirmDialog
        open={confirmShare}
        onOpenChange={setConfirmShare}
        title="Keep this project’s agent data in its repository?"
        body={
          <>
            Its agent data moves from your folder to a branch <span className="font-medium text-foreground">agent-data</span> of this
            project&rsquo;s repository, pushed now and as agents work. It holds what you asked each agent and what it answered, under your
            git email. Everyone who can read the repository can read it.
          </>
        }
        extra={data.accounts && <SendAs host={data.accounts} value={sendAs} onChange={setPicked} label="Push as" />}
        confirmLabel="Move and push"
        confirmBusyLabel="Moving…"
        fallbackError="Could not move the agent data."
        destructive={false}
        confirmDisabled={noAccount}
        onConfirm={() => sendShareRecords(projectId, true, sendAs)}
        onSuccess={() => void reload()}
      />
    </SettingsSection>
  )
}

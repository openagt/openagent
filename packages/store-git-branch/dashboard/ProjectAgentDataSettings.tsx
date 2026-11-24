import { useState } from 'react'
import { ConfirmDialog, Facts, PathStrip, SendAs, SettingsRow, SettingsRowShapes, SettingsSection, SettingsSelectRow, Slot, firstSendAs, rpcClient, useAction, useModuleHost, usePolled, type ModuleHost, type UiSettingsProps } from '@openagt/ui/module'
import type { KeptData, ProjectAgentData } from '../src/server.js'

/** Settings › Your agent data, store-git-repository's: where the person's own folder is. */
const YOUR_AGENT_DATA = 'agent-data'

const server = (host: Pick<ModuleHost, 'call'>) => rpcClient<typeof import('../src/server.js')>(host)

/** Read again this often while the page is open: agents add runs and tickets as they work. */
const EVERY_MS = 10_000

/** One thing kept, as the list reads: a folder with how many it holds, a file by its name. */
function keptWords(kept: KeptData): string {
  return kept.count !== undefined ? `${kept.name} (${kept.count})` : kept.name
}

/**
 * Settings › Project › Project agent data: where one project's agent data is, the person's own folder or
 * the project's own repository, switched here, and what the modules keep there. One project's at a
 * time: Settings draws it for one (`pickProject`). Kept in the
 * repository, it is sent as one of OpenAgent's own accounts at the remote's host, named here,
 * never as the person's own login.
 */
export function ProjectAgentDataSettings({ projects }: UiSettingsProps) {
  const projectId = projects[0]?.id
  return projectId !== undefined ? <ProjectDataRead projectId={projectId} /> : null
}

/** The project's agent data, read again every few seconds. */
function ProjectDataRead({ projectId }: { projectId: string }) {
  const host = useModuleHost()
  const read = usePolled<ProjectAgentData | null>(() => server(host).data(projectId, {}), null, EVERY_MS, [host, projectId])
  return <Slot of={read} shape={<SettingsRowShapes />}>{data => data && <ProjectData projectId={projectId} data={data} reload={read.reload} />}</Slot>
}

/** Where one project's agent data is, the pick that moves it, and what is kept there. */
function ProjectData({ projectId, data, reload }: { projectId: string; data: ProjectAgentData; reload: () => Promise<void> }) {
  const host = useModuleHost()
  const calls = server(host)
  const [confirmShare, setConfirmShare] = useState(false)
  const [picked, setPicked] = useState<string | undefined>()
  const { busy, error, run } = useAction()

  const folder = (
    <>
      your folder{' '}
      <button type="button" className="focus-ring rounded-sm align-bottom hover:underline" onClick={() => host.openSettings(YOUR_AGENT_DATA)}>
        <PathStrip path={data.folder.path} className="text-primary" />
      </button>
      {data.folder.remote ? (
        <>
          , synced with{' '}
          {data.folder.remoteUrl ? (
            <a href={data.folder.remoteUrl} target="_blank" rel="noreferrer" className="text-primary hover:underline">
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
  const kept = data.kept.filter(k => k.count !== 0)
  // The account it goes as: the one kept while shared; on the way in, the one picked in the dialog.
  const sendAs = picked !== undefined && data.accounts?.logins.includes(picked) ? picked : firstSendAs(data.accounts, data.account)
  const noAccount = data.accounts !== undefined && sendAs === undefined

  const pick = (next: string) => {
    if (next === data.place || busy) return
    if (next === 'repository') setConfirmShare(true)
    else void run(() => calls.share(projectId, { on: false }), 'Could not move the agent data.').then(() => reload())
  }

  return (
    <SettingsSection description="Where this project’s agent data is, and what the modules keep there.">
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
        <div>
          <SendAs host={data.accounts} value={data.account} disabled={busy} onChange={login => void run(() => calls.sendAs(projectId, { login }), 'Could not change the account.').then(() => reload())} />
        </div>
      )}
      {error && <p className="text-xs text-danger">{error}</p>}
      <SettingsRow
        label="What is kept"
        description={kept.length > 0 ? <Facts facts={kept.map(keptWords)} /> : 'Nothing yet.'}
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
        extra={data.accounts && <SendAs host={data.accounts} value={sendAs} onChange={setPicked} />}
        confirmLabel="Move and push"
        confirmBusyLabel="Moving…"
        fallbackError="Could not move the agent data."
        destructive={false}
        confirmDisabled={noAccount}
        onConfirm={() => calls.share(projectId, { on: true, ...(sendAs !== undefined ? { login: sendAs } : {}) })}
        onSuccess={() => void reload()}
      />
    </SettingsSection>
  )
}

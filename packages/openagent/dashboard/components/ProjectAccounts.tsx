import { useState } from 'react'
import { onProjectAccounts, sendProjectAccounts, type ProjectAccountsView, type ProjectAgentAccounts } from '../rpc/logins.js'
import { readAhead, usePolled } from '../lib/use-async.js'
import { Checkbox } from './ui/checkbox.js'
import { SettingsSection as Section, SettingsSelectRow as SelectRow } from './SettingsRows.js'

// Settings › Project › Accounts: the accounts one project's runs work as, when not the computer's
// (a project of someone else's, worked on as their agent's account, on their Claude or Codex). Offered for a
// kind the computer has two or more of. Kept on this computer, in the project's runner settings,
// never in the repository: whose accounts a project uses is the person's.

/** The Settings entry, in the Project group. */
export const PROJECT_ACCOUNTS_ENTRY = 'project-accounts'

/** Where a project's answer is kept for the page's life. */
const keyOf = (projectId: string): string => `project-accounts:${projectId}`

/**
 * Ask for a project's accounts before Settings opens on it: whether its Accounts entry is in the
 * list takes the server a second to say (the git host's tool asks the host), and the list is
 * drawn at once with what was read ahead.
 */
export function readProjectAccountsAhead(projectId: string): void {
  readAhead(keyOf(projectId), () => onProjectAccounts(projectId))
}

/** The project's accounts as the page reads them; null while there is nothing a project could pick. */
export function useProjectAccounts(projectId: string | undefined): { view: ProjectAccountsView | null; reload: () => Promise<void> } {
  const { value, reload } = usePolled<ProjectAccountsView | null>(projectId ? () => onProjectAccounts(projectId) : null, null, 30_000, [projectId], projectId ? { remember: keyOf(projectId) } : undefined)
  return { view: value && (value.gitHost || value.claude || value.codex) ? value : null, reload }
}

const SAME = ''
const SOME = 'some'

export function ProjectAccountsSettings({ projectId }: { projectId: string }) {
  const { view, reload } = useProjectAccounts(projectId)
  const [error, setError] = useState<string | undefined>()
  const save = async (change: { gitHost?: string | null; claude?: string[] | null; codex?: string[] | null }) => {
    setError(undefined)
    const done = await sendProjectAccounts(projectId, change)
    if (!done.ok) setError(done.error)
    await reload()
  }
  if (!view) return <p className="text-sm text-muted-foreground">This computer has one account of each kind: this project's runs use those.</p>
  const host = view.gitHost
  return (
    <Section description="The accounts this project's runs work as, when not this computer's. Kept on this computer only, never in the repository.">
      {host && (
        <SelectRow
          label={host.name}
          description={`Which account this project's runs push and open a ${host.requestWord} as.${host.computer !== undefined ? ` This computer's runs use @${host.computer}.` : ''}`}
          value={host.project ?? SAME}
          options={[{ value: SAME, label: 'Same as this computer' }, ...host.accounts.map(login => ({ value: login, label: `@${login}` }))]}
          onChange={next => void save({ gitHost: next === SAME ? null : next })}
        />
      )}
      {view.claude && <AgentPick label="Claude" accounts={view.claude} onChange={claude => void save({ claude })} />}
      {view.codex && <AgentPick label="Codex" accounts={view.codex} onChange={codex => void save({ codex })} />}
      {error !== undefined && (
        <p role="alert" className="pt-2 text-xs text-danger">
          {error}
        </p>
      )}
    </Section>
  )
}

/** One agent's accounts for the project: the computer's, or only some of them, in the order Agent accounts has them. */
function AgentPick({ label, accounts, onChange }: { label: string; accounts: ProjectAgentAccounts; onChange: (picked: string[] | null) => void }) {
  const picked = new Set(accounts.project ?? [])
  return (
    <div className="py-3">
      <SelectRow
        label={label}
        description={`Which ${label} accounts this project's runs use, in the order Agent accounts has them.`}
        value={accounts.project ? SOME : SAME}
        options={[
          { value: SAME, label: 'Same as this computer' },
          { value: SOME, label: 'Only some of them' },
        ]}
        onChange={next => onChange(next === SAME ? null : accounts.accounts.map(a => a.id))}
      />
      {accounts.project && (
        <ul className="mt-2 space-y-2 pl-1">
          {accounts.accounts.map(account => (
            <li key={account.id}>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={picked.has(account.id)}
                  onCheckedChange={on => {
                    // In the file's order; none left is the computer's again.
                    const next = accounts.accounts.map(a => a.id).filter(id => (id === account.id ? on : picked.has(id)))
                    onChange(next.length > 0 ? next : null)
                  }}
                />
                {account.name}
              </label>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

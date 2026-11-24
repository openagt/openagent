import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { nodeGitRunner, sessionFolder, sessionsHome, type GitRunner } from '@openagt/agent-data'
import { copyStart } from '@openagt/git-branches'
import type { AgentMeta } from '../store/index.js'

// The repos a session has as copies, read off its folder in the sessions home: each a clone under
// its name there (`@openagt/git-branches`' session folder), with a branch of its own. A run in a
// project has them beside its checkout; a session with no project works in the folder itself, and
// a repository its agent cloned there on its own is one of them too. The session's work bar has a
// row per copy with work, read and acted on as the project's own row is: each of the handoff's
// functions (`agent-handoff.ts`) takes the folder it is asked about.

/** A copy's name: one folder's own name, never a path, and none of the folder's dot-entries (the run's live record is one). */
export function isCopyName(name: unknown): name is string {
  return typeof name === 'string' && /^[^./\\][^/\\]*$/.test(name)
}

/** The session's folder; a test names the home. */
function folderOf(agentId: string, home = sessionsHome()): string {
  return sessionFolder(home, agentId)
}

/** The names of the session's copies, in the folder's order by name: every folder in it that is a repository's top. None for a session with no folder. */
export async function sessionCopies(agentId: string, home?: string): Promise<string[]> {
  const folder = folderOf(agentId, home)
  const entries = await readdir(folder, { withFileTypes: true }).catch(() => [])
  const names = entries.filter(entry => entry.isDirectory() && isCopyName(entry.name)).map(entry => entry.name)
  const repos = await Promise.all(names.map(async name => ((await stat(join(folder, name, '.git')).then(() => true, () => false)) ? name : undefined)))
  return repos.filter((name): name is string => name !== undefined).sort()
}

/**
 * One copy as the handoff's functions take a run: its folder, and the run as it stands there, on
 * the branch the copy is on now (its agent renames it), its work measured from the commit the copy
 * was made at, which the copy names: work its folder took in since still counts as the session's.
 * What the run's record says of the project's own branch is left out: where its work began, where
 * its pull request goes and the request it opened are the project's. Nothing for a name that is no
 * copy of this session's.
 */
export async function copyTarget(agent: AgentMeta, name: unknown, deps: { home?: string; git?: GitRunner } = {}): Promise<{ cwd: string; agent: AgentMeta } | undefined> {
  if (!isCopyName(name)) return undefined
  const cwd = join(folderOf(agent.id, deps.home), name)
  if (!(await stat(join(cwd, '.git')).then(() => true, () => false))) return undefined
  const git = deps.git ?? nodeGitRunner()
  const [branch, start] = await Promise.all([git(['branch', '--show-current'], cwd).then(out => out.trim(), () => ''), copyStart(cwd, git)])
  if (!branch) return undefined
  const { baseCommit: _baseCommit, prBase: _prBase, pr: _pr, landed: _landed, ...rest } = agent
  return { cwd, agent: { ...rest, branch, ...(start !== undefined ? { baseCommit: start } : {}) } }
}

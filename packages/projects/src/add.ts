import { resolve, sep } from 'node:path'
import { installProject } from './install.js'
import { nodeGitRunner } from '@openagt/git-branches'
import { writeSharing } from '@openagt/store-filesystem'
import { PROJECTS, type GivenFolder, type ProjectsLifecycle, type Settings } from '@openagt/hooks'
import { isFolder, listProject, projectRefAt } from './list.js'
import { repositoryOf } from './repository-of.js'

/** What adding a folder as a project did: added, or on the list already; or why not. */
export type AddResult =
  | { ok: true; alreadyActivated: boolean; noRemote?: true; /** For a project added by its repository's address: the folder it is in. */ path?: string }
  | { ok: false; error: string }

/** What adding a folder is given: the settings the list is kept in, and who is told of a project added. */
export interface AddContext {
  settings: Settings
  lifecycle: Pick<ProjectsLifecycle, 'added'>
}

/**
 * Add the folder at `path` as a project (#396): its repository made ready for OpenAgent, then the
 * folder put on the list. Ready again is a no-op success: an activated repository stays as it is.
 * `share` is the person's answer on the agents' records, written before the project is listed, so
 * the first sync of a project added with `false` sends nothing. No answer leaves the repository's
 * own as it is: one never asked reads as kept, and a yes given before stays a yes. Put on the list
 * by this add, the modules on in it are told, and start their work there.
 */
export async function addFolder(ctx: AddContext, path: string, share?: boolean): Promise<AddResult> {
  // A folder that is not there would reach git as a missing cwd, which says the confusing
  // "spawn git ENOENT" rather than what is wrong.
  const abs = resolve(path)
  if (!(await isFolder(abs))) return { ok: false, error: `path does not exist or is not a directory: ${abs}` }
  const installed = await installProject(abs)
  if (!installed.ok) return { ok: false, error: installed.error }
  // A yes is to the remote that is there: with none the records are kept, so a remote the project
  // gets later is asked about, in the project's menu, before anything goes to it.
  const shared = share === true && (await hasOrigin(abs))
  if (share !== undefined) {
    const written = await writeSharing(abs, shared).then(() => undefined, (err: unknown) => (err instanceof Error ? err.message : String(err)))
    if (written !== undefined) return { ok: false, error: written }
  }
  const listed = await listProject(ctx.settings, abs, new Date().toISOString())
  if (listed.added) await ctx.lifecycle.added(await projectRefAt(listed.record.id, abs))
  return { ok: true, alreadyActivated: installed.alreadyActivated === true, ...(share && !shared ? { noRemote: true as const } : {}) }
}

/**
 * The folder `openagent` was typed in: the listed project that holds it, so typing it again inside
 * a project, or inside one of its folders, adds nothing; else the repository the folder is in, by
 * its top folder, added as Add project adds one, with no answer on the agents' records: the
 * repository keeps the one it has. Nothing outside a repository, where there is nothing to add.
 * The loader tells the modules of a project added here (`folderGiven`).
 */
export async function givenFolder(settings: Settings, folder: string): Promise<GivenFolder | undefined> {
  const path = resolve(folder)
  const holding = (await settings.get(PROJECTS)).find(project => path === project.path || path.startsWith(project.path + sep))
  if (holding) return { project: await projectRefAt(holding.id, holding.path), added: false }
  const top = await repositoryOf(path)
  if (top === undefined) return undefined
  // Told by the loader, which calls the others once this answers: none are told twice.
  const added = await addFolder({ settings, lifecycle: { added: async () => {} } }, top)
  if (!added.ok) throw new Error(added.error)
  const listed = (await settings.get(PROJECTS)).find(project => project.path === resolve(top))
  if (!listed) throw new Error(`${top} could not be put on the list of projects`)
  return { project: await projectRefAt(listed.id, listed.path), added: true }
}

/** Whether the repository at `cwd` has an `origin` remote: the one a share sends the records to. A folder that is no repository has none. */
async function hasOrigin(cwd: string): Promise<boolean> {
  return nodeGitRunner()(['remote'], cwd).then(out => out.split('\n').some(line => line.trim() === 'origin'), () => false)
}

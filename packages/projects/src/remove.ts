import { fileBranchRepo, projectKeyAt } from '@openagt/store-filesystem'
import { PROJECTS, type CleanupReport, type ProjectsLifecycle, type Settings } from '@openagt/hooks'
import { isFolder, projectRefAt, unlistProject } from './list.js'
import { removeProjectFiles } from './remove-files.js'

/** What removing a project did: off the list, with what was removed of its files when that was asked, or why not. */
export type RemoveResult = { ok: true; cleanup?: CleanupReport } | { ok: false; error: string }

/**
 * Take the project `id` off the list: nothing in its folder is deleted unless `files` is true.
 * Found on the list by its id and not through its folder, so a project whose folder is gone goes
 * too. Refused while the app says it may not go (an agent at work in it). Once off the list every
 * module is told, so what it started there stops (the project's scheduler) and what it kept for
 * the project goes; with `files`, each removes what it left in the folder too, and answers what
 * went and what stayed. The agents' records and the dashboard's own directory go last, and only
 * when no module failed: a module that refused (a run still alive) keeps them for that run.
 */
export async function removeListed(ctx: { settings: Settings; lifecycle: ProjectsLifecycle }, id: string, files: boolean): Promise<RemoveResult> {
  const listed = await ctx.settings.get(PROJECTS)
  const record = listed.find(project => project.id === id)
  if (!record) return { ok: false, error: 'no project with that id is on the list' }
  const here = await isFolder(record.path)
  const project = here ? await projectRefAt(record.id, record.path) : { id: record.id, name: record.path.split('/').at(-1) ?? record.id, dir: record.path }
  const refused = here ? await ctx.lifecycle.refusal(project) : undefined
  if (refused !== undefined) return { ok: false, error: refused }
  await unlistProject(ctx.settings, id)
  const cleaned = await ctx.lifecycle.removed(project, { files: files && here })
  if (!files || !here) return { ok: true }
  // The records are the repository's: while another project on the list is a checkout of the
  // same repository, or a clone of it whose records the personal folder keeps in the same
  // directory, they stay.
  const repository = await fileBranchRepo(record.path)
  const key = await projectKeyAt(repository ?? record.path)
  let recordsUsedBy: string | undefined
  for (const other of listed) {
    if (other.id === id) continue
    const otherRepository = await fileBranchRepo(other.path)
    if ((repository !== undefined && otherRepository === repository) || (await projectKeyAt(otherRepository ?? other.path)) === key) recordsUsedBy = other.path
  }
  return { ok: true, cleanup: await removeProjectFiles(record.path, cleaned, { recordsUsedBy }) }
}

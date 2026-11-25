import { addressOfRemote, repositoryAddress, PROJECTS } from '@openagt/hooks'
import { act, read, type RpcComputerHost } from '@openagt/hooks/rpc'
import { addFolder, type AddResult } from './add.js'
import { cloneProject, cloneTarget, cloneTargetOf } from './clone.js'
import { addRepoFolder, REPO_FOLDERS, removeRepoFolder } from './list.js'
import { canPickDirectory, pickDirectory as askForDirectory, type PickDirectoryResult } from './pick-directory.js'
import { removeListed, type RemoveResult } from './remove.js'
import { thisComputersRepos, type FoundRepo } from './repos.js'

// The projects module's server part (`@openagt/hooks/rpc`), this computer's: what the picker, Add
// project, Remove project and Settings › Repos call, at `/_rpc/@openagt/projects/<name>`. Each
// changes the list through the settings it is handed, and tells the other modules through the
// app's lifecycle it is handed (`host.lifecycle`).

/** How long a call waits for what a person or a clone takes longer to give: past it, the call answers `waiting`, and is asked again. */
export const WAIT_MS = 15_000

/** What a call that waits on a person or a clone answers before it is done: ask again. */
export type Waiting = { waiting: true }

/** The answers on their way, by what they answer: a second ask joins the first. Kept until a call took the answer. */
const onTheirWay = new Map<string, Promise<unknown>>()

/**
 * The answer to `key`, once `start` gave it, or {@link Waiting} after {@link WAIT_MS}: a call is
 * answered within the time a call may take, and the work goes on behind it, for the next ask to
 * take. The work is started once, whoever asks.
 */
async function answerOf<T>(key: string, start: () => Promise<T>, waitMs: number): Promise<T | Waiting> {
  let work = onTheirWay.get(key) as Promise<T> | undefined
  if (!work) onTheirWay.set(key, (work = start()))
  let timer: NodeJS.Timeout | undefined
  const waited = new Promise<Waiting>(resolve => (timer = setTimeout(() => resolve({ waiting: true }), waitMs)))
  const answer = await Promise.race([work.then(value => ({ value })), waited]).finally(() => clearTimeout(timer))
  if ('waiting' in answer) return answer
  onTheirWay.delete(key)
  return answer.value
}

/** Add a folder as a project; the agents' records stay on this computer, the project's Agent data page shares them later. */
export const addProject = act(async (host: RpcComputerHost, { path }: { path: string }): Promise<AddResult> => {
  const trimmed = typeof path === 'string' ? path.trim() : ''
  if (!trimmed) return { ok: false, error: 'a project path is required' }
  return addFolder(host, trimmed, false)
})

/**
 * Open the system's folder dialog on this computer and wait for the person's choice (#1150): the
 * browser cannot learn an absolute path from any picker of its own, and this computer, which the
 * person sits at, can. A dismissed dialog is `path: null`; a dialog still open answers `waiting`,
 * and the next ask waits on the same one.
 */
export const pickDirectory = act(async (_host: RpcComputerHost, { waitMs = WAIT_MS }: { waitMs?: number }): Promise<PickDirectoryResult | Waiting> => answerOf('pick', () => askForDirectory(), waitMs))

/** Where the repository a person typed the address of would be cloned to on this computer, or why what was typed is no address: asked before anything is cloned. */
export const cloneTargetFor = read(async (_host: RpcComputerHost, { address }: { address: string }) => cloneTargetOf(typeof address === 'string' ? address : ''))

/**
 * Add a project by its repository's address, for a computer that does not have its folder: the
 * repository is cloned into `~/projects/<its name>` as the account a module gives for its host
 * (`account.access`), and the folder is then added as {@link addProject} adds one. A folder
 * already there with this repository in it is added as it is. The clone is the module's own work,
 * which goes on behind a call that answers `waiting`; the answer says where the project is.
 */
export const addFromAddress = act(async (host: RpcComputerHost, { address, waitMs = WAIT_MS }: { address: string; waitMs?: number }): Promise<AddResult | Waiting> => {
  const typed = typeof address === 'string' ? address : ''
  const target = cloneTarget(typed)
  if (!target) return cloneTargetOf(typed) as AddResult
  return answerOf(`clone ${target.path}`, async (): Promise<AddResult> => {
    const access = await host.gitAccess(`https://${target.address}`)
    const cloned = await cloneProject(typed, access ? { access } : {})
    if (!cloned.ok) return cloned
    const added = await addFolder(host, cloned.path, false)
    return added.ok ? { ...added, path: cloned.path } : added
  }, waitMs)
})

/**
 * Take a project off the list: nothing in its folder is deleted unless `files` is true, and then
 * the answer says what went and what stayed. Addressed by id and not by path, so a project whose
 * folder is gone can still be removed.
 */
export const removeProject = act(async (host: RpcComputerHost, { projectId, files }: { projectId: string; files?: boolean }): Promise<RemoveResult> => {
  if (typeof projectId !== 'string' || !projectId) return { ok: false, error: 'a project id is required' }
  return removeListed(host, projectId, files === true)
})

/** The repos on this computer that are not projects yet, and whether a folder can be added to look in. */
export interface ReposRead {
  repos: FoundRepo[]
  /** The look through this computer was cut short, and one with more time is on its way: the picker asks again shortly. */
  loading: boolean
  /** This computer can show a folder dialog, so the picker offers "Search another folder…". */
  canAddFolder: boolean
  /** The addresses of the projects' repositories (`github.com/me/shop`): the picker leaves a module's repo that is one of them out. */
  projects: string[]
}

/**
 * The repos a new session can start in besides the projects (Rom's "a project is a sticky repo"):
 * every repository the crawl found on this computer, less those that are projects already. The
 * kept list, so the picker opens at once; an old one is crawled again behind it.
 */
export const repos = read(async (host: RpcComputerHost, _input: object): Promise<ReposRead> => {
  const [found, projects] = await Promise.all([thisComputersRepos(() => host.settings.get(REPO_FOLDERS)).read(), host.settings.get(PROJECTS)])
  const pinned = new Set(projects.map(project => project.path))
  const addresses = await Promise.all(projects.map(project => repositoryAddress(project.path).catch(() => undefined)))
  return {
    repos: found.repos.filter(repo => !pinned.has(repo.path)),
    loading: found.looking,
    canAddFolder: canPickDirectory(),
    projects: [...new Set([...addresses, ...found.repos.map(repo => (repo.url ? addressOfRemote(repo.url) : undefined))].filter((one): one is string => one !== undefined))],
  }
})

/** Settings › Repos: the folders the person added, looked in beside the home folder. */
export const repoFolders = read(async (host: RpcComputerHost, _input: object): Promise<{ folders: string[] }> => ({ folders: await host.settings.get(REPO_FOLDERS) }))

/**
 * "Search another folder…": the system's folder dialog, and the folder picked joins those the
 * crawl looks in, which then runs again before the answer. A dismissed dialog adds nothing; a
 * dialog still open answers `waiting`.
 */
export const addFolderToSearch = act(async (host: RpcComputerHost, { waitMs = WAIT_MS }: { waitMs?: number }): Promise<{ ok: true; added: boolean } | { ok: false; error: string } | Waiting> => {
  const picked = await answerOf('pick', () => askForDirectory(), waitMs)
  if ('waiting' in picked) return picked
  if (!picked.ok) return picked
  if (!picked.path) return { ok: true, added: false }
  await addRepoFolder(host.settings, picked.path)
  await thisComputersRepos(() => host.settings.get(REPO_FOLDERS)).refresh()
  return { ok: true, added: true }
})

/** Stop looking for repos in a folder the person added. */
export const removeFolderToSearch = act(async (host: RpcComputerHost, { folder }: { folder: string }): Promise<{ ok: true } | { ok: false; error: string }> => {
  if (typeof folder !== 'string') return { ok: false, error: 'no folder named' }
  await removeRepoFolder(host.settings, folder)
  await thisComputersRepos(() => host.settings.get(REPO_FOLDERS)).refresh()
  return { ok: true }
})

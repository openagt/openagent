import { join, relative } from 'node:path'
import { excludeFromGit, nodeBranchFileFs, nodeGitRunner, projectDataDir, projectDataDirs, pullProjectData, withProjectData, type BranchFileFs, type CommitMessage, type FileBranchSync, type FileBranchWrite, type GitRunner } from '@openagt/agent-data'
import { TICKETS_DIR } from './names.js'

// Where the tickets live: `tickets/` in the project's data directory (its directory in the
// personal folder, or the checkout of its `agent-data` branch when shared), with a `tickets` link
// at the repository root so the roadmap is one listing away for a person.

/** The `tickets/` directory in the project's data, from anywhere in the project's clone. */
export async function ticketsDir(root: string, git: GitRunner = nodeGitRunner()): Promise<string> {
  return join(await projectDataDir(root, { git }), TICKETS_DIR)
}

/** The plain-file seams an operation on the branch's files needs. */
export type TicketFiles = BranchFileFs

/**
 * A caller's write funnel: apply `op` to a checkout of the branch, commit, push. The default is
 * the persistent checkout's serialized cycle; a test's fake stands in.
 */
export type TicketsFunnel = (root: string, message: CommitMessage, op: (dir: string) => Promise<void>) => Promise<FileBranchWrite>

/** Injectable seams so every operation is unit-testable off disk and git; production takes the defaults. */
export interface TicketDeps extends Partial<TicketFiles> {
  funnel?: TicketsFunnel
  log?: (message: string) => void
}

/** The default funnel: the project's data write. */
export const ticketsFunnel: TicketsFunnel = (root, message, op) => withProjectData(root, message, op)

/** Fill in whatever a caller left out, so an operation reads the same way in tests and out. */
export function resolveTicketDeps(deps: TicketDeps): TicketFiles & { funnel: TicketsFunnel; log: (message: string) => void } {
  const fs = nodeBranchFileFs()
  return {
    read: deps.read ?? fs.read,
    write: deps.write ?? fs.write,
    remove: deps.remove ?? fs.remove,
    list: deps.list ?? fs.list,
    funnel: deps.funnel ?? ticketsFunnel,
    log: deps.log ?? (() => {}),
  }
}

/** The filesystem the root link needs; `node:fs/promises` in production. */
export interface LinkFs {
  /** Whether anything (file, dir, or dangling link) sits at `path`. */
  lexists: (path: string) => Promise<boolean>
  /** Where the link at `path` points; `undefined` when nothing there is a link. */
  readlink: (path: string) => Promise<string | undefined>
  symlink: (target: string, path: string) => Promise<void>
  unlink: (path: string) => Promise<void>
}

function nodeLinkFs(): LinkFs {
  const fs = () => import('node:fs/promises')
  return {
    lexists: path => fs().then(f => f.lstat(path)).then(() => true, () => false),
    readlink: path => fs().then(f => f.readlink(path)).catch(() => undefined),
    symlink: (target, path) => fs().then(f => f.symlink(target, path)),
    unlink: path => fs().then(f => f.unlink(path)),
  }
}

/**
 * Bring a long-lived process's view of the tickets up to date: the repository root links
 * `tickets` into the project's data, and a shared project's branch and its persistent checkout
 * exist and converge with origin — reading what other machines and cloud sessions pushed, and
 * pushing anything an earlier cycle left stranded. Reports why it could not converge; never throws.
 *
 * The root link is created only over nothing — a real `tickets/` directory or a file of the
 * user's own is theirs — or over the link made here to the other place the data was in before the
 * person switched sharing. It is hidden from git the moment it is made, as an uncommitted entry at
 * the root would ride any sweeping `git add -A` onto a code branch. Hiding it takes a pair of
 * rules, because the repository's exclude speaks for every worktree at once, the persistent
 * checkout included, whose root holds the real `tickets/` the branch exists to carry: `/tickets`
 * hides root entries of that name, and `!/tickets/` re-includes directories, which a link never
 * matches — so the link stays hidden while the checkout's directory keeps committing.
 */
export async function syncTickets(
  root: string,
  deps: TicketDeps & { git?: GitRunner; linkFs?: LinkFs } = {},
): Promise<FileBranchSync> {
  const r = resolveTicketDeps(deps)
  const git = deps.git ?? nodeGitRunner()
  const linkFs = deps.linkFs ?? nodeLinkFs()
  const rootLink = join(root, TICKETS_DIR)
  const wanted = relative(root, await ticketsDir(root, git))
  const places = await projectDataDirs(root, { git })
  const made = [places.personal, places.branch].map(dir => relative(root, join(dir, TICKETS_DIR)))
  const at = await linkFs.readlink(rootLink)
  if (at !== undefined && at !== wanted && made.includes(at)) await linkFs.unlink(rootLink).catch(() => {})
  if (!(await linkFs.lexists(rootLink))) {
    await linkFs.symlink(wanted, rootLink).catch(() => {})
    await excludeFromGit(root, '/' + TICKETS_DIR, undefined, git).catch(() => {})
    await excludeFromGit(root, '!/' + TICKETS_DIR + '/', undefined, git).catch(() => {})
  }
  return pullProjectData(root, { git, log: r.log })
}

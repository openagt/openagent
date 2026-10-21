import { lstat, mkdir, readlink, realpath, stat, symlink, unlink } from 'node:fs/promises'
import { dirname, isAbsolute, join } from 'node:path'
import { excludeFromGit, nodeGitRunner, type GitRunner } from '@openagt/agent-data'
import { CLI_BIN_DIR } from './bin-dir.js'

/**
 * A package's command, linked into a checkout that has none: each command at
 * `node_modules/.bin/<command>`, and the package itself at `node_modules/<package>`.
 *
 * A skill's text tells the agent to run its command by the package's full name,
 * `npx @openagt/skill-branches@0.1`. `npx` looks for a copy of the package in the checkout, and asks
 * npm for one otherwise; a copy it finds, it runs by the command's name from `node_modules/.bin`.
 * In a project that depends on the package the checkout already has both, linked with the
 * project's other tools. In a project with nothing installed (an empty folder a dashboard added)
 * it has neither, so both are linked here: the agent then runs the very copy that made its
 * checkout, with nothing downloaded and no network.
 *
 * The package is linked only beside its own commands. Beside another tool that holds a command's
 * name in the project, the full name would run that tool, so there it is left to npm.
 *
 * Hidden from the project's git through the repository's exclude file: a link is the package's
 * state, not the agent's work, and `node_modules` is never a person's. Best-effort: an entry already there (the project's
 * own copy) is left alone, a link of this package's that points nowhere is made again, and a link
 * that cannot be made is a worse run, not a failed one.
 */

/** A package to link into a checkout: its name, its directory (the one holding its `package.json`), and its commands, each a name and its script. */
export interface PackageLink {
  name: string
  dir: string
  bins: Readonly<Record<string, string>>
}

/** Where a checkout holds its tools. */
const BIN_DIR = 'node_modules/.bin'

/** This package, as a {@link PackageLink}: its directory is beside `bin/`. */
export const OWN_PACKAGE: PackageLink = { name: '@openagt/skill-branches', dir: dirname(CLI_BIN_DIR), bins: { branches: join(CLI_BIN_DIR, 'branches') } }

/** The paths of a package's links, relative to a checkout: what the exclude file hides, and the rules a cleanup lifts. */
export function packageLinkPaths(pkg: PackageLink): string[] {
  return [...Object.keys(pkg.bins).map(command => `${BIN_DIR}/${command}`), `node_modules/${pkg.name}`]
}

/** The paths of this package's own links. */
export const COMMAND_LINKS: readonly string[] = packageLinkPaths(OWN_PACKAGE)

export async function linkPackage(repo: string, checkout: string, pkg: PackageLink, git: GitRunner = nodeGitRunner()): Promise<void> {
  let ours = true
  for (const [command, script] of Object.entries(pkg.bins)) {
    const path = `${BIN_DIR}/${command}`
    if (!(await entryExists(join(checkout, path)))) await link(repo, checkout, path, script, 'file', git)
    ours &&= await realpath(join(checkout, path)).then(async found => found === (await realpath(script)), () => false)
  }
  const path = `node_modules/${pkg.name}`
  // 'junction' is the only directory-link type Windows grants without elevation; it is ignored on POSIX.
  if (ours && !(await entryExists(join(checkout, path)))) await link(repo, checkout, path, pkg.dir, process.platform === 'win32' ? 'junction' : 'dir', git)
}

/** This package's own command and package, linked into `checkout`. */
export function linkOwnCommand(repo: string, checkout: string, git: GitRunner = nodeGitRunner()): Promise<void> {
  return linkPackage(repo, checkout, OWN_PACKAGE, git)
}

/**
 * Whether something is at `path`. lstat, not stat: a link that is there counts, whatever it points
 * at. One exception is taken away first: a link to an absolute path that is gone. That is a link
 * this package made to an install that has since moved (the project's own links are relative), and
 * left there it would keep the place of a working one.
 */
export async function entryExists(path: string): Promise<boolean> {
  const entry = await lstat(path).catch(() => undefined)
  if (!entry) return false
  if (!entry.isSymbolicLink()) return true
  const target = await readlink(path).catch(() => undefined)
  if (target === undefined || !isAbsolute(target) || (await stat(target).then(() => true, () => false))) return true
  return unlink(path).then(() => false, () => true)
}

async function link(repo: string, checkout: string, path: string, target: string, type: 'file' | 'dir' | 'junction', git: GitRunner): Promise<void> {
  await excludeFromGit(repo, `/${path}`, undefined, git).catch(() => {})
  try {
    await mkdir(dirname(join(checkout, path)), { recursive: true })
    await symlink(target, join(checkout, path), type)
  } catch {
    // A filesystem that refuses the link: the agent still starts.
  }
}

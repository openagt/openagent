import { basename } from 'node:path'
import { nodeGitRunner, type GitRunner } from './git.js'
import { addressOfRemote, spellingOfRemote } from './repository-address.js'

/**
 * The address of the repository in a folder, as git says its `origin` remote is
 * (`repository-address.ts` reads an address without git, for browser-side code too), and the
 * project's name that comes of it.
 */

/** Where the repository at `cwd` fetches from and pushes to, as its `origin` remote was given; none when it has no `origin`. */
export async function originUrl(cwd: string, git: GitRunner = nodeGitRunner()): Promise<string | undefined> {
  return git(['remote', 'get-url', 'origin'], cwd).then(
    out => out.trim() || undefined,
    () => undefined,
  )
}

/**
 * The address of the repository at `cwd`: its `origin` remote, the one every push goes to. A
 * project with no `origin`, or one that is a folder on this disk, has none and runs on this
 * machine only.
 */
export async function repositoryAddress(cwd: string, git: GitRunner = nodeGitRunner()): Promise<string | undefined> {
  const url = await originUrl(cwd, git)
  return url === undefined ? undefined : addressOfRemote(url)
}

/**
 * A project's name: its repository's, the last part of its address in the letters `origin` writes
 * it with, so the project reads the same on every computer whatever its folder there is called.
 * A project with no address is its folder's.
 */
export async function projectNameOf(cwd: string, git: GitRunner = nodeGitRunner()): Promise<string> {
  return (await repositorySpelling(cwd, git))?.split('/').at(-1) ?? basename(cwd)
}

/** The same address in the letters the `origin` remote is written with: see {@link spellingOfRemote}. */
export async function repositorySpelling(cwd: string, git: GitRunner = nodeGitRunner()): Promise<string | undefined> {
  const url = await originUrl(cwd, git)
  return url === undefined ? undefined : spellingOfRemote(url)
}

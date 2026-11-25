import { execFile } from 'node:child_process'
import { basename } from 'node:path'
import type { ProjectRef } from './project.js'
import { addressOfRemote, spellingOfRemote } from './repository-address.js'

/**
 * The address of the repository in a folder, as git says its `origin` remote is
 * (`repository-address.ts` reads an address without git, for browser-side code too), and the
 * project's name that comes of it: what a project's `remote` ({@link ProjectRef}) is, the kernel's
 * one rule for every module to name a repository by.
 */

/** Runs `git` in `cwd`, resolving its stdout; rejects on a non-zero exit. git-branches' runner is one. */
export type GitRunner = (args: string[], cwd: string) => Promise<string>

/** A read of git's, bounded as git-branches bounds one: the default runner of the reads below. */
const readGit: GitRunner = (args, cwd) =>
  new Promise((resolve, reject) => execFile('git', args, { cwd, timeout: 10_000 }, (err, stdout) => (err ? reject(err) : resolve(String(stdout)))))

/** Where the repository at `cwd` fetches from and pushes to, as its `origin` remote was given; none when it has no `origin`. */
export async function originUrl(cwd: string, git: GitRunner = readGit): Promise<string | undefined> {
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
export async function repositoryAddress(cwd: string, git: GitRunner = readGit): Promise<string | undefined> {
  const url = await originUrl(cwd, git)
  return url === undefined ? undefined : addressOfRemote(url)
}

/**
 * A project's name: its repository's, the last part of its address in the letters `origin` writes
 * it with, so the project reads the same on every computer whatever its folder there is called.
 * A project with no address is its folder's.
 */
export async function projectNameOf(cwd: string, git: GitRunner = readGit): Promise<string> {
  return (await repositorySpelling(cwd, git))?.split('/').at(-1) ?? basename(cwd)
}

/** The same address in the letters the `origin` remote is written with: see {@link spellingOfRemote}. */
export async function repositorySpelling(cwd: string, git: GitRunner = readGit): Promise<string | undefined> {
  const url = await originUrl(cwd, git)
  return url === undefined ? undefined : spellingOfRemote(url)
}

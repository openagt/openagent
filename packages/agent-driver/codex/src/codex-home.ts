import { copyFile, lstat, mkdir, readlink, realpath, rename, rm, stat, symlink } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

// Codex homes: the folder Codex keeps a login and its conversations in (`CODEX_HOME`). The
// person's own; the one kept on this machine for runs with `skills` off, which links to the
// person's login; and an added account's (`codex-accounts.ts`), which links to its own.

/** Where this package keeps what it makes on this machine: `$XDG_STATE_HOME/agent-driver`, or under `~/.local/state`. */
export function driverStateDir(env: NodeJS.ProcessEnv = process.env): string {
  return join(env['XDG_STATE_HOME'] || join(env['HOME'] || homedir(), '.local', 'state'), 'agent-driver')
}

/** The Codex home kept on this machine for every project: `$XDG_STATE_HOME/agent-driver/codex-home`, or under `~/.local/state`. */
export function defaultCodexHome(env: NodeJS.ProcessEnv = process.env): string {
  return join(driverStateDir(env), 'codex-home')
}

/** The person's own Codex home, where their login is: `CODEX_HOME`, else `~/.codex`. */
export function personalCodexHome(env: NodeJS.ProcessEnv = process.env): string {
  return env['CODEX_HOME'] || join(env['HOME'] || homedir(), '.codex')
}

/**
 * Make `home` a Codex home that starts with only a link to the login in `personal`, so a session
 * started there is logged in as the person and loads none of their files. Created on first use;
 * the conversations Codex saves there are kept. A link that is missing or points elsewhere is put
 * back. A plain file in its place is a login Codex saved over the link: when it is newer than the
 * person's own, it is copied onto theirs first, so a refreshed login is never lost.
 */
export async function prepareCodexHome(home: string, personal: string): Promise<void> {
  home = resolve(home)
  personal = resolve(personal)
  await mkdir(home, { recursive: true })
  // The same folder, by whatever path: nothing to link.
  if ((await realpath(home)) === (await realpath(personal).catch(() => personal))) return
  const link = join(home, 'auth.json')
  const target = join(personal, 'auth.json')
  const found = await lstat(link).catch((err: NodeJS.ErrnoException) => {
    if (err.code === 'ENOENT') return undefined
    throw err
  })
  if (found?.isSymbolicLink()) {
    if ((await readlink(link)) === target) return
    await rm(link, { force: true })
  } else if (found?.isFile()) {
    // Moved aside first, so of two sessions starting at once only one takes the file, and a link
    // the other already put back is never copied onto the file it points at.
    const aside = `${link}.${process.pid}.${Date.now()}`
    const taken = await rename(link, aside).then(
      () => true,
      (err: NodeJS.ErrnoException) => {
        if (err.code === 'ENOENT') return false
        throw err
      },
    )
    if (taken) {
      const saved = await lstat(aside)
      const theirs = await stat(target).catch(() => undefined)
      if (saved.isFile() && (!theirs || saved.mtimeMs > theirs.mtimeMs)) {
        try {
          await mkdir(personal, { recursive: true })
          await copyFile(aside, target)
        } catch (err) {
          // Put the saved login back where the next start finds it again.
          await rename(aside, link).catch(() => {})
          throw err
        }
      }
      await rm(aside, { force: true })
    }
  } else if (found) {
    throw new Error(`${link} is neither a file nor a link; remove it to let Codex runs use this home`)
  }
  await symlink(target, link).catch(async (err: NodeJS.ErrnoException) => {
    // Another session starting at the same moment made the same link.
    if (err.code !== 'EEXIST' || (await readlink(link).catch(() => undefined)) !== target) throw err
  })
}

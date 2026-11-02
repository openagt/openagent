import { execFile } from 'node:child_process'
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

// A folder made a repository by a test has no identity of its own to commit under, and a
// machine may have none either (GitHub's runner): the tests bring one, as a person's machine does.
for (const who of ['AUTHOR', 'COMMITTER']) {
  process.env[`GIT_${who}_NAME`] ??= 'tester'
  process.env[`GIT_${who}_EMAIL`] ??= 'tester@example.com'
}

/** A folder for a test: empty, or a git repository with one commit on `main` and an identity of its own. */
export async function folder(git: boolean): Promise<string> {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'openagent-skills-')))
  if (git) {
    await run(root, 'init', '-q', '-b', 'main')
    await run(root, 'config', 'user.email', 'tester@example.com')
    await run(root, 'config', 'user.name', 'tester')
    await run(root, 'config', 'commit.gpgsign', 'false')
    await writeFile(join(root, 'README.md'), '# a project\n')
    await run(root, 'add', '-A')
    await run(root, 'commit', '-q', '-m', 'init')
  }
  return root
}

/** Git in `root`: its stdout. */
export async function run(root: string, ...args: string[]): Promise<string> {
  return (await promisify(execFile)('git', args, { cwd: root })).stdout
}

export const gone = (root: string): Promise<void> => rm(root, { recursive: true, force: true })

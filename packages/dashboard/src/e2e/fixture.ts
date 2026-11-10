// A fixture project as the E2E stories and the demo stand it up (see README.md): a real git repo
// with an `origin`, the tickets and queue skills, and, once it is added to a dashboard, start and
// resume lines that run `fake-run-bin.js`, so a Start goes the whole production way offline.
import { copyFile, mkdir, writeFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { withFileBranch, DATA_BRANCH } from '@openagt/agent-data'
import { TICKETS_DIR } from '@openagt/skill-tickets'
import { QUEUE_FILE } from '@openagt/skill-queue'
import { PROJECT_HOOKS_FILE } from '../project-hooks.js'

/**
 * The two skills every fixture project holds, by the name of each one's folder, with the package
 * whose text it is, read from this workspace's own install: the tickets and the queue. Holding a
 * skill's text is what gives a project that skill's package in the dashboard.
 */
const packageDir = (name: string): string => resolve(dirname(fileURLToPath(import.meta.resolve(name))), '..')
const SKILL_PACKAGES: Record<string, string> = {
  tickets: packageDir('@openagt/skill-tickets'),
  queue: packageDir('@openagt/skill-queue'),
}

const exec = promisify(execFile)

/** Run `git <args>` in `cwd`, failing loudly on error (a broken fixture is a test bug). */
export async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await exec('git', args, { cwd })
  return stdout
}

/**
 * Make `cwd` (an empty directory) a fixture repo holding `files`: committed on `main`, except the
 * tickets and the queue, which go on the data branch where the product reads them.
 */
export async function makeFixtureRepo(cwd: string, files: Record<string, string> = {}): Promise<void> {
  await git(cwd, 'init', '-q', '-b', 'main')
  await git(cwd, 'config', 'user.email', 'e2e@test')
  await git(cwd, 'config', 'user.name', 'e2e')
  const seeded = Object.keys(files).length ? files : { 'README.md': '# story fixture\n' }
  // The tickets and the queue live on the `agent-data` branch (#1748), never in the working
  // tree: a story that seeds them names the same paths, and they land where the product reads.
  const onBranch = Object.entries(seeded).filter(([file]) => file.startsWith(`${TICKETS_DIR}/`) || file === QUEUE_FILE)
  for (const [file, text] of Object.entries(seeded)) {
    if (onBranch.some(([f]) => f === file)) continue
    await mkdir(dirname(join(cwd, file)), { recursive: true })
    await writeFile(join(cwd, file), text)
  }
  // The project keeps its tickets and queue the way a real one does: it holds the two skills'
  // texts, so the dashboard brings their packages to it; its runs and checkouts come from the
  // packages every project has.
  for (const [skill, pkg] of Object.entries(SKILL_PACKAGES)) {
    await mkdir(join(cwd, '.claude', 'skills', skill), { recursive: true })
    await copyFile(join(pkg, 'SKILL.md'), join(cwd, '.claude', 'skills', skill, 'SKILL.md'))
  }
  await git(cwd, 'add', '-A')
  await git(cwd, 'commit', '-q', '-m', 'seed')
  if (onBranch.length) {
    const result = await withFileBranch(cwd, DATA_BRANCH, 'seed', async dir => {
      for (const [file, text] of onBranch) {
        await mkdir(dirname(join(dir, file)), { recursive: true })
        await writeFile(join(dir, file), text)
      }
    })
    if (!result.ok) throw new Error(`could not seed the ${DATA_BRANCH} branch: ${result.error}`)
  }
  // A bare repo standing in for `origin`, because a real project has one: an agent's branch
  // starts from its default branch, and whether a run's work reached it is what a story reads.
  const origin = join(cwd, 'origin.git')
  await git(cwd, 'init', '-q', '--bare', origin)
  await git(cwd, 'remote', 'add', 'origin', origin)
}

/** The tool the fixture's start and resume lines run: a stand-in for a real run's, with a scripted agent. */
export const FAKE_RUN = fileURLToPath(new URL('./fake-run-bin.js', import.meta.url))

/**
 * Give an added fixture project its start and resume lines, and only those: this machine's file,
 * under the directory adding the project ignored. Written after the add, which writes its own
 * defaults there.
 */
export async function writeFakeRunHooks(cwd: string): Promise<void> {
  await writeFile(join(cwd, PROJECT_HOOKS_FILE), `start: node ${JSON.stringify(FAKE_RUN)} start\nresume: node ${JSON.stringify(FAKE_RUN)} resume\n`)
}

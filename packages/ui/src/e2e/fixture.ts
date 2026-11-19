// A fixture project as the E2E stories and the demo stand it up (see README.md): a real git repo
// with an `origin`, and the tickets and queue skills (and more for the demo). Its runs are the
// scripted host's (`fake-runs.ts`), so a Start goes the whole production way offline.
import { copyFile, mkdir, writeFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { withFileBranch, DATA_BRANCH } from '@openagt/agent-data'
import { TICKETS_DIR } from '@openagt/skill-tickets'
import { QUEUE_FILE } from '@openagt/skill-queue'

/**
 * The skills a fixture project can hold, by the name of each one's folder, with the package whose
 * text it is, read from this workspace's own install. Holding a skill's text is what gives a project
 * that skill's package in the dashboard: its pages and cards.
 */
const packageDir = (name: string): string => resolve(dirname(fileURLToPath(import.meta.resolve(name))), '..')
const SKILL_PACKAGES = {
  tickets: packageDir('@openagt/skill-tickets'),
  queue: packageDir('@openagt/skill-queue'),
  logs: packageDir('@openagt/skill-logs'),
  scheduler: packageDir('@openagt/skill-scheduler'),
}
export type FixtureSkill = keyof typeof SKILL_PACKAGES

const exec = promisify(execFile)

/** Run `git <args>` in `cwd`, failing loudly on error (a broken fixture is a test bug). */
export async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await exec('git', args, { cwd })
  return stdout
}

/** Who a fixture's commits are by, and where its `origin` stands, when not the stories' own. */
export interface FixtureOptions {
  /** The repository's git user: its seed commit is theirs, and every commit made in the folder after. */
  user?: { name: string; email: string }
  /**
   * The bare repository that stands in for `origin`. Inside the project's folder by default, where
   * a story's clean-up takes it with the project; a project a person looks at has it elsewhere, or
   * its files (`HEAD`, `config`, `hooks/…`) are listed among the project's own.
   */
  origin?: string
}

/**
 * Make `cwd` (an empty directory) a fixture repo holding `files` and the texts of `skills`: committed
 * on `main`, except the tickets and the queue, which go on the data branch where the product reads them.
 */
export async function makeFixtureRepo(cwd: string, files: Record<string, string> = {}, skills: readonly FixtureSkill[] = ['tickets', 'queue'], options: FixtureOptions = {}): Promise<void> {
  const user = options.user ?? { name: 'e2e', email: 'e2e@test' }
  await git(cwd, 'init', '-q', '-b', 'main')
  await git(cwd, 'config', 'user.email', user.email)
  await git(cwd, 'config', 'user.name', user.name)
  const seeded = Object.keys(files).length ? files : { 'README.md': '# story fixture\n' }
  // The tickets and the queue live on the `agent-data` branch (#1748), never in the working
  // tree: a story that seeds them names the same paths, and they land where the product reads.
  const onBranch = Object.entries(seeded).filter(([file]) => file.startsWith(`${TICKETS_DIR}/`) || file === QUEUE_FILE)
  for (const [file, text] of Object.entries(seeded)) {
    if (onBranch.some(([f]) => f === file)) continue
    await mkdir(dirname(join(cwd, file)), { recursive: true })
    await writeFile(join(cwd, file), text)
  }
  // The project keeps its tickets and queue the way a real one does: it holds the skills' texts,
  // so the dashboard brings their packages to it; its runs and checkouts come from the packages
  // every project has.
  for (const skill of skills) {
    await mkdir(join(cwd, '.claude', 'skills', skill), { recursive: true })
    await copyFile(join(SKILL_PACKAGES[skill], 'SKILL.md'), join(cwd, '.claude', 'skills', skill, 'SKILL.md'))
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
  const origin = options.origin ?? join(cwd, 'origin.git')
  await mkdir(dirname(origin), { recursive: true })
  await git(cwd, 'init', '-q', '--bare', origin)
  await git(cwd, 'remote', 'add', 'origin', origin)
}

/** A run's process as the scripted host spawns it (`fake-runs.ts`): a stand-in for agent-runner's, with a scripted agent. */
export const FAKE_RUN = fileURLToPath(new URL('./fake-run-bin.js', import.meta.url))

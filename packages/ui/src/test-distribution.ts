import { mkdir, stat, symlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DISTRIBUTION_ENV, packageDirOf } from '@openagt/hooks'
import type { DashboardDistribution, DashboardPackage } from './distribution-packages.js'

/**
 * The packages `@openagt/dashboard`'s distribution lists, but agent-runner, whose module a demo
 * gives a run host of its own: what this package's demo and tests run, resolved from this
 * package's install (its devDependencies), with whose each is, and which plugin starts on, as the
 * dashboard says it.
 */
export const DASHBOARD_PACKAGES: DashboardDistribution = [
  { package: '@openagt/store-filesystem' },
  { package: '@openagt/store-git-repository' },
  { package: '@openagt/store-git-branch' },
  { package: '@openagt/skill-branches' },
  { package: '@openagt/skill-github' },
  { package: '@openagt/skills' },
  { package: '@openagt/dashboard-changes' },
  { package: '@openagt/dashboard-files' },
  { package: '@openagt/ui-card-waiting', for: 'computer' },
  { package: '@openagt/user-info', for: 'computer' },
  { package: '@openagt/dashboard-devices', for: 'computer' },
  { package: '@openagt/skill-account-rotation', for: 'computer' },
  { package: '@openagt/skill-ask', on: true },
  { package: '@openagt/skill-logs' },
  { package: '@openagt/skill-tickets' },
  { package: '@openagt/skill-queue' },
  { package: '@openagt/skill-browser' },
  { package: '@openagt/skill-scheduler' },
  { package: '@openagt/skill-discord' },
  { package: '@openagt/skill-reply' },
]

/**
 * The tests' distribution: `@openagt/dashboard`'s packages, agent-runner's among them, and devices
 * on: the tests' computer has its door and its other computers, which they exercise.
 */
const TEST_DISTRIBUTION: DashboardDistribution = [
  ...DASHBOARD_PACKAGES.map(item => (!('module' in item) && item.package === '@openagt/dashboard-devices' ? { ...item, on: true } : item)),
  { package: '@openagt/agent-runner' },
]

export default TEST_DISTRIBUTION

const FILE = fileURLToPath(import.meta.url)

/** How many distributions this process's tests handed down: each is a file of its own, since a distribution is read once per file. */
let handedDown = 0

/** Hand the tests' distribution down to this process, as a distribution's `openagent` does: for a test that reads the packages the dashboard brings. */
export function handDownTestDistribution(env: NodeJS.ProcessEnv = process.env): void {
  env[DISTRIBUTION_ENV] = FILE
}

/** The tests' distribution's packages, less the ones named: for a test whose own package stands in for one of them. */
export function testPackagesBut(...left: readonly string[]): DashboardPackage[] {
  return TEST_DISTRIBUTION.flatMap(item => (!('module' in item) && !left.includes(item.package) ? [item] : []))
}

/**
 * Hand down a distribution of a test's own packages, installed under `dir`'s `node_modules`: each
 * by its name, every project's, unless given as an entry. A package that is not installed there is
 * the tests' distribution's, linked in. Answers what hands down again the distribution handed down
 * before.
 */
export async function handDownDistribution(dir: string, packages: readonly (string | DashboardPackage)[]): Promise<() => void> {
  const entries = packages.map(entry => (typeof entry === 'string' ? { package: entry } : entry))
  for (const { package: name } of entries) {
    const at = join(dir, 'node_modules', name)
    if (await stat(at).then(() => true, () => false)) continue
    await mkdir(dirname(at), { recursive: true })
    await symlink(await packageDirOf(FILE, name), at)
  }
  const file = join(dir, `distribution-${++handedDown}.mjs`)
  await writeFile(file, `export default ${JSON.stringify(entries)}\n`)
  const before = process.env[DISTRIBUTION_ENV]
  process.env[DISTRIBUTION_ENV] = file
  return () => {
    if (before === undefined) delete process.env[DISTRIBUTION_ENV]
    else process.env[DISTRIBUTION_ENV] = before
  }
}

/** {@link handDownDistribution} for the time of `run`. */
export async function withDistribution(dir: string, packages: readonly (string | DashboardPackage)[], run: () => Promise<void>): Promise<void> {
  const handBack = await handDownDistribution(dir, packages)
  try {
    await run()
  } finally {
    handBack()
  }
}

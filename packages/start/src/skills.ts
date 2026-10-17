import { realpath } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { delimiter, dirname } from 'node:path'
import { SKILLS_ENV } from '@openagt/agent-data'

/**
 * The skills every run gets by default: what an agent needs in any project to work at all, read
 * what earlier agents did, ask the person a question, and hand its work over on the project's git
 * host; and the ones the dashboard has pages for, so a page never shows work an agent cannot do:
 * split a task across subagents, the tickets and the queue. The one place they are named: the
 * runner links whatever it is handed, and the dashboard gives every project their pages. Each is
 * linked into a run's checkout, hidden from git, and a project's own skill of the same name takes
 * its place (see the runner's `basic-skills.ts`).
 */
export const DEFAULT_SKILLS: readonly string[] = ['@openagt/skill-logs', '@openagt/skill-question', '@openagt/skill-github', '@openagt/skill-orchestration', '@openagt/skill-tickets', '@openagt/skill-queue']

/**
 * Put the default skills in `env` under {@link SKILLS_ENV}: their packages' directories, resolved
 * from this package's own install, joined by the path delimiter. One that is not installed is
 * left out.
 */
export async function handDownSkills(env: NodeJS.ProcessEnv): Promise<void> {
  const require = createRequire(import.meta.url)
  const dirs: string[] = []
  for (const name of DEFAULT_SKILLS) {
    let manifest: string
    try {
      manifest = require.resolve(`${name}/package.json`)
    } catch {
      continue
    }
    dirs.push(await realpath(dirname(manifest)))
  }
  env[SKILLS_ENV] = dirs.join(delimiter)
}

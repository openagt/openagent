import { join } from 'node:path'
import { DATA_BRANCH } from '@openagt/git-branches'
import { OPENAGENT_DIR } from '@openagt/hooks'

/**
 * The `.openagent/.gitignore` (#313): one file, one content, written at install.
 *
 * Everything under `.openagent/` is this machine's or transient: a run's live files. The
 * lasting records (the runs, the `logs` skill's) live on the data branch
 * (#1582/#1769), so nothing is tracked, this file included: git shows no trace of the directory.
 */

/** The `.gitignore` path under `cwd`'s `.openagent/`. */
export function gitignorePath(cwd: string): string {
  return join(cwd, OPENAGENT_DIR, '.gitignore')
}

/** The whole file: everything under `.openagent/` stays out of git, the file itself too (#1582). */
export function openagentGitignore(): string {
  return `# OpenAgent: agent state is transient; the lasting records live on the ${DATA_BRANCH} branch.\n*\n`
}

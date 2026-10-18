import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const run = promisify(execFile)

/**
 * The Git repository a folder is in, by its top folder: the project `npx @openagt/start` adds when
 * it is typed in that folder. Undefined outside a repository, where there is nothing to add.
 */
export async function repositoryOf(folder: string): Promise<string | undefined> {
  const said = await run('git', ['rev-parse', '--show-toplevel'], { cwd: folder }).catch(() => undefined)
  const top = said?.stdout.trim()
  return top ? top : undefined
}

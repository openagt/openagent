import { homedir } from 'node:os'
import { delimiter, join } from 'node:path'

/**
 * The folder the installs a press runs put their programs in, with no admin: Claude Code's own
 * installer and gh's build both go to `~/.local/bin`. A shell started from a terminal often has it
 * on its PATH by the person's own setup; OpenAgent, started from anywhere, puts it there itself,
 * last, so what is installed after it started is found by its checks and its runs alike.
 */
export function withLocalBin(env: NodeJS.ProcessEnv): void {
  const dir = join(env['HOME'] ?? homedir(), '.local', 'bin')
  const path = env['PATH'] ?? ''
  if (path.split(delimiter).includes(dir)) return
  env['PATH'] = path ? `${path}${delimiter}${dir}` : dir
}

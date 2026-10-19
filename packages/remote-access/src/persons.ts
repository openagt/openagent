import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

/**
 * Start making a person's user, as a process of its own that outlives whoever asked: the command
 * again, with `person-work`. Started by `add --for`, and by the door's process when a person of a
 * server starts their first run on this computer through that server's line. Answers its process.
 */
export function startPersonWork(env: NodeJS.ProcessEnv, account: string): number | undefined {
  const child = spawn(process.execPath, [fileURLToPath(new URL('../bin/remote-access', import.meta.url)), 'person-work', account], { env, detached: true, stdio: 'ignore' })
  child.on('error', () => {})
  child.unref()
  return child.pid
}

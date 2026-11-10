import { execFile, spawn } from 'node:child_process'
import { access, constants } from 'node:fs/promises'
import { delimiter, join } from 'node:path'
import type { AdminStep, InstallIO } from './platform.js'

/** Run a command to its end; rejects with what it said when it fails. `interactive` gives it this terminal, for a password. */
export function run(command: string, args: string[], opts: { interactive?: boolean } = {}): Promise<void> {
  if (opts.interactive) {
    return new Promise((resolvePromise, rejectPromise) => {
      spawn(command, args, { stdio: 'inherit' })
        .on('error', rejectPromise)
        .on('exit', code => (code === 0 ? resolvePromise() : rejectPromise(new Error(`${command} ended with ${code}`))))
    })
  }
  return new Promise((resolvePromise, rejectPromise) => {
    execFile(command, args, (error, _stdout, stderr) => (error ? rejectPromise(new Error(String(stderr).trim() || error.message)) : resolvePromise()))
  })
}

/** Runs `step` as the administrator, in this terminal, which asks for the password. */
export function asAdmin(step: AdminStep, io: InstallIO): Promise<void> {
  io.out(`◆ ${step.says}`)
  return run('sudo', ['/bin/sh', '-c', step.script], { interactive: true })
}

/** Whether `command` runs to its end without failing. */
export function succeeds(command: string, args: string[]): Promise<boolean> {
  return run(command, args).then(
    () => true,
    () => false,
  )
}

/**
 * Whether `command` is on this computer: in `PATH`, or in a folder of the administrator's
 * commands, which a person's own `PATH` may leave out (`nft` is in `/usr/sbin`).
 */
export async function installed(command: string, path: string | undefined): Promise<boolean> {
  const folders = [...(path ?? '').split(delimiter).filter(Boolean), '/usr/local/sbin', '/usr/sbin', '/sbin']
  for (const folder of folders) {
    if (await access(join(folder, command), constants.X_OK).then(() => true, () => false)) return true
  }
  return false
}

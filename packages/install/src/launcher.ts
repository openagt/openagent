import { readFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { quoted } from './address.js'

/**
 * The `openagent` command the install puts on the PATH (#2394, decision 40): a script that runs
 * the copy of the dashboard the computer starts at login, so a terminal and the login service run
 * the same version, and nothing goes into the person's global npm. Written as the administrator,
 * in a folder every PATH has, Mac and Linux alike; `openagent --uninstall` takes it off with the rest.
 */
export const LAUNCHER = '/usr/local/bin/openagent'

/** The line that says the launcher is the install's: the uninstall takes off no other `openagent`. */
export const LAUNCHER_MARK = '# OpenAgent: put here by `npx @openagt/install`'

/** What the launcher runs: the node that ran the install, on the dashboard the login service runs. */
export interface Launcher {
  node: string
  dashboard: string
}

/** The launcher's text. */
export function launcherScript({ node, dashboard }: Launcher): string {
  return `#!/bin/sh
${LAUNCHER_MARK}, to run the dashboard OpenAgent starts at login.
# \`openagent --uninstall\` takes OpenAgent off this computer, this command with it.
exec ${quoted(node)} ${quoted(dashboard)} "$@"
`
}

/**
 * Shell lines that put the launcher in place, as the administrator, however often they run. It is
 * written beside its place and moved there, so an `openagent` there before (a link `npm i -g`
 * made) is replaced, never written through.
 */
export function addLauncherLines(launcher: Launcher, at: string = LAUNCHER): string {
  const next = `${at}.openagent`
  return [
    `mkdir -p ${quoted(dirname(at))}`,
    `printf '%s' ${quoted(launcherScript(launcher))} > ${quoted(next)}`,
    `chmod 755 ${quoted(next)}`,
    `mv -f ${quoted(next)} ${quoted(at)}`,
  ].join('\n')
}

/** A shell line that takes the launcher off, when it is the install's. */
export function removeLauncherLine(at: string = LAUNCHER): string {
  return `if grep -qF ${quoted(LAUNCHER_MARK)} ${quoted(at)} 2>/dev/null; then rm -f ${quoted(at)}; fi`
}

/** Whether the launcher at `file` is the install's: one that cannot be read is none. */
export async function hasLauncher(file: string = LAUNCHER): Promise<boolean> {
  return (await readFile(file, 'utf8').catch(() => '')).includes(LAUNCHER_MARK)
}

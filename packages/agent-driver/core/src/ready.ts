import { execFile } from 'node:child_process'
import { readAccounts } from './accounts.js'

/**
 * Whether a coding agent's CLI can start a session at all, asked before a run spends a checkout
 * on it: the CLI is installed, and it is logged in. Installed is not the same as usable: a CLI
 * that resolves fine and is logged out starts, and every session dies before its first turn.
 *
 * Only a CLI that says no out loud is a problem. An answer this module cannot read is "could not
 * say" and passes: a wrong "you are logged out" blocks a setup that works, which is worse than
 * the dead session this exists to prevent.
 */

/** What stands in the way of a session: problems stop it, warnings are said and do not. Each line names its own fix. */
export interface DriverReadiness {
  problems: string[]
  warnings: string[]
  /** What a press does about the problem, when the adapter has a command for it: install the CLI, or log it in. */
  fix?: DriverFix
  /** The CLI's own login is out, and an added account is what runs use: its own login is no account to show. */
  ownLoggedOut?: true
}

/** The command a press runs about a problem: one the adapter declared, never one from a page. */
export interface DriverFix {
  kind: 'install' | 'log-in'
  /** A shell command line, shown under the button as it is run. */
  command: string
  /** The line of `problems` this answers: a page that says it in its own words, beside its press, leaves that line out. */
  problem: string
}

/**
 * Run `<bin> <args>`: whether it succeeded, and everything it said. stdout and stderr merged,
 * since CLIs disagree about where a status line belongs.
 */
export type CliProbe = (bin: string, args: readonly string[]) => Promise<{ ok: boolean; output: string }>

/** How to ask one coding agent's CLI: what an adapter hands {@link checkCliReady}. */
export interface CliSpec {
  bin: string
  /** The fix when the CLI is missing, after "`<bin>` not found — ". */
  install: string
  /** The arguments that ask the CLI whether it is logged in. */
  authArgs: readonly string[]
  /** Reads the CLI's answer to its login question. `undefined` when it could not say. */
  loggedIn: (result: { ok: boolean; output: string }) => boolean | undefined
  /** The command that logs the CLI in. */
  login: string
  /**
   * The commands a press may run for the person, each with no terminal and no admin: one that
   * installs the CLI where it is found again (a folder on the PATH runs get), one that logs it in
   * in this computer's browser. A CLI with none is fixed by hand, as its line says.
   */
  fixes?: { install?: string; login?: string }
}

export interface DriverReadyOptions {
  /** The CLI binary to ask. Default the spec's own, on `PATH`. */
  bin?: string
  /** The probe. Default {@link probeCli}. */
  probe?: CliProbe
  /** Whether this process runs as root. Default reads its uid. */
  isRoot?: () => boolean
  /** The user `sudo` recorded, named in the root warning. Default `SUDO_USER`. */
  sudoUser?: string | undefined
  /**
   * The agent's accounts file (`accounts.ts`): one that holds an added account is a login runs
   * use, so the CLI's own login is not needed, as on a server that has only the person's own
   * computers' logins. Unsaid, only the CLI's own login counts.
   */
  accounts?: string
}

/**
 * Ask a coding agent's CLI whether a session can start. The login is asked only of a CLI that is
 * there: one "not found" beats two lines saying the same thing.
 *
 * Root is a warning, not a problem: under `sudo` the CLI looks for its credentials in root's home
 * and every session dies alike, saying nothing about why; but a container runs everything as root
 * legitimately.
 */
export async function checkCliReady(spec: CliSpec, opts: DriverReadyOptions = {}): Promise<DriverReadiness> {
  const bin = opts.bin ?? spec.bin
  const probe = opts.probe ?? probeCli
  const problems: string[] = []
  const warnings: string[] = []
  let fix: DriverFix | undefined
  let ownLoggedOut = false

  const version = await probe(bin, ['--version'])
  if (!version.ok) {
    const problem = `\`${bin}\` not found — ${spec.install}`
    problems.push(problem)
    if (spec.fixes?.install !== undefined) fix = { kind: 'install', command: spec.fixes.install, problem }
  } else if (spec.loggedIn(await probe(bin, spec.authArgs)) === false) {
    if (opts.accounts !== undefined && readAccounts(opts.accounts).some(account => account.login !== undefined)) ownLoggedOut = true
    else {
      const problem = `\`${bin}\` is not logged in. Run \`${spec.login}\`, then start again.`
      problems.push(problem)
      if (spec.fixes?.login !== undefined) fix = { kind: 'log-in', command: spec.fixes.login, problem }
    }
  }

  if ((opts.isRoot ?? runningAsRoot)()) {
    const sudoUser = opts.sudoUser !== undefined ? opts.sudoUser : process.env['SUDO_USER']
    warnings.push(
      `running as root, so the coding agent looks for credentials under root's home and will not find yours. Run it as ${sudoUser ? `\`${sudoUser}\`` : 'your own user'}, without \`sudo\`.`,
    )
  }
  return { problems, warnings, ...(fix ? { fix } : {}), ...(ownLoggedOut ? { ownLoggedOut: true as const } : {}) }
}

/** The real probe: the binary on `PATH`, ten seconds at most. */
export function probeCli(bin: string, args: readonly string[]): Promise<{ ok: boolean; output: string }> {
  return new Promise(resolve => {
    execFile(bin, [...args], { timeout: 10_000 }, (err, stdout, stderr) => {
      resolve({ ok: !err, output: `${String(stdout)}${String(stderr)}` })
    })
  })
}

/** Windows has no uid, and is never root by this test. */
function runningAsRoot(): boolean {
  return process.getuid?.() === 0
}

import { checkForUpdate, formatUpdateStatus, nodeVersionFetcher, updateCommand, type VersionFetcher } from './update-check.js'
import { runDaemon, DEFAULT_DAEMON_PORT } from '../daemon.js'
import { joinRunningDashboard } from '../join-dashboard.js'
import type { StartedProject } from '../dashboard/types.js'
import { handDownDistribution } from './distribution.js'
import { openInBrowser } from './browser.js'
import { openagentPackage, openagentVersion } from '../version.js'
import { helpRows, helpText, unknownWord, usageError } from '@openagt/hooks/command'

export type { DashboardDistribution, DashboardPackage } from '../distribution-packages.js'

/** Where the CLI writes. Injectable so tests capture output. */
export interface CliIO {
  out: (line: string) => void
  err: (line: string) => void
}

const defaultIO: CliIO = {
  out: line => process.stdout.write(line + '\n'),
  err: line => process.stderr.write(line + '\n'),
}

/** The command's help; with `--uninstall` where the distribution takes OpenAgent off the computer. */
const helpOf = (uninstall: boolean): string => `OpenAgent — autonomous AI programming, with a coding agent.

${helpRows([
  'Usage:',
  ['openagent', "Serve the dashboard in the foreground. Ctrl+C stops it; the server logs stream to this terminal. Typed inside a Git repository, it adds that repository to the dashboard's projects and opens its page. With the dashboard running already, it hands the repository to that one."],
  'Options:',
  ['--port <n>', 'Dashboard port (default: 4200).'],
  ['-h, --help', 'Show this help.'],
  ['-v, --version', 'Print the version.'],
  ...(uninstall ? [['--uninstall', 'Take OpenAgent off this computer: everything `npx @openagt/install` put on it.'] as [string, string]] : []),
])}

${helpText('The dashboard listens on this computer only.')}

${helpText("Everything else is the dashboard: it shows a project's runs as their hosts say them, and starts one on this computer's run host, the module OpenAgent is distributed with that runs it.")}`

/** What the CLI itself accepts: three options, no verbs (D4). */
export interface CliArgs {
  help: boolean
  version: boolean
  /** `--port <n>`: the port the dashboard binds. Default {@link DEFAULT_DAEMON_PORT}; `0` is ephemeral. */
  port?: number
  error?: string
}

/**
 * Parse argv (without the node/script prefix). Pure and testable.
 *
 * Three options and nothing else: `--port` because it is the one thing a browser cannot be asked
 * and a dashboard cannot serve about itself; `--help` and `--version` because a command with
 * options owes the user both. The command runs no agent (#1774): a run is started
 * from the dashboard, on this computer's run host (#2394).
 */
export function parseArgs(argv: string[]): CliArgs {
  const opts: CliArgs = { help: false, version: false }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!
    switch (arg) {
      case '--help':
      case '-h':
        opts.help = true
        break
      case '--version':
      case '-v':
        opts.version = true
        break
      case '--port': {
        const port = portOf(argv[++i])
        if (port !== undefined) opts.port = port
        else opts.error ??= 'invalid --port: must be a port number from 0 to 65535'
        break
      }
      default:
        // The first thing that could not be read is the one told: what follows an unknown option is its value, not a command.
        opts.error ??= unknownWord(arg)
    }
  }
  return opts
}

/** `value` read as a port to bind, `0` for a free one; undefined when it names no port. */
export function portOf(value: string | undefined): number | undefined {
  const port = value?.trim() ? Number(value) : NaN
  return Number.isInteger(port) && port >= 0 && port <= 65535 ? port : undefined
}

/** What a distribution runs this command with: its `openagent` is this one, serving its modules. */
export interface CliOptions {
  /**
   * The path of the distribution's file (`@openagt/dashboard`'s `distribution.js`), which
   * default-exports its {@link DashboardDistribution}: the packages and modules OpenAgent runs.
   * The package above it is the one OpenAgent is installed as, whose version it says.
   */
  distribution: string
  /**
   * What `openagent --uninstall` runs, handed the words typed with it: the distribution's install,
   * taking OpenAgent off this computer (#2394, decision 39). Absent, the command has no `--uninstall`.
   */
  uninstall?: (argv: string[]) => Promise<number>
  io?: CliIO
}

/**
 * The `openagent` command, as a distribution runs it (#2394): `ui` has no modules of its own, and
 * serves the ones of the distribution it is handed.
 */
export async function runCli(argv: string[], opts: CliOptions): Promise<number> {
  const io = opts.io ?? defaultIO
  // Set in this process's own environment before anything: everything the dashboard starts
  // inherits it, and it says which package OpenAgent is, and so its version.
  handDownDistribution(process.env, opts.distribution)
  const at = argv.indexOf('--uninstall')
  if (at !== -1 && opts.uninstall) return opts.uninstall(argv.filter((_, i) => i !== at))
  const args = parseArgs(argv)
  if (args.error) {
    io.err(usageError('openagent', args.error))
    return 2
  }
  if (args.help) {
    io.out(helpOf(opts.uninstall !== undefined))
    return 0
  }
  if (args.version) {
    io.out(openagentVersion())
    return 0
  }
  // Everything else is bare `openagent`: serve the dashboard in the foreground until Ctrl-C.
  return runForegroundDaemonCmd(args, io)
}

/**
 * Bare `openagent`: run the dashboard server in the foreground (#456), so its logs and any
 * server-thrown errors are visible and Ctrl+C stops it. Blocks until the server is signalled
 * (SIGINT/SIGTERM).
 */
async function runForegroundDaemonCmd(args: CliArgs, io: CliIO): Promise<number> {
  const cwd = process.cwd()
  const port = args.port ?? DEFAULT_DAEMON_PORT
  // The folder this was typed in, handed over: the modules make it a project when it is in a repository.
  const project = cwd
  try {
    let url = ''
    await runDaemon(cwd, {
      port,
      onListening: state => {
        url = state.url
        io.out(`◆ dashboard running: ${state.url}`)
        io.out('  Ctrl+C to stop the dashboard. Server logs stream below.')
        // #312 asks bare `openagent` to print the commands + version too. onListening is sync and
        // runDaemon then blocks until signalled, so this is fire-and-forget by necessity: the
        // update line lands a moment later, above the server logs.
        void printStartupFooter(io)
      },
      project,
      // Outside a repository there is no project to open: the Overview, where one is added.
      onProject: (started: StartedProject | undefined) => (started ? openProject(url, started, io) : openInBrowser(url)),
    })
  } catch (err) {
    // Another dashboard has the port (#2141): this one hands it the folder rather than failing.
    // An ephemeral port never collides, so it never joins.
    if ((err as NodeJS.ErrnoException).code === 'EADDRINUSE' && port !== 0) return joinRunning(port, project, io)
    io.err(`could not start the dashboard (${err instanceof Error ? err.message : String(err)}).`)
    return 1
  }
  io.out('◆ dashboard stopped.')
  return 0
}

/**
 * Say where the project is and open its page, which picks it in the sidebar too. What is printed
 * is the address the page shows; what is opened is its id, which always opens it, whatever the
 * page's modules call their pages: the dashboard then writes the address in its place.
 */
function openProject(url: string, started: StartedProject, io: CliIO): void {
  if (started.added) io.out(`◆ project added: ${started.path}`)
  io.out(`◆ project: ${url}/${encodeURIComponent(started.address)}`)
  openInBrowser(`${url}/${encodeURIComponent(started.id)}`)
}

/**
 * A dashboard runs on the port already: hand it the repository this was typed in, open the page,
 * and end, since this process serves nothing. What holds the port may be no dashboard at all.
 */
async function joinRunning(port: number, project: string, io: CliIO): Promise<number> {
  const running = await joinRunningDashboard(port, project)
  if (!running.joined) {
    io.err(`could not start the dashboard: port ${port} is taken by another program. Pass --port <n> to use another one.`)
    return 1
  }
  io.out(`◆ dashboard already running: ${running.url}`)
  const version = openagentVersion()
  if (running.version !== version) io.out(`  It runs OpenAgent v${running.version}; this is v${version}. Stop it and run this again to use v${version}.`)
  if (!running.project) {
    // Outside a repository there is no project to open: the Overview, where one is added.
    openInBrowser(running.url)
    return 0
  }
  if (!running.project.ok) {
    io.err(`could not add ${project}: ${running.project.error}`)
    return 1
  }
  openProject(running.url, running.project, io)
  return 0
}

/**
 * The startup footer every dashboard path prints (#312): the version, and then — once npm
 * answers — whether that version is the latest.
 *
 * The update line is deliberately not awaited before the static lines. #312 asks for the static
 * info first, and the foreground path (bare `openagent`) blocks on the server forever, so a line
 * printed after the await would never appear there at all. `checkForUpdate` is already forgiving:
 * offline or slow (2.5s cap) resolves to 'unknown', which prints nothing.
 */
export function printStartupFooter(io: CliIO, opts: { fetchLatest?: VersionFetcher } = {}): Promise<void> {
  io.out(`◆ OpenAgent v${openagentVersion()}`)
  const own = openagentPackage()
  if (!own) return Promise.resolve()
  return checkForUpdate(own.version, opts.fetchLatest ?? nodeVersionFetcher(), own.name)
    .then(status => {
      const line = formatUpdateStatus(status, updateCommand(own))
      if (line) io.out(line)
    })
    .catch(() => {})
}

import { checkForUpdate, formatUpdateStatus, nodeVersionFetcher, type VersionFetcher } from './update-check.js'
import { runDaemon, joinRunningDashboard, DEFAULT_DAEMON_PORT, type StartedProject } from '@openagt/dashboard/serve'
import { handDownSkills } from './skills.js'
import { repositoryOf } from './project.js'
import { openInBrowser } from './browser.js'
import { openagentVersion } from './version.js'

/** Where the CLI writes. Injectable so tests capture output. */
export interface CliIO {
  out: (line: string) => void
  err: (line: string) => void
}

const defaultIO: CliIO = {
  out: line => process.stdout.write(line + '\n'),
  err: line => process.stderr.write(line + '\n'),
}

const HELP = `OpenAgent — turnkey AI orchestration that wraps a coding agent (Claude Code or Codex).

Usage:
  openagent              Serve the dashboard in the foreground. Ctrl+C closes it; the server
                         logs stream to this terminal. Typed inside a Git repository, it adds
                         that repository to the dashboard's projects and opens its page. With
                         the dashboard running already, it hands the repository to that one.

Options:
  --port <n>             Dashboard port (default: 4200).
  -h, --help             Show this help.
  -v, --version          Print the version.

The dashboard listens on this computer only. A phone, or another computer's OpenAgent, gets in
from Settings › Devices.

Everything else is the dashboard: it shows a project's runs from their files, and starts one
through the project's own start hook (.openagent/hooks.yml), which names the tool that runs it.`

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
 * from the dashboard, by the project's own start hook.
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
        const n = Number(argv[++i])
        if (Number.isInteger(n) && n >= 0) opts.port = n
        else opts.error ??= 'invalid --port: must be a non-negative integer'
        break
      }
      default:
        // The first thing that could not be read is the one told: what follows an unknown option is its value, not a command.
        opts.error ??= arg.startsWith('-') ? `unknown option: ${arg}` : `unknown command: ${arg}`
    }
  }
  return opts
}

export async function runCli(argv: string[], io: CliIO = defaultIO): Promise<number> {
  const args = parseArgs(argv)
  if (args.error) {
    io.err(args.error)
    io.err('Run `openagent --help` for usage.')
    return 2
  }
  if (args.help) {
    io.out(HELP)
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
  let project: string | undefined
  try {
    // Set in this process's own environment, so everything the dashboard starts inherits it.
    await handDownSkills(process.env)
    project = await repositoryOf(cwd)
    let url = ''
    await runDaemon(cwd, {
      port,
      version: openagentVersion(),
      onListening: state => {
        url = state.url
        io.out(`◆ dashboard running: ${state.url}`)
        io.out('  Ctrl+C to stop the dashboard. Server logs stream below.')
        // #312 asks bare `openagent` to print the commands + version too. onListening is sync and
        // runDaemon then blocks until signalled, so this is fire-and-forget by necessity: the
        // update line lands a moment later, above the server logs.
        void printStartupFooter(io)
        // Outside a repository there is no project to open: the Overview, where one is added.
        if (project === undefined) openInBrowser(state.url)
      },
      ...(project !== undefined ? { project, onProject: (started: StartedProject) => openProject(url, started, io) } : {}),
    })
  } catch (err) {
    // Another dashboard has the port (#2141): this one hands it the folder rather than failing.
    // An ephemeral port never collides, so it never joins.
    if ((err as NodeJS.ErrnoException).code === 'EADDRINUSE' && port !== 0) return joinRunning(port, project, io)
    io.err(`could not start the dashboard (${err instanceof Error ? err.message : String(err)}).`)
    return 1
  }
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
async function joinRunning(port: number, project: string | undefined, io: CliIO): Promise<number> {
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
 * The startup footer every dashboard path prints (#312): where prompts come from, the version,
 * and then — once npm answers — whether that version is the latest.
 *
 * The update line is deliberately not awaited before the static lines. #312 asks for the static
 * info first, and the foreground path (bare `openagent`) blocks on the server forever, so a line
 * printed after the await would never appear there at all. `checkForUpdate` is already forgiving:
 * offline or slow (2.5s cap) resolves to 'unknown', which prints nothing.
 */
export function printStartupFooter(io: CliIO, opts: { fetchLatest?: VersionFetcher } = {}): Promise<void> {
  const version = openagentVersion()
  io.out('')
  io.out('Type a prompt on the dashboard to start an agent, or use:')
  io.out('  openagent --help              All options')
  io.out('')
  io.out(`OpenAgent v${version}`)
  return checkForUpdate(version, opts.fetchLatest ?? nodeVersionFetcher())
    .then(status => {
      const line = formatUpdateStatus(status)
      if (line) io.out(line)
    })
    .catch(() => {})
}

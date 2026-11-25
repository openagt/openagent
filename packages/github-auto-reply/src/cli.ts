import { Refused, UsageError, helpRows, helpText, parseCommandArgs, runCommandLine, type Command, type Failure } from '@openagt/hooks/command'
import { errorMessage } from '@openagt/git-branches'
import { nodeGhRunner, workingGh, type GhRunner } from '@openagt/github'
import { listReplies } from './replies.js'

/**
 * The command the plugin's scheduler row checks GitHub with (#2394): what came for this machine's
 * agents on the project's open issues and pull requests. It answers as every OpenAgent command
 * does (`runCommandLine`), and works as one of OpenAgent's own GitHub accounts, as `github`'s
 * commands do, never as the person's `gh`.
 */

export const USAGE = `usage: github-auto-reply <command>

${helpRows([
  ['replies [--since <iso>]', `what came on the open issues and pull requests this machine's agents worked on, since each agent ended: maintainers' words that call the agent with /agent, and on an agent's own pull request checks that turned red and a conflict once the base branch moved; [{ run, text }], one per run, read from the project's run records; with --since, also [{ for, text, branch? }] for each open issue or pull request no run was on, where a maintainer called the agent since then: the check of the plugin's scheduler row. An account that cannot write to the project pushes to its fork (git remote set-url --push origin <fork>): that fork's pull requests are then this machine's`],
])}

${helpText('JSON on stdout. Exit code 1 for a refusal or a failure (the reason on stderr), 2 for a usage error.')}`

/** The streams and the working directory a run of the CLI sees. */
export interface CliIo {
  cwd: string
  stdout: (line: string) => void
  stderr: (line: string) => void
}

/** What the command works with besides its command line, swapped in tests. */
export interface CliDeps {
  gh?: GhRunner
  env?: NodeJS.ProcessEnv
}

interface Context {
  cwd: string
  gh: GhRunner
  env: NodeJS.ProcessEnv
}

/** A failure no command meant: GitHub, or `gh` talking to it, said no in a way no rule names. */
const GIT_HOST_FAILED: Failure = { reason: 'git-host-failed', detail: errorMessage }

const COMMANDS: Record<string, Command<[Context]>> = {
  replies: async (args, { cwd, gh, env }) => {
    const { values } = parseCommandArgs(args, { since: { type: 'string' } }, 0)
    if (values.since !== undefined && Number.isNaN(Date.parse(values.since))) throw new UsageError(`--since is a time, like 2026-10-09T10:00:00Z, not "${values.since}"`)
    const working = await workingGh({ gh, cwd, env })
    try {
      return await listReplies(cwd, { gh: working, ...(values.since !== undefined ? { since: values.since } : {}) })
    } catch (err) {
      const detail = errorMessage(err)
      throw new Refused({ ok: false, reason: 'git-host-failed', detail }, `the pull requests could not be read: ${detail}`)
    }
  },
}

/** Run the CLI: `argv` is everything after the program name. Resolves to the exit code. */
export function runCli(argv: string[], io: CliIo, deps: CliDeps = {}): Promise<number> {
  const context: Context = { cwd: io.cwd, gh: deps.gh ?? nodeGhRunner(), env: deps.env ?? process.env }
  return runCommandLine(argv, io, { program: 'github-auto-reply', usage: USAGE, commands: COMMANDS, failure: GIT_HOST_FAILED }, context)
}

import { unknownWord, usageError, wrongArguments } from '@openagt/agent-data'
import { clearWebhook, invalidWebhook, postMessage, resolveWebhook, saveWebhook, WEBHOOK_ENV } from './webhook.js'

/**
 * The `discord` command: JSON on stdout, one line for a person on stderr, and the exit code says
 * how it went — 0 for a result, 1 for a refusal or a failure, 2 for a command line that could not
 * be read.
 */

export const USAGE = `usage: discord <command>

  send <message>          post the message to this machine's Discord webhook
  setup <webhook>         save the webhook for this machine (${WEBHOOK_ENV} in the environment wins over it)
  setup --clear           forget this machine's webhook
  status                  whether a webhook is set here, and where it comes from (never the URL)

JSON on stdout. Exit code 1 for a refusal or a failure (the reason on stderr), 2 for a usage error.`

export interface CliIo {
  env: NodeJS.ProcessEnv
  stdout: (line: string) => void
  stderr: (line: string) => void
  fetch?: typeof fetch
}

export async function runCli(argv: string[], io: CliIo): Promise<number> {
  const [command, ...args] = argv
  const answer = (result: Record<string, unknown>, line?: string): number => {
    io.stdout(JSON.stringify(result))
    if (line) io.stderr(line)
    return result['ok'] === true ? 0 : 1
  }
  const usage = (): number => {
    io.stderr(command === undefined ? USAGE : usageError('discord', ['send', 'setup', 'status'].includes(command) ? wrongArguments(command, args) : unknownWord(command)))
    return 2
  }

  if (command === '--help' || command === '-h') {
    io.stdout(USAGE)
    return 0
  }

  if (command === 'send') {
    if (args.length !== 1) return usage()
    const message = args[0]!
    if (!message.trim()) return answer({ ok: false, reason: 'empty' }, 'the message is empty')
    const target = await resolveWebhook(io.env)
    if (!target) return answer({ ok: false, reason: 'no-webhook' }, `no webhook on this machine: run \`discord setup <webhook>\` or set ${WEBHOOK_ENV}`)
    const posted = await postMessage(target.webhook, message, io.fetch)
    return posted.ok ? answer({ ok: true, source: target.source }) : answer({ ok: false, reason: 'not-posted', detail: posted.detail }, posted.detail)
  }

  if (command === 'setup') {
    if (args.length !== 1) return usage()
    if (args[0] === '--clear') return answer({ ok: true, cleared: true, file: await clearWebhook(io.env) })
    const invalid = invalidWebhook(args[0]!)
    if (invalid) return answer({ ok: false, reason: 'invalid', detail: invalid }, invalid)
    const file = await saveWebhook(io.env, args[0]!)
    const shadowed = io.env[WEBHOOK_ENV]?.trim() ? `saved, but ${WEBHOOK_ENV} is set and wins over it` : undefined
    return answer({ ok: true, file, ...(shadowed ? { shadowedBy: WEBHOOK_ENV } : {}) }, shadowed)
  }

  if (command === 'status') {
    if (args.length !== 0) return usage()
    const target = await resolveWebhook(io.env)
    return answer({ ok: true, webhook: target !== undefined, ...(target ? { source: target.source } : {}) })
  }

  return usage()
}

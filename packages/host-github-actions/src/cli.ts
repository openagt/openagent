import { givenName, NAME_FILE_ENV, isRunId } from '@openagt/agent-driver'
import { runTurn, type TurnDeps, type TurnRequest } from './turn.js'

/**
 * The command of the host's own processes (`host.ts`), not a person's: `host-github-actions turn
 * <project folder>` runs one turn of a run there, the turn read off its stdin as JSON. A Stop
 * (SIGINT) ends the turn: the Actions run is cancelled, and the run recorded stopped.
 */

export const USAGE = 'usage: host-github-actions turn <project folder>   (the turn, as JSON, on stdin)'

/** Where the command reads its turn and says what went wrong. */
export interface CliIo {
  stdin: AsyncIterable<string | Buffer>
  stderr: (line: string) => void
}

export async function runCli(argv: readonly string[], io: CliIo, deps: TurnDeps = {}): Promise<number> {
  const [command, dir, ...rest] = argv
  if (command !== 'turn' || dir === undefined || rest.length > 0) {
    io.stderr(USAGE)
    return 2
  }
  const turn = turnOf(await readAll(io.stdin))
  if (typeof turn === 'string') {
    io.stderr(turn)
    return 2
  }
  const stop = new AbortController()
  const onStop = (): void => stop.abort()
  process.once('SIGINT', onStop)
  // The run's name, which whoever started it is asking for (`nameHandOver`): none comes where runs are not named.
  const file = process.env[NAME_FILE_ENV]
  delete process.env[NAME_FILE_ENV]
  const title = file !== undefined ? givenName(file, stop.signal).then(given => (given === 'ask' ? undefined : given)) : undefined
  try {
    await runTurn(dir, turn, { stop: stop.signal, ...(title ? { title } : {}), ...deps })
    return 0
  } catch (err) {
    io.stderr(err instanceof Error ? err.message : String(err))
    return 1
  } finally {
    process.off('SIGINT', onStop)
  }
}

async function readAll(stream: AsyncIterable<string | Buffer>): Promise<string> {
  let text = ''
  for await (const chunk of stream) text += typeof chunk === 'string' ? chunk : chunk.toString('utf8')
  return text
}

/** The turn the host handed over, as far as it is one; else what is wrong with it. */
export function turnOf(text: string): TurnRequest | string {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return 'The turn is no JSON.'
  }
  if (typeof value !== 'object' || value === null) return 'The turn is no JSON object.'
  const { id, prompt, resume, model, account } = value as Record<string, unknown>
  if (typeof id !== 'string' || !isRunId(id)) return 'The turn names no run.'
  if (typeof prompt !== 'string' || !prompt.trim()) return 'The turn sends no prompt.'
  if (resume !== undefined && resume !== true) return 'A turn goes on with its run, or starts it.'
  return {
    id,
    prompt,
    ...(resume === true ? { resume } : {}),
    ...(typeof model === 'string' ? { model } : {}),
    ...(typeof account === 'string' ? { account } : {}),
  }
}

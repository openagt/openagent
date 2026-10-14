import type { Driver } from '@openagt/agent-driver'

/**
 * A run's short name, the way Claude Code on the web names a session: "README.md condensing" for
 * "make readme.md shorter". The person's own words are the whole prompt — too long for a list and
 * often a paragraph — so a list of runs used to read as a column of first lines. The name is asked
 * of the same coding agent the run is on, in one throwaway session with that agent's small, fast
 * model: it costs about a cent, it is never the run's own session (nothing is added to what the
 * agent was asked), and it runs beside the first turn, so nothing waits for it.
 */

/** The small, fast model each coding agent names a run with. An agent not named here names nothing. */
export const TITLE_MODELS: Record<string, string> = {
  'claude-code': 'haiku',
  codex: 'gpt-5.6-luna',
}

/** The longest a name may be: a list row shows about this much, and the model is asked for far less. */
export const MAX_TITLE = 60

/** What the small model is asked. */
export function titlePrompt(prompt: string): string {
  return [
    'Name this coding session in two to five words, the way a list of sessions names one:',
    'a short phrase for the subject of the work, no quotes, no full stop, no prefix.',
    'Answer with the name alone and nothing else.',
    '',
    'The person asked:',
    prompt.slice(0, 2_000),
  ].join('\n')
}

/**
 * The name out of what the model answered: its first non-empty line, free of the wrapping a model
 * adds on its own (quotes, a trailing stop, a "Title:" lead-in), cut to {@link MAX_TITLE}.
 * `undefined` when nothing usable came back — a run keeps the person's own words then.
 */
export function titleOf(said: string): string | undefined {
  const line = said
    .split('\n')
    .map(text => text.trim())
    .find(text => text.length > 0)
  if (line === undefined) return undefined
  const named = line
    .replace(/^(?:title|name|session)\s*:\s*/i, '')
    .replace(/^["'“”‘’`]+|["'“”‘’`]+$/g, '')
    .replace(/[.。]$/, '')
    .trim()
  if (named.length === 0) return undefined
  return named.length > MAX_TITLE ? `${named.slice(0, MAX_TITLE - 1).trimEnd()}…` : named
}

/**
 * Ask the coding agent for the run's short name. One session, one prompt, disposed straight after.
 * Never throws and never takes long: an agent that cannot say, is not logged in, or is slow leaves
 * the run with the person's own words, which is what every run had before.
 */
export async function nameRun(
  driver: Driver,
  opts: { cwd: string; prompt: string; signal?: AbortSignal; timeoutMs?: number },
): Promise<string | undefined> {
  const model = TITLE_MODELS[driver.id]
  if (model === undefined) return undefined
  const stop = new AbortController()
  const onAbort = () => stop.abort()
  opts.signal?.addEventListener('abort', onAbort)
  const timer = setTimeout(() => stop.abort(), opts.timeoutMs ?? 60_000)
  try {
    const session = await driver.start({ cwd: opts.cwd, model, signal: stop.signal })
    try {
      const turn = await session.prompt(titlePrompt(opts.prompt))
      return titleOf(turn.text)
    } finally {
      await session.dispose().catch(() => {})
    }
  } catch {
    return undefined
  } finally {
    clearTimeout(timer)
    opts.signal?.removeEventListener('abort', onAbort)
  }
}

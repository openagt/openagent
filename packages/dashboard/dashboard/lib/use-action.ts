import { useCallback, useState } from 'react'

/**
 * What an action did: `ok` says whether it succeeded, and only then is there a `value`.
 *
 * Said as a pair rather than as "the value, or `undefined` when it did not succeed", because an
 * action that succeeds with nothing to report is not a failure: with the value alone, a `sendStop`
 * that resolves void was indistinguishable from one that threw, and every such caller had to map
 * its success to a stand-in value to tell the two apart.
 */
export type ActionOutcome<T> = { ok: true; value: Succeeded<T> } | { ok: false }

/** What is left of an action's result once its own refusal branch is ruled out. */
type Succeeded<T> = Exclude<T, { ok: false }>

// The write-side twin of use-async's read hooks. Every mutation panel hand-rolled the same
// shape: flip a busy flag, clear the error, await the RPC, route a `{ ok: false, error }`
// result or a thrown error into an error string, and reset busy in a finally. That is this
// hook, once. `run` reports whether the action succeeded and carries its value when it did, so
// the caller does only its success side. `fallback` names the error for a thrown failure that
// carries no message of its own.
export function useAction(): {
  busy: boolean
  error: string | null
  reset: () => void
  run: <T>(fn: () => Promise<T>, fallback?: string) => Promise<ActionOutcome<T>>
} {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const reset = useCallback(() => setError(null), [])

  const run = useCallback(async <T,>(fn: () => Promise<T>, fallback = 'Something went wrong.'): Promise<ActionOutcome<T>> => {
    setBusy(true)
    setError(null)
    try {
      const result = await fn()
      if (isFailure(result)) {
        setError(result.error ?? fallback)
        return { ok: false }
      }
      return { ok: true, value: result as Succeeded<T> }
    } catch (err) {
      setError(err instanceof Error ? err.message : fallback)
      return { ok: false }
    } finally {
      setBusy(false)
    }
  }, [])

  return { busy, error, reset, run }
}

/** A mutating RPC's failure branch: `{ ok: false, error }`. Void results are not failures. */
function isFailure(result: unknown): result is { ok: false; error?: string } {
  return typeof result === 'object' && result !== null && 'ok' in result && (result as { ok: unknown }).ok === false
}

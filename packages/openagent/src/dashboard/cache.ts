/**
 * A read-through cache for the dashboard's slow reads (#1028).
 *
 * The dashboard polls. Every session view asks for its branch's PR, twice (the worktree bar and
 * the handoff summary), on every navigation and again every ten seconds — and a git host read costs
 * about 600ms against a local git read's ten. So the same answer was being bought over and over,
 * and the panel waited for it each time.
 *
 * Three behaviours, and each one is load-bearing:
 *   - **single flight** — concurrent asks for the same key share one call, so two panels and a
 *     poll tick do not become three subprocesses
 *   - **stale while revalidate** — once a value exists it is returned immediately, and refreshed
 *     in the background when it is older than `ttlMs`; nobody waits twice for the same answer
 *   - **a budget on the cold ask** — the first ask waits only `budgetMs` for the answer before
 *     reporting `pending`, so a slow lookup delays one panel's extra detail rather than the page
 *
 * `pending` is not "failed": it means the answer is on its way and the next read will have it.
 * A caller that must not act on a half-answer (offering to open a PR that may already exist)
 * uses it to hold off.
 */

interface Entry<T> {
  /** Set only once a read has succeeded; `has` tells an unset value from a cached `undefined`. */
  value?: T | undefined
  has: boolean
  /** When `value` was read, for the staleness check. */
  at: number
  /** The in-flight refresh, if one is running. */
  inflight?: Promise<T> | undefined
}

const entries = new Map<string, Entry<unknown>>()

/** What a cached read answers with: the value, and whether it is still being fetched. */
export interface Cached<T> {
  value: T | undefined
  /** True when no value is known yet and a read is still running. */
  pending: boolean
  /**
   * When this value was read, for a caller that knows of something that happened since and cannot
   * be in it — a pull request the run opened as it ended, say. Absent while nothing is known yet.
   */
  at?: number
}

/** Clock seam, so the tests do not sleep. */
export type Now = () => number

export interface CacheOptions {
  /** How old a value may be before a background refresh is started. */
  ttlMs?: number
  /** How long a first, uncached ask waits before reporting `pending`. */
  budgetMs?: number
  now?: Now
}

/**
 * Read `key` through the cache, calling `load` when it is missing or stale.
 *
 * A failed load is not cached: it leaves whatever was there (a panel keeps showing the last PR it
 * knew about rather than dropping it because the git host hiccuped) and the next read tries again.
 */
export async function cachedRead<T>(key: string, load: () => Promise<T>, options: CacheOptions = {}): Promise<Cached<T>> {
  const { ttlMs = 60_000, budgetMs = 150, now = Date.now } = options
  const entry = entries.get(key) as Entry<T> | undefined

  // A known value answers straight away. Refresh it in the background when it has aged out, so
  // the cost of being current is never paid by the caller that happens to ask.
  if (entry?.has) {
    if (now() - entry.at >= ttlMs && !entry.inflight) void refresh(key, load, now)
    return { value: entry.value, pending: false, at: entry.at }
  }

  // Nothing known yet: join the running read, or start one, and wait a moment for it.
  const inflight = entry?.inflight ?? refresh(key, load, now)
  const settled = await withBudget(inflight, budgetMs)
  if (settled.done) return { value: settled.value, pending: false, at: (entries.get(key) as Entry<T> | undefined)?.at ?? now() }
  return { value: undefined, pending: true }
}

/** Drop what is cached under `key`, so the next read is a fresh one. */
export function invalidate(key: string): void {
  entries.delete(key)
}

/** Test seam: forget everything. */
export function clearCache(): void {
  entries.clear()
}

function refresh<T>(key: string, load: () => Promise<T>, now: Now): Promise<T> {
  const inflight = load()
    .then(value => {
      entries.set(key, { value, has: true, at: now() })
      return value
    })
    .catch(error => {
      // Keep the last good value; only the in-flight marker goes.
      const current = entries.get(key) as Entry<T> | undefined
      if (current?.has) entries.set(key, { value: current.value, has: true, at: current.at })
      else entries.delete(key)
      throw error
    })
  const current = entries.get(key) as Entry<T> | undefined
  entries.set(key, { ...(current ?? { has: false, at: 0 }), inflight })
  // The rejection is reported to whoever awaited it; nothing else must see an unhandled one.
  inflight.catch(() => {})
  return inflight
}

/** Resolve as soon as `promise` does, or give up waiting after `ms`. */
async function withBudget<T>(promise: Promise<T>, ms: number): Promise<{ done: true; value: T } | { done: false }> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<{ done: false }>(resolve => {
    timer = setTimeout(() => resolve({ done: false }), ms)
  })
  try {
    return await Promise.race([promise.then(value => ({ done: true as const, value })).catch(() => ({ done: false as const })), timeout])
  } finally {
    clearTimeout(timer)
  }
}

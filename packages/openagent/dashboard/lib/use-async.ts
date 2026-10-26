import { createContext, useCallback, useContext, useEffect, useRef, useState, type DependencyList } from 'react'

// Every panel here reads the same way: ask the daemon, hold the answer, drop it on the
// floor if the component moved on. That was written out 12 times, and only the usage
// panel remembered to catch — so a daemon restart made every other tick an unhandled
// rejection. These two hooks are that pattern, once.
//
// A read is never asked again while its answer is on its way: on a server with one core every
// question waits behind the others, and asking again only lengthens the line. The next read of a
// poll is set from when the last one answered, and a tab that is not shown reads nothing until it
// is shown again, when it reads at once.

/**
 * What a read shows when its deps change, until the new answer lands. By default, nothing: the
 * `initial` value, so one target's data is never shown as another's.
 *
 * - `'previous'`: the last answer, whatever it was for. For a read whose target barely matters
 *   to the eye (the git host page of a project), where blanking would only flicker.
 * - `{ remember: key }`: the last answer read under this key, marked loaded, or nothing when no
 *   answer was. For a page a person goes back and forth between (a run's facts): going back shows
 *   what was read last time at once, and the read is made again all the same, so it is replaced
 *   the moment the fresh answer lands. The key names the target, so no other target's answer is
 *   ever shown. Every read under one key is one read: the Overview's tile and card asking the
 *   same question wait for the same answer, and each answer reaches both.
 * - `{ remember: key, stored: true }`: also kept in this browser, for the next time the page is
 *   opened: it shows the last answer from its first frame, faded ({@link StaleReads}) until the
 *   fresh one lands. For what a person opens the page to glance at (the Overview's cards).
 */
export type Keep = 'previous' | { remember: string; stored?: true }

/** The answers kept under their keys, for the page's life. Capped: the oldest goes first. */
const remembered = new Map<string, unknown>()
const REMEMBERED_MAX = 500

function remember(key: string, value: unknown): void {
  remembered.delete(key)
  remembered.set(key, value)
  if (remembered.size > REMEMBERED_MAX) remembered.delete(remembered.keys().next().value!)
}

/** Where a stored answer is kept in the browser. */
const STORED_PREFIX = 'openagent:read:'
/** An answer larger than this is not stored: the browser's room is small, and such a list is not a glance. */
const STORED_MAX = 100_000
/** What was last written under each stored key, so an answer that did not change is not written again. */
const written = new Map<string, string>()

function storage(): Storage | undefined {
  try {
    return typeof window === 'undefined' ? undefined : window.localStorage
  } catch {
    return undefined
  }
}

/** The answer stored under `key` by an earlier visit, if any. */
function storedAnswer(key: string): { value: unknown } | undefined {
  try {
    const text = storage()?.getItem(STORED_PREFIX + key)
    return text ? { value: JSON.parse(text) as unknown } : undefined
  } catch {
    return undefined
  }
}

function store(key: string, value: unknown): void {
  try {
    const text = JSON.stringify(value)
    if (text === undefined || written.get(key) === text) return
    written.set(key, text)
    if (text.length > STORED_MAX) storage()?.removeItem(STORED_PREFIX + key)
    else storage()?.setItem(STORED_PREFIX + key, text)
  } catch {
    // A full or refused storage only costs the next visit its first frame.
  }
}

/** Forget the answer remembered under a key, for a target known to have changed since; with no key, every answer (for tests). */
export function forgetRemembered(key?: string): void {
  if (key === undefined) {
    remembered.clear()
    shared.clear()
    written.clear()
    answered.clear()
    return
  }
  remembered.delete(key)
  written.delete(key)
  try {
    storage()?.removeItem(STORED_PREFIX + key)
  } catch {
    // Nothing stored to forget.
  }
}

/** The keys being read ahead now, so a pointer crossing a row twice asks once. */
const readingAhead = new Set<string>()

/**
 * Read an answer before the page that shows it is opened, and keep it under its key: the page
 * then shows it in its first frame, and reads it again all the same. Nothing is read for a key
 * that already holds an answer.
 */
export function readAhead<T>(key: string, load: () => Promise<T>): void {
  if (remembered.has(key) || readingAhead.has(key)) return
  readingAhead.add(key)
  void load()
    .then(answer => {
      // The page may have opened and read it meanwhile: its answer is the later one.
      if (!remembered.has(key)) remember(key, answer)
    })
    .catch(() => {
      // The page makes its own read when it opens.
    })
    .finally(() => readingAhead.delete(key))
}

/**
 * One read's line: the reads asked of it in order, and who waits for their answers. A read is
 * asked only when none is out, unless it must start after something changed (`reload`); an
 * answer older than one already given is dropped. Shared by every hook reading under one key,
 * else a hook's own.
 */
interface ReadLine {
  asked: number
  given: number
  out?: { n: number; settled: Promise<void> }
  /** Told when a read settles: with its answer, or with nothing when it failed or was dropped. */
  waiting: Set<(answer?: { value: unknown }) => void>
}

const shared = new Map<string, ReadLine>()
/** The keys answered since the page opened: a stored answer under one of them is no longer the only one. */
const answered = new Set<string>()

function lineFor(key: string | undefined): ReadLine {
  const own = (): ReadLine => ({ asked: 0, given: 0, waiting: new Set() })
  if (key === undefined) return own()
  let line = shared.get(key)
  if (!line) shared.set(key, (line = own()))
  return line
}

function ask(line: ReadLine, load: () => Promise<unknown>, key: string | undefined, again: boolean): Promise<void> {
  if (line.out && !again) return line.out.settled
  const n = ++line.asked
  const tell = (answer?: { value: unknown }): void => {
    for (const wait of [...line.waiting]) wait(answer)
  }
  const settled = load().then(
    value => {
      if (n <= line.given) return tell()
      line.given = n
      if (key !== undefined) {
        remember(key, value)
        answered.add(key)
      }
      tell({ value })
    },
    () => tell(),
  )
  const out = {
    n,
    settled: settled.finally(() => {
      if (line.out === out) delete line.out
    }),
  }
  line.out = out
  return out.settled
}

/** What each poll does when the tab is shown again: read at once. */
const onShown = new Set<() => void>()
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') for (const read of [...onShown]) read()
  })
}
const hidden = (): boolean => typeof document !== 'undefined' && document.visibilityState === 'hidden'

/**
 * Set around a part of the page that fades while what it shows is only an answer stored from an
 * earlier visit (an Overview card): every read inside tells it, by its own id, whether it is.
 */
export const StaleReads = createContext<((reader: object, stale: boolean) => void) | null>(null)

/**
 * A rejected read keeps the last value rather than blanking it, which is what the usage
 * panel already did deliberately: an empty bar reads as "nothing used" rather than "no
 * answer". The next tick usually succeeds.
 */
function useAsyncValue<T>(
  load: (() => Promise<T>) | null,
  initial: T,
  everyMs: number | null,
  deps: DependencyList,
  keep?: Keep,
): { value: T; reload: () => Promise<void>; loaded: boolean; stale: boolean } {
  // A remembered answer is there from the very first frame, also on a page just mounted: the
  // effect below runs only after that frame is painted. One stored by an earlier visit stands in
  // when the page has none yet, and says it is stale.
  const keyOf = (): string | undefined => (load && typeof keep === 'object' ? keep.remember : undefined)
  const kept = (key: string | undefined): { value: T; stale: boolean } | undefined => {
    if (key === undefined) return undefined
    if (remembered.has(key)) return { value: remembered.get(key) as T, stale: false }
    if (typeof keep !== 'object' || !keep.stored || answered.has(key)) return undefined
    const stored = storedAnswer(key)
    return stored ? { value: stored.value as T, stale: true } : undefined
  }
  const [first] = useState(() => kept(keyOf()))
  const [value, setValue] = useState<T>(() => (first ? first.value : initial))
  // Whether `value` is an answer rather than the initial. Only a successful read sets it, so a
  // caller that reads absence as a fact ("is this session gone, or just not fetched yet?", #784)
  // never mistakes a daemon hiccup for an answer.
  const [loaded, setLoaded] = useState(first !== undefined)
  const [stale, setStale] = useState(first?.stale ?? false)
  // Captured once, like useState's own initial: it is also what a dep change resets to,
  // and callers pass literals like `[]` that would otherwise be a new value every render.
  const initialRef = useRef(initial)
  // A dep change and an unmount both retire the read line this hook waits on. `reload` reads the
  // same one, so an imperative refetch can't write back after either.
  const lineRef = useRef<{ line: ReadLine; key?: string; live: boolean }>({ line: lineFor(undefined), live: false })
  // The deps the state above was set for. The effect that switches it runs after the frame is
  // painted, so for one frame after a switch the state still holds the last target's answer:
  // the render below answers for the new deps itself in that frame.
  const shownFor = useRef<DependencyList>(deps)
  // Whether the deps changed since the first read: a read for new deps is asked anew, even under a
  // key whose read is out, since that one was asked before the change (a project just added).
  const readBefore = useRef(false)
  // The pace is no target: a change of it keeps what is shown and sets the next read by it.
  const every = useRef(everyMs)
  every.current = everyMs
  const repace = useRef<() => void>(() => {})

  useEffect(() => {
    // Nothing to read, nothing remembered shown: a remembered answer stands in only for a read
    // that is being made again.
    const key = keyOf()
    const stored = typeof keep === 'object' && keep.stored === true
    const line = lineFor(key)
    const current = { line, ...(key !== undefined ? { key } : {}), live: true }
    lineRef.current = current
    // A switch shows nothing rather than the last target's data, unless `keep` says otherwise.
    const shown = kept(key)
    if (shown) {
      setValue(shown.value)
      setLoaded(true)
    } else {
      if (keep !== 'previous') setValue(initialRef.current)
      setLoaded(false)
    }
    setStale(shown?.stale ?? false)
    shownFor.current = deps
    if (!load) return () => void (current.live = false)
    const anew = readBefore.current
    readBefore.current = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const read = (): void => void ask(line, load, key, false)
    // The next read of a poll is set from the last answer, whoever asked for it; a tab not shown
    // sets none, and reads when it is shown again.
    const next = (): void => {
      clearTimeout(timer)
      const ms = every.current
      if (ms !== null && !hidden()) timer = setTimeout(() => void (hidden() || read()), ms)
    }
    repace.current = next
    const told = (answer?: { value: unknown }): void => {
      if (!current.live) return
      if (answer) {
        if (stored && key !== undefined) store(key, answer.value)
        setValue(answer.value as T)
        setLoaded(true)
        setStale(false)
      }
      next()
    }
    line.waiting.add(told)
    if (everyMs !== null) onShown.add(read)
    void ask(line, load, key, anew)
    return () => {
      current.live = false
      repace.current = () => {}
      clearTimeout(timer)
      line.waiting.delete(told)
      onShown.delete(read)
    }
    // The caller owns the dep list: `load` closes over exactly these, by contract.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  const paced = useRef(everyMs)
  useEffect(() => {
    if (paced.current === everyMs) return
    paced.current = everyMs
    repace.current()
  }, [everyMs])

  const reload = useCallback((): Promise<void> => {
    const { line, key, live } = lineRef.current
    if (!load || !live) return Promise.resolve()
    return ask(line, load, key, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  // Told to the part of the page around this read, which fades while it is stale.
  const fade = useContext(StaleReads)
  const reader = useRef({})
  const shownStale = stale && sameDeps(shownFor.current, deps)
  useEffect(() => {
    if (!fade) return
    const id = reader.current
    fade(id, shownStale)
    return () => fade(id, false)
  }, [fade, shownStale])

  if (!sameDeps(shownFor.current, deps)) {
    const shown = kept(keyOf())
    if (shown) return { value: shown.value, reload, loaded: true, stale: shown.stale }
    return { value: keep === 'previous' ? value : initialRef.current, reload, loaded: false, stale: false }
  }
  return { value, reload, loaded, stale }
}

function sameDeps(a: DependencyList, b: DependencyList): boolean {
  return a.length === b.length && a.every((dep, i) => Object.is(dep, b[i]))
}

/**
 * Read once, and again whenever `deps` change.
 *
 * Pass `null` for `load` when there is nothing to read yet (no project selected): the
 * value stays `initial` and no read is made. `load` must close over exactly `deps`.
 */
export function useLoaded<T>(
  load: (() => Promise<T>) | null,
  initial: T,
  deps: DependencyList,
  keep?: Keep,
): T {
  return useAsyncValue(load, initial, null, deps, keep).value
}

/**
 * Read now, again `everyMs` after each answer, and again whenever `deps` change. Polling stops on
 * unmount, and while the tab is not shown. `reload` reads immediately, for when a local action
 * means the next tick is too late to wait for, and settles once that read has answered.
 *
 * Pass `null` for `load` when there is nothing to read yet. `load` must close over
 * exactly `deps`. `loaded` is false until the first successful read, and again after
 * a dep change — for callers that must tell "not there" from "not read yet". `stale` is true
 * while the value is only an answer stored by an earlier visit (`{ remember, stored: true }`).
 */
export function usePolled<T>(
  load: (() => Promise<T>) | null,
  initial: T,
  everyMs: number,
  deps: DependencyList,
  keep?: Keep,
): { value: T; reload: () => Promise<void>; loaded: boolean; stale: boolean } {
  return useAsyncValue(load, initial, everyMs, deps, keep)
}

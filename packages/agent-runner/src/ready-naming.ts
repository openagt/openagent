import type { Driver, ReadyPrompt } from '@openagt/agent-driver'
import { readPersonal } from './config.js'
import { driverFor, type DriverName } from './runner.js'
import { isBareCommand, startNaming, TITLE_MODELS, titleOf, titlePrompt, type NamingSession } from './title.js'

// A run's name, ready the moment the run is started: what keeps a session's row from waiting
// seconds for it, as Claude Code on the web has its name in about a second and a half.
//
// The name is a small model's answer (`title.ts`), and most of the time a fresh naming session
// takes is the coding agent's own start-up, not the model: Claude Code reads its settings and its
// login for about a second before it asks anything, Codex starts its server and opens a
// conversation for two. Measured on the same prompt: two seconds fresh, one ready (Claude Code);
// four fresh, two with the conversation open (Codex). So a long-lived process that starts runs —
// the dashboard's — keeps one naming session started and waiting, takes it for a run the moment
// the run is started, and starts the next one for the run after.
//
// One waits per setup a run would name with: the coding agent and the person's setup parts that
// are off on this machine. A project like most shares the one. A coding agent nobody starts a run on has none waiting: one is made after its
// first run, which is named the way it always was, by a session started then.
//
// A session waits a while at most and is replaced: its process holds a login that may be refreshed
// under it, and a prompt it was started with that names the day.

/** How long a naming session waits for a run before it is replaced by a fresh one. */
export const READY_NAMING_MAX_WAIT_MS = 20 * 60_000

/** How often the waiting sessions are looked over: replaced when old, or when their process ended. */
const LOOK_OVER_EVERY_MS = 60_000

/**
 * The most naming sessions kept waiting at once: a few projects with setups of their own, each a
 * process holding a couple of hundred megabytes. The one waiting longest goes first.
 */
export const READY_NAMING_MAX_WAITING = 3

/** How long a name may take before the run goes on with none from here. */
const NAMING_TIMEOUT_MS = 60_000

/** The driver a run started in a project would name with, and what tells its setup apart from another's. */
export interface NamingSetup {
  key: string
  driver: Driver
}

/** The setup a run of `driver` in `repo` names with: the project's setup parts. */
export async function namingSetup(repo: string, driver: DriverName): Promise<NamingSetup> {
  const personal = await readPersonal(repo, () => {})
  return { key: JSON.stringify([driver, personal]), driver: driverFor(driver, undefined, personal) }
}

interface Waiting {
  ready: ReadyPrompt
  naming: NamingSession
  since: number
  setup: NamingSetup
}

export interface ReadyNamingDeps {
  setup?: (repo: string, driver: DriverName) => Promise<NamingSetup>
  now?: () => number
  maxWaitMs?: number
  maxWaiting?: number
}

/** The naming sessions a long-lived process keeps waiting, one per setup ({@link namingSetup}). */
export class ReadyNaming {
  private readonly waiting = new Map<string, Waiting>()
  /** Sessions being started, by setup: one start per setup at a time. */
  private readonly starting = new Map<string, Promise<void>>()
  private readonly timer: ReturnType<typeof setInterval>
  private closed = false

  constructor(private readonly deps: ReadyNamingDeps = {}) {
    this.timer = setInterval(() => this.lookOver(), LOOK_OVER_EVERY_MS)
    this.timer.unref()
  }

  /** Whether a run of `driver` started with `prompt` is named here: not a bare command (named from its report), and on an agent with a small model to name with. */
  names(prompt: string, driver: DriverName): boolean {
    return !this.closed && !isBareCommand(prompt) && TITLE_MODELS[driver] !== undefined
  }

  /** Have a naming session waiting for runs of `driver` in `repo`, unless one waits already. Never throws. */
  async prepare(repo: string, driver: DriverName): Promise<void> {
    const setup = await this.setupOf(repo, driver)
    if (setup) await this.keep(setup)
  }

  /**
   * The name of a run of `driver` started in `repo` with `prompt`: asked of the session waiting for
   * it, or of one started now when none waits, and the next one started once it answered.
   * `undefined` when this run is not named here — an agent with no small model, a bare command
   * (named from its report) — or when no name came: the run's words stay its name, or it asks on
   * its own. Never throws.
   */
  async name(repo: string, prompt: string, driver: DriverName, signal?: AbortSignal): Promise<string | undefined> {
    if (!this.names(prompt, driver)) return undefined
    const setup = await this.setupOf(repo, driver)
    if (!setup) return undefined
    const taken = this.take(setup.key) ?? (await this.start(setup))
    if (!taken) return undefined
    const stop = () => taken.ready.cancel()
    signal?.addEventListener('abort', stop)
    const timer = setTimeout(stop, NAMING_TIMEOUT_MS)
    try {
      return titleOf((await taken.ready.prompt(titlePrompt(prompt))).text)
    } catch {
      return undefined
    } finally {
      clearTimeout(timer)
      signal?.removeEventListener('abort', stop)
      // Not waited on: the name is what the caller waits for.
      void this.end(taken).then(() => this.keep(setup))
    }
  }

  /** End every waiting session; none is started after. */
  async close(): Promise<void> {
    this.closed = true
    clearInterval(this.timer)
    await Promise.allSettled([...this.starting.values()])
    const all = [...this.waiting.values()]
    this.waiting.clear()
    await Promise.all(all.map(one => this.end(one)))
  }

  private async setupOf(repo: string, driver: DriverName): Promise<NamingSetup | undefined> {
    return (this.deps.setup ?? namingSetup)(repo, driver).catch(() => undefined)
  }

  private now(): number {
    return (this.deps.now ?? Date.now)()
  }

  /** Whether a waiting session may still be asked: its process still waits for words, and it has not waited too long. */
  private fresh(one: Waiting): boolean {
    return one.ready.waiting && this.now() - one.since < (this.deps.maxWaitMs ?? READY_NAMING_MAX_WAIT_MS)
  }

  /** The waiting session of a setup, taken off the list: only one that is {@link fresh}. */
  private take(key: string): Waiting | undefined {
    const one = this.waiting.get(key)
    if (!one) return undefined
    this.waiting.delete(key)
    if (this.fresh(one)) return one
    void this.end(one)
    return undefined
  }

  /** Start a session for a setup and keep it waiting, unless one waits or is being started. */
  private keep(setup: NamingSetup): Promise<void> {
    if (this.closed || this.waiting.has(setup.key)) return Promise.resolve()
    const already = this.starting.get(setup.key)
    if (already) return already
    const started = this.start(setup)
      .then(one => {
        if (!one) return
        if (this.closed || this.waiting.has(setup.key)) return void this.end(one)
        if (this.waiting.size >= (this.deps.maxWaiting ?? READY_NAMING_MAX_WAITING)) {
          const [oldest] = [...this.waiting].sort(([, a], [, b]) => a.since - b.since)
          if (oldest) {
            this.waiting.delete(oldest[0])
            void this.end(oldest[1])
          }
        }
        this.waiting.set(setup.key, one)
      })
      .finally(() => this.starting.delete(setup.key))
    this.starting.set(setup.key, started)
    return started
  }

  /** A naming session started now (`title.ts`), its process waiting for words; none where the driver cannot start one ready. */
  private async start(setup: NamingSetup): Promise<Waiting | undefined> {
    const naming = await startNaming(setup.driver).catch(() => undefined)
    if (!naming) return undefined
    const ready = naming.session.ready?.()
    if (!ready) {
      await naming.close()
      return undefined
    }
    return { ready, naming, since: this.now(), setup }
  }

  private async end(one: Waiting): Promise<void> {
    one.ready.cancel()
    await one.naming.close()
  }

  /** Replace each waiting session that is too old, or whose process ended on its own. */
  private lookOver(): void {
    for (const [key, one] of [...this.waiting]) {
      if (this.fresh(one)) continue
      this.waiting.delete(key)
      void this.end(one).then(() => this.keep(one.setup))
    }
  }
}

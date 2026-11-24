// `@openagt/hooks/testing`: fakes of the hooks, so a module is tested alone: a store kept in
// memory, a host whose runs a test drives, a run's context for a step, and the host a server
// part's function is handed.
import { StoreOrder } from './order.js'
import type { InboxLine } from './agent.js'
import type { GitAccounts } from './account.js'
import type { AppContext } from './app.js'
import type { RpcComputerHost, RpcHost } from './rpc.js'
import type { RunFeedEvent } from './run-event.js'
import type { RunContext, RunFound, RunHost, RunInput, RunRef, RunRequest, RunStatus, RunSummary } from './run.js'
import { settingsIn, type Settings } from './settings.js'
import { chainStore, changesOf, checkPath, isUnder, messageOf, scopeKey, type Scope, type Store, type StoreBackend } from './store.js'

/** A store kept in memory: the end of the chain, as the filesystem store is. */
export interface MemoryStore extends StoreBackend {
  /** The files a scope holds, by path. */
  files(scope: Scope): Record<string, string>
  /** Every save, in order: its scope, its message, the paths it changed. */
  readonly saves: readonly { scope: Scope; message: string; paths: string[] }[]
}

/** Settings kept in a memory store: for a function's host, or any test that reads and saves a setting. */
export function memorySettings(): Settings {
  return settingsIn(chainStore([memoryStore()]))
}

export function memoryStore(): MemoryStore {
  const data = new Map<string, Map<string, string>>()
  const watchers = new Set<{ key: string; path: string; onChange: (path: string) => void }>()
  const saves: { scope: Scope; message: string; paths: string[] }[] = []
  const filesOf = (scope: Scope): Map<string, string> => {
    const key = scopeKey(scope)
    let files = data.get(key)
    if (!files) {
      files = new Map()
      data.set(key, files)
    }
    return files
  }
  const changed = (scope: Scope, path: string): void => {
    const key = scopeKey(scope)
    for (const watcher of [...watchers]) if (watcher.key === key && isUnder(path, watcher.path)) watcher.onChange(path)
  }
  const read = async (scope: Scope, path: string): Promise<string | undefined> => filesOf(scope).get(checkPath(path))
  const list = async (scope: Scope, dir: string): Promise<string[]> => {
    checkPath(dir, { dir: true })
    return [...filesOf(scope).keys()].filter(path => path !== dir && isUnder(path, dir)).sort()
  }
  // One save at a time, as a backend that locks its scope makes them: an update reads what the
  // save before it wrote.
  let saving: Promise<unknown> = Promise.resolve()
  const store: Store = {
    read,
    list,
    save(scope, update, message) {
      const save = async (): Promise<void> => {
        const changes = await changesOf(update, { read: path => read(scope, path), list: dir => list(scope, dir) })
        const files = filesOf(scope)
        for (const [path, text] of Object.entries(changes)) {
          if (text === null) files.delete(path)
          else files.set(path, text)
        }
        const paths = Object.keys(changes)
        saves.push({ scope, message: messageOf(message), paths })
        for (const path of paths) changed(scope, path)
      }
      const done = saving.then(save, save)
      saving = done.catch(() => undefined)
      return done
    },
    watch(scope, path, onChange) {
      const watcher = { key: scopeKey(scope), path: checkPath(path, { dir: true }), onChange }
      watchers.add(watcher)
      return () => {
        watchers.delete(watcher)
      }
    },
  }
  return {
    order: StoreOrder.FILESYSTEM,
    wrap: () => store,
    files: scope => Object.fromEntries(filesOf(scope)),
    saves,
  }
}

/** A host whose runs live in memory: a test emits their events and ends them. */
export interface FakeHost extends RunHost {
  /** Every start asked, in order. */
  readonly requests: readonly RunRequest[]
  readonly resumed: readonly { id: string; input: RunInput }[]
  /** The lines said to a working run, in order. */
  readonly steered: readonly { id: string; line: InboxLine }[]
  readonly stopped: readonly { id: string; force: boolean }[]
  events(run: RunRef, signal: AbortSignal): AsyncIterable<RunFeedEvent>
  /** A run's next event: its streams get it. */
  emit(id: string, event: RunFeedEvent): void
  /** A run ends: its streams end after the events they have not read yet. */
  end(id: string, status: Exclude<RunStatus, 'working'>): void
  /** Where a run's work is, as `find` answers it from then on: a run the host started is found with nothing known of its work until then. */
  place(id: string, found: RunFound): void
}

export function fakeHost(opts: { id?: string; label?: string } = {}): FakeHost {
  const runs = new Map<string, { summary: RunSummary; events: RunFeedEvent[]; waiting: Set<() => void> }>()
  const requests: RunRequest[] = []
  const resumed: { id: string; input: RunInput }[] = []
  const steered: { id: string; line: InboxLine }[] = []
  const stopped: { id: string; force: boolean }[] = []
  const places = new Map<string, RunFound>()
  let next = 1
  const runOf = (id: string) => {
    const run = runs.get(id)
    if (!run) throw new Error(`No run ${id} here`)
    return run
  }
  const wake = (run: { waiting: Set<() => void> }): void => {
    for (const resolve of [...run.waiting]) resolve()
    run.waiting.clear()
  }
  const end = (id: string, status: Exclude<RunStatus, 'working'>): void => {
    const run = runOf(id)
    run.summary = { ...run.summary, status, endedAt: new Date().toISOString() }
    wake(run)
  }
  const resume = async ({ id }: RunRef, input: RunInput): Promise<void> => {
    const run = runOf(id)
    resumed.push({ id, input })
    const { endedAt: _, ...rest } = run.summary
    run.summary = { ...rest, status: 'working' }
  }
  return {
    id: opts.id ?? 'fake',
    label: opts.label ?? 'A fake host',
    requests,
    resumed,
    steered,
    stopped,
    async start(request) {
      requests.push(request)
      const id = `run-${next++}`
      const summary: RunSummary = { id, host: opts.id ?? 'fake', status: 'working', startedAt: new Date().toISOString(), prompt: request.prompt, ...(request.project !== undefined ? { project: request.project.id } : {}) }
      runs.set(id, { summary, events: [], waiting: new Set() })
      return { id }
    },
    resume,
    async steer(run, line) {
      if (runOf(run.id).summary.status === 'working') steered.push({ id: run.id, line })
      else if (line.kind === 'message') await resume(run, { text: line.text })
      else if (line.kind === 'answer') await resume(run, { answer: line.answer })
    },
    async stop({ id }, stopOpts) {
      stopped.push({ id, force: stopOpts?.force ?? false })
      end(id, 'stopped')
    },
    async list(project, wanted = {}) {
      return [...runs.values()]
        .reverse()
        .map(run => run.summary)
        .filter(summary => summary.project === project?.id && (!wanted.ids || wanted.ids.includes(summary.id)) && (wanted.since === undefined || summary.startedAt >= wanted.since))
    },
    async find({ id }) {
      return places.get(id) ?? (runs.has(id) ? { changedNothing: false } : undefined)
    },
    async *events({ id }, signal) {
      const run = runOf(id)
      let read = 0
      for (;;) {
        while (read < run.events.length) yield run.events[read++]!
        if (run.summary.status !== 'working' || signal.aborted) return
        await new Promise<void>(resolve => {
          run.waiting.add(resolve)
          signal.addEventListener('abort', () => resolve(), { once: true })
        })
      }
    },
    emit(id, event) {
      const run = runOf(id)
      run.events.push(event)
      wake(run)
    },
    end,
    place(id, found) {
      places.set(id, found)
    },
  }
}

/** A run's context for a step's tests: what is not given is empty, and the store is kept in memory. */
export function fakeRun(given: Partial<Omit<RunContext, 'store' | 'settings'>> & { store?: Store } = {}): RunContext {
  const store = given.store ?? chainStore([memoryStore()])
  return {
    id: 'run-1',
    prompt: '',
    options: {},
    context: [],
    skills: [],
    env: {},
    facts: {},
    signal: new AbortController().signal,
    ...given,
    store,
    settings: settingsIn(store),
  }
}

/** What a module's life in the app is handed, for its tests: `projects` its projects (none when unsaid), a store and its settings in memory, no account at any git host, and a signal never aborted. */
export function fakeApp(given: Partial<AppContext> = {}): AppContext {
  const store = given.store ?? chainStore([memoryStore()])
  return { projects: async () => [], store, settings: settingsIn(store), gitAccess: async () => undefined, signal: new AbortController().signal, ...given }
}

/** OpenAgent's accounts for a test: none at any host, so nothing can be sent. */
const NO_ACCOUNTS: GitAccounts = {
  hosts: async () => [],
  sendAs: async host => ({ ok: false, error: `OpenAgent has no account at ${host}` }),
}

/**
 * The host a function of a module of the computer's is handed, for the module's server tests:
 * settings in memory, no project registered and no account at any git host, unless `given` says otherwise.
 */
export function computerRpcHost(given: Partial<RpcComputerHost> = {}): RpcComputerHost {
  return { settings: memorySettings(), projects: async () => [], accounts: NO_ACCOUNTS, ...given }
}

/**
 * The host a function of a project's module is handed, for the module's server tests: the project
 * `project` at `/work/project`, settings in memory, and no run, merge, question or account known,
 * and every line said and every landing written down refused, unless `given` says how it answers.
 */
export function rpcHost(given: Partial<RpcHost> = {}): RpcHost {
  return {
    settings: memorySettings(),
    projects: async () => [{ id: 'project', name: 'project', dir: '/work/project' }],
    accounts: NO_ACCOUNTS,
    root: '/work/project',
    project: async () => ({ id: 'project', name: 'project', dir: '/work/project' }),
    run: async () => undefined,
    mergeCommit: async () => ({ pending: false }),
    questions: async () => [],
    say: async () => {
      throw new Error('no run of this test takes a line')
    },
    landed: async () => {
      throw new Error('no run of this test keeps a record')
    },
    gitAccess: async () => undefined,
    modulesOn: async () => [],
    ...given,
  }
}

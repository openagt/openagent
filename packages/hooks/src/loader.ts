import { readFile, realpath } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { GitAccess, GitAccounts } from './account.js'
import { ROUTE_PATH, type AppContext, type AppRoute, type AppStart, type AttentionArgs, type AttentionRead, type CleanupReport, type GivenFolder, type ProjectRemoval, type ProjectsLifecycle } from './app.js'
import { HOOK_NAMES, MODULE_NAME, type HookName, type ModuleDefinition, type OwnRow } from './module.js'
import { runPipeline, type OrderedStep, type PipelineResult } from './pipeline.js'
import type { ProjectRef } from './project.js'
import type { RunAgent } from './agent.js'
import type { RunContext, RunHost, RunOptions, RunSkill, SkillArgs } from './run.js'
import { enabledSetting, SETTING_SCOPES, settingsIn, type Setting, type Settings } from './settings.js'
import { chainStore, scopeKey, type Store, type StoreContext } from './store.js'

/** A module, as a distribution lists it. */
export interface DistributionEntry {
  module: ModuleDefinition
  /** For a plugin: it starts enabled, until a person switches it off. */
  on?: boolean
  /** The package the module is the Node part of, when the distribution lists it by its package. */
  package?: string
}

/** A handler that threw: the loader went on without what it would have given. */
export interface HandlerError {
  module: string
  /** Where it threw: `app.attention`, `run.skills`, `app.lifecycle.started`… */
  hook: string
  error: unknown
}

export interface HooksOptions {
  /** Every registered project, for a module's {@link AppContext.projects}; none in a process with no registry, such as a run's own. */
  projects?: () => Promise<ProjectRef[]>
  /** Told of each handler that threw. Without it, the error goes to stderr. */
  onError?: (error: HandlerError) => void
  /** The process runs one command and exits, a command an agent runs: the store's backends are told ({@link StoreContext}). */
  oneShot?: boolean
}

/** A skill, with the module that gives it. */
export interface GivenSkill extends RunSkill {
  module: string
}

/**
 * A distribution's modules, loaded: the one way anything calls a module's hooks. A plugin's hooks
 * are called only where it is on: its Enabled row on (per person, per computer, or in the
 * project; one kept per project is as the distribution starts it where no project is named, such
 * as a session with no project), and, for a run, not among the plugins the run goes without. A
 * core module is always on. The store's chain is the exception: every backend is in it, since
 * the Enabled rows are read through the store; a git store keeps its own row, what its link reads
 * to know where the data is ({@link OwnRow}).
 *
 * A handler that throws is told to `onError`, and the others go on: one module never takes the
 * app down. A run step that throws is no such handler: it fails the run (`run`).
 */
export interface Hooks {
  /** The modules, in the distribution's order. */
  readonly modules: readonly ModuleDefinition[]
  /** The store every backend's link makes, the filesystem store at its end. */
  readonly store: Store
  readonly settings: Settings
  module(name: string): ModuleDefinition | undefined
  /** The module the distribution's package `name` is the Node part of; none for a package without one. */
  ofPackage(name: string): ModuleDefinition | undefined
  /** Whether a module is on: always for a core module; for a plugin, its Enabled row, in `project` for one kept per project. */
  enabled(name: string, project?: ProjectRef): Promise<boolean>
  /** The modules on, in the distribution's order: every core module, and each plugin whose Enabled row is on, in `project` for one kept per project. Each scope's rows are read once for all of them. */
  on(project?: ProjectRef): Promise<ModuleDefinition[]>
  /** Switch a plugin's Enabled row, in `project` for one kept per project. One that keeps its own row is switched on its Settings entry, not here. */
  setEnabled(name: string, on: boolean, project?: ProjectRef): Promise<void>
  /** A run's steps, sorted by order; at the same order, in the distribution's order, then each module's own. */
  steps(run: { project?: ProjectRef; options: RunOptions }): Promise<OrderedStep[]>
  /** Run a run's steps, as {@link runPipeline} does. */
  run(ctx: RunContext): Promise<PipelineResult>
  /**
   * The skills the modules on for a run give it; with `every`, every module's, the plugins that
   * are off too: what a clean-up takes back the rules hiding their links for. A second skill of a
   * name already given is left out, and told to `onError`.
   */
  skills(args: SkillArgs, opts?: { every?: boolean }): Promise<GivenSkill[]>
  /** The coding agents, by their ids; a second one of an id is left out. */
  agents(): Promise<RunAgent[]>
  /** Where runs can run, in a project when one is named; a second host of an id is left out. */
  hosts(project?: ProjectRef): Promise<RunHost[]>
  /** How git reaches `remote` as an account: the first module with an account for it says. */
  gitAccess(remote: string): Promise<GitAccess | undefined>
  /** OpenAgent's accounts at the git hosts, as every module's `account.access` answers for its hosts. */
  readonly gitAccounts: GitAccounts
  /** The addresses the modules on answer for callers that are no page of the app's; a second route at a path is left out. */
  routes(): Promise<AppRoute[]>
  /**
   * What needs the person, every module's items in the distribution's order, and whether every module answered.
   * With no project, a plugin kept per project is asked where it is on in a project ({@link AppAttention}).
   */
  attention(args: AttentionArgs): Promise<AttentionRead>
  /**
   * The app started: each module on starts its own work, its signal aborting when the app stops.
   * From then on, a plugin kept per person or per computer starts when it is switched on, and
   * stops when it is switched off; one kept per project starts with the app wherever it is on.
   */
  started(app: AppStart): Promise<void>
  /** The app is stopping: the modules started, the last first. */
  stopping(): Promise<void>
  projectAdded(project: ProjectRef): Promise<void>
  /** A module wrote the project's data from outside this process's store: the modules on in it are told (`AppLifecycle.projectWritten`), and answered. */
  projectWritten(project: ProjectRef): Promise<void>
  /** Every module is told, each cleaning up its own data; what they removed and kept in the folder with `files`, and a line for each that refused or failed. */
  projectRemoved(project: ProjectRef, removal?: ProjectRemoval): Promise<CleanupReport>
  /** The folder `openagent` was typed in, made a project by the first module that answers for it: the modules on in it are told when it was added just now. */
  folderGiven(folder: string): Promise<GivenFolder | undefined>
  /** What the module that keeps the list of projects tells the others through ({@link AppContext.lifecycle}). */
  readonly lifecycle: ProjectsLifecycle
}

/** Load a distribution's modules. Throws for a distribution that is wrong: a name that is not one, two modules of one name, a hook that is no hook. */
export function createHooks(entries: readonly DistributionEntry[], opts: HooksOptions = {}): Hooks {
  check(entries)
  const modules = entries.map(entry => entry.module)
  const byName = new Map(modules.map(module => [module.name, module]))
  const byPackage = new Map(entries.flatMap(entry => (entry.package !== undefined ? [[entry.package, entry.module]] : [])))
  const switches = new Map<string, Setting<boolean>>()
  for (const { module, on } of entries) if (module.plugin && !module.plugin.row) switches.set(module.name, enabledSetting(module.name, module.plugin.scope, on ?? false))
  const store = chainStore(
    modules.flatMap(module => (module.hooks['store.backend'] ? [module.hooks['store.backend']] : [])),
    { oneShot: opts.oneShot ?? false },
  )
  const settings = settingsIn(store)
  const report = (module: string, hook: string, error: unknown): void => {
    if (opts.onError) opts.onError({ module, hook, error })
    else console.error(`${module}: ${hook} failed`, error)
  }

  /** Whether the module `name` is on, its row read through `rows`. */
  const enabled = async (name: string, project?: ProjectRef, rows: Settings = settings): Promise<boolean> => {
    const module = byName.get(name)
    if (!module?.plugin) return module !== undefined
    try {
      if (module.plugin.row) return await module.plugin.row.read(project)
      const setting = switches.get(name)!
      // Kept per project, where no project is named (a session with no project): no project keeps a row for it, so it is as the distribution starts it.
      if (setting.scope === 'project' && project === undefined) return setting.default
      return await rows.get(setting, project)
    } catch (error) {
      report(name, 'enabled', error)
      return false
    }
  }
  const isOn = async (module: ModuleDefinition, rows: Settings, project?: ProjectRef, options?: RunOptions): Promise<boolean> =>
    !module.plugin || (!options?.plugins?.without?.includes(module.name) && (await enabled(module.name, project, rows)))
  /** The modules on, in the distribution's order: those that fill `hook`, when one is named. Each scope's rows are read once for all of them. */
  const onModules = async (project?: ProjectRef, options?: RunOptions, hook?: HookName): Promise<ModuleDefinition[]> => {
    const asked = hook ? modules.filter(module => module.hooks[hook] !== undefined) : modules
    const rows = settingsIn(readingOnce(store))
    const flags = await Promise.all(asked.map(module => isOn(module, rows, project, options)))
    return asked.filter((_, i) => flags[i])
  }
  const firstOfEach = <T>(items: { module: string; item: T }[], idOf: (item: T) => string, hook: string): T[] => {
    const seen = new Map<string, string>()
    const kept: T[] = []
    for (const { module, item } of items) {
      const id = idOf(item)
      const first = seen.get(id)
      if (first !== undefined) {
        report(module, hook, new Error(`${first} gives ${id} already`))
        continue
      }
      seen.set(id, module)
      kept.push(item)
    }
    return kept
  }

  let app: AppStart | undefined
  const gitAccess = async (remote: string) => {
    for (const module of await onModules(undefined, undefined, 'account.access')) {
      const access = module.hooks['account.access']
      if (!access?.git) continue
      try {
        const answer = await access.git(remote)
        if (answer) return answer
      } catch (error) {
        report(module.name, 'account.access', error)
      }
    }
    return undefined
  }
  const projectAdded = async (project: ProjectRef): Promise<void> => {
    for (const module of await onModules(project, undefined, 'app.lifecycle')) {
      const lifecycle = module.hooks['app.lifecycle']
      if (!lifecycle?.projectAdded) continue
      try {
        await lifecycle.projectAdded(project, appContext(module))
      } catch (error) {
        report(module.name, 'app.lifecycle.projectAdded', error)
      }
    }
  }
  const projectWritten = async (project: ProjectRef): Promise<void> => {
    for (const module of await onModules(project, undefined, 'app.lifecycle')) {
      const lifecycle = module.hooks['app.lifecycle']
      if (!lifecycle?.projectWritten) continue
      try {
        await lifecycle.projectWritten(project, appContext(module))
      } catch (error) {
        report(module.name, 'app.lifecycle.projectWritten', error)
      }
    }
  }
  const projectRemoved = async (project: ProjectRef, removal: ProjectRemoval = { files: false }): Promise<CleanupReport> => {
    const cleaned: CleanupReport = { removed: [], kept: [], failed: [] }
    // Every module, on or not there now: each cleans up whatever it kept while it was.
    for (const module of modules) {
      const lifecycle = module.hooks['app.lifecycle']
      if (!lifecycle?.projectRemoved) continue
      try {
        const answer = await lifecycle.projectRemoved(project, appContext(module), removal)
        if (answer) {
          cleaned.removed.push(...answer.removed)
          cleaned.kept.push(...answer.kept)
        }
      } catch (error) {
        report(module.name, 'app.lifecycle.projectRemoved', error)
        cleaned.failed.push(`${module.name}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    return cleaned
  }
  // Every module, on or not there now, as each is told of the removal: the first that refuses
  // keeps the project. One that cannot tell refuses too, in its words: a run of its may be at work.
  const refusal = async (project: ProjectRef): Promise<string | undefined> => {
    for (const module of modules) {
      const refuse = module.hooks['app.lifecycle']?.refuseRemoval
      if (!refuse) continue
      try {
        const reason = await refuse(project, appContext(module))
        if (reason !== undefined) return reason
      } catch (error) {
        report(module.name, 'app.lifecycle.refuseRemoval', error)
        return `${module.name} could not tell whether the project may go: ${error instanceof Error ? error.message : String(error)}`
      }
    }
    return undefined
  }
  const lifecycle: ProjectsLifecycle = {
    added: projectAdded,
    refusal,
    removed: projectRemoved,
  }
  /** The modules started, in the order they were, each with what aborts its signal. */
  const live = new Map<ModuleDefinition, AbortController>()
  const appContext = (module: ModuleDefinition): AppContext => ({
    projects: async () => {
      const all = (await opts.projects?.()) ?? []
      if (module.plugin?.scope !== 'project') return all
      const flags = await Promise.all(all.map(project => enabled(module.name, project)))
      return all.filter((_, i) => flags[i])
    },
    store,
    settings,
    get signal() {
      return live.get(module)?.signal ?? app?.signal ?? new AbortController().signal
    },
    ...(app !== undefined ? { url: app.url } : {}),
    gitAccess,
    lifecycle,
    skills: (args, opts) => hooks.skills(args, opts),
    runs: async project => (await Promise.all((await hooks.hosts(project)).map(host => host.list(project)))).flat(),
  })
  const startOne = async (module: ModuleDefinition, start: AppStart): Promise<void> => {
    const stop = new AbortController()
    start.signal.addEventListener('abort', () => stop.abort(), { once: true })
    live.set(module, stop)
    const lifecycle = module.hooks['app.lifecycle']
    if (!lifecycle?.started) return
    try {
      await lifecycle.started(appContext(module))
    } catch (error) {
      report(module.name, 'app.lifecycle.started', error)
    }
  }
  const stopOne = async (module: ModuleDefinition): Promise<void> => {
    const stop = live.get(module)
    if (!stop) return
    live.delete(module)
    stop.abort()
    const lifecycle = module.hooks['app.lifecycle']
    if (!lifecycle?.stopping) return
    try {
      await lifecycle.stopping()
    } catch (error) {
      report(module.name, 'app.lifecycle.stopping', error)
    }
  }

  const steps = async (run: { project?: ProjectRef; options: RunOptions }): Promise<OrderedStep[]> => {
    const all = (await onModules(run.project, run.options, 'run.step')).flatMap(module =>
      (module.hooks['run.step'] ?? []).map(step => ({ order: step.order, name: step.name, module: module.name, run: (ctx: RunContext) => step.run(ctx) })),
    )
    // A stable sort: at the same order, the distribution's order and each module's own stay.
    return all.sort((a, b) => a.order - b.order)
  }

  const hooks: Hooks = {
    modules,
    store,
    settings,
    module: name => byName.get(name),
    ofPackage: name => byPackage.get(name),
    enabled,
    on: project => onModules(project),
    async setEnabled(name, on, project) {
      const module = byName.get(name)
      if (module?.plugin?.row) throw new Error(`${name} keeps its own row: it is switched on its Settings entry`)
      const setting = switches.get(name)
      if (!module || !setting) throw new Error(module ? `${name} is a core module, always on` : `No module is named ${name}`)
      await settings.set(setting, on, project)
      // Once the app started, one kept per person or per computer starts or stops with its switch.
      if (!app || app.signal.aborted || setting.scope === 'project') return
      if (on && !live.has(module)) await startOne(module, app)
      if (!on) await stopOne(module)
    },
    steps,
    run: async ctx => runPipeline(await steps({ ...(ctx.project ? { project: ctx.project } : {}), options: ctx.options }), ctx),
    async skills(args, opts = {}) {
      const given: { module: string; item: GivenSkill }[] = []
      for (const module of opts.every ? modules : await onModules(args.project, args.options, 'run.skills')) {
        const hook = module.hooks['run.skills']
        if (!hook) continue
        try {
          for (const skill of await hook(args)) given.push({ module: module.name, item: { ...skill, module: module.name } })
        } catch (error) {
          report(module.name, 'run.skills', error)
        }
      }
      return firstOfEach(given, skill => `a skill named ${skill.name}`, 'run.skills')
    },
    async agents() {
      const given = (await onModules(undefined, undefined, 'run.agent')).flatMap(module => (module.hooks['run.agent'] ?? []).map(item => ({ module: module.name, item })))
      return firstOfEach(given, agent => `a coding agent ${agent.id}`, 'run.agent')
    },
    async hosts(project) {
      const given = (await onModules(project, undefined, 'run.host')).flatMap(module => (module.hooks['run.host'] ?? []).map(item => ({ module: module.name, item })))
      return firstOfEach(given, host => `a host ${host.id}`, 'run.host')
    },
    async routes() {
      const given = (await onModules(undefined, undefined, 'app.route')).flatMap(module => (module.hooks['app.route'] ?? []).map(item => ({ module: module.name, item })))
      return firstOfEach(given, route => `a route at ${route.path}`, 'app.route')
    },
    gitAccess,
    gitAccounts: {
      async hosts() {
        const said = await Promise.all(
          (await onModules(undefined, undefined, 'account.access')).map(async module => {
            try {
              return (await module.hooks['account.access']?.hosts?.()) ?? []
            } catch (error) {
              report(module.name, 'account.access', error)
              return []
            }
          }),
        )
        return said.flat()
      },
      async sendAs(host, login) {
        for (const module of await onModules(undefined, undefined, 'account.access')) {
          const answer = await module.hooks['account.access']?.sendAs?.(host, login)
          if (answer) return answer
        }
        return { ok: false, error: `No module answers for ${host}.` }
      },
      async mergeCommit(dir, branch, number) {
        for (const module of await onModules(undefined, undefined, 'account.access')) {
          try {
            const answer = await module.hooks['account.access']?.mergeCommit?.(dir, branch, number)
            if (answer) return answer
          } catch (error) {
            report(module.name, 'account.access', error)
          }
        }
        return { pending: false }
      },
      async runAs(dir, login) {
        let refused: { ok: false; error: string } | undefined
        for (const module of await onModules(undefined, undefined, 'account.access')) {
          try {
            const answer = await module.hooks['account.access']?.runAs?.(dir, login)
            if (answer?.ok || (answer && dir !== undefined)) return answer
            refused ??= answer
          } catch (error) {
            report(module.name, 'account.access', error)
          }
        }
        return refused
      },
      async people(dir, emails) {
        for (const module of await onModules(undefined, undefined, 'account.access')) {
          try {
            const answer = await module.hooks['account.access']?.people?.(dir, emails)
            if (answer) return answer
          } catch (error) {
            report(module.name, 'account.access', error)
          }
        }
        return []
      },
    },
    async attention(args) {
      // Asked about this computer, with no project: a plugin kept per project is asked as the
      // distribution starts it, and also where it is on in one of the registry's projects.
      const inSome = async (module: ModuleDefinition): Promise<boolean> =>
        !args.options?.plugins?.without?.includes(module.name) && (await appContext(module).projects()).length > 0
      const asked = args.project
        ? await onModules(args.project, args.options, 'app.attention')
        : await (async () => {
            const on = new Set(await onModules(undefined, args.options, 'app.attention'))
            const filling = modules.filter(module => module.hooks['app.attention'] !== undefined)
            const flags = await Promise.all(filling.map(module => (on.has(module) || (module.plugin?.scope === 'project' && inSome(module)))))
            return filling.filter((_, i) => flags[i])
          })()
      // Every module at once: each reads what it says, a git host among them.
      const said = await Promise.all(
        asked.map(async module => {
          const hook = module.hooks['app.attention']
          if (!hook) return []
          try {
            return (await hook(args, appContext(module))).map(item => ({ ...item, module: module.name }))
          } catch (error) {
            report(module.name, 'app.attention', error)
            return undefined
          }
        }),
      )
      return { items: said.flatMap(items => items ?? []), whole: said.every(items => items !== undefined) }
    },
    async started(start) {
      app = start
      for (const module of modules) {
        // A plugin kept per project starts wherever it is: its projects() says where it is on. So
        // does one that keeps its own row: the row turns on and off on its Settings entry, never
        // through a switch here, so its work asks the row.
        if (module.plugin && module.plugin.scope !== 'project' && !module.plugin.row && !(await enabled(module.name))) continue
        await startOne(module, start)
      }
    },
    async stopping() {
      for (const module of [...live.keys()].reverse()) await stopOne(module)
    },
    projectAdded,
    projectWritten,
    projectRemoved,
    async folderGiven(folder) {
      for (const module of modules) {
        const lifecycle = module.hooks['app.lifecycle']
        if (!lifecycle?.folderGiven) continue
        // Not caught: the folder is asked about by the person who typed the command, and told why it is no project.
        const given = await lifecycle.folderGiven(folder, appContext(module))
        if (!given) continue
        if (given.added) await projectAdded(given.project)
        return given
      }
      return undefined
    },
    lifecycle,
  }
  return hooks
}

/** The store, each file read once while what asks of it goes on: many rows asked at once read each scope's settings once. A fresh read is the store's every time. */
function readingOnce(store: Store): Store {
  const reads = new Map<string, Promise<string | undefined>>()
  return {
    ...store,
    read(scope, path, opts) {
      if (opts?.fresh) return store.read(scope, path, opts)
      const key = `${scopeKey(scope)}\0${path}`
      let read = reads.get(key)
      if (!read) reads.set(key, (read = store.read(scope, path, opts)))
      return read
    },
  }
}

function check(entries: readonly DistributionEntry[]): void {
  const names = new Set<string>()
  for (const { module, on } of entries) {
    const name: unknown = module?.name
    if (typeof name !== 'string' || !MODULE_NAME.test(name)) throw new Error(`${JSON.stringify(name)} is no module name: lower-case words joined by dashes`)
    if (names.has(name)) throw new Error(`Two modules are named ${name}`)
    names.add(name)
    if (typeof module.hooks !== 'object' || module.hooks === null) throw new Error(`${name} fills no hooks: give it hooks: {}`)
    if (module.plugin !== undefined && !SETTING_SCOPES.includes(module.plugin.scope)) throw new Error(`${name} keeps its Enabled row nowhere: per person, per computer or per project`)
    if (on !== undefined && module.plugin === undefined) throw new Error(`${name} is a core module, always on: only a plugin starts on or off`)
    if (on !== undefined && module.plugin?.row) throw new Error(`${name} keeps its own row: it starts as its row says`)
    for (const hook of Object.keys(module.hooks)) if (!(HOOK_NAMES as readonly string[]).includes(hook)) throw new Error(`${name} fills ${hook}, which is no hook`)
    for (const step of module.hooks['run.step'] ?? []) if (!Number.isFinite(step.order)) throw new Error(`${name}'s step "${step.name}" stands at no order`)
    for (const route of module.hooks['app.route'] ?? []) if (!ROUTE_PATH.test(route.path)) throw new Error(`${name}'s route ${JSON.stringify(route.path)} is no route's path: /_ and a name`)
  }
}

/**
 * A package, as a distribution lists it. Its Node part, when it has one, is its `./module` entry,
 * which default-exports the module; a package with only a UI part (`./dashboard`) or a skill's
 * text has none, and those parts are read by what uses them, such as the dashboard.
 */
export interface DistributionPackage {
  package: string
  /** For a plugin: it starts enabled, until a person switches it off. */
  on?: boolean
}

/** What a distribution lists: a module's package, or a module already loaded (a demo's fakes). */
export type DistributionItem = DistributionPackage | DistributionEntry

/**
 * A distribution's modules, from what it lists: a package's `./module` entry, imported with
 * `load`, or a module as it is given. The distribution passes its own `import`, so the packages
 * resolve from its dependencies: they are not this package's. A package `hasModule` says has no
 * Node part brings no module.
 */
export async function loadModules(
  items: readonly DistributionItem[],
  load: (specifier: string) => Promise<unknown>,
  hasModule: (name: string) => boolean = () => true,
): Promise<DistributionEntry[]> {
  const entries = await Promise.all(
    items.map(async (item): Promise<DistributionEntry | undefined> => {
      if ('module' in item) return item
      const { package: name, on } = item
      if (!hasModule(name)) return undefined
      const exported = await load(`${name}/module`)
      const module = typeof exported === 'object' && exported !== null ? (exported as { default?: unknown }).default : undefined
      if (typeof module !== 'object' || module === null || typeof (module as { name?: unknown }).name !== 'string') {
        throw new Error(`${name}/module default-exports no module: export default defineModule({ ... })`)
      }
      return { module: module as ModuleDefinition, package: name, ...(on !== undefined ? { on } : {}) }
    }),
  )
  return entries.filter(entry => entry !== undefined)
}

/** Load a distribution's modules from what it lists ({@link loadModules}). */
export async function loadDistribution(items: readonly DistributionItem[], load: (specifier: string) => Promise<unknown>, opts: HooksOptions = {}): Promise<Hooks> {
  return createHooks(await loadModules(items, load), opts)
}

/**
 * Where a distribution hands itself down to the processes it starts, such as a run's own: the
 * path of its file, which default-exports what it lists ({@link DistributionItem}).
 */
export const DISTRIBUTION_ENV = 'OPENAGENT_DISTRIBUTION'

/**
 * The modules of the distribution handed down in `env` ({@link DISTRIBUTION_ENV}), each package
 * resolved from the distribution file's own place, as the distribution resolves it; none when
 * none was handed down. A package whose `exports` has no `./module` has no Node part.
 */
export async function loadHandedDown(env: NodeJS.ProcessEnv = process.env): Promise<DistributionEntry[] | undefined> {
  const file = env[DISTRIBUTION_ENV]
  if (!file) return undefined
  const items = await distributionItems(file)
  const withModule = new Set<string>()
  for (const item of items) {
    if ('module' in item) continue
    const { exports } = JSON.parse(await readFile(join(await packageDirOf(file, item.package), 'package.json'), 'utf8')) as { exports?: unknown }
    if (typeof exports === 'object' && exports !== null && Object.hasOwn(exports, './module')) withModule.add(item.package)
  }
  const require = createRequire(file)
  return loadModules(items, specifier => import(pathToFileURL(require.resolve(specifier)).href), name => withModule.has(name))
}

/** What the distribution file at `file` lists: its default export. Throws for a file that exports no list. */
export async function distributionItems(file: string): Promise<readonly DistributionItem[]> {
  const exported = ((await import(pathToFileURL(file).href)) as { default?: unknown }).default
  if (!Array.isArray(exported)) throw new Error(`${file} default-exports no distribution: a list of its packages and modules`)
  return exported as DistributionItem[]
}

/**
 * Where the package `name` is installed, as the distribution file at `file` resolves it: its
 * directory, symlinks resolved, found whatever the package's `exports` lets through. Throws for
 * a package that is not installed there.
 */
export async function packageDirOf(file: string, name: string): Promise<string> {
  for (const dir of createRequire(file).resolve.paths(name) ?? []) {
    const found = await realpath(join(dir, name)).catch(() => undefined)
    if (found !== undefined && (await readFile(join(found, 'package.json')).then(() => true, () => false))) return found
  }
  throw new Error(`${name}, which the distribution ${file} lists, is not installed beside it`)
}

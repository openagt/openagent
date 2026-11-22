import type { ProjectRef } from './project.js'

/**
 * The store: where every module keeps its data, by scope and path, through one chain of backends
 * (`store.backend`). The filesystem store is the end of the chain; a git store wraps it, keeps the
 * scopes it syncs, and passes the rest on.
 */

/** Whose data it is: the person's, which follows them to every computer; this computer's alone; or one project's. */
export type Scope = { readonly kind: 'person' } | { readonly kind: 'computer' } | { readonly kind: 'project'; readonly project: ProjectRef }

/** The person's scope: what follows them to every computer (their agent profiles, their name and picture). */
export const PERSON: Scope = { kind: 'person' }

/** This computer's scope: what stays on it (its editor, its logins). */
export const COMPUTER: Scope = { kind: 'computer' }

/** One project's scope: a backend finds where it is kept from the project itself (its folder, its repository). */
export function projectScope(project: ProjectRef): Scope {
  return { kind: 'project', project }
}

/** A scope in one word, for a message or a map's key: `person`, `computer`, `project:<id>`. */
export function scopeKey(scope: Scope): string {
  return scope.kind === 'project' ? `project:${scope.project.id}` : scope.kind
}

/** Files to save, by path: the text each file gets, or `null` to remove it. */
export type Changes = Readonly<Record<string, string | null>>

/** A scope's files as a save finds them, for the changes it makes from them. */
export interface ScopeFiles {
  read(path: string): Promise<string | undefined>
  list(dir: string): Promise<string[]>
}

/**
 * Changes made from the files as they are when the save is made: a git store calls it once it took
 * in what its remote has, and again if its push lost a race, so a change that depends on what is
 * there (a ticket claimed only while no one holds it) is made from what is current. It throws to
 * save nothing, and the save throws that.
 */
export type Update = (files: ScopeFiles) => Changes | Promise<Changes>

/** Why a save is made: a git store's commit message. A function is called once the changes are made, for a batch that only knows then what it did. */
export type Message = string | (() => string)

/** How a read reads. */
export interface ReadOptions {
  /**
   * Read what is current where the data is kept: a git store fetches first. Without it, what this
   * computer has, which suits a read made every few seconds.
   */
  fresh?: boolean
}

/** What every module reads and writes its data through. Paths are relative and `/`-separated ({@link checkPath}). */
export interface Store {
  /** A file's text; none when there is no such file. */
  read(scope: Scope, path: string, opts?: ReadOptions): Promise<string | undefined>
  /** The files under a folder (`''` for the scope's top), each by its path from the scope's top, sorted. */
  list(scope: Scope, dir: string, opts?: ReadOptions): Promise<string[]>
  /**
   * Save files together, as given or as `update` makes them: a git store commits them as one
   * commit and pushes it. Resolved once the files are kept; a git store that could not push keeps
   * them here and sends them with its next save.
   */
  save(scope: Scope, changes: Changes | Update, message: Message): Promise<void>
  /** Call `onChange` with the path of each file under `path` (`''` for the whole scope) that changes, until the function it answers is called. */
  watch(scope: Scope, path: string, onChange: (path: string) => void): () => void
}

/** What a backend is told of the process it runs in. */
export interface StoreContext {
  /**
   * The process runs one command and exits (a command an agent runs): a backend leaves nothing of
   * its own behind for later, such as a checkout kept between writes.
   */
  oneShot: boolean
}

/** A link of the store's chain. */
export interface StoreBackend {
  /** Where it stands in the chain, a {@link StoreOrder} or any number between: a lower one wraps a higher one. */
  order: number
  /** This backend's store, given the next one in the chain: what it does not keep, it passes to `next`. */
  wrap(next: Store, context: StoreContext): Store
}

/**
 * The store a chain of backends makes: the lowest `order` outermost, seeing each call first; at the
 * same order, the first one given. A call that reaches the end of the chain, kept by no backend, is
 * refused with the scope it was for.
 */
export function chainStore(backends: readonly StoreBackend[], context: StoreContext = { oneShot: false }): Store {
  const outerFirst = [...backends].sort((a, b) => a.order - b.order)
  return outerFirst.reduceRight<Store>((next, backend) => backend.wrap(next, context), NO_STORE)
}

/** The end of every chain: nothing is kept here. */
const NO_STORE: Store = {
  read: async scope => refuse(scope),
  list: async scope => refuse(scope),
  save: async scope => refuse(scope),
  watch: scope => refuse(scope),
}

function refuse(scope: Scope): never {
  throw new Error(`No store keeps the ${scopeKey(scope)} data`)
}

/** The changes a save makes: as given, or as `update` makes them from `files`. Every path is checked. */
export async function changesOf(changes: Changes | Update, files: ScopeFiles): Promise<Changes> {
  const made = typeof changes === 'function' ? await changes(files) : changes
  for (const path of Object.keys(made)) checkPath(path)
  return made
}

/** A save's message, once its changes are made. */
export function messageOf(message: Message): string {
  return typeof message === 'function' ? message() : message
}

/** Whether a path is one a store takes: relative, `/`-separated, with no empty, `.` or `..` part. */
export function isStorePath(path: string): boolean {
  return path !== '' && !path.includes('\\') && path.split('/').every(part => part !== '' && part !== '.' && part !== '..')
}

/** The path, when a store takes it ({@link isStorePath}); `''` too with `dir`, for a scope's top. Throws for any other. */
export function checkPath(path: string, opts: { dir?: boolean } = {}): string {
  if ((opts.dir && path === '') || isStorePath(path)) return path
  throw new Error(`${JSON.stringify(path)} is no path in a store: relative, separated by /, without . or .. parts`)
}

/** Whether `path` is `dir` or a file under it; every path is under `''`. */
export function isUnder(path: string, dir: string): boolean {
  return dir === '' || path === dir || path.startsWith(`${dir}/`)
}

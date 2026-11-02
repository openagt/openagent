/**
 * The one `node:fs/promises` adapter. Every `node*Fs()` factory in the package
 * returns this under its own narrow type: the store may append, the registry may
 * not, and those interfaces stay separate because they are the consumers'
 * contracts. Only the implementation was worth sharing, and it was written out
 * four times before this.
 *
 * Every import is dynamic, which is the whole point of the convention: a module
 * that reads files keeps a `node:fs` edge out of its static import graph, so it
 * can be reached from browser-safe code as long as the read itself never runs
 * there. `client.test.ts` enforces the graph half.
 */
export interface NodeFs {
  /** Rejects when the file is absent. */
  read(path: string): Promise<string>
  write(path: string, contents: string): Promise<void>
  append(path: string, contents: string): Promise<void>
  /** True when `path` exists AND is a file. Any stat error reads as `false`. */
  exists(path: string): Promise<boolean>
  /** True when `path` exists AND is a directory. Any stat error reads as `false`. */
  isDirectory(path: string): Promise<boolean>
  /** Recursive. */
  mkdir(path: string): Promise<void>
  /** List a directory's entries (names only). Missing dir yields `[]`. */
  readdir(path: string): Promise<string[]>
  /** Replace `to` with `from`. Atomic within one filesystem, which is the point of having it. */
  rename(from: string, to: string): Promise<void>
  /** Set a file's permission bits. Rejects when the path is absent, or the fs cannot express them. */
  chmod(path: string, mode: number): Promise<void>
}

/** The `node:fs/promises` implementation of {@link NodeFs}. */
export function nodeFs(): NodeFs {
  return {
    async read(path) {
      const { readFile } = await import('node:fs/promises')
      return readFile(path, 'utf8')
    },
    async write(path, contents) {
      const { writeFile } = await import('node:fs/promises')
      await writeFile(path, contents, 'utf8')
    },
    async append(path, contents) {
      const { appendFile } = await import('node:fs/promises')
      await appendFile(path, contents, 'utf8')
    },
    async exists(path) {
      const { stat } = await import('node:fs/promises')
      try {
        return (await stat(path)).isFile()
      } catch {
        return false
      }
    },
    async isDirectory(path) {
      const { stat } = await import('node:fs/promises')
      try {
        return (await stat(path)).isDirectory()
      } catch {
        return false
      }
    },
    async mkdir(path) {
      const { mkdir } = await import('node:fs/promises')
      await mkdir(path, { recursive: true })
    },
    async readdir(path) {
      const { readdir } = await import('node:fs/promises')
      try {
        return await readdir(path)
      } catch {
        return []
      }
    },
    async rename(from, to) {
      const { rename } = await import('node:fs/promises')
      await rename(from, to)
    },
    async chmod(path, mode) {
      const { chmod } = await import('node:fs/promises')
      await chmod(path, mode)
    },
  }
}

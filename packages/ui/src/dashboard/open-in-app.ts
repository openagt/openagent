import { platform } from 'node:os'
import { delimiter, join } from 'node:path'

// The project panel's "Open in Finder / editor" (#490, part of #488). Localhost-only: the
// daemon spawns a local command to reveal the repo in the OS file manager or open it in an
// editor. The path is the project's own registered path (never client input), and a public
// host has no local checkout to resolve, so there is nothing to spawn there.

/** Which app to open the project in. */
export type OpenTarget = 'files' | 'editor'

/** A known editor: its launcher CLI plus a human label for the picker (#727). */
export interface EditorInfo {
  bin: string
  label: string
}

/**
 * The editors the picker can offer (#727), probed by their CLI launcher on PATH. Order is the
 * display order. `$OPENAGENT_EDITOR` and a hand-typed value stay valid beyond this list; this is
 * only what auto-detection looks for.
 */
export const KNOWN_EDITORS: EditorInfo[] = [
  { bin: 'code', label: 'VS Code' },
  { bin: 'code-insiders', label: 'VS Code Insiders' },
  { bin: 'cursor', label: 'Cursor' },
  { bin: 'windsurf', label: 'Windsurf' },
  { bin: 'zed', label: 'Zed' },
  { bin: 'subl', label: 'Sublime Text' },
  { bin: 'webstorm', label: 'WebStorm' },
  { bin: 'idea', label: 'IntelliJ IDEA' },
  { bin: 'nvim', label: 'Neovim' },
  { bin: 'vim', label: 'Vim' },
  { bin: 'emacs', label: 'Emacs' },
]

/** Whether an editor launcher is installed (on PATH). A seam so detection is unit-testable. */
export type EditorProbe = (bin: string) => Promise<boolean>

/**
 * An {@link EditorProbe} that looks each launcher up on the real PATH: an executable match in any
 * PATH dir (trying PATHEXT suffixes on Windows). Pure lookup, nothing is spawned.
 */
function nodeEditorProbe(env: NodeJS.ProcessEnv = process.env, os: NodeJS.Platform = platform()): EditorProbe {
  const dirs = (env.PATH ?? '').split(delimiter).filter(Boolean)
  const exts = os === 'win32' ? (env.PATHEXT ?? '.EXE;.CMD;.BAT;.COM').split(';').filter(Boolean) : ['']
  return async bin => {
    const { access, constants } = await import('node:fs/promises')
    const flag = os === 'win32' ? constants.F_OK : constants.X_OK
    for (const dir of dirs) {
      for (const ext of exts) {
        try {
          await access(join(dir, bin + ext), flag)
          return true
        } catch {
          // not here; keep looking
        }
      }
    }
    return false
  }
}

/** The installed subset of {@link KNOWN_EDITORS}, in display order (#727). */
export async function detectEditors(probe: EditorProbe = nodeEditorProbe()): Promise<EditorInfo[]> {
  const hits = await Promise.all(KNOWN_EDITORS.map(async e => ((await probe(e.bin)) ? e : null)))
  return hits.filter((e): e is EditorInfo => e !== null)
}

/** The outcome of an open attempt. */
export type OpenResult = { ok: true } | { ok: false; error: string }

/** Spawns a command, resolving once it launches (not on exit) and rejecting if it can't start. */
export type SpawnRunner = (command: string, args: string[]) => Promise<void>

/**
 * A {@link SpawnRunner} backed by `spawn`, detached. Resolves on the `spawn` event so a
 * long-lived editor (or `explorer`, which exits non-zero even on success) does not block or
 * error; rejects on the `error` event (e.g. ENOENT when the command is not on PATH).
 */
function nodeSpawnRunner(): SpawnRunner {
  return (command, args) =>
    new Promise((resolve, reject) => {
      void import('node:child_process').then(({ spawn }) => {
        const child = spawn(command, args, { stdio: 'ignore', detached: true })
        child.on('error', reject)
        child.on('spawn', () => {
          child.unref()
          resolve()
        })
      })
    })
}

/** The OS command that reveals a path in the file manager. */
export function fileManagerCommand(path: string, os: NodeJS.Platform = platform()): { command: string; args: string[] } {
  if (os === 'darwin') return { command: 'open', args: [path] }
  if (os === 'win32') return { command: 'explorer', args: [path] }
  return { command: 'xdg-open', args: [path] }
}

/** The command to open a path in an editor: `$OPENAGENT_EDITOR` when set, else the VS Code CLI. */
export function editorCommand(path: string, editor = process.env.OPENAGENT_EDITOR): { command: string; args: string[] } {
  const bin = editor && editor.trim() ? editor.trim() : 'code'
  return { command: bin, args: [path] }
}

/**
 * Open the project at `cwd` in the file manager or an editor. Failures are values, never throws.
 * `editor` (#727) is the stored preference; when unset {@link editorCommand} falls back to
 * `$OPENAGENT_EDITOR`, then `code`.
 */
export async function openInApp(
  cwd: string,
  target: OpenTarget,
  agent: SpawnRunner = nodeSpawnRunner(),
  editor?: string,
): Promise<OpenResult> {
  const { command, args } = target === 'editor' ? editorCommand(cwd, editor) : fileManagerCommand(cwd)
  try {
    await agent(command, args)
    return { ok: true }
  } catch (err) {
    if ((err as NodeJS.ErrnoException | undefined)?.code === 'ENOENT') {
      return { ok: false, error: `"${command}" was not found on PATH` }
    }
    return { ok: false, error: err instanceof Error ? err.message : 'failed to open' }
  }
}

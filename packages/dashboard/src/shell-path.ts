import { spawn } from 'node:child_process'
import { userInfo } from 'node:os'
import { delimiter } from 'node:path'

/**
 * The PATH the person's terminal has now: their login shell, started as a terminal starts it
 * (`-i -l`, so `.zshrc` and `.zprofile` both run), asked for its PATH. OpenAgent runs as a
 * service with the PATH its install's terminal had, so a coding agent or `gh` installed later, or
 * under another Node version of fnm or nvm, is in no folder of it: the checks said "not installed"
 * of what the terminal runs. Undefined when the shell does not answer in time, or on Windows,
 * where a service's PATH is the person's own already.
 */
export async function loginShellPath(env: NodeJS.ProcessEnv, opts: { shell?: string; timeoutMs?: number } = {}): Promise<string | undefined> {
  if (process.platform === 'win32') return undefined
  const shell = opts.shell ?? env['SHELL'] ?? safeShell()
  if (!shell) return undefined
  return new Promise(resolve => {
    // `printenv`, not `echo $PATH`: fish keeps PATH as a list, and every shell runs `printenv` alike.
    // The marks keep out what the person's rc files print themselves.
    const child = spawn(shell, ['-i', '-l', '-c', `echo ${MARK}; printenv PATH; echo ${MARK}`], { env, stdio: ['ignore', 'pipe', 'ignore'], detached: true })
    let out = ''
    const done = (path: string | undefined) => {
      clearTimeout(timer)
      try {
        if (child.pid !== undefined) process.kill(-child.pid, 'SIGKILL')
      } catch {
        // Ended already.
      }
      resolve(path)
    }
    const timer = setTimeout(() => done(undefined), opts.timeoutMs ?? SHELL_TIMEOUT_MS)
    child.stdout.on('data', (chunk: Buffer) => {
      out += chunk.toString()
      const path = between(out)
      if (path !== undefined) done(path || undefined)
    })
    child.on('error', () => done(undefined))
    child.on('close', () => done(between(out) || undefined))
  })
}

/**
 * Put the login shell's PATH first in `env`, and keep every folder `env` had after it: a folder
 * only the service's PATH had (`~/.local/bin`, the install's Node) is still found.
 */
export async function withLoginShellPath(env: NodeJS.ProcessEnv, opts: { shell?: string; timeoutMs?: number } = {}): Promise<void> {
  const path = await loginShellPath(env, opts)
  if (path !== undefined) env['PATH'] = mergePaths(path, env['PATH'] ?? '')
}

/**
 * This process's PATH: the login shell's, then the one the service started with. Asked when the
 * dashboard starts, and again by a check that found a program missing, at most every few seconds:
 * what the person installs while OpenAgent runs is found without a restart. Always merged with the
 * PATH the service started with, never the last one, and only when something is missing: a shell
 * that adds a folder of its own each time (fnm makes one per shell) neither lengthens the PATH nor
 * leaves a folder behind every few seconds.
 */
export function refreshLoginShellPath(): Promise<void> {
  if (refreshing && Date.now() - refreshedAt < REFRESH_MS) return refreshing
  refreshedAt = Date.now()
  const start = (servicePath ??= process.env['PATH'] ?? '')
  const env = { ...process.env, PATH: start }
  refreshing = withLoginShellPath(env).then(() => {
    process.env['PATH'] = env.PATH
  })
  return refreshing
}

let servicePath: string | undefined
let refreshing: Promise<void> | undefined
let refreshedAt = 0

/** Every folder of `first`, then the ones of `rest` it lacks, each once, in order. */
export function mergePaths(first: string, rest: string): string {
  const seen = new Set<string>()
  const out: string[] = []
  for (const dir of [...first.split(delimiter), ...rest.split(delimiter)]) {
    if (!dir || seen.has(dir)) continue
    seen.add(dir)
    out.push(dir)
  }
  return out.join(delimiter)
}

function between(out: string): string | undefined {
  const start = out.indexOf(`${MARK}\n`)
  if (start === -1) return undefined
  const end = out.indexOf(`\n${MARK}`, start + MARK.length + 1)
  if (end === -1) return undefined
  return out.slice(start + MARK.length + 1, end).trim()
}

function safeShell(): string | undefined {
  try {
    return userInfo().shell ?? undefined
  } catch {
    return undefined
  }
}

const MARK = '__OPENAGENT_PATH__'
/** A shell with a heavy setup (oh-my-zsh, nvm) can take a few seconds; past this, the PATH stays as it was. */
const SHELL_TIMEOUT_MS = 8_000
const REFRESH_MS = 10_000

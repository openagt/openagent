// The demo (see README.md): the real dashboard, started by its CLI as a person starts it, on a
// throwaway home with fixture projects whose start and resume lines run the scripted fake run.
// Every page and every flow of the product, offline, free, and the same each time: `pnpm demo`
// serves it to a person, and the browser smoke tests drive it.
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync } from 'node:fs'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'
import { projectId } from '../registry.js'
import type { AgentMeta, AgentStatus } from '../store/index.js'
import { git, makeFixtureRepo, writeFakeRunHooks } from './fixture.js'

const CLI = fileURLToPath(new URL('../../dist/cli/bin.js', import.meta.url))

/** A project of the demo, as the dashboard has it. */
export interface DemoProject {
  name: string
  cwd: string
  /** The id the dashboard's RPCs and pages key it by: `<url>/<id>` opens its page. */
  id: string
}

export interface Demo {
  /** The dashboard's address. */
  url: string
  /** The throwaway home everything lives in; `stop()` removes it. */
  home: string
  /** The project the dashboard has from the start. */
  project: DemoProject
  /** A fixture repo the dashboard does not have yet: the one to add. */
  toAdd: string
  /** Call one of the dashboard's RPCs, as its page does. */
  call<T = unknown>(name: string, ...args: unknown[]): Promise<T>
  /** Poll the project's runs until one is in one of `states`. */
  waitAgent(agentId: string, states: AgentStatus[], timeoutMs?: number): Promise<AgentMeta>
  /** Stop every run still working, then the dashboard, then remove the home. */
  stop(): Promise<void>
}

export interface DemoOptions {
  /** The port the dashboard binds. 0, the default, is a free one: the demo never joins a dashboard already running. */
  port?: number
  /** Start a run in each state a page shows: done with a commit, waiting on a question, and working. */
  seed?: boolean
  /** Where the dashboard's own lines go (the CLI's and its server logs). Dropped when not given. */
  log?: (line: string) => void
}

/** What the demo's project holds: two tickets on its data branch, for the Tickets page. */
const SHOP_FILES: Record<string, string> = {
  'README.md': '# shop\n\nThe demo project: a small web shop.\n',
  'tickets/2026-08-01_login-page.md': 'priority: 8\n\n# Login page\n\n## TLDR\n\nAdd a login page with session cookies.\n',
  'tickets/2026-08-02_dark-mode.md': '# Dark mode\n\n## TLDR\n\nHonor prefers-color-scheme.\n',
}

/** The seeded runs, by what each prompt scripts the fake agent to do (fake-run-bin.ts). */
const SEEDED: Array<{ prompt: string; until: AgentStatus[] }> = [
  { prompt: 'commit a login page with session cookies', until: ['done'] },
  { prompt: 'ask which colour the login page should be', until: ['waiting'] },
  { prompt: 'hold: move the cart to a page of its own', until: ['running'] },
]

const DEMO_USER = { name: 'Demo', email: 'demo@example.invalid' }

/** The variables an OpenAgent run hands its agent: an agent running the demo must not hand them on to it. */
const handedToAgents = (name: string): boolean => name.startsWith('OPENAGENT_') || name === 'AGENT_ID'

export async function startDemo(options: DemoOptions = {}): Promise<Demo> {
  if (!existsSync(CLI)) throw new Error(`no build of the dashboard at ${CLI}: run \`pnpm build\` first`)
  const home = mkdtempSync(join(tmpdir(), 'openagent-demo-'))
  const shop = join(home, 'projects', 'shop')
  const toAdd = join(home, 'projects', 'blog')
  await mkdir(shop, { recursive: true })
  await mkdir(toAdd, { recursive: true })
  // The person the dashboard names is the home's git user: "Demo", not whoever runs the demo.
  await writeFile(join(home, '.gitconfig'), `[user]\n\tname = ${DEMO_USER.name}\n\temail = ${DEMO_USER.email}\n`)
  for (const [cwd, files] of [
    [shop, SHOP_FILES],
    [toAdd, { 'README.md': '# blog\n\nThe project to add from the dashboard.\n' }],
  ] as const) {
    await makeFixtureRepo(cwd, files)
    await git(cwd, 'config', 'user.name', DEMO_USER.name)
    await git(cwd, 'config', 'user.email', DEMO_USER.email)
  }

  const env: NodeJS.ProcessEnv = Object.fromEntries(Object.entries(process.env).filter(([name]) => !handedToAgents(name)))
  Object.assign(env, { HOME: home, XDG_CONFIG_HOME: join(home, '.config') })
  // Started in the home, which is no repository, so the CLI adds no project of its own. A process
  // group of its own: a Ctrl+C at the terminal reaches only the demo, which stops the runs first.
  const cli = spawn(process.execPath, [CLI, '--port', String(options.port ?? 0)], { cwd: home, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true })
  /** Signal the dashboard and what it started that is still in its group (its long-polls outlive it a while). */
  const signalGroup = (signal: NodeJS.Signals): void => {
    try {
      process.kill(-cli.pid!, signal)
    } catch {
      // Nothing of the group is left.
    }
  }
  const killCli = (): void => signalGroup('SIGKILL')
  process.once('exit', killCli)
  const said: string[] = []
  const exited = new Promise<number | null>(resolvePromise => cli.once('exit', code => resolvePromise(code)))

  const url = await new Promise<string>((resolvePromise, rejectPromise) => {
    for (const stream of [cli.stdout, cli.stderr]) {
      createInterface({ input: stream }).on('line', line => {
        said.push(line)
        options.log?.(line)
        const bound = /dashboard running: (\S+)/.exec(line)
        if (bound) resolvePromise(bound[1]!)
      })
    }
    void exited.then(code => rejectPromise(new Error(`the dashboard exited (${code}) before it served:\n${said.join('\n')}`)))
  }).catch(async (err: unknown) => {
    process.removeListener('exit', killCli)
    await rm(home, { recursive: true, force: true })
    throw err
  })

  async function call<T = unknown>(name: string, ...args: unknown[]): Promise<T> {
    // Same-origin, as the page's own calls are.
    const response = await fetch(`${url}/_rpc/${name}`, { method: 'POST', headers: { 'content-type': 'application/json', origin: url }, body: JSON.stringify(args) })
    if (!response.ok) throw new Error(`${name}: HTTP ${response.status}`)
    const text = await response.text()
    return (text ? (JSON.parse(text) as { ret?: T }).ret : undefined) as T
  }

  const id = projectId(resolve(shop))
  const project: DemoProject = { name: 'shop', cwd: shop, id }

  async function waitAgent(agentId: string, states: AgentStatus[], timeoutMs = 30_000): Promise<AgentMeta> {
    const deadline = Date.now() + timeoutMs
    let last: AgentMeta | undefined
    for (;;) {
      last = (await call<AgentMeta[]>('onAgents', id)).find(agent => agent.id === agentId)
      if (last && states.includes(last.status)) return last
      if (Date.now() > deadline) throw new Error(`run ${agentId} did not get to ${states.join('/')} (last seen: ${last?.status})`)
      await new Promise(r => setTimeout(r, 200))
    }
  }

  async function stop(): Promise<void> {
    process.removeListener('exit', killCli)
    // A run is a process of its own and outlives the dashboard: each one still working is stopped
    // the way the Stop button stops it, and waited out, so none writes into the home being removed.
    const projects = await call<Array<{ id: string }>>('onProjects').catch(() => [])
    for (const { id: project } of projects) {
      const working = (await call<AgentMeta[]>('onAgents', project).catch(() => [])).filter(agent => agent.status === 'running')
      for (const agent of working) await call('sendStop', project, agent.id).catch(() => {})
      const deadline = Date.now() + 10_000
      while (Date.now() < deadline) {
        const still = (await call<AgentMeta[]>('onAgents', project).catch(() => [])).some(agent => agent.status === 'running')
        if (!still) break
        await new Promise(r => setTimeout(r, 200))
      }
    }
    if (cli.exitCode === null) {
      cli.kill('SIGINT')
      const timer = setTimeout(killCli, 10_000)
      await exited
      clearTimeout(timer)
    }
    // What the dashboard started and left behind in its group goes too: it writes into the home.
    signalGroup('SIGTERM')
    // Retried: what the dashboard started on its own (a coding agent's CLI asked for its usage)
    // can still be writing into the home for a moment after the dashboard is gone.
    await rm(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }).catch((err: unknown) => {
      process.stderr.write(`the demo could not remove ${home}: ${err instanceof Error ? err.message : String(err)}\n`)
    })
  }

  try {
    const added = await call<{ ok: boolean; error?: string }>('sendAddProject', shop)
    if (!added.ok) throw new Error(`could not add the demo project: ${added.error}`)
    // Its records go to its remote, as a team's do.
    const shared = await call<{ ok: boolean; error?: string }>('sendShareRecords', id, true)
    if (!shared.ok) throw new Error(`could not share the demo project's records: ${shared.error}`)
    await writeFakeRunHooks(shop)
    if (options.seed) {
      for (const { prompt, until } of SEEDED) {
        const started = await call<{ ok: true; agentId: string } | { ok: false; error: string }>('sendStart', id, prompt, {})
        if (!started.ok) throw new Error(`could not start "${prompt}": ${started.error}`)
        await waitAgent(started.agentId, until)
      }
    }
  } catch (err) {
    await stop().catch(() => {})
    throw err
  }

  return { url, home, project, toAdd, call, waitAgent, stop }
}

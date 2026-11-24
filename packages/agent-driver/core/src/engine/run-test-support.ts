// What the run tests share: a fixed clock, fake git hosts and the fake agents a run is started with.
import { rmSync } from 'node:fs'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { FakeDriver, type FakeDriverSession } from '../fake.js'
import { promptSent } from '../session-support.js'
import type { GitRunner } from '@openagt/agent-data'
import { RunOrder, type AgentLogins, type DistributionEntry, type DriverReadiness, type ModuleDefinition, type PullRequest, type Question, type RunAgent, type RunAgentOptions, type RunAgentReadyOptions, type StoreBackend, type Driver, type DriverSession, type DriverStartOptions } from '@openagt/hooks'
import { memoryStore } from '@openagt/hooks/testing'
import { gitBranchesModule } from '@openagt/git-branches/module'
import { githubModule, type GithubDeps } from '@openagt/github/module'
import { skillsModule } from '@openagt/skills/module'
import { projectsModule } from '@openagt/projects/module'
import agentDriver from './module.js'
import { git } from './test-repo.js'

export const NOW = new Date('2026-09-16T14:01:00.000Z')

/** What a run asks of its git host, as a test stands in for it: the pull request a branch has. */
export interface GitHost {
  requestOfBranch(dir: string, branch: string): Promise<PullRequest | undefined>
}

/** A git host with no pull request for any branch: what a run whose agent opened none reads. */
export const noGitHost: GitHost = { requestOfBranch: async () => undefined }

/**
 * A git host holding one pull request for one branch, once the agent has opened it (`open()`): read
 * back by the run. Every call is kept.
 */
export function fakeGitHost(branch: string, hook?: () => Promise<void>): GitHost & { open(): void; calls: string[][] } {
  let opened = false
  const calls: string[][] = []
  return {
    calls,
    open: () => (opened = true),
    requestOfBranch: async (_repo, asked) => {
      calls.push(['requests', asked])
      await hook?.()
      return opened && asked === branch ? { number: 12, url: 'https://example.com/x/y/pull/12' } : undefined
    },
  }
}

/** A fake session with something done before each prompt, handed the prompt as the agent is sent it, the attached text and the added sentence after it: the spread of a class instance loses its methods, so the wrapper is explicit. */
export function wrap(fake: FakeDriverSession, before: (text: string) => Promise<void>): DriverSession & { prompts: string[] } {
  return {
    id: fake.id,
    cwd: fake.cwd,
    prompts: fake.prompts,
    ...(fake.log ? { log: fake.log } : {}),
    prompt: async (text, opts) => {
      await before(promptSent(text, opts ?? {}))
      return fake.prompt(text, opts)
    },
    dispose: () => fake.dispose(),
  }
}

/** The question the tests' agents end a turn on, in the block ask's skill teaches. */
export const QUESTION = 'Plan written.\n\n```await-choices\n{ "title": "Ship it?", "options": [{ "label": "Approve" }, { "label": "Decline", "stop": true }], "recommended": "Approve" }\n```\n'

/** {@link QUESTION} as ask reads it. */
const SHIP_IT: Question = { title: 'Ship it?', options: [{ id: 'opt:0', label: 'Approve' }, { id: 'opt:1', label: 'Decline', stop: true }], recommended: 'opt:0' }

/** An agent that commits one file on a branch it names itself, the way a real one does. */
export function committingDriver(): Driver {
  return {
    id: 'fake',
    start: async (opts: DriverStartOptions): Promise<DriverSession> => {
      const fake = await new FakeDriver({
        respond: () => ({ text: 'Fixed it and committed.', usage: { costUsd: 0.5, inputTokens: 10, outputTokens: 5, cacheReadTokens: 0, cacheCreationTokens: 0 } }),
        sessionId: 's-1',
        model: 'claude-opus-5-5',
      }).start(opts)
      return wrap(fake, async () => {
        await git(['config', 'user.email', 'agent@example.com'], opts.cwd)
        await git(['config', 'user.name', 'agent'], opts.cwd)
        await git(['branch', '-m', 'agent-fix-it'], opts.cwd)
        await writeFile(join(opts.cwd, 'fixed.txt'), 'fixed\n')
        await git(['add', '-A'], opts.cwd)
        await git(['commit', '-q', '-m', 'Fix it'], opts.cwd)
      })
    },
  }
}

/** A clock a minute on at every reading: two runs of one process get two ids. */
export function ticking(): () => Date {
  let minutes = 0
  return () => new Date(NOW.getTime() + minutes++ * 60_000)
}

/** An agent that commits a file on the branch it names, pushes it and opens its pull request, the way the skills say; it notes the prompt it was given. */
export function publishingDriver(gitHost: ReturnType<typeof fakeGitHost>, seen: { prompt?: string }): Driver {
  return {
    id: 'fake',
    start: async (opts: DriverStartOptions): Promise<DriverSession> => {
      const fake = await new FakeDriver({ turns: [{ text: 'Fixed it and published.' }], sessionId: 's-1' }).start(opts)
      return wrap(fake, async text => {
        seen.prompt = text
        await git(['config', 'user.email', 'agent@example.com'], opts.cwd)
        await git(['config', 'user.name', 'agent'], opts.cwd)
        await git(['branch', '-m', 'agent-fix-it'], opts.cwd)
        await writeFile(join(opts.cwd, 'fixed.txt'), 'fixed\n')
        await git(['add', '-A'], opts.cwd)
        await git(['commit', '-q', '-m', 'Fix it'], opts.cwd)
        await git(['push', '-q', 'origin', 'HEAD'], opts.cwd)
        gitHost.open()
      })
    },
  }
}

/** GitHub as a test's run works as an account on it: what github's module asks of it there. */
export type GithubAccounts = Pick<GithubDeps, 'onGithub' | 'workAs'>

/** GitHub with no repository a test's run is in: the run works as no account there. */
export const noGithub: GithubAccounts = { onGithub: async () => false }

/**
 * GitHub with every repository on it, and OpenAgent's accounts there, by login, each with the
 * environment a run works as it with; the first is the one runs use. Each account worked as is kept.
 */
export function fakeGithub(accounts: Record<string, Record<string, string>>): GithubAccounts & { workedAs: string[] } {
  const workedAs: string[] = []
  return {
    workedAs,
    onGithub: async () => true,
    workAs: async (_dir, user) => {
      const login = user ?? Object.keys(accounts)[0]
      const env = login !== undefined ? accounts[login] : undefined
      if (login === undefined || env === undefined) throw new Error(`OpenAgent has no GitHub account ${user ?? ''}`.trim())
      workedAs.push(login)
      return { login, env }
    },
  }
}

/**
 * The plugins every test's run goes through, on as OpenAgent's distribution starts them: logs and
 * ask as a run has them, their skills and ask's step, which reads {@link QUESTION}. Stand-ins of the
 * tests' own, by the same names, since the real ones build on this package.
 */
const PLUGINS: DistributionEntry[] = await (async () => {
  const skills = await mkdtemp(join(tmpdir(), 'agent-driver-plugin-skills-'))
  process.once('exit', () => rmSync(skills, { recursive: true, force: true }))
  const skill = async (name: string): Promise<URL> => {
    const dir = join(skills, name)
    await mkdir(dir)
    await writeFile(join(dir, 'SKILL.md'), `---\nname: ${name}\ndescription: The ${name} plugin's skill, as a run gets it.\n---\n`)
    return pathToFileURL(`${dir}/`)
  }
  const [logs, ask] = [await skill('logs'), await skill('ask')]
  return [
    { module: { name: 'logs', plugin: { scope: 'project' }, hooks: { 'run.skills': () => [{ name: 'logs', dir: logs }] } }, on: true },
    {
      module: {
        name: 'ask',
        plugin: { scope: 'project' },
        hooks: {
          'run.skills': ({ agent }) => (agent?.ownQuestionTool ? [] : [{ name: 'ask', dir: ask }]),
          'run.step': [{ order: RunOrder.CONTEXT, name: 'ask the person', run: ctx => void (ctx.asking = { questionIn: text => (text.includes(QUESTION.trim()) ? SHIP_IT : undefined) }) }],
        },
      },
      on: true,
    },
  ]
})()

/** A list of accounts as a test's coding agent has one (`RunAgent.accounts`): its own login there, and nothing else of it asked. */
export function testLogins(list: string): AgentLogins {
  const none = (): never => {
    throw new Error("these tests ask nothing of an agent's logins")
  }
  return { list, service: list, envLogins: [], installed: async () => true, ownLoginThere: () => true, ownName: async () => undefined, logOut: none, signIn: none, isSignInCode: () => false, forget: none, usage: async () => undefined }
}

/**
 * A coding agent of the tests' own, as a module fills `run.agent` with one: `accounts` its list's name, `ready` its readiness,
 * `driver` the driver of each run (a {@link FakeDriver} saying `Done.` when absent), and what it
 * was built and asked with kept for a test to read.
 */
export function testAgent(
  id: string,
  opts: { accounts?: string; ready?: (asked: RunAgentReadyOptions) => DriverReadiness; driver?: (built: RunAgentOptions) => Driver } = {},
): RunAgent & { built: RunAgentOptions[]; asked: RunAgentReadyOptions[] } {
  const built: RunAgentOptions[] = []
  const asked: RunAgentReadyOptions[] = []
  return {
    id,
    label: id,
    ...(opts.accounts !== undefined ? { accounts: testLogins(opts.accounts) } : {}),
    built,
    asked,
    ready: async readyOpts => {
      asked.push(readyOpts)
      return opts.ready?.(readyOpts) ?? { problems: [], warnings: [] }
    },
    driver: driverOpts => {
      built.push(driverOpts)
      return opts.driver?.(driverOpts) ?? new FakeDriver({ turns: [{ text: 'Done.' }] })
    },
  }
}

/** The tests' coding agents, as a distribution's module brings them: Claude Code's id first, the one a run names none on, then Codex's. */
export const TEST_AGENTS: ModuleDefinition = { name: 'test-agents', hooks: { 'run.agent': [testAgent('claude-code', { accounts: 'claude' }), testAgent('codex', { accounts: 'codex' })] } }

/**
 * The modules a test's run goes through, as OpenAgent's distribution lists them for a run: a store
 * kept in memory (the person's settings: the plugins' Enabled rows, the profiles), projects, git-branches and
 * github, each with what the test stands in for, the skills module, agent-driver, the plugins
 * logs and ask, and any module of the test's own.
 */
export function testModules(deps: { gitHost?: GitHost; git?: GitRunner; github?: GithubAccounts; store?: StoreBackend; also?: ModuleDefinition[] } = {}): DistributionEntry[] {
  const gitHost = deps.gitHost ?? noGitHost
  return [
    { module: { name: 'test-store', hooks: { 'store.backend': deps.store ?? memoryStore() } } },
    { module: projectsModule() },
    { module: gitBranchesModule(deps.git ? { git: deps.git } : {}) },
    { module: githubModule({ ...(deps.github ?? noGithub), requestOfBranch: (dir, branch) => gitHost.requestOfBranch(dir, branch) }) },
    { module: skillsModule() },
    { module: agentDriver },
    { module: TEST_AGENTS },
    ...PLUGINS,
    ...(deps.also ?? []).map(module => ({ module })),
  ]
}

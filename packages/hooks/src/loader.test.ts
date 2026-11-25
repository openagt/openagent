import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AppContext, AppLifecycle } from './app.js'
import { createHooks, DISTRIBUTION_ENV, loadDistribution, loadHandedDown, type DistributionEntry, type HandlerError } from './loader.js'
import { defineModule, type ModuleDefinition } from './module.js'
import { RunOrder } from './order.js'
import type { ProjectRef } from './project.js'
import type { RunAgent } from './agent.js'
import type { RunStep } from './run.js'
import { fakeHost, fakeRun, memoryStore } from './testing.js'

// The loader: a distribution checked, its modules' hooks called in order, a plugin's only where it
// is on, and a handler that throws told and gone past.

const P1: ProjectRef = { id: 'p1', name: 'One', dir: '/projects/one' }
const P2: ProjectRef = { id: 'p2', name: 'Two', dir: '/projects/two' }

/** The store every distribution here keeps its settings in, first in the list. */
const filesystem = (): ModuleDefinition => defineModule({ name: 'store-filesystem', hooks: { 'store.backend': memoryStore() } })

function hooksOf(entries: DistributionEntry[], errors: HandlerError[] = []) {
  return createHooks([{ module: filesystem() }, ...entries], { onError: error => errors.push(error), projects: async () => [P1, P2] })
}

const marker = (name: string, order: number, done: string[]): RunStep => ({ order, name, run: () => void done.push(name) })

/** A coding agent that never runs: enough for the loader, which only lists it. */
const agent = (id: string): RunAgent => ({ id, label: id, ready: async () => ({ problems: [], warnings: [] }), driver: () => { throw new Error('no runs here') } })

const messages = (errors: HandlerError[]): string[] => errors.map(error => `${error.module} ${error.hook}: ${(error.error as Error).message}`)

test('a distribution that is wrong is refused, saying what is wrong', () => {
  const refused = (entries: DistributionEntry[], said: RegExp) => assert.throws(() => createHooks(entries), said)
  refused([{ module: defineModule({ name: 'Git', hooks: {} }) }], /"Git" is no module name/)
  refused([{ module: defineModule({ name: 'github', hooks: {} }) }, { module: defineModule({ name: 'github', hooks: {} }) }], /Two modules are named github/)
  refused([{ module: { name: 'github', hooks: { 'run.steps': [] } } as unknown as ModuleDefinition }], /github fills run.steps, which is no hook/)
  refused([{ module: defineModule({ name: 'github', hooks: {} }), on: true }], /github is a core module, always on/)
  refused([{ module: { name: 'notifications-command', plugin: { scope: 'machine' }, hooks: {} } as unknown as ModuleDefinition }], /notifications-command keeps its Enabled row nowhere/)
  refused([{ module: defineModule({ name: 'github', hooks: { 'run.step': [{ order: Number.NaN, name: 'account', run: () => {} }] } }) }], /github's step "account" stands at no order/)
  refused([{ module: defineModule({ name: 'store-git-branch', plugin: { scope: 'project', row: { read: async () => false, settings: 'project-agent-data' } }, hooks: {} }), on: true }], /store-git-branch keeps its own row: it starts as its row says/)
  refused([{ module: defineModule({ name: 'host-claude-web', hooks: { 'app.route': [{ path: '/bridge', handle: () => {} }] } }) }], /host-claude-web's route "\/bridge" is no route's path/)
  refused([{ module: defineModule({ name: 'host-claude-web', hooks: { 'app.route': [{ path: '/_bridge/start', handle: () => {} }] } }) }], /host-claude-web's route "\/_bridge\/start" is no route's path/)
})

test("a run's steps go by order; at the same order, by the distribution's order, then by each module's own", async () => {
  const done: string[] = []
  const hooks = hooksOf([
    { module: defineModule({ name: 'agent-driver', hooks: { 'run.step': [marker('turns', RunOrder.RUN, done), marker('record', RunOrder.RECORD, done)] } }) },
    { module: defineModule({ name: 'git-branches', hooks: { 'run.step': [marker('reclaim', RunOrder.CLEANUP, done), marker('worktree', RunOrder.WORKSPACE, done)] } }) },
    { module: defineModule({ name: 'github', hooks: { 'run.step': [marker('pull request', RunOrder.RECORD, done), marker('account', RunOrder.ACCOUNTS, done)] } }) },
  ])
  assert.deepEqual(
    (await hooks.steps({ options: {} })).map(step => `${step.module}: ${step.name}`),
    ['github: account', 'git-branches: worktree', 'agent-driver: turns', 'agent-driver: record', 'github: pull request', 'git-branches: reclaim'],
  )
  const result = await hooks.run(fakeRun({ store: hooks.store }))
  assert.deepEqual(done, ['account', 'worktree', 'turns', 'record', 'pull request', 'reclaim'])
  assert.deepEqual(result, { outcome: { status: 'done' }, errors: [] })
})

test('a plugin is off until its Enabled row is on, in the scope it keeps the row; a core module is always on', async () => {
  const hooks = hooksOf([
    { module: defineModule({ name: 'tickets', plugin: { scope: 'project' }, hooks: {} }) },
    { module: defineModule({ name: 'queue', plugin: { scope: 'project' }, hooks: {} }), on: true },
    { module: defineModule({ name: 'notifications-command', plugin: { scope: 'computer' }, hooks: {} }) },
    { module: defineModule({ name: 'ask', plugin: { scope: 'computer' }, hooks: {} }), on: true },
    { module: defineModule({ name: 'github', hooks: {} }) },
  ])
  assert.equal(await hooks.enabled('github'), true)
  assert.equal(await hooks.enabled('ask'), true, 'the distribution starts ask on')
  assert.equal(await hooks.enabled('notifications-command'), false)
  assert.equal(await hooks.enabled('tickets', P1), false)
  await hooks.setEnabled('tickets', true, P1)
  await hooks.setEnabled('queue', false, P1)
  await hooks.setEnabled('notifications-command', true)
  await hooks.setEnabled('ask', false)
  assert.equal(await hooks.enabled('tickets', P1), true)
  assert.equal(await hooks.enabled('tickets', P2), false, 'each project has its own row')
  assert.equal(await hooks.enabled('queue', P1), false)
  assert.equal(await hooks.enabled('queue', P2), true)
  assert.equal(await hooks.enabled('tickets'), false, 'a plugin kept per project, where no project is named, is as the distribution starts it: off')
  assert.equal(await hooks.enabled('queue'), true, 'or on')
  assert.equal(await hooks.enabled('notifications-command'), true)
  assert.equal(await hooks.enabled('ask'), false)
  assert.equal(await hooks.enabled('nothing'), false)
  await assert.rejects(hooks.setEnabled('github', false), /github is a core module, always on/)
  await assert.rejects(hooks.setEnabled('nothing', true), /No module is named nothing/)
})

test('a plugin that keeps its own row is on as the row says, where it is asked, and is switched on its Settings entry, not here; a row that cannot be read is off, and told', async () => {
  const errors: HandlerError[] = []
  const shared = new Set(['p1'])
  const asked: (string | undefined)[] = []
  const hooks = hooksOf(
    [
      { module: defineModule({ name: 'store-git-branch', plugin: { scope: 'project', row: { read: async project => (asked.push(project?.id), project !== undefined && shared.has(project.id)), settings: 'project-agent-data' } }, hooks: {} }) },
      {
        module: defineModule({
          name: 'store-git-repository',
          plugin: {
            scope: 'computer',
            row: {
              read: async () => {
                throw new Error('the folder is gone')
              },
              settings: 'agent-data',
            },
          },
          hooks: {},
        }),
      },
    ],
    errors,
  )
  assert.equal(await hooks.enabled('store-git-branch', P1), true)
  assert.equal(await hooks.enabled('store-git-branch', P2), false)
  assert.equal(await hooks.enabled('store-git-branch'), false, 'with no project, as the row says')
  assert.deepEqual(asked, ['p1', 'p2', undefined])
  await assert.rejects(hooks.setEnabled('store-git-branch', true, P2), /store-git-branch keeps its own row: it is switched on its Settings entry/)
  assert.equal(await hooks.enabled('store-git-repository'), false)
  assert.deepEqual(messages(errors), ['store-git-repository enabled: the folder is gone'])
  // No setting was made for either: their rows are their own.
  assert.equal(await hooks.store.read({ kind: 'project', project: P2 }, 'settings.json'), undefined)
})

test("a question of every module's rows reads each scope's settings once, and only the rows of the modules that fill the hook asked; the modules on are every one's", async () => {
  const store = memoryStore()
  const reads: string[] = []
  const counting = defineModule({
    name: 'store-filesystem',
    hooks: { 'store.backend': { order: store.order, wrap: (next, context) => {
      const inner = store.wrap(next, context)
      return { ...inner, read: (scope, path, opts) => (reads.push(`${scope.kind} ${path}`), inner.read(scope, path, opts)) }
    } } },
  })
  const step = (name: string): RunStep => ({ order: RunOrder.RUN, name, run: () => {} })
  const hooks = createHooks(
    [
      { module: counting },
      { module: defineModule({ name: 'tickets', plugin: { scope: 'project' }, hooks: { 'run.step': [step('tickets')] } }), on: true },
      { module: defineModule({ name: 'queue', plugin: { scope: 'project' }, hooks: { 'run.step': [step('queue')] } }), on: true },
      { module: defineModule({ name: 'browser', plugin: { scope: 'project' }, hooks: { 'run.step': [step('browser')] } }) },
      { module: defineModule({ name: 'notifications-command', plugin: { scope: 'computer' }, hooks: { 'run.step': [step('notifications-command')] } }), on: true },
      { module: defineModule({ name: 'discord', plugin: { scope: 'person' }, hooks: { 'app.attention': async () => [] } }), on: true },
    ],
    { onError: () => {} },
  )
  assert.deepEqual((await hooks.steps({ project: P1, options: {} })).map(one => one.name), ['tickets', 'queue', 'notifications-command'])
  assert.deepEqual(reads.sort(), ['computer settings.json', 'project settings.json'], "discord's row is not read: it gives no step")
  reads.length = 0
  assert.deepEqual((await hooks.on(P1)).map(module => module.name), ['store-filesystem', 'tickets', 'queue', 'notifications-command', 'discord'])
  assert.deepEqual(reads.sort(), ['computer settings.json', 'person settings.json', 'project settings.json'])
})

test('a run goes without the plugins its options name: none of their steps, skills or items; a core module named there stays on', async () => {
  const done: string[] = []
  const hooks = hooksOf([
    {
      module: defineModule({
        name: 'github',
        hooks: { 'run.step': [marker('account', RunOrder.ACCOUNTS, done)], 'run.skills': () => [{ name: 'github', dir: '/skills/github', command: 'github' }] },
      }),
    },
    {
      module: defineModule({
        name: 'browser',
        plugin: { scope: 'project' },
        hooks: {
          'run.step': [marker('chrome', RunOrder.CONTEXT, done)],
          'run.skills': () => [{ name: 'browser', dir: '/skills/browser', command: 'browser' }],
          'app.attention': () => [{ kind: 'setup', scope: 'project', words: 'Chrome is missing' }],
        },
      }),
    },
  ])
  await hooks.setEnabled('browser', true, P1)
  const every = { project: P1, options: {} }
  const without = { project: P1, options: { plugins: { without: ['browser', 'github'] } } }
  assert.deepEqual((await hooks.steps(every)).map(step => step.name), ['account', 'chrome'])
  assert.deepEqual((await hooks.steps(without)).map(step => step.name), ['account'])
  assert.deepEqual((await hooks.skills(every)).map(skill => `${skill.module}: ${skill.name}`), ['github: github', 'browser: browser'])
  assert.deepEqual((await hooks.skills(without)).map(skill => skill.name), ['github'])
  assert.deepEqual(await hooks.attention(every), { items: [{ kind: 'setup', scope: 'project', words: 'Chrome is missing', module: 'browser' }], whole: true })
  assert.deepEqual(await hooks.attention(without), { items: [], whole: true })
  assert.deepEqual((await hooks.steps({ project: P2, options: {} })).map(step => step.name), ['account'], 'the browser is off in p2')
  assert.deepEqual((await hooks.skills({ project: P2 }, { every: true })).map(skill => skill.name), ['github', 'browser'], "a clean-up asks every module's skills, a plugin that is off too")
})

test('asked about this computer, a plugin kept per project is asked where it is on in a project, and handed the projects it is on in', async () => {
  const told: string[][] = []
  const hooks = hooksOf([
    {
      module: defineModule({
        name: 'tickets',
        plugin: { scope: 'project' },
        hooks: {
          'app.attention': async (_args, app) => {
            const projects = await app.projects()
            told.push(projects.map(project => project.id))
            return [{ kind: 'setup', scope: 'computer', words: 'Populate the tickets' }]
          },
        },
      }),
    },
  ])
  assert.deepEqual(await hooks.attention({}), { items: [], whole: true }, 'on in no project, nothing is asked')
  await hooks.setEnabled('tickets', true, P2)
  assert.deepEqual(await hooks.attention({}), { items: [{ kind: 'setup', scope: 'computer', words: 'Populate the tickets', module: 'tickets' }], whole: true })
  assert.deepEqual(await hooks.attention({ options: { plugins: { without: ['tickets'] } } }), { items: [], whole: true }, 'nor where the options go without it')
  assert.deepEqual(told, [['p2']])
})

test('asked about this computer, a plugin kept per project that the distribution starts on is asked, as on in no project yet', async () => {
  const hooks = hooksOf([{ module: defineModule({ name: 'ask', plugin: { scope: 'project' }, hooks: { 'app.attention': () => [{ kind: 'waiting', scope: 'run', run: 's1', words: 'Needs answer' }] } }), on: true }])
  assert.deepEqual(await hooks.attention({}), { items: [{ kind: 'waiting', scope: 'run', run: 's1', words: 'Needs answer', module: 'ask' }], whole: true })
})

test('a second skill, coding agent or host of one name is left out and told; a handler that throws is told, and the others are still asked', async () => {
  const errors: HandlerError[] = []
  const hooks = hooksOf(
    [
      { module: defineModule({ name: 'agent-driver-claude-code', hooks: { 'run.agent': [agent('claude-code')], 'run.skills': () => [{ name: 'shared', dir: '/a' }] } }) },
      { module: defineModule({ name: 'copycat', hooks: { 'run.agent': [agent('claude-code')], 'run.skills': () => [{ name: 'shared', dir: '/b' }, { name: 'own', dir: '/c' }] } }) },
      {
        module: defineModule({
          name: 'broken',
          hooks: {
            'run.skills': () => {
              throw new Error('no skills today')
            },
            'app.attention': async () => {
              throw new Error('no idea')
            },
            'run.host': [fakeHost({ id: 'here' })],
          },
        }),
      },
      {
        module: defineModule({
          name: 'notifications-command',
          hooks: {
            'run.host': [fakeHost({ id: 'here' }), fakeHost({ id: 'there' })],
            'app.attention': () => [{ kind: 'waiting', scope: 'run', run: 'r1', words: 'Needs an answer', fix: { label: 'Answer', action: 'answer' } }],
          },
        }),
      },
    ],
    errors,
  )
  assert.deepEqual((await hooks.skills({ project: P1 })).map(skill => `${skill.module}: ${skill.name} at ${String(skill.dir)}`), ['agent-driver-claude-code: shared at /a', 'copycat: own at /c'])
  assert.deepEqual((await hooks.agents()).map(agent => agent.id), ['claude-code'])
  assert.deepEqual((await hooks.hosts()).map(host => host.id), ['here', 'there'])
  // The module that threw gave nothing, and says the read is not whole: its items are not known to be gone.
  assert.deepEqual(await hooks.attention({}), { items: [{ kind: 'waiting', scope: 'run', run: 'r1', words: 'Needs an answer', fix: { label: 'Answer', action: 'answer' }, module: 'notifications-command' }], whole: false })
  assert.deepEqual(messages(errors), [
    'broken run.skills: no skills today',
    'copycat run.skills: agent-driver-claude-code gives a skill named shared already',
    'copycat run.agent: agent-driver-claude-code gives a coding agent claude-code already',
    'notifications-command run.host: broken gives a host here already',
    'broken app.attention: no idea',
  ])
})

test("the routes are the modules' on, a plugin's only while it is: a second route at a path is left out and told", async () => {
  const errors: HandlerError[] = []
  const bridge = { path: '/_bridge', handle: () => {} }
  const copied = { path: '/_bridge', handle: () => {} }
  const copy = { path: '/_copy', handle: () => {} }
  const hooks = hooksOf(
    [
      { module: defineModule({ name: 'host-claude-web', plugin: { scope: 'computer' }, hooks: { 'app.route': [bridge] } }) },
      { module: defineModule({ name: 'copycat', hooks: { 'app.route': [copied, copy] } }) },
    ],
    errors,
  )
  assert.deepEqual(await hooks.routes(), [copied, copy])
  assert.deepEqual(messages(errors), [])
  await hooks.setEnabled('host-claude-web', true)
  assert.deepEqual(await hooks.routes(), [bridge, copy])
  assert.deepEqual(messages(errors), ['copycat app.route: host-claude-web gives a route at /_bridge already'])
})

test('git reaches a remote as the first module with an account for it says; one that throws is told and gone past', async () => {
  const errors: HandlerError[] = []
  const hooks = hooksOf(
    [
      { module: defineModule({ name: 'gitlab', hooks: { 'account.access': { git: async remote => (remote.includes('gitlab') ? { env: { GIT_ASKPASS: 'gitlab' } } : undefined) } } }) },
      {
        module: defineModule({
          name: 'broken',
          hooks: {
            'account.access': {
              git: async () => {
                throw new Error('the keychain is locked')
              },
            },
          },
        }),
      },
      { module: defineModule({ name: 'github', hooks: { 'account.access': { git: async remote => (remote.includes('github') ? { env: { GH_CONFIG_DIR: '/accounts/a' } } : undefined) } } }) },
    ],
    errors,
  )
  assert.deepEqual(await hooks.gitAccess('https://github.com/o/r'), { env: { GH_CONFIG_DIR: '/accounts/a' } })
  assert.deepEqual(await hooks.gitAccess('https://gitlab.com/o/r'), { env: { GIT_ASKPASS: 'gitlab' } })
  assert.equal(await hooks.gitAccess('https://example.com/o/r'), undefined)
  assert.deepEqual(messages(errors), ['broken account.access: the keychain is locked', 'broken account.access: the keychain is locked'])
})

test("a run's account is the first module answering for its repository's; a session with no project takes the first given, else the first refusal", async () => {
  const errors: HandlerError[] = []
  const refuses = (error: string) => async () => ({ ok: false as const, error })
  const hooks = hooksOf(
    [
      { module: defineModule({ name: 'gitlab', hooks: { 'account.access': { runAs: async dir => (dir === undefined ? { ok: false, error: 'no gitlab account' } : dir.includes('gitlab') ? { ok: true, login: 'lab', env: { A: 'lab' } } : undefined) } } }) },
      { module: defineModule({ name: 'broken', hooks: { 'account.access': { runAs: async () => Promise.reject(new Error('the keychain is locked')) } } }) },
      { module: defineModule({ name: 'github', hooks: { 'account.access': { runAs: async (dir, login) => (dir === undefined || dir.includes('github') ? { ok: true, login: login ?? 'hub', env: { A: 'hub' } } : undefined) } } }) },
    ],
    errors,
  )
  assert.deepEqual(await hooks.gitAccounts.runAs('/repos/gitlab'), { ok: true, login: 'lab', env: { A: 'lab' } })
  assert.deepEqual(await hooks.gitAccounts.runAs('/repos/github', 'octo'), { ok: true, login: 'octo', env: { A: 'hub' } })
  assert.equal(await hooks.gitAccounts.runAs('/repos/elsewhere'), undefined)
  assert.deepEqual(await hooks.gitAccounts.runAs(undefined), { ok: true, login: 'hub', env: { A: 'hub' } })
  assert.deepEqual(await hooksOf([{ module: defineModule({ name: 'a', hooks: { 'account.access': { runAs: refuses('first') } } }) }, { module: defineModule({ name: 'b', hooks: { 'account.access': { runAs: refuses('second') } } }) }], []).gitAccounts.runAs(undefined), { ok: false, error: 'first' })
  assert.deepEqual(messages(errors), ['broken account.access: the keychain is locked', 'broken account.access: the keychain is locked', 'broken account.access: the keychain is locked'])
})

test('the people behind commit emails are the first module answering for the repository says; nobody where none does', async () => {
  const hooks = hooksOf(
    [
      { module: defineModule({ name: 'gitlab', hooks: { 'account.access': { people: async dir => (dir.includes('gitlab') ? [] : undefined) } } }) },
      { module: defineModule({ name: 'github', hooks: { 'account.access': { people: async (dir, emails) => (dir.includes('github') ? emails.map(email => ({ email, login: email.split('@')[0]! })) : undefined) } } }) },
    ],
    [],
  )
  assert.deepEqual(await hooks.gitAccounts.people('/repos/github', ['ada@x.dev']), [{ email: 'ada@x.dev', login: 'ada' }])
  assert.deepEqual(await hooks.gitAccounts.people('/repos/gitlab', ['ada@x.dev']), [])
  assert.deepEqual(await hooks.gitAccounts.people('/repos/elsewhere', ['ada@x.dev']), [])
})

test("the app's life: modules start where they are on, one that keeps its own row wherever it is, and stop the last first; a project added or written reaches the modules on in it, a removed one every module", async () => {
  const seen: string[] = []
  const errors: HandlerError[] = []
  const lifecycle = (name: string): AppLifecycle => ({
    started: async (app: AppContext) => void seen.push(`${name} started in ${(await app.projects()).map(project => project.id).join(',') || 'none'}`),
    stopping: () => void seen.push(`${name} stopping`),
    projectAdded: project => void seen.push(`${name} added ${project.id}`),
    projectWritten: project => void seen.push(`${name} wrote ${project.id}`),
    projectRemoved: project => void seen.push(`${name} removed ${project.id}`),
  })
  const hooks = hooksOf(
    [
      { module: defineModule({ name: 'projects', hooks: { 'app.lifecycle': lifecycle('projects') } }) },
      { module: defineModule({ name: 'github-auto-reply', plugin: { scope: 'project' }, hooks: { 'app.lifecycle': lifecycle('auto-reply') } }) },
      { module: defineModule({ name: 'notifications-command', plugin: { scope: 'computer' }, hooks: { 'app.lifecycle': lifecycle('notifications-command') } }) },
      {
        module: defineModule({
          name: 'scheduled-agents',
          plugin: { scope: 'computer' },
          hooks: {
            'app.lifecycle': {
              ...lifecycle('scheduler'),
              started: () => {
                throw new Error('no clock')
              },
            },
          },
        }),
        on: true,
      },
      // Off as its row says, and started all the same: its row may turn on while the app runs.
      { module: defineModule({ name: 'store-git-repository', plugin: { scope: 'computer', row: { read: async () => false, settings: 'agent-data' } }, hooks: { 'app.lifecycle': lifecycle('folder sync') } }) },
    ],
    errors,
  )
  await hooks.setEnabled('github-auto-reply', true, P2)
  await hooks.started({ signal: new AbortController().signal, url: 'http://127.0.0.1:4200' })
  await hooks.projectAdded({ id: 'p3', name: 'Three', dir: '/projects/three' })
  await hooks.projectWritten(P2)
  await hooks.projectRemoved(P1)
  await hooks.stopping()
  assert.deepEqual(seen, [
    'projects started in p1,p2',
    'auto-reply started in p2',
    'folder sync started in p1,p2',
    'projects added p3',
    'scheduler added p3',
    'projects wrote p2',
    'auto-reply wrote p2',
    'scheduler wrote p2',
    'projects removed p1',
    'auto-reply removed p1',
    'notifications-command removed p1',
    'scheduler removed p1',
    'folder sync removed p1',
    'folder sync stopping',
    'scheduler stopping',
    'auto-reply stopping',
    'projects stopping',
  ])
  assert.deepEqual(messages(errors), ['scheduled-agents app.lifecycle.started: no clock'])
})

test('once the app started, a plugin kept per person or per computer starts and stops with its switch, its signal aborted as it stops; one kept per project does not', async () => {
  const seen: string[] = []
  const signals: AbortSignal[] = []
  const lifecycle = (name: string): AppLifecycle => ({
    started: app => {
      signals.push(app.signal)
      seen.push(`${name} started at ${app.url}`)
    },
    stopping: () => void seen.push(`${name} stopping`),
  })
  const hooks = hooksOf([
    { module: defineModule({ name: 'projects', hooks: { 'app.lifecycle': lifecycle('projects') } }) },
    { module: defineModule({ name: 'notifications-command', plugin: { scope: 'computer' }, hooks: { 'app.lifecycle': lifecycle('notifications-command') } }) },
    { module: defineModule({ name: 'discord', plugin: { scope: 'person' }, hooks: { 'app.lifecycle': lifecycle('discord') } }), on: true },
    { module: defineModule({ name: 'tickets', plugin: { scope: 'project' }, hooks: { 'app.lifecycle': lifecycle('tickets') } }) },
  ])
  await hooks.setEnabled('notifications-command', false)
  const app = new AbortController()
  await hooks.started({ signal: app.signal, url: 'http://127.0.0.1:4200' })
  await hooks.setEnabled('notifications-command', true)
  await hooks.setEnabled('notifications-command', true)
  await hooks.setEnabled('tickets', true, P1)
  await hooks.setEnabled('discord', false)
  assert.deepEqual(seen.splice(0), [
    'projects started at http://127.0.0.1:4200',
    'discord started at http://127.0.0.1:4200',
    'tickets started at http://127.0.0.1:4200',
    'notifications-command started at http://127.0.0.1:4200',
    'discord stopping',
  ])
  assert.deepEqual(signals.map(signal => signal.aborted), [false, true, false, false], "discord's signal is aborted: it was switched off")
  app.abort()
  await hooks.stopping()
  assert.deepEqual(seen, ['notifications-command stopping', 'tickets stopping', 'projects stopping'], 'the last started stops first')
  assert.deepEqual(signals.map(signal => signal.aborted), [true, true, true, true])
  await hooks.setEnabled('notifications-command', false)
  await hooks.setEnabled('notifications-command', true)
  assert.deepEqual(seen, ['notifications-command stopping', 'tickets stopping', 'projects stopping'], 'nothing starts once the app stopped')
})

test("a distribution is loaded from its packages' ./module entries, through the import it passes", async () => {
  const packages: Record<string, unknown> = {
    '@openagt/store-filesystem/module': { default: filesystem() },
    '@openagt/github/module': { default: defineModule({ name: 'github', hooks: {} }) },
    '@openagt/tickets/module': { default: defineModule({ name: 'tickets', plugin: { scope: 'project' }, hooks: {} }) },
  }
  const load = async (specifier: string): Promise<unknown> => {
    if (!(specifier in packages)) throw new Error(`Cannot find ${specifier}`)
    return packages[specifier]
  }
  const hooks = await loadDistribution([{ package: '@openagt/store-filesystem' }, { package: '@openagt/github' }, { package: '@openagt/tickets', on: true }], load)
  assert.deepEqual(
    hooks.modules.map(module => module.name),
    ['store-filesystem', 'github', 'tickets'],
  )
  assert.equal(await hooks.enabled('tickets', P1), true)
  assert.equal(hooks.ofPackage('@openagt/tickets')?.name, 'tickets', 'a package is known by the module it is')
  assert.equal(hooks.ofPackage('@openagt/ui-pane-files'), undefined)
  await assert.rejects(loadDistribution([{ package: '@openagt/nothing' }], load), /Cannot find @openagt\/nothing\/module/)
  await assert.rejects(loadDistribution([{ package: '@openagt/bare' }], async () => ({ default: 42 })), /@openagt\/bare\/module default-exports no module/)
})

test("a distribution handed down is loaded from its file, each package resolved from the file's own place, a package with no Node part skipped, and a module it lists as it is", async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hooks-distribution-'))
  try {
    const thing = join(dir, 'node_modules', '@openagt', 'thing')
    await mkdir(thing, { recursive: true })
    await writeFile(join(thing, 'package.json'), JSON.stringify({ name: '@openagt/thing', type: 'module', exports: { './module': './module.js' } }))
    await writeFile(join(thing, 'module.js'), "export default { name: 'thing', hooks: {} }\n")
    // A package with a UI part alone, and one with a skill's text alone: no Node part to load.
    const pane = join(dir, 'node_modules', '@openagt', 'pane')
    await mkdir(pane, { recursive: true })
    await writeFile(join(pane, 'package.json'), JSON.stringify({ name: '@openagt/pane', type: 'module', exports: { './dashboard': './dashboard.js', './package.json': './package.json' } }))
    const skill = join(dir, 'node_modules', '@openagt', 'skill')
    await mkdir(skill, { recursive: true })
    await writeFile(join(skill, 'package.json'), JSON.stringify({ name: '@openagt/skill' }))
    const file = join(dir, 'distribution.mjs')
    await writeFile(file, "export default [{ package: '@openagt/thing' }, { package: '@openagt/pane' }, { package: '@openagt/skill' }, { module: { name: 'fake-runs', hooks: {} } }]\n")
    assert.deepEqual((await loadHandedDown({ [DISTRIBUTION_ENV]: file }))?.map(entry => entry.module.name), ['thing', 'fake-runs'])
    assert.equal(await loadHandedDown({}), undefined, 'none handed down')
    const wrong = join(dir, 'wrong.mjs')
    await writeFile(wrong, 'export default 42\n')
    await assert.rejects(loadHandedDown({ [DISTRIBUTION_ENV]: wrong }), /wrong\.mjs default-exports no distribution/)
    const missing = join(dir, 'missing.mjs')
    await writeFile(missing, "export default [{ package: '@openagt/missing' }]\n")
    await assert.rejects(loadHandedDown({ [DISTRIBUTION_ENV]: missing }), /@openagt\/missing, which the distribution .*missing\.mjs lists, is not installed beside it/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('with no store in the distribution, a plugin is off, and why is told', async () => {
  const errors: HandlerError[] = []
  const hooks = createHooks([{ module: defineModule({ name: 'notifications-command', plugin: { scope: 'computer' }, hooks: {} }), on: true }], { onError: error => errors.push(error) })
  assert.equal(await hooks.enabled('notifications-command'), false)
  assert.deepEqual(messages(errors), ['notifications-command enabled: No store keeps the computer data'])
})

test('a project removed with its files: each module answers what it removed and kept there, one that refuses is a line of what failed, and the others still clean up', async () => {
  const errors: HandlerError[] = []
  const said: boolean[] = []
  const hooks = hooksOf(
    [
      { module: defineModule({ name: 'git-branches', hooks: { 'app.lifecycle': { projectRemoved: (_project, _app, { files }) => (said.push(files), files ? { removed: ['.branches'], kept: [{ path: '.branches/agent-1', reason: 'uncommitted work' }] } : undefined) } } }) },
      {
        module: defineModule({
          name: 'agent-driver',
          hooks: {
            'app.lifecycle': {
              projectRemoved: () => {
                throw new Error('a run is still working here')
              },
            },
          },
        }),
      },
      { module: defineModule({ name: 'scheduled-agents', hooks: { 'app.lifecycle': { projectRemoved: () => ({ removed: ['.scheduler'], kept: [] }) } } }) },
    ],
    errors,
  )
  assert.deepEqual(await hooks.projectRemoved(P1, { files: true }), {
    removed: ['.branches', '.scheduler'],
    kept: [{ path: '.branches/agent-1', reason: 'uncommitted work' }],
    failed: ['agent-driver: a run is still working here'],
  })
  assert.deepEqual(await hooks.projectRemoved(P1), { removed: ['.scheduler'], kept: [], failed: ['agent-driver: a run is still working here'] })
  assert.deepEqual(said, [true, false])
})

test("the folder the command was typed in: the first module that answers makes it a project, and the modules on in it are told when it was added just now", async () => {
  const added: string[] = []
  const hooks = hooksOf([
    { module: defineModule({ name: 'other', hooks: { 'app.lifecycle': { folderGiven: async () => undefined, projectAdded: project => void added.push(`other ${project.id}`) } } }) },
    { module: defineModule({ name: 'projects', hooks: { 'app.lifecycle': { folderGiven: async folder => ({ project: { ...P2, dir: folder }, added: folder === '/projects/two' }) } } }) },
  ])
  assert.deepEqual(await hooks.folderGiven('/projects/two'), { project: P2, added: true })
  assert.deepEqual(await hooks.folderGiven('/projects/two/src').then(given => given?.added), false)
  assert.deepEqual(added, ['other p2'])
})

test('a project may not go while a module refuses it: the first refusal is said, one that cannot tell refuses in its words, and with none refusing it may', async () => {
  const errors: HandlerError[] = []
  const asked: string[] = []
  const refusing = (name: string, reason: (project: ProjectRef) => string | undefined): DistributionEntry => ({
    module: defineModule({ name, hooks: { 'app.lifecycle': { refuseRemoval: project => (asked.push(name), reason(project)) } } }),
  })
  const quiet = hooksOf([refusing('free', () => undefined)])
  assert.equal(await quiet.lifecycle.refusal(P1), undefined)
  const busy = hooksOf([refusing('free', () => undefined), refusing('runs', project => `An agent is working in ${project.name}.`), refusing('later', () => 'not asked')])
  asked.length = 0
  assert.equal(await busy.lifecycle.refusal(P1), 'An agent is working in One.')
  assert.deepEqual(asked, ['free', 'runs'], 'the first refusal is the answer')
  const broken = hooksOf([refusing('runs', () => { throw new Error('the locks could not be read') })], errors)
  assert.equal(await broken.lifecycle.refusal(P1), 'runs could not tell whether the project may go: the locks could not be read')
  assert.deepEqual(errors.map(error => `${error.module} ${error.hook}`), ['runs app.lifecycle.refuseRemoval'])
})

test("a module's app lists the runs of a project, or of no project, as every host there lists them", async () => {
  const here = fakeHost({ id: 'here' })
  const there = fakeHost({ id: 'there' })
  const seen: AppContext[] = []
  const hooks = hooksOf([
    { module: defineModule({ name: 'agent-driver', hooks: { 'run.host': [here] } }) },
    { module: defineModule({ name: 'host-elsewhere', hooks: { 'run.host': [there] } }) },
    { module: defineModule({ name: 'git-branches', hooks: { 'app.attention': (_args, app) => (seen.push(app), []) } }) },
  ])
  await here.start({ project: P1, prompt: 'one', options: {} })
  await there.start({ project: P1, prompt: 'two', options: {} })
  await here.start({ prompt: 'none', options: {} })
  await hooks.attention({ project: P1 })
  const app = seen[0]!
  assert.deepEqual((await app.runs(P1)).map(run => `${run.host}: ${run.prompt}`), ['here: one', 'there: two'])
  assert.deepEqual((await app.runs()).map(run => run.prompt), ['none'])
})

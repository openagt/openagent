import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import type { AppContext, AppLifecycle } from './app.js'
import { createHooks, loadDistribution, type DistributionEntry, type HandlerError } from './loader.js'
import { defineModule, type ModuleDefinition } from './module.js'
import { RunOrder } from './order.js'
import type { ProjectRef } from './project.js'
import type { RunAgent, RunStep } from './run.js'
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

/** A coding agent that is only its id: enough for the loader, which never starts one. */
const driver = (id: string): RunAgent => ({ id }) as unknown as RunAgent

const messages = (errors: HandlerError[]): string[] => errors.map(error => `${error.module} ${error.hook}: ${(error.error as Error).message}`)

test('a distribution that is wrong is refused, saying what is wrong', () => {
  const refused = (entries: DistributionEntry[], said: RegExp) => assert.throws(() => createHooks(entries), said)
  refused([{ module: defineModule({ name: 'Git', hooks: {} }) }], /"Git" is no module name/)
  refused([{ module: defineModule({ name: 'github', hooks: {} }) }, { module: defineModule({ name: 'github', hooks: {} }) }], /Two modules are named github/)
  refused([{ module: { name: 'github', hooks: { 'run.steps': [] } } as unknown as ModuleDefinition }], /github fills run.steps, which is no hook/)
  refused([{ module: defineModule({ name: 'github', hooks: {} }), on: true }], /github is a core module, always on/)
  refused([{ module: { name: 'devices', plugin: { scope: 'machine' }, hooks: {} } as unknown as ModuleDefinition }], /devices keeps its Enabled row nowhere/)
  refused([{ module: defineModule({ name: 'github', hooks: { 'run.step': [{ order: Number.NaN, name: 'account', run: () => {} }] } }) }], /github's step "account" stands at no order/)
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
    ['git-branches: worktree', 'github: account', 'agent-driver: turns', 'agent-driver: record', 'github: pull request', 'git-branches: reclaim'],
  )
  const result = await hooks.run(fakeRun({ store: hooks.store }))
  assert.deepEqual(done, ['worktree', 'account', 'turns', 'record', 'pull request', 'reclaim'])
  assert.deepEqual(result, { outcome: { status: 'done' }, errors: [] })
})

test('a plugin is off until its Enabled row is on, in the scope it keeps the row; a core module is always on', async () => {
  const hooks = hooksOf([
    { module: defineModule({ name: 'tickets', plugin: { scope: 'project' }, hooks: {} }) },
    { module: defineModule({ name: 'devices', plugin: { scope: 'computer' }, hooks: {} }) },
    { module: defineModule({ name: 'ask', plugin: { scope: 'computer' }, hooks: {} }), on: true },
    { module: defineModule({ name: 'github', hooks: {} }) },
  ])
  assert.equal(await hooks.enabled('github'), true)
  assert.equal(await hooks.enabled('ask'), true, 'the distribution starts ask on')
  assert.equal(await hooks.enabled('devices'), false)
  assert.equal(await hooks.enabled('tickets', P1), false)
  await hooks.setEnabled('tickets', true, P1)
  await hooks.setEnabled('devices', true)
  await hooks.setEnabled('ask', false)
  assert.equal(await hooks.enabled('tickets', P1), true)
  assert.equal(await hooks.enabled('tickets', P2), false, 'each project has its own row')
  assert.equal(await hooks.enabled('tickets'), false, 'a plugin kept per project is on in no project unless one is named')
  assert.equal(await hooks.enabled('devices'), true)
  assert.equal(await hooks.enabled('ask'), false)
  assert.equal(await hooks.enabled('nothing'), false)
  await assert.rejects(hooks.setEnabled('github', false), /github is a core module, always on/)
  await assert.rejects(hooks.setEnabled('nothing', true), /No module is named nothing/)
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
  assert.deepEqual(await hooks.attention(every), [{ kind: 'setup', scope: 'project', words: 'Chrome is missing', module: 'browser' }])
  assert.deepEqual(await hooks.attention(without), [])
  assert.deepEqual((await hooks.steps({ project: P2, options: {} })).map(step => step.name), ['account'], 'the browser is off in p2')
})

test('a second skill, coding agent or host of one name is left out and told; a handler that throws is told, and the others are still asked', async () => {
  const errors: HandlerError[] = []
  const hooks = hooksOf(
    [
      { module: defineModule({ name: 'agent-driver-claude-code', hooks: { 'run.agent': [driver('claude-code')], 'run.skills': () => [{ name: 'shared', dir: '/a' }] } }) },
      { module: defineModule({ name: 'copycat', hooks: { 'run.agent': [driver('claude-code')], 'run.skills': () => [{ name: 'shared', dir: '/b' }, { name: 'own', dir: '/c' }] } }) },
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
          name: 'devices',
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
  assert.deepEqual(await hooks.attention({}), [{ kind: 'waiting', scope: 'run', run: 'r1', words: 'Needs an answer', fix: { label: 'Answer', action: 'answer' }, module: 'devices' }])
  assert.deepEqual(messages(errors), [
    'broken run.skills: no skills today',
    'copycat run.skills: agent-driver-claude-code gives a skill named shared already',
    'copycat run.agent: agent-driver-claude-code gives a coding agent claude-code already',
    'devices run.host: broken gives a host here already',
    'broken app.attention: no idea',
  ])
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

test("the app's life: modules start where they are on and stop the last first; a project added reaches the modules on in it, a removed one every module", async () => {
  const seen: string[] = []
  const errors: HandlerError[] = []
  const lifecycle = (name: string): AppLifecycle => ({
    started: async (app: AppContext) => void seen.push(`${name} started in ${(await app.projects()).map(project => project.id).join(',') || 'none'}`),
    stopping: () => void seen.push(`${name} stopping`),
    projectAdded: project => void seen.push(`${name} added ${project.id}`),
    projectRemoved: project => void seen.push(`${name} removed ${project.id}`),
  })
  const hooks = hooksOf(
    [
      { module: defineModule({ name: 'projects', hooks: { 'app.lifecycle': lifecycle('projects') } }) },
      { module: defineModule({ name: 'github-auto-reply', plugin: { scope: 'project' }, hooks: { 'app.lifecycle': lifecycle('auto-reply') } }) },
      { module: defineModule({ name: 'devices', plugin: { scope: 'computer' }, hooks: { 'app.lifecycle': lifecycle('devices') } }) },
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
    ],
    errors,
  )
  await hooks.setEnabled('github-auto-reply', true, P2)
  await hooks.started(new AbortController().signal)
  await hooks.projectAdded({ id: 'p3', name: 'Three', dir: '/projects/three' })
  await hooks.projectRemoved(P1)
  await hooks.stopping()
  assert.deepEqual(seen, [
    'projects started in p1,p2',
    'auto-reply started in p2',
    'projects added p3',
    'scheduler added p3',
    'projects removed p1',
    'auto-reply removed p1',
    'devices removed p1',
    'scheduler removed p1',
    'scheduler stopping',
    'auto-reply stopping',
    'projects stopping',
  ])
  assert.deepEqual(messages(errors), ['scheduled-agents app.lifecycle.started: no clock'])
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
  await assert.rejects(loadDistribution([{ package: '@openagt/nothing' }], load), /Cannot find @openagt\/nothing\/module/)
  await assert.rejects(loadDistribution([{ package: '@openagt/bare' }], async () => ({ default: 42 })), /@openagt\/bare\/module default-exports no module/)
})

test('with no store in the distribution, a plugin is off, and why is told', async () => {
  const errors: HandlerError[] = []
  const hooks = createHooks([{ module: defineModule({ name: 'devices', plugin: { scope: 'computer' }, hooks: {} }), on: true }], { onError: error => errors.push(error) })
  assert.equal(await hooks.enabled('devices'), false)
  assert.deepEqual(messages(errors), ['devices enabled: No store keeps the computer data'])
})

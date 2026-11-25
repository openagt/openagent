import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import type { AppContext, ProjectRef } from '@openagt/hooks'
import { schedulersLifecycle, type SchedulersDeps } from './lifecycle.js'

const project = (dir: string): ProjectRef => ({ id: dir.slice(1), name: dir.slice(1), dir })
const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms))

async function eventually(ok: () => boolean): Promise<void> {
  for (let i = 0; i < 200 && !ok(); i++) await sleep(10)
  assert.ok(ok())
}

/** An app whose plugin is on in the projects `on` names, and a scheduler that says what it was asked. */
function scheduling(on: string[], deps: Partial<SchedulersDeps> = {}) {
  const calls: string[] = []
  const logged: string[] = []
  const app = { on, stop: new AbortController() }
  const context = { projects: async () => app.on.map(project), get signal() { return app.stop.signal } } as unknown as AppContext
  const lifecycle = schedulersLifecycle({
    start: async repo => void calls.push(`start ${repo}`),
    stop: async (repo, opts) => void calls.push(`stop ${repo}${opts.unlessKeepAlive ? ' unless kept alive' : ''}`),
    log: line => void logged.push(line),
    everyMs: 20,
    ...deps,
  })
  return { app, context, lifecycle, calls, logged }
}

test('the scheduler runs in each project the plugin is on in for as long as OpenAgent runs: switched on there, it starts within a look; switched off, it stops, kept alive or not; as OpenAgent stops, it stops unless kept alive', async () => {
  const { app, context, lifecycle, calls } = scheduling(['/a', '/b'])
  await lifecycle.started!(context)
  assert.deepEqual(calls, ['start /a', 'start /b'], 'started as OpenAgent starts')
  app.on = ['/b', '/c']
  await eventually(() => calls.length === 4)
  assert.deepEqual(calls.slice(2), ['start /c', 'stop /a'])
  // Looked at again with nothing changed: nothing is asked again.
  await sleep(60)
  assert.equal(calls.length, 4)
  app.stop.abort()
  await lifecycle.stopping!()
  assert.deepEqual(calls.slice(4), ['stop /b unless kept alive', 'stop /c unless kept alive'])
  // No look once OpenAgent stopped.
  app.on = ['/d']
  await sleep(60)
  assert.equal(calls.length, 6)
})

test('a project added has its scheduler started where the plugin is on, once; a removed one stops it unless kept alive; only a scheduler this OpenAgent started is stopped', async () => {
  const { app, context, lifecycle, calls } = scheduling([])
  await lifecycle.started!(context)
  // Told by the loader for the modules on in it alone.
  await lifecycle.projectAdded!(project('/a'), context)
  await lifecycle.projectAdded!(project('/a'), context)
  assert.deepEqual(calls, ['start /a'])
  await lifecycle.projectRemoved!(project('/a'), context, { files: false })
  assert.deepEqual(calls, ['start /a', 'stop /a unless kept alive'])
  // Told for every module, on or not: nothing was started there, so nothing is written in its folder.
  await lifecycle.projectRemoved!(project('/b'), context, { files: false })
  assert.deepEqual(calls, ['start /a', 'stop /a unless kept alive'])
  app.stop.abort()
  await lifecycle.stopping!()
  assert.equal(calls.length, 2)
})

test('a start that fails is told, the other projects start, and it is tried again at the next look; a list that cannot be read is told and stops nothing', async () => {
  let fails = true
  const { app, context, lifecycle, calls, logged } = scheduling(['/a', '/b'], {
    start: async repo => {
      if (repo === '/a' && fails) throw new Error('the state file cannot be written')
      calls.push(`start ${repo}`)
    },
  })
  await lifecycle.started!(context)
  assert.deepEqual(calls, ['start /b'])
  assert.deepEqual(logged, ['[scheduler] could not start the scheduler of /a: the state file cannot be written'])
  fails = false
  await eventually(() => calls.includes('start /a'))
  context.projects = async () => {
    throw new Error('the settings cannot be read')
  }
  await eventually(() => logged.includes('[scheduler] could not read where the plugin is on: the settings cannot be read'))
  assert.deepEqual(calls, ['start /b', 'start /a'], 'nothing stopped for it')
  app.stop.abort()
  await lifecycle.stopping!()
})

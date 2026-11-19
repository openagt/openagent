import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { RunOrder } from './order.js'
import { runPipeline, type OrderedStep } from './pipeline.js'
import type { RunContext } from './run.js'
import { fakeRun } from './testing.js'

// The run pipeline: the steps that prepare, the agent's turns, the steps that finish, and what a
// failure, a stop or a finishing step that throws does to the rest.

function step(order: number, name: string, run: (ctx: RunContext) => void | Promise<void> = () => {}): OrderedStep {
  return { order, name, module: name.split(' ')[0]!, run }
}

test('the steps run in the order given, the turns set the outcome, and the finishing steps read it', async () => {
  const done: string[] = []
  const ctx = fakeRun()
  const result = await runPipeline(
    [
      step(RunOrder.WORKSPACE, 'git-branches worktree', ctx => {
        done.push('worktree')
        ctx.workspace = '/work/run-1'
      }),
      step(RunOrder.SKILLS, 'skills link', ctx => void done.push(`skills into ${ctx.workspace}`)),
      step(RunOrder.RUN, 'agent-driver turns', ctx => {
        done.push('turns')
        ctx.outcome = { status: 'waiting', question: 'Ship it?' }
      }),
      step(RunOrder.RECORD, 'agent-driver record', ctx => void done.push(`record ${ctx.outcome?.status}`)),
    ],
    ctx,
  )
  assert.deepEqual(done, ['worktree', 'skills into /work/run-1', 'turns', 'record waiting'])
  assert.deepEqual(result, { outcome: { status: 'waiting', question: 'Ship it?' }, errors: [] })
})

test('turns that set no outcome leave the run done', async () => {
  const result = await runPipeline([step(RunOrder.RUN, 'agent-driver turns')], fakeRun())
  assert.deepEqual(result.outcome, { status: 'done' })
})

test('a step that prepares and throws fails the run: the rest of the preparing and the turns are skipped, and every finishing step runs', async () => {
  const done: string[] = []
  const result = await runPipeline(
    [
      step(RunOrder.CLONE, 'projects clone', () => {
        throw new Error('the repository is gone')
      }),
      step(RunOrder.WORKSPACE, 'git-branches worktree', () => void done.push('worktree')),
      step(RunOrder.RUN, 'agent-driver turns', () => void done.push('turns')),
      step(RunOrder.RECORD, 'agent-driver record', ctx => void done.push(`record ${ctx.outcome?.status}`)),
      step(RunOrder.CLEANUP, 'git-branches reclaim', () => void done.push('reclaim')),
    ],
    fakeRun(),
  )
  assert.deepEqual(done, ['record failed', 'reclaim'])
  assert.deepEqual(result.outcome, { status: 'failed', error: 'projects clone: the repository is gone' })
  assert.equal(result.errors.length, 1)
  assert.equal(result.errors[0]?.module, 'projects')
})

test('a stop asked before a step starts stops the run there, and the finishing steps still run', async () => {
  const stop = new AbortController()
  const done: string[] = []
  const result = await runPipeline(
    [
      step(RunOrder.WORKSPACE, 'git-branches worktree', () => {
        done.push('worktree')
        stop.abort()
      }),
      step(RunOrder.RUN, 'agent-driver turns', () => void done.push('turns')),
      step(RunOrder.CLEANUP, 'git-branches reclaim', ctx => void done.push(`reclaim ${ctx.outcome?.status}`)),
    ],
    fakeRun({ signal: stop.signal }),
  )
  assert.deepEqual(done, ['worktree', 'reclaim stopped'])
  assert.deepEqual(result.outcome, { status: 'stopped' })
})

test('a finishing step that throws is told in the errors, the next ones still run, and the outcome stays', async () => {
  const done: string[] = []
  const result = await runPipeline(
    [
      step(RunOrder.RUN, 'agent-driver turns'),
      step(RunOrder.RECORD, 'github pull request', () => {
        throw new Error('GitHub did not answer')
      }),
      step(RunOrder.CLEANUP, 'git-branches reclaim', () => void done.push('reclaim')),
      step(RunOrder.NOTIFY, 'notifications-command ended', () => void done.push('notify')),
    ],
    fakeRun(),
  )
  assert.deepEqual(done, ['reclaim', 'notify'])
  assert.deepEqual(result.outcome, { status: 'done' })
  assert.deepEqual(
    result.errors.map(error => [error.module, error.step, (error.error as Error).message]),
    [['github', 'github pull request', 'GitHub did not answer']],
  )
})

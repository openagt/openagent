import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { RunOrder, type AttentionItem, type RunQuestion, type WaitingRun } from '@openagt/hooks'
import { fakeApp, fakeRun } from '@openagt/hooks/testing'
import ask, { NEEDS_ANSWER } from './module.js'

// The module: its skill, for an agent with no question tool of its own; its step, which has a run
// ask; and what it says waits on the person.

const QUESTION: RunQuestion = { id: '2026-11-19T10:00:00.000Z', title: 'Which database?', options: [{ id: 'opt:0', label: 'SQLite' }, { id: 'opt:1', label: 'Postgres' }] }

test('a plugin kept per project; its skill goes to an agent that has no question tool of its own', async () => {
  assert.deepEqual(ask.plugin, { scope: 'project' })
  const skills = ask.hooks['run.skills']!
  const [skill] = await skills({ agent: { id: 'codex' } })
  assert.equal(skill?.name, 'ask')
  assert.equal(new URL('SKILL.md', skill!.dir).pathname.endsWith('/ask/SKILL.md'), true, 'the skill is the package\'s own SKILL.md')
  assert.deepEqual(await skills({ agent: { id: 'claude-code', ownQuestionTool: true } }), [])
})

test("its step, before the agent's turns, has the run ask: a message ending on the block is a question", async () => {
  const [step] = ask.hooks['run.step']!
  assert.ok(step && step.order < RunOrder.RUN)
  const ctx = fakeRun()
  await step.run(ctx)
  assert.equal(ctx.asking?.questionIn('Done.'), undefined)
  assert.equal(ctx.asking?.questionIn('```await-choices\n{ "title": "Ship it?", "options": [{ "label": "Yes" }] }\n```')?.title, 'Ship it?')
})

test('a run waiting on a question needs an answer: one item per run, by the question it asks now', async () => {
  const attention = ask.hooks['app.attention']!
  const runs: WaitingRun[] = [
    { id: 'run-1', name: 'Pick a database', endedAt: '2026-11-19T10:00:01.000Z', questions: [{ ...QUESTION, id: 'early', title: 'Earlier?' }, QUESTION] },
    { id: 'run-2', questions: [QUESTION] },
    { id: 'run-3', questions: [] },
  ]
  const items: AttentionItem[] = await attention({ waiting: async () => runs }, fakeApp())
  assert.deepEqual(items, [
    { kind: 'waiting', scope: 'run', run: 'run-1', id: `run-1:${QUESTION.id}`, words: NEEDS_ANSWER, title: 'Pick a database', detail: 'Which database?', mark: 'question', since: '2026-11-19T10:00:01.000Z' },
    { kind: 'waiting', scope: 'run', run: 'run-2', id: `run-2:${QUESTION.id}`, words: NEEDS_ANSWER, title: 'run-2', detail: 'Which database?', mark: 'question' },
  ])
  assert.deepEqual(await attention({}, fakeApp()), [], 'nothing waits where no run is asked about')
})

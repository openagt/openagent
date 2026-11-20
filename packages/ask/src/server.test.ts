import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import type { RunQuestion, InboxLine } from '@openagt/hooks'
import { rpcHost } from '@openagt/hooks/testing'
import { answer } from './server.js'

// The answer the card sends: checked against the question the run waits on, said to the run, and
// taken once.

const ONE: RunQuestion = { id: 'q1', title: 'Which side?', options: [{ id: 'l', label: 'Left' }, { id: 'r', label: 'Right' }] }
const SEVERAL: RunQuestion = { id: 'q2', title: 'Which checks?', multi: true, options: [{ id: 'lint', label: 'Lint' }, { id: 'types', label: 'Types' }] }

/** A project whose run `run-1` waits on `open`, and the lines said to it; `refuse` says why a line is not taken. */
function project(root: string, open: RunQuestion[], refuse?: string) {
  const said: InboxLine[] = []
  const host = rpcHost({
    root,
    questions: async agentId => (agentId === 'run-1' ? open : []),
    say: async (agentId, line) => {
      if (refuse) throw new Error(refuse)
      assert.equal(agentId, 'run-1')
      said.push(line)
    },
  })
  return { host, said }
}

test("a pick is said as the option's label, and is what the agent is told", async () => {
  const { host, said } = project('/p/pick', [ONE])
  assert.deepEqual(await answer(host, { agentId: 'run-1', question: 'q1', picked: 'r' }), { ok: true, said: 'You paused to ask: "Which side?". The user chose: Right. Continue with that decision.' })
  assert.deepEqual(said, [{ kind: 'answer', question: 'Which side?', answer: 'Right' }])
})

test('only what the question offers is picked, one option where one is asked', async () => {
  const { host, said } = project('/p/refused', [ONE, SEVERAL])
  assert.deepEqual(await answer(host, { agentId: 'run-1', question: 'q1', picked: 'zzz' }), { ok: false, error: "every pick must be one of the question's options" })
  assert.deepEqual(await answer(host, { agentId: 'run-1', question: 'q1', picked: ['l', 'r'] }), { ok: false, error: 'pick exactly one option' })
  assert.deepEqual(await answer(host, { agentId: 'run-1', question: 'q1', picked: 'l', words: 'or both' }), { ok: false, error: 'pick exactly one option' })
  assert.deepEqual(await answer(host, { agentId: 'run-1', question: 'gone', picked: 'l' }), { ok: false, error: 'that question is no longer open' })
  assert.deepEqual(await answer(host, { agentId: 'run-2', question: 'q1', picked: 'l' }), { ok: false, error: 'that question is no longer open' })
  assert.deepEqual(await answer(host, { agentId: 'run-1', question: 'q2', words: '  ' }), { ok: false, error: 'your own answer is empty' })
  assert.deepEqual(said, [], 'nothing refused is said')
})

test("the person's own words answer as a label does, beside the options a multi-select checked", async () => {
  const { host, said } = project('/p/words', [SEVERAL, ONE])
  assert.deepEqual(await answer(host, { agentId: 'run-1', question: 'q2', picked: ['lint', 'types'], words: 'and the e2e tests' }), {
    ok: true,
    said: 'You paused to ask: "Which checks?". The user chose: Lint, Types, and the e2e tests. Continue with that decision.',
  })
  assert.deepEqual(await answer(host, { agentId: 'run-1', question: 'q1', words: 'Neither' }), { ok: true, said: 'You paused to ask: "Which side?". The user chose: Neither. Continue with that decision.' })
  assert.deepEqual(said, [
    { kind: 'answer', question: 'Which checks?', answer: 'Lint, Types, and the e2e tests' },
    { kind: 'answer', question: 'Which side?', answer: 'Neither' },
  ])
})

test('a skip tells the agent to go on without an answer', async () => {
  const { host, said } = project('/p/skip', [ONE])
  const skipped = 'You paused to ask: "Which side?". The user skipped it. Continue without an answer.'
  assert.deepEqual(await answer(host, { agentId: 'run-1', question: 'q1', skip: true }), { ok: true, said: skipped })
  assert.deepEqual(said, [{ kind: 'message', text: skipped }])
  assert.deepEqual(await answer(host, { agentId: 'run-1', question: 'q1', picked: 'l' }), { ok: false, error: 'Already skipped' })
})

test('a question takes one answer until the run goes on from it, two at once included; asked again, it takes one more', async () => {
  const open = [ONE]
  const { host, said } = project('/p/once', open)
  const [first, second] = await Promise.all([answer(host, { agentId: 'run-1', question: 'q1', picked: 'l' }), answer(host, { agentId: 'run-1', question: 'q1', picked: 'r' })])
  assert.equal(first.ok, true)
  assert.deepEqual(second, { ok: false, error: 'Already answered: Left' })
  // The run went on: its question is closed, and asked again later, it is a question of its own.
  open.splice(0, 1, { ...ONE, id: 'q1-again' })
  assert.deepEqual(await answer(host, { agentId: 'run-1', question: 'q1', picked: 'r' }), { ok: false, error: 'that question is no longer open' })
  assert.equal((await answer(host, { agentId: 'run-1', question: 'q1-again', picked: 'r' })).ok, true)
  assert.deepEqual(said.map(line => line.kind === 'answer' && line.answer), ['Left', 'Right'])
})

test("a line the run's host does not take is no answer: its words are the refusal, and the question still takes one", async () => {
  const refused = project('/p/elsewhere', [ONE], 'This run is on another-box. Continue it there.')
  assert.deepEqual(await answer(refused.host, { agentId: 'run-1', question: 'q1', picked: 'l' }), { ok: false, error: 'This run is on another-box. Continue it there.' })
  const taken = project('/p/elsewhere', [ONE])
  assert.equal((await answer(taken.host, { agentId: 'run-1', question: 'q1', picked: 'l' })).ok, true)
})

test('an input that names no run or no question is refused', async () => {
  const { host } = project('/p/input', [ONE])
  assert.deepEqual(await answer(host, { question: 'q1', picked: 'l' } as never), { ok: false, error: 'which run, and which of its questions?' })
  assert.deepEqual(await answer(host, { agentId: 'run-1', picked: 'l' } as never), { ok: false, error: 'which run, and which of its questions?' })
})

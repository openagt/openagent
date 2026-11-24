import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { makeWorld, waitFor, release } from './harness.js'
import { onWaiting, onAgents, onAgent, onRetainedWorktrees, onAgentWorktree } from '../dashboard-rpc/reads.js'
import { sendMessage, sendStop, sendDeleteAgent } from '../dashboard-rpc/control.js'
import { callModule } from '../dashboard-rpc/module-calls.js'

// The steering stories (README.md): everything the user does TO a run — answer its question (through
// ask's server part), say something to it, stop it — reaches the run through its host, which goes
// through what the run reads: the inbox file in the run's checkout while it works, a resume once
// it has ended, a signal to the pid on its card. The observable answer comes back through the run's
// own diary.

test('answer a waiting run’s question from the Human Queue; the answer resumes the same run (#304/#1455/#1774)', async () => {
  const world = await makeWorld()
  const rpc = world.rpc
  try {
    const project = await world.addProject()
    const agentId = await world.startAgent(project, 'ask before wiring up auth')
    const tail = await world.tailAgent(project, agentId)

    // The run's turn ends on a question, so the run ends `waiting`, its checkout kept: the full
    // question (title, options, recommendation) is on the feed, and the Human Queue lists it
    // against this run.
    const gate = await waitFor(() => tail.events.find(e => e.kind === 'choice'), 'the question')
    assert.equal(gate.kind, 'choice')
    if (gate.kind !== 'choice') return
    assert.deepEqual(gate.options.map(o => o.label), ['Left', 'Right'])
    await world.waitAgent(project, agentId, 'waiting')
    assert.equal((await rpc(onAgentWorktree)(project.id, agentId))?.checkout !== undefined, true, 'a waiting run keeps its checkout')
    const waiting = await waitFor(
      async () => (await rpc(onWaiting)()).items.find(item => item.words === 'Needs answer' && item.run === agentId),
      'the Human Queue to list the waiting run',
    )
    assert.equal(waiting.projectId, project.id)
    assert.equal(waiting.detail, 'Which way?')
    assert.equal(waiting.id, `${agentId}:${gate.id}`)

    // The answer is ask's, as its card sends it: a pick that is not one of the question's options
    // is refused, and nothing is resumed.
    const answer = async (picked: string) => {
      const called = await rpc(callModule)(project.id, '@openagt/ask', 'answer', { agentId, question: gate.id, picked })
      return called.ok ? called.output : called
    }
    assert.deepEqual(await answer('no-such-option'), { ok: false, error: 'every pick must be one of the question\'s options' })

    // The user picks an option: the host resumes the run with the chosen label, and
    // the same run goes on to done, under the same id, in the same diary.
    const right = gate.options.find(o => o.label === 'Right')!
    assert.deepEqual(await answer(right.id), { ok: true, said: 'You paused to ask: "Which way?". The user chose: Right. Continue with that decision.' })
    assert.deepEqual((await world.hostCalls()).at(-1), { call: 'resume', id: agentId, answer: 'Right' })
    await world.waitAgent(project, agentId, 'done')
    await world.waitRetired(project, agentId)
    const replay = await rpc(onAgent)(project.id, agentId)
    assert.ok(replay.some(e => e.kind === 'driver' && e.event.type === 'text' && e.event.text.includes('The user chose: Right')), 'the resumed turn carried the answer')

    // Answered means gone from the Human Queue, and the question no longer open to a second answer.
    assert.equal((await rpc(onWaiting)()).items.some(item => item.words === 'Needs answer' && item.run === agentId), false)
    assert.deepEqual(await answer(right.id), { ok: false, error: 'that question is no longer open' })
  } finally {
    await world.close()
  }
})

test('say something to a working run: the message is its next turn; said to an ended run, it resumes it (#714/#1774)', async () => {
  const world = await makeWorld()
  const rpc = world.rpc
  try {
    const project = await world.addProject()
    const agentId = await world.startAgent(project, 'hold: build the dashboard page')
    await world.waitAgent(project, agentId, 'running')

    // Said while the run is certainly working: the line waits in the run's inbox, nothing is resumed,
    // and the run takes it when its turn ends, as a turn of its own.
    assert.deepEqual(await rpc(sendMessage)(project.id, 'Also add a logout button', agentId), { ok: true })
    assert.equal((await world.hostCalls()).filter(call => call.call === 'resume').length, 0)
    await release(project, agentId)
    await world.waitAgent(project, agentId, 'done')
    await world.waitRetired(project, agentId)
    const first = await rpc(onAgent)(project.id, agentId)
    assert.ok(first.some(e => e.kind === 'driver' && e.event.type === 'text' && e.event.text.includes('Also add a logout button')), 'the message became a turn')

    // Said once the run has ended: the host resumes the same run with the text.
    assert.deepEqual(await rpc(sendMessage)(project.id, 'One more thing', agentId), { ok: true })
    assert.deepEqual((await world.hostCalls()).at(-1), { call: 'resume', id: agentId, text: 'One more thing' })
    await waitFor(async () => {
      const events = await rpc(onAgent)(project.id, agentId)
      return events.some(e => e.kind === 'driver' && e.event.type === 'text' && e.event.text.includes('One more thing')) ? true : undefined
    }, 'the resumed turn to reach the run\'s diary')
    // With the session's "Auto" changed, the new level goes with the words to the resume.
    await world.waitAgent(project, agentId, 'done')
    await world.waitRetired(project, agentId)
    assert.deepEqual(await rpc(sendMessage)(project.id, 'Ship it', agentId, 'pr'), { ok: true })
    assert.deepEqual((await world.hostCalls()).at(-1), { call: 'resume', id: agentId, text: 'Ship it', publish: 'pr' })
    assert.deepEqual(await rpc(sendMessage)(project.id, 'Ship it', agentId, 'push' as never), { ok: false, error: 'unknown publish level' })
    assert.equal((await rpc(onAgents)(project.id)).filter(r => r.id === agentId).length, 1, 'one run, one row')
  } finally {
    await world.close()
  }
})

test('stop a run; its checkout is reclaimed, then the run is deleted (#737/#1032/E5)', async () => {
  const world = await makeWorld()
  const rpc = world.rpc
  try {
    const project = await world.addProject()
    const agentId = await world.startAgent(project, 'hold: long experiment')
    const tail = await world.tailAgent(project, agentId)
    await world.waitAgent(project, agentId, 'running')

    // Stop is a signal to the pid the run's card names: the run ends `stopped`, not failed.
    assert.deepEqual(await rpc(sendStop)(project.id, agentId), { ok: true })
    const end = await waitFor(() => tail.events.find(e => e.kind === 'end'), 'the end event')
    assert.equal(end.kind === 'end' && end.stopped, true)
    tail.stop()
    await world.waitAgent(project, agentId, 'stopped')

    // One rule (E5): the checkout goes once its work is on the remote, whatever the run did.
    await world.waitRetired(project, agentId)
    assert.deepEqual(await rpc(onRetainedWorktrees)(project.id), [])
    assert.equal((await rpc(onAgentWorktree)(project.id, agentId))?.checkout, undefined, 'no checkout of its own is left')
    assert.ok((await rpc(onAgents)(project.id)).some(r => r.id === agentId && r.status === 'stopped'), 'the run\'s row survives')

    // Delete is the destructive sibling: the row itself disappears from the dashboard.
    const deleted = await rpc(sendDeleteAgent)(project.id, agentId)
    assert.equal(deleted.ok, true, `delete failed: ${'error' in deleted ? deleted.error : ''}`)
    assert.equal((await rpc(onAgents)(project.id)).some(r => r.id === agentId), false)
  } finally {
    await world.close()
  }
})

test('a Stop pressed while the run is still starting stops it once its card names its process', async () => {
  const world = await makeWorld()
  const rpc = world.rpc
  try {
    const project = await world.addProject()
    // The host answered the run's id; the run is still making its checkout, so no card names its pid yet.
    const agentId = await world.startAgent(project, 'hold: long experiment')
    assert.deepEqual(await rpc(sendStop)(project.id, agentId), { ok: true })
    await world.waitAgent(project, agentId, 'stopped')
  } finally {
    await world.close()
  }
})

test('a waiting run’s kept checkout can be removed by hand (#737)', async () => {
  const world = await makeWorld()
  const rpc = world.rpc
  try {
    const project = await world.addProject()
    const agentId = await world.startAgent(project, 'ask and wait')
    await world.waitAgent(project, agentId, 'waiting')
    // The record lands a moment after the card says `waiting`; removing the checkout before it
    // does would take away the only copy there is.
    await world.waitRecorded(project, agentId)
    await waitFor(async () => ((await rpc(onRetainedWorktrees)(project.id)).includes(agentId) ? true : undefined), 'the kept checkout to reach the Remove list')
    // git-branches' Remove worktree, in the session's menu.
    const removed = await rpc(callModule)(project.id, '@openagt/git-branches', 'removeCheckout', { agentId })
    assert.equal(removed.ok && (removed.output as { ok: boolean }).ok, true, `remove failed: ${JSON.stringify(removed)}`)
    assert.deepEqual(await rpc(onRetainedWorktrees)(project.id), [])
    assert.ok((await rpc(onAgents)(project.id)).some(r => r.id === agentId && r.status === 'waiting'), 'the run\'s row survives, still waiting')
  } finally {
    await world.close()
  }
})

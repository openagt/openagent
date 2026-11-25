import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { readdir, stat } from 'node:fs/promises'
import { imagesDir } from '@openagt/agent-driver'
import { makeWorld, waitFor } from './harness.js'
import { onAgent } from '../dashboard-rpc/reads.js'
import { sendMessage } from '../dashboard-rpc/control.js'
import { callModule } from '../dashboard-rpc/module-calls.js'

// An image dropped or pasted into the box (README.md): the page sends its bytes once, the module
// that keeps images (agent-driver's `composer.images`) keeps it on this computer under its hash, and
// a Start or a message names it. The run
// is handed the names, its record keeps them with the prompt they went with, and the image itself
// stays in the image store: never in the run's checkout, never in the project's records.

/** The smallest PNG there is: one pixel. */
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

type Kept = { ok: true; name: string } | { ok: false; error: string }

test('a screenshot goes with the start and with a message to the ended run, and the chat names it with each after a reload', async () => {
  const world = await makeWorld()
  const rpc = world.rpc
  try {
    const project = await world.addProject()
    // What the box's keep calls: agent-driver's server part, in no project.
    const keep = async (type: string, data: string): Promise<Kept> => {
      const called = await rpc(callModule)(null, '@openagt/agent-driver', 'keepImage', { type, data })
      if (!called.ok) throw new Error(called.error)
      return called.output as Kept
    }
    const kept = await keep('image/png', PNG)
    assert.ok(kept.ok, 'the image is kept')
    if (!kept.ok) return
    assert.match(kept.name, /^[0-9a-f]{64}\.png$/)
    assert.deepEqual(await readdir(imagesDir()), [kept.name])
    assert.equal((await stat(imagesDir())).mode & 0o777, 0o700, 'readable by this user alone')

    const agentId = await world.startAgent(project, 'What word is in this screenshot?', { images: [kept.name] })
    assert.deepEqual((await world.hostCalls()).at(-1), { call: 'start', id: agentId, prompt: 'What word is in this screenshot?', publish: 'commit', images: [kept.name] })
    await world.waitAgent(project, agentId, 'done')
    await world.waitRetired(project, agentId)
    const starts = async () => (await rpc(onAgent)(project.id, agentId)).flatMap(e => (e.kind === 'driver' && e.event.type === 'start' ? [[e.event.prompt, e.event.images]] : []))
    assert.deepEqual(await starts(), [['What word is in this screenshot?', [kept.name]]], 'the record names the image with its prompt')

    // Said to the ended run, the message resumes it with its own image.
    assert.deepEqual(await rpc(sendMessage)(project.id, 'And in this one?', agentId, null, { images: [kept.name] }), { ok: true })
    assert.deepEqual((await world.hostCalls()).at(-1), { call: 'resume', id: agentId, text: 'And in this one?', images: [kept.name] })
    await waitFor(async () => ((await starts()).length === 2 ? true : undefined), 'the resumed turn to reach the run\'s diary')
    assert.deepEqual((await starts())[1], ['And in this one?', [kept.name]])
    await world.waitAgent(project, agentId, 'done')
    await world.waitRetired(project, agentId)

    // What names no image the dashboard keeps is refused, and nothing is resumed.
    const calls = (await world.hostCalls()).length
    assert.deepEqual(await rpc(sendMessage)(project.id, 'Look', agentId, null, { images: ['/etc/passwd'] }), { ok: false, error: 'Images are named by the names the dashboard kept them under.' })
    assert.deepEqual(await rpc(sendMessage)(project.id, 'Look', agentId, null, { images: [`${'f'.repeat(64)}.png`] }), { ok: false, error: 'An image is no longer on this computer. Take it out and add it again.' })
    await assert.rejects(world.startAgent(project, 'Look', { images: [`${'f'.repeat(64)}.png`] }), /An image is no longer on this computer/)
    assert.equal((await world.hostCalls()).length, calls)
    // Bytes that are no image of the kind they say are not kept.
    assert.deepEqual(await keep('image/jpeg', PNG), { ok: false, error: 'This is not a JPG image' })
    assert.deepEqual(await keep('image/png', 'not base64!'), { ok: false, error: 'An image is sent as its kind and its bytes in base64.' })
  } finally {
    await world.close()
  }
})

import { strict as assert } from 'node:assert'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'
import { ownDoor } from './own-door.js'
import { testHome } from './test-home.js'

test('this computer\'s own door is asked by its command, and what it answers is read whole: which of a server\'s devices its line is, never its key', async () => {
  const home = await testHome()
  try {
    // The door's own file, as it keeps a line: this computer's id at the server, a dot, and its key there.
    const lines = [{ url: 'https://box.example.com', pin: 'p'.repeat(43), key: '0f9e8d7c6b5a.the-secret-of-the-line', mode: 'watch' }]
    await writeFile(join(home.env.XDG_CONFIG_HOME!, 'openagent-remote-access.json'), JSON.stringify({ on: false, devices: [], codes: [], lines }))
    const answer = await ownDoor(['status'], home.env)
    assert.ok(answer.ok, JSON.stringify(answer))
    assert.deepEqual((JSON.parse(answer.out!) as { lines: unknown }).lines, [{ url: 'https://box.example.com', mode: 'watch', id: '0f9e8d7c6b5a' }])
    assert.doesNotMatch(answer.out!, /the-secret-of-the-line/)

    // A command the door refuses is told by the door's own last words.
    const refused = await ownDoor(['line', 'full', 'other.example.com'], home.env)
    assert.deepEqual(refused, { ok: false, error: 'This computer keeps no line to other.example.com.' })
  } finally {
    await home.remove()
  }
})

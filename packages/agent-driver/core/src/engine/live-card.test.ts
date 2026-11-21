import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { hideLiveDir, inboxPath, liveDir } from './live-card.js'

// The folder's name is a contract with the dashboard, which reads a working agent's card and
// diary there by the same name, written in its own package: said here as the literal.
test('a run\'s live files are kept under .openagent/ in its checkout, hidden from git there', async () => {
  const checkout = await mkdtemp(join(tmpdir(), 'agent-runner-live-'))
  try {
    assert.equal(liveDir(checkout), join(checkout, '.openagent'))
    assert.equal(inboxPath(checkout), join(checkout, '.openagent', 'inbox.jsonl'))
    await hideLiveDir(checkout)
    assert.equal(await readFile(join(checkout, '.openagent', '.gitignore'), 'utf8'), '*\n')
    // A `.gitignore` already there is kept as it is.
    await writeFile(join(checkout, '.openagent', '.gitignore'), '*\n!.gitignore\n')
    await hideLiveDir(checkout)
    assert.equal(await readFile(join(checkout, '.openagent', '.gitignore'), 'utf8'), '*\n!.gitignore\n')
  } finally {
    await rm(checkout, { recursive: true, force: true })
  }
})

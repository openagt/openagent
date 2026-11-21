import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { runCli, turnOf, USAGE, type CliIo } from './cli.js'
import { fakeGitHub, removeRepo, testRepo } from './test-support.js'

// The command of the host's own turn processes: the turn read off its stdin, and what is wrong said on its stderr.

const ID = '2026-11-19T10-00-00-000Z'

test('the turn a host hands its process is read off its stdin: the run, what the turn sends, and whether it goes on with the run (#2394)', () => {
  assert.deepEqual(turnOf(JSON.stringify({ id: ID, prompt: 'add a flag', model: 'claude-opus-4-8', account: 'octo-agent' })), { id: ID, prompt: 'add a flag', model: 'claude-opus-4-8', account: 'octo-agent' })
  assert.deepEqual(turnOf(JSON.stringify({ id: ID, prompt: 'and document it', resume: true })), { id: ID, prompt: 'and document it', resume: true })
  assert.equal(turnOf('{'), 'The turn is no JSON.')
  assert.equal(turnOf('7'), 'The turn is no JSON object.')
  assert.equal(turnOf(JSON.stringify({ id: '../../etc', prompt: 'go' })), 'The turn names no run.')
  assert.equal(turnOf(JSON.stringify({ id: ID, prompt: ' ' })), 'The turn sends no prompt.')
  assert.equal(turnOf(JSON.stringify({ id: ID, prompt: 'go', resume: 'yes' })), 'A turn goes on with its run, or starts it.')
})

test('the command runs one turn of a run in a project, and says on its stderr why one could not (#2394)', async () => {
  const said: string[] = []
  const io = (text: string): CliIo => ({
    stdin: (async function* () {
      yield text
    })(),
    stderr: line => void said.push(line),
  })
  assert.equal(await runCli(['run'], io('')), 2)
  assert.equal(await runCli(['turn', '/nowhere'], io('{}')), 2)
  assert.deepEqual(said.splice(0), [USAGE, 'The turn names no run.'])
  const repo = await testRepo()
  try {
    const deps = { github: async () => ({ owner: 'o', repo: 'r', token: 't', login: 'octo-agent' }), actions: { fetch: fakeGitHub().fetch, sleep: async () => {} } }
    assert.equal(await runCli(['turn', repo], io(JSON.stringify({ id: ID, prompt: 'go on', resume: true })), deps), 1)
    assert.match(said.splice(0).join('\n'), /No run .* of this project ran on GitHub Actions/)
    assert.equal(await runCli(['turn', repo], io(JSON.stringify({ id: ID, prompt: 'add a flag' })), deps), 0)
    assert.deepEqual(said, [])
    assert.equal(process.listenerCount('SIGINT'), 0, 'a Stop is listened for while the turn runs, not after')
  } finally {
    await removeRepo(repo)
  }
})

import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { exec, openSession } from './ssh.js'
import { pretendServer } from './test-home.js'

test('ssh asks nothing, takes a new server\'s key and refuses a changed one, and never reads an address as an option', async () => {
  const { exec: fake, calls } = pretendServer()
  const session = await openSession({ address: '203.0.113.5', user: 'root' }, { exec: fake })
  try {
    assert.deepEqual(await session.meet(), { ok: true, fingerprint: 'SHA256:0123456789abcdefghijklmnopqrstuvwxyzABCDEFG' })
    await session.run('root', 'echo hi', 1_000)
    await session.run('openagent', 'echo hi', 1_000)
    const [meet, asRoot, asOwn] = calls
    for (const call of calls) {
      const options = call.args.filter((_, index) => call.args[index - 1] === '-o')
      assert.ok(options.includes('BatchMode=yes'))
      assert.ok(options.includes('StrictHostKeyChecking=accept-new'))
      // The user, the end of the options, the address, then the one command.
      assert.deepEqual(call.args.slice(-5, -1), ['-l', 'root', '--', '203.0.113.5'])
    }
    assert.equal(meet!.remote, 'true')
    assert.equal(asRoot!.remote, 'bash -s')
    assert.equal(asRoot!.script, 'echo hi')
    assert.equal(asOwn!.remote, "runuser -l openagent -c 'bash -s'")
  } finally {
    await session.close()
  }
})

test('a user that is not root becomes root without being asked, or the server says no', async () => {
  const { exec: fake, calls } = pretendServer()
  const session = await openSession({ address: 'box.example.com', user: 'ubuntu' }, { exec: fake })
  try {
    await session.run('root', '', 1_000)
    await session.run('openagent', '', 1_000)
    assert.deepEqual(calls.map(call => call.remote), ['sudo -n bash -s', "sudo -n runuser -l openagent -c 'bash -s'"])
  } finally {
    await session.close()
  }
})

test('a first meeting that fails tells what ssh said, without what ssh says about itself', async () => {
  const { exec: fake } = pretendServer(() => ({ code: 255, err: 'OpenSSH_9.9p2, LibreSSL 3.3.6\ndebug1: Reading configuration data /etc/ssh/ssh_config\nroot@203.0.113.5: Permission denied (publickey).' }))
  const session = await openSession({ address: '203.0.113.5', user: 'root' }, { exec: fake })
  try {
    assert.deepEqual(await session.meet(), { ok: false, said: 'root@203.0.113.5: Permission denied (publickey).' })
  } finally {
    await session.close()
  }
})

test('a command is fed its text, answers what it said and how it ended, and is not waited for longer than its time', async () => {
  assert.deepEqual(await exec('sh', ['-c', 'cat; echo oops >&2; exit 3'], 'fed', { timeoutMs: 5_000 }), { code: 3, out: 'fed', err: 'oops' })
  const late = await exec('sh', ['-c', 'sleep 30'], '', { timeoutMs: 100 })
  assert.equal(late.code, null)
  assert.match(late.err, /^No answer for \d+ minutes\.$/)
  const stop = new AbortController()
  const stopped = exec('sh', ['-c', 'sleep 30'], '', { timeoutMs: 5_000, signal: stop.signal })
  stop.abort()
  assert.deepEqual(await stopped, { code: null, out: '', err: 'The install was stopped.' })
  const missing = await exec('no-such-command-anywhere', [], '', { timeoutMs: 1_000 })
  assert.equal(missing.code, null)
  assert.match(missing.err, /could not start/)
})

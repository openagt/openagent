import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { askLink, install, lastLines, withAdvice } from './install.js'
import { STEPS } from './steps.js'
import { freshSteps, readStore, update } from './store.js'
import { pretendServer, testHome } from './test-home.js'

const SERVER = { address: '203.0.113.5', user: 'root' }

async function saved(env: NodeJS.ProcessEnv, user = 'root'): Promise<void> {
  await update(env, store => void store.servers.push({ ...SERVER, user, steps: freshSteps(), adding: true }))
}

const stepsOf = async (env: NodeJS.ProcessEnv): Promise<string[]> => (await readStore(env)).servers[0]!.steps.map(step => `${step.id}:${step.state}`)

test('every step runs in order as its own user, the server\'s key is kept as it was first seen, and nothing is left running', async () => {
  const home = await testHome()
  try {
    await saved(home.env)
    const { exec, calls } = pretendServer()
    await install({ env: home.env, address: SERVER.address, version: '1.2.3', exec })
    const [server] = (await readStore(home.env)).servers
    assert.deepEqual(server!.steps, STEPS.map(step => ({ id: step.id, state: 'done' })))
    assert.equal(server!.fingerprint, 'SHA256:0123456789abcdefghijklmnopqrstuvwxyzABCDEFG')
    assert.equal(server!.worker, undefined)
    // The first meeting, then one script a step.
    assert.deepEqual(calls.map(call => call.remote), ['true', ...STEPS.map(step => (step.as === 'root' ? 'bash -s' : "runuser -l openagent -c 'bash -s'"))])
    assert.deepEqual(calls.slice(1).map(call => call.script), STEPS.map(step => step.script({ address: SERVER.address, version: '1.2.3' })))
  } finally {
    await home.remove()
  }
})

test('the install stops at the step that fails, with the last of what the server said, and the steps after it are not run', async () => {
  const home = await testHome()
  try {
    await saved(home.env)
    const tools = STEPS.find(step => step.id === 'tools')!.script({ address: SERVER.address, version: '1.2.3' })
    const { exec, calls } = pretendServer(call => (call.script === tools ? { code: 100, out: 'Reading package lists...', err: 'E: Unable to locate package git' } : undefined))
    await install({ env: home.env, address: SERVER.address, version: '1.2.3', exec })
    assert.deepEqual(await stepsOf(home.env), ['login:done', 'user:done', 'tools:failed', 'openagent:waiting', 'agent:waiting', 'service:waiting', 'door:waiting'])
    assert.equal((await readStore(home.env)).servers[0]!.steps[2]!.said, 'Reading package lists...\nE: Unable to locate package git')
    assert.equal(calls.length, 4)
    assert.equal((await readStore(home.env)).servers[0]!.worker, undefined)
  } finally {
    await home.remove()
  }
})

test('a login that fails says what to do about it: the keys, a changed server, a user that cannot become root', async () => {
  const home = await testHome()
  try {
    await saved(home.env, 'ubuntu')
    const denied = pretendServer(() => ({ code: 255, err: 'ubuntu@203.0.113.5: Permission denied (publickey).' }))
    await install({ env: home.env, address: SERVER.address, version: '1.2.3', exec: denied.exec })
    assert.deepEqual(await stepsOf(home.env).then(steps => steps[0]), 'login:failed')
    assert.equal(
      (await readStore(home.env)).servers[0]!.steps[0]!.said,
      'ubuntu@203.0.113.5: Permission denied (publickey).\nOpenAgent logs in with this computer\'s own SSH keys. Check that "ssh ubuntu@203.0.113.5" works in a terminal without asking for anything.',
    )
    // Nothing was run on a server this computer could not log in to.
    assert.deepEqual(denied.calls.map(call => call.remote), ['true'])

    const noSudo = pretendServer(call => (call.remote === 'true' ? undefined : { code: 1, err: 'sudo: a password is required' }))
    await install({ env: home.env, address: SERVER.address, version: '1.2.3', exec: noSudo.exec })
    assert.equal((await readStore(home.env)).servers[0]!.steps[0]!.said, 'sudo: a password is required\nThe user ubuntu cannot become root without a password. Use root, or a user whose sudo asks for none.')

    assert.match(withAdvice(SERVER, '@ WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED! @\nHost key verification failed.'), /\nThis server shows another key than the one this computer remembers for it\. Nothing was sent to it\.$/)
    assert.equal(withAdvice(SERVER, 'E: Unable to locate package git'), 'E: Unable to locate package git')
  } finally {
    await home.remove()
  }
})

test('an install that is stopped says so on the step it was at', async () => {
  const home = await testHome()
  try {
    await saved(home.env)
    const stop = new AbortController()
    const { exec } = pretendServer(call => {
      if (call.remote !== 'true') stop.abort()
      return stop.signal.aborted ? { code: null, err: 'The install was stopped.' } : undefined
    })
    await install({ env: home.env, address: SERVER.address, version: '1.2.3', exec, signal: stop.signal })
    const [login, user] = (await readStore(home.env)).servers[0]!.steps
    assert.deepEqual(login, { id: 'login', state: 'failed', said: 'The install was stopped.' })
    assert.equal(user!.state, 'waiting')
  } finally {
    await home.remove()
  }
})

test('only the end of what a command said is kept, its errors last', () => {
  const out = Array.from({ length: 30 }, (_, index) => `line ${index + 1}`).join('\n')
  const kept = lastLines({ out, err: 'the reason\n\n' }).split('\n')
  assert.equal(kept.length, 15)
  assert.equal(kept.at(-1), 'the reason')
  assert.equal(kept[0], 'line 17')
})

test('the server\'s door is asked for a link as the server\'s own user; an answer that is no link is not taken for one', async () => {
  const link = { url: 'https://203.0.113.5/_remote-access/enter#code.pin', expires: '2026-10-11T12:00:00.000Z' }
  const good = pretendServer(() => ({ out: JSON.stringify(link) + '\n' }))
  assert.deepEqual(await askLink(SERVER, { exec: good.exec }), { ok: true, ...link })
  assert.deepEqual(good.calls.map(call => call.remote), ["runuser -l openagent -c 'bash -s'"])
  assert.match(good.calls[0]!.script, /remote-access\/bin\/remote-access add\n/)

  assert.deepEqual(await askLink(SERVER, { exec: pretendServer(() => ({ out: 'Welcome to Debian\n' })).exec }), { ok: false, error: 'The server answered something else than a link.' })
  assert.deepEqual(await askLink(SERVER, { exec: pretendServer(() => ({ code: 1, err: 'the door is not open' })).exec }), { ok: false, error: 'the door is not open' })
})

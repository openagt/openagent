import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { checkCliReady, type CliProbe, type CliSpec } from './ready.js'

/**
 * A probe that answers `--version` and the login question separately, so a test can say
 * "installed but logged out" without a whole CLI. The login question answers empty unless
 * given: what an old CLI that does not know the subcommand looks like.
 */
function probeFor(answers: { version?: { ok: boolean; output: string }; auth?: { ok: boolean; output: string } }): CliProbe {
  return (_bin, args) => Promise.resolve(args[0] === '--version' ? (answers.version ?? { ok: true, output: '1.2.3' }) : (answers.auth ?? { ok: true, output: '' }))
}

/** A CLI that says `yes` or `no` about its login, and anything else when it cannot say. */
const spec: CliSpec = {
  bin: 'agent',
  install: 'install the agent: https://example.com/agent',
  authArgs: ['whoami'],
  loggedIn: ({ output }) => (output === 'yes' ? true : output === 'no' ? false : undefined),
  login: 'agent login',
}

/** No root unless a test asks for it: the suite must pass in a root CI container. */
const notRoot = { isRoot: () => false }

test('an installed, logged-in CLI is ready', async () => {
  const ready = await checkCliReady(spec, { ...notRoot, probe: probeFor({ auth: { ok: true, output: 'yes' } }) })
  assert.deepEqual(ready, { problems: [], warnings: [] })
})

test('a missing CLI is a problem naming its install, and its login is not asked', async () => {
  const asked: string[][] = []
  const ready = await checkCliReady(spec, {
    ...notRoot,
    probe: (bin, args) => {
      asked.push([bin, ...args])
      return Promise.resolve({ ok: false, output: '' })
    },
  })
  assert.deepEqual(asked, [['agent', '--version']])
  assert.deepEqual(ready.problems, ['`agent` not found — install the agent: https://example.com/agent'])
})

test('a logged-out CLI is a problem naming the command that fixes it', async () => {
  const ready = await checkCliReady(spec, { ...notRoot, probe: probeFor({ auth: { ok: true, output: 'no' } }) })
  assert.deepEqual(ready.problems, ['`agent` is not logged in. Run `agent login`, then start again.'])
})

test('a logged-out CLI is ready when an account is added beside it: runs use that login, as on a server with only the person\'s own computers\' logins', async () => {
  const loggedOut = probeFor({ auth: { ok: true, output: 'no' } })
  assert.equal((await checkCliReady(spec, { ...notRoot, probe: loggedOut, addedAccount: false })).problems.length, 1)
  assert.deepEqual(await checkCliReady(spec, { ...notRoot, probe: loggedOut, addedAccount: true }), { problems: [], warnings: [], ownLoggedOut: true })
})

test('a CLI that will not say whether it is logged in is ready', async () => {
  const ready = await checkCliReady(spec, { ...notRoot, probe: probeFor({ auth: { ok: false, output: "error: unknown command 'whoami'" } }) })
  assert.deepEqual(ready.problems, [])
})

test('root warns, naming the sudo user, and blocks nothing', async () => {
  const ready = await checkCliReady(spec, { isRoot: () => true, sudoUser: 'alice', probe: probeFor({ auth: { ok: true, output: 'yes' } }) })
  assert.deepEqual(ready.problems, [])
  assert.equal(ready.warnings.length, 1)
  assert.match(ready.warnings[0]!, /root/)
  assert.match(ready.warnings[0]!, /`alice`/)
})

test('a CLI that declares its fixes gives the one for its problem: the install when it is missing, the login when it is logged out; none when ready', async () => {
  const fixing: CliSpec = { ...spec, fixes: { install: 'curl -fsSL https://example.com/install.sh | bash', login: 'agent login --browser' } }
  const missing = await checkCliReady(fixing, { ...notRoot, probe: () => Promise.resolve({ ok: false, output: '' }) })
  assert.deepEqual(missing.fix, { kind: 'install', command: 'curl -fsSL https://example.com/install.sh | bash', problem: missing.problems[0] })
  assert.equal(missing.problems.length, 1)
  const out = await checkCliReady(fixing, { ...notRoot, probe: probeFor({ auth: { ok: true, output: 'no' } }) })
  // The line it answers is the problem the page leaves out when it says it in its own words beside the press.
  assert.deepEqual(out.fix, { kind: 'log-in', command: 'agent login --browser', problem: out.problems[0] })
  assert.equal(out.problems.length, 1)
  assert.equal((await checkCliReady(fixing, { ...notRoot, probe: probeFor({ auth: { ok: true, output: 'yes' } }) })).fix, undefined)
  // One with none is fixed by hand, as its line says.
  assert.equal((await checkCliReady(spec, { ...notRoot, probe: probeFor({ auth: { ok: true, output: 'no' } }) })).fix, undefined)
})

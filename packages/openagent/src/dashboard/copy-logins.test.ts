import assert from 'node:assert/strict'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { test, type TestContext } from 'node:test'
import { copyLoginsTo, personLogins, type RunComputerCommand } from './copy-logins.js'
import { loginsOfOwn, loginsToCopy, markOf, readLogins, type GivenLogins, type MachineLogins } from './machine-logins.js'
import { handleRelayRequest, WATCH_HEADER, type RelayHandlers } from './relay-endpoints.js'

// A person's logins on another person's computer (#2140): the person's own OpenAgent on a server
// copies its logins there before it sends a run, and that computer takes them as its servers
// package takes a login handed over. A copy fills in what is missing or replaces an older copy,
// never a login the person made there.

const GITHUB = 'gho_mine123'
const CLAUDE = 'sk-ant-oat01-mine'

test('a login is copied when the computer has none, or has an older copy; never over one the person made there', () => {
  const own = { github: GITHUB, claude: CLAUDE }
  assert.deepEqual(loginsToCopy(own, {}), own)
  assert.deepEqual(loginsToCopy(own, { github: { source: 'copied', mark: markOf(GITHUB) }, claude: { source: 'copied', mark: markOf('an older one') } }), { claude: CLAUDE })
  assert.deepEqual(loginsToCopy(own, { github: { source: 'made' }, claude: { source: 'made', mark: markOf('x') } }), {})
  // A copy that says no mark is no longer known to be this one: it is copied again.
  assert.deepEqual(loginsToCopy(own, { github: { source: 'copied' } }), own)
  // What this OpenAgent does not have, it does not copy.
  assert.deepEqual(loginsToCopy({}, {}), {})
})

test('what another computer says of the logins there is read as its data; the servers package\'s own answer reads as copies and logins made there', () => {
  assert.deepEqual(readLogins({ github: { source: 'copied', from: 'vps-1', mark: markOf(GITHUB), account: 'rom', extra: 1 }, claude: { source: 'stolen' } }), { github: { source: 'copied', from: 'vps-1', mark: markOf(GITHUB), account: 'rom' } })
  assert.deepEqual(readLogins('junk'), {})
  assert.deepEqual(readLogins({ github: { source: 'made', from: 'a b', mark: 'XYZ' } }), { github: { source: 'made' } })
  const own = { person: 'rom', logins: { github: { there: true, working: false, account: 'rom', from: 'vps-1', mark: markOf(GITHUB) }, claude: { there: true, working: false, mark: markOf(CLAUDE) } } }
  assert.deepEqual(loginsOfOwn(own), { github: { source: 'copied', account: 'rom', from: 'vps-1', mark: markOf(GITHUB) }, claude: { source: 'made', mark: markOf(CLAUDE) } })
  assert.deepEqual(loginsOfOwn({ person: 'rom', logins: { github: { there: false, working: true }, claude: { there: false, working: false } } }), {})
})

async function listen(t: TestContext, handle: (req: IncomingMessage, res: ServerResponse) => void): Promise<string> {
  const server = createServer(handle)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => {
    server.closeAllConnections()
    server.close()
  })
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`
}

/** A person's own OpenAgent on another person's computer: its relay, over handlers that keep what they were given. */
async function theirs(t: TestContext, logins: Partial<RelayHandlers['logins']> = {}) {
  const given: GivenLogins[] = []
  let kept: MachineLogins = {}
  let pings = 0
  const handlers: RelayHandlers = {
    project: async () => undefined,
    start: async () => ({ ok: true, agentId: 'x' }),
    tailEvents: () => () => {},
    logins: {
      read: async () => kept,
      give: async login => {
        given.push(login)
        kept = { ...kept, ...(login.github ? { github: { source: login.from ? 'copied' : 'made', mark: markOf(login.github), ...(login.from ? { from: login.from } : {}) } } : {}), ...(login.claude ? { claude: { source: login.from ? 'copied' : 'made', mark: markOf(login.claude), ...(login.from ? { from: login.from } : {}) } } : {}) }
        return { ok: true, logins: kept }
      },
      ...logins,
    },
  }
  const url = await listen(t, (req, res) => {
    const path = new URL(req.url ?? '/', 'http://x').pathname
    if (path === '/_relay/ping') pings++
    void handleRelayRequest(req, res, path, handlers)
  })
  return { url, given, have: (logins: MachineLogins) => void (kept = logins), pings: () => pings }
}

test('the logins are answered and taken at /_relay/logins; a login that is not a word, a call that may only watch, and an OpenAgent that is no person\'s take none', async t => {
  const machine = await theirs(t)
  const post = (body: unknown, headers: Record<string, string> = {}): Promise<Response> => fetch(`${machine.url}/_relay/logins`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) })
  assert.deepEqual(await (await fetch(`${machine.url}/_relay/logins`)).json(), {})
  const taken = await post({ github: GITHUB, from: 'vps-1' })
  assert.equal(taken.status, 200)
  assert.deepEqual(await taken.json(), { github: { source: 'copied', mark: markOf(GITHUB), from: 'vps-1' } })
  assert.equal((await post({ github: 'two words' })).status, 400)
  assert.equal((await post({ github: GITHUB, from: 'not a name' })).status, 400)
  assert.equal((await post({})).status, 400)
  assert.equal((await post({ claude: CLAUDE }, { [WATCH_HEADER]: '1' })).status, 403)
  assert.deepEqual(machine.given, [{ github: GITHUB, from: 'vps-1' }])

  const refused = await theirs(t, { give: async () => ({ ok: false, error: 'That is the GitHub login of @octocat.' }) })
  const no = await fetch(`${refused.url}/_relay/logins`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ github: GITHUB }) })
  assert.deepEqual([no.status, await no.text()], [422, 'That is the GitHub login of @octocat.'])

  const nobody = await listen(t, (req, res) => void handleRelayRequest(req, res, '/_relay/logins', { project: async () => undefined, start: async () => ({ ok: true, agentId: 'x' }), tailEvents: () => () => {} }))
  assert.equal((await fetch(nobody)).status, 404)
})

test('before a run is sent, the server copies what the computer lacks, says where from, and waits for it to answer again after a Claude login', async t => {
  const machine = await theirs(t)
  const target = { url: machine.url, key: 'line', label: 'rom-desktop' }
  const own = async () => ({ github: GITHUB, claude: CLAUDE })
  assert.deepEqual(await copyLoginsTo(target, { own, pollMs: 5 }), { ok: true })
  assert.equal(machine.given.length, 1)
  assert.equal(machine.given[0]!.github, GITHUB)
  assert.equal(machine.given[0]!.claude, CLAUDE)
  assert.match(machine.given[0]!.from ?? '', /^[A-Za-z0-9]/)
  assert.ok(machine.pings() >= 1, 'the computer was asked whether it answers again')

  // The same logins again: nothing to copy.
  assert.deepEqual(await copyLoginsTo(target, { own, pollMs: 5 }), { ok: true })
  assert.equal(machine.given.length, 1)

  // A login the person made there stays, and an older copy is replaced.
  machine.have({ github: { source: 'made', mark: markOf('made there') }, claude: { source: 'copied', from: 'vps-1', mark: markOf('older') } })
  assert.deepEqual(await copyLoginsTo(target, { own, pollMs: 5 }), { ok: true })
  assert.deepEqual(Object.keys(machine.given[1]!).sort(), ['claude', 'from'])
})

test('a computer that cannot say its logins, or does not take them, stops the run with its own words', async t => {
  const making = await listen(t, (_req, res) => void res.writeHead(503, { 'content-type': 'text/plain' }).end("@sul's place on this computer is being made. Try again in a minute."))
  assert.deepEqual(await copyLoginsTo({ url: making, key: 'line', label: 'rom-desktop' }, { own: async () => ({ github: GITHUB }) }), { ok: false, error: "rom-desktop: @sul's place on this computer is being made. Try again in a minute." })
  const refusing = await theirs(t, { give: async () => ({ ok: false, error: 'Claude Code on this computer does not take the login.' }) })
  assert.deepEqual(await copyLoginsTo({ url: refusing.url, key: 'line', label: 'rom-desktop' }, { own: async () => ({ claude: CLAUDE }) }), { ok: false, error: 'Your logins could not be copied to rom-desktop: Claude Code on this computer does not take the login.' })
})

test('a person\'s OpenAgent takes logins as the servers package does, GitHub first, and says where each came from', async () => {
  const ran: { args: string[]; input: string | null | undefined }[] = []
  const status = (logins: Record<string, unknown>) => ({ ok: true as const, output: { person: 'sul', logins } })
  let after: Record<string, unknown> = { github: { there: false, working: false }, claude: { there: false, working: false } }
  const run: RunComputerCommand = async (pkg, args, _command, input) => {
    assert.equal(pkg, '@openagt/servers')
    ran.push({ args, input })
    if (args[1] === 'login' && args[2] === 'github') after = { ...after, github: { there: true, working: false, from: 'vps-1', mark: markOf(GITHUB) } }
    if (args[1] === 'login' && args[2] === 'claude') after = { ...after, claude: { there: true, working: false, from: 'vps-1', mark: markOf(CLAUDE) } }
    return status(after)
  }
  const logins = personLogins(run)
  const given = await logins.give({ claude: CLAUDE, github: GITHUB, from: 'vps-1' })
  assert.deepEqual(ran.map(call => call.args), [['own', 'login', 'github', '--from', 'vps-1'], ['own', 'login', 'claude', '--from', 'vps-1'], ['own']])
  assert.deepEqual(ran.map(call => call.input), [GITHUB, CLAUDE, undefined])
  assert.deepEqual(given, { ok: true, logins: { github: { source: 'copied', from: 'vps-1', mark: markOf(GITHUB) }, claude: { source: 'copied', from: 'vps-1', mark: markOf(CLAUDE) } } })

  // One the package did not take is said in its words, and nothing after it is given.
  const refusing: RunComputerCommand = async () => status({ github: { there: false, working: false, said: 'That is the GitHub login of @octocat.' }, claude: { there: false, working: false } })
  assert.deepEqual(await personLogins(refusing).give({ github: GITHUB, claude: CLAUDE }), { ok: false, error: 'That is the GitHub login of @octocat.' })
  // A package that cannot be asked says no logins at all.
  assert.deepEqual(await personLogins(async () => ({ ok: false, error: 'not here' })).read(), {})
})

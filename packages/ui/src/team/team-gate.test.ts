import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { request } from 'node:http'
import type { AppRoute } from '@openagt/hooks'
import { startDashboard, type Dashboard } from '../dashboard/server.js'
import { testDashboardOptions } from '../dashboard-rpc/test-context.js'
import type { GitHubSignIn, Poll } from './github-sign-in.js'
import { computerName } from '../computer-name.js'
import { readTeam, teamStore, type TeamPerson } from './team-file.js'
import { teamGate, type SignInCode, type SignInWait, type TeamState } from './team-gate.js'

const DANI: TeamPerson = { login: 'nitedani', id: 1, name: 'Dani' }
const SULEIMAN: TeamPerson = { login: 'suleimansh', id: 2, name: 'Suleiman' }
const JO: TeamPerson = { login: 'jo-dev', id: 3 }

/** A dashboard with Team mode's door, a team file of its own, GitHub played by `next`, and a clock the test moves. */
async function rig() {
  const dir = await mkdtemp(join(tmpdir(), 'team-'))
  await writeFile(join(dir, 'index.html'), '<!doctype html><title>OpenAgent</title>')
  const file = join(dir, 'team.json')
  let clock = 1_000_000
  let next: Poll = { state: 'pending' }
  let polls = 0
  const github: GitHubSignIn = {
    start: async () => ({ deviceCode: 'dev', userCode: 'K7QM-2XRD', verificationUri: 'https://github.com/login/device', expiresIn: 900, interval: 5 }),
    poll: async () => {
      polls++
      return next
    },
  }
  const routes: AppRoute[] = [
    { path: '/_images', handle: (_req, res) => void res.writeHead(200).end('image') },
    { path: '/_bridge', callers: 'own', handle: (_req, res) => void res.writeHead(200).end('bridge') },
  ]
  const dashboard: Dashboard = await startDashboard(
    testDashboardOptions({ clientBundleDir: dir, team: teamGate(teamStore(file), github, () => clock), routes: async () => routes }),
  )
  const url = dashboard.url
  const call = async (path: string, init: { body?: unknown; cookie?: string; headers?: Record<string, string> } = {}) => {
    const res = await fetch(`${url}${path}`, {
      method: init.body === undefined ? 'GET' : 'POST',
      headers: {
        ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(init.cookie ? { cookie: init.cookie } : {}),
        ...init.headers,
      },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    })
    const setCookie = res.headers.get('set-cookie') ?? undefined
    const text = await res.text()
    return { status: res.status, setCookie, json: (text.startsWith('{') ? JSON.parse(text) : text) as unknown }
  }
  /** Sign in as `person` from start to end: the code, one wait too early, the wait GitHub answers. */
  const signIn = async (person: TeamPerson, turnOn = false): Promise<{ wait: SignInWait; cookie?: string }> => {
    const code = (await call('/_team/sign-in', { body: { turnOn } })).json as SignInCode
    assert.equal(code.userCode, 'K7QM-2XRD')
    next = { state: 'done', person }
    clock += 5_000
    const answer = await call('/_team/sign-in/wait', { body: { id: code.id } })
    const cookie = answer.setCookie?.split(';')[0]
    return { wait: answer.json as SignInWait, ...(cookie ? { cookie } : {}) }
  }
  return {
    url,
    file,
    call,
    signIn,
    polls: () => polls,
    tick: (ms: number) => void (clock += ms),
    setNext: (poll: Poll) => void (next = poll),
    close: async () => {
      await dashboard.close()
      await rm(dir, { recursive: true, force: true })
    },
  }
}

/** A call of the dashboard's own: refused 401 in Team mode without a sign-in, anything else past the door. */
const RPC = '/_rpc/onPreferences'

test('Team mode off: nobody signs in, and every call is let by as before', async () => {
  const r = await rig()
  try {
    assert.deepEqual((await r.call('/_team/me')).json, { on: false })
    assert.notEqual((await r.call(RPC, { body: [] })).status, 401)
    assert.equal((await r.call('/_images/a.png')).status, 200)
    assert.deepEqual((await r.call('/_team/sign-in', { body: {} })).json, { error: 'Team mode is off: nobody signs in here.' })
  } finally {
    await r.close()
  }
})

test('turning it on is signing in: the one who signs in owns it, and this browser is in', async () => {
  const r = await rig()
  try {
    const code = (await r.call('/_team/sign-in', { body: { turnOn: true } })).json as SignInCode
    // Asked again before GitHub's interval: told to wait, and GitHub is not asked.
    assert.deepEqual((await r.call('/_team/sign-in/wait', { body: { id: code.id } })).json, { state: 'pending', interval: 5 })
    assert.equal(r.polls(), 0)
    r.tick(5_000)
    r.setNext({ state: 'done', person: DANI })
    const done = await r.call('/_team/sign-in/wait', { body: { id: code.id } })
    assert.deepEqual(done.json, { state: 'done', person: DANI })
    assert.match(done.setCookie ?? '', /^openagent-session=[\w-]+; Path=\/; HttpOnly; SameSite=Lax; Max-Age=2592000$/)
    const team = await readTeam(r.file)
    assert.equal(team.on, true)
    assert.deepEqual(team.owner, DANI)
    assert.equal(team.sessions.length, 1)
    // The file keeps a hash of the key, never the key.
    assert.ok(!(await readFile(r.file, 'utf8')).includes(done.setCookie!.split(';')[0]!.split('=')[1]!))
    const cookie = done.setCookie!.split(';')[0]!
    assert.deepEqual((await r.call('/_team/me', { cookie })).json, { on: true, name: computerName(), owner: DANI, person: DANI, members: [] })
  } finally {
    await r.close()
  }
})

test('Team mode on: what the dashboard knows answers only a browser signed in, or this computer key', async () => {
  const r = await rig()
  try {
    const { cookie } = await r.signIn(DANI, true)
    assert.equal((await r.call(RPC, { body: [] })).status, 401)
    assert.notEqual((await r.call(RPC, { body: [], cookie: cookie! })).status, 401)
    assert.equal((await r.call(RPC, { body: [], cookie: 'openagent-session=made-up' })).status, 401)
    assert.equal((await r.call('/_rpc/changes')).status, 401)
    // The page itself is no secret: it shows the sign-in.
    assert.equal((await r.call('/')).status, 200)
    // A module's route answers those signed in, unless it checks its callers itself.
    assert.equal((await r.call('/_images/a.png')).status, 401)
    assert.equal((await r.call('/_images/a.png', { cookie: cookie! })).status, 200)
    assert.equal((await r.call('/_bridge/x')).status, 200)
    // Who is not signed in sees only that it is on, and whose it is.
    assert.deepEqual((await r.call('/_team/me')).json, { on: true, name: computerName(), owner: DANI })
    // A program of this computer's shows the file's key.
    const { localKey } = await readTeam(r.file)
    assert.notEqual((await r.call(RPC, { body: [], headers: { authorization: `Bearer ${localKey}` } })).status, 401)
    assert.equal((await r.call(RPC, { body: [], headers: { authorization: 'Bearer nope' } })).status, 401)
  } finally {
    await r.close()
  }
})

test('only the people the owner added sign in; removed, they are out at once', async () => {
  const r = await rig()
  try {
    const owner = (await r.signIn(DANI, true)).cookie!
    assert.deepEqual((await r.signIn(JO)).wait, { state: 'not-member', login: 'jo-dev', owner: 'nitedani' })
    assert.deepEqual((await r.call('/_team/members/add', { body: { login: '@SuleimanSh' }, cookie: owner })).json, { ok: true })
    assert.deepEqual((await r.call('/_team/members/add', { body: { login: 'suleimansh' }, cookie: owner })).json, { error: '@suleimansh is on the team already.' })
    assert.deepEqual((await r.call('/_team/members/add', { body: { login: 'not a login' }, cookie: owner })).json, { error: '"not a login" is no GitHub username.' })
    const signed = await r.signIn(SULEIMAN)
    assert.deepEqual(signed.wait, { state: 'done', person: SULEIMAN })
    const member = signed.cookie!
    assert.notEqual((await r.call(RPC, { body: [], cookie: member })).status, 401)
    const me = (await r.call('/_team/me', { cookie: member })).json as Extract<TeamState, { on: true }>
    assert.deepEqual(me.person, SULEIMAN)
    assert.equal(me.members?.[0]?.login, 'suleimansh')
    // A member changes nothing of the team.
    assert.equal((await r.call('/_team/members/add', { body: { login: 'jo-dev' }, cookie: member })).status, 403)
    assert.equal((await r.call('/_team/off', { body: {}, cookie: member })).status, 403)
    await r.call('/_team/members/remove', { body: { login: 'suleimansh' }, cookie: owner })
    assert.equal((await r.call(RPC, { body: [], cookie: member })).status, 401)
  } finally {
    await r.close()
  }
})

test('signed out, the browser is out; turned off, the dashboard is open again and the people added are kept', async () => {
  const r = await rig()
  try {
    const owner = (await r.signIn(DANI, true)).cookie!
    await r.call('/_team/members/add', { body: { login: 'suleimansh' }, cookie: owner })
    const member = (await r.signIn(SULEIMAN)).cookie!
    const out = await r.call('/_team/sign-out', { body: {}, cookie: member })
    assert.match(out.setCookie ?? '', /Max-Age=0/)
    assert.equal((await r.call(RPC, { body: [], cookie: member })).status, 401)
    assert.deepEqual((await r.call('/_team/off', { body: {}, cookie: owner })).json, { ok: true })
    assert.notEqual((await r.call(RPC, { body: [] })).status, 401)
    const team = await readTeam(r.file)
    assert.deepEqual([team.on, team.sessions.length, team.members.map(m => m.login)], [false, 0, ['suleimansh']])
  } finally {
    await r.close()
  }
})

test('a code GitHub ended, or one that ran out, says so', async () => {
  const r = await rig()
  try {
    const code = (await r.call('/_team/sign-in', { body: { turnOn: true } })).json as SignInCode
    r.tick(5_000)
    r.setNext({ state: 'ended', reason: 'GitHub was told no.' })
    assert.deepEqual((await r.call('/_team/sign-in/wait', { body: { id: code.id } })).json, { state: 'ended', reason: 'GitHub was told no.' })
    assert.deepEqual((await r.call('/_team/sign-in/wait', { body: { id: code.id } })).json, { state: 'ended', reason: 'The code ran out. Start again.' })
    assert.equal((await readTeam(r.file)).on, false)
  } finally {
    await r.close()
  }
})

test('a change from another site is refused', async () => {
  const r = await rig()
  try {
    assert.equal((await r.call('/_team/sign-in', { body: { turnOn: true }, headers: { origin: 'https://evil.example' } })).status, 403)
    // A rebound name (fetch cannot send another Host, so node's own request does).
    const status = await new Promise<number>((resolvePromise, rejectPromise) =>
      request(`${r.url}/_team/me`, { headers: { host: 'evil.example' } }, res => {
        res.resume()
        resolvePromise(res.statusCode ?? 0)
      })
        .on('error', rejectPromise)
        .end(),
    )
    assert.equal(status, 403)
  } finally {
    await r.close()
  }
})

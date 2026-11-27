import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { callerEnv, type TeamCaller } from '@openagt/hooks'
import { accountsFor, accountsPath, addAccount, readAccounts, shareAccount, shownAccounts } from './accounts.js'
import { accountRotation } from './rotation.js'
import { runCli } from './cli.js'
import { testLogins } from './test-logins.js'
import { loginWiring } from './wiring.js'
import { forReaders, lasting, markOptions } from '../engine/records.js'

// The coding agents' accounts on a machine shared by a team (Team mode): each is its adder's, one
// from before Team mode the team owner's, and its owner shares it or not. A person sees, changes
// and runs on theirs and the shared ones.

const DANI: TeamCaller = { login: 'nitedani', owner: true, teamOwner: 'nitedani' }
const SULEIMAN: TeamCaller = { login: 'suleimansh', owner: false, teamOwner: 'nitedani' }

async function inDir(body: (env: NodeJS.ProcessEnv) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'accounts-team-'))
  try {
    await body({ HOME: join(dir, 'home'), XDG_CONFIG_HOME: join(dir, 'config'), XDG_STATE_HOME: join(dir, 'state') })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

/** The machine's list: the owner's own login from before, an account Dani added, one Suleiman added. */
function seed(path: string): void {
  addAccount('Dani 2', 'd2', path, new Date(), undefined, 'nitedani')
  addAccount('Suleiman', 's', path, new Date(), undefined, 'suleimansh')
}

test('a person sees their accounts and the shared ones, each saying whose; the owner sees what was there before', () =>
  inDir(async env => {
    const path = accountsPath('claude', env)
    seed(path)
    const names = (caller?: TeamCaller) => shownAccounts(readAccounts(path), caller).map(a => [a.name, a.of, a.mine])
    assert.deepEqual(names(DANI), [
      ['This computer', 'nitedani', true],
      ['Dani 2', 'nitedani', true],
    ])
    assert.deepEqual(names(SULEIMAN), [['Suleiman', 'suleimansh', true]])
    // On a machine of one person, every account, as before.
    assert.deepEqual(names(), [
      ['This computer', undefined, undefined],
      ['Dani 2', undefined, undefined],
      ['Suleiman', undefined, undefined],
    ])
    shareAccount('This computer', true, DANI, path)
    assert.deepEqual(names(SULEIMAN), [
      ['This computer', 'nitedani', false],
      ['Suleiman', 'suleimansh', true],
    ])
    assert.throws(() => shareAccount('This computer', false, SULEIMAN, path), /no account of yours named This computer/)
    shareAccount('This computer', false, DANI, path)
    assert.deepEqual(accountsFor(readAccounts(path), SULEIMAN).map(a => a.name), ['Suleiman'])
  }))

test('a run takes only its person’s accounts and the shared ones', () =>
  inDir(async env => {
    const path = accountsPath('claude', env)
    seed(path)
    const claude = testLogins('claude')
    assert.equal(accountRotation(claude, { path, caller: SULEIMAN }).first(env)?.name, 'Suleiman')
    assert.equal(accountRotation(claude, { path, caller: DANI }).first(env)?.name, 'This computer')
    // Asked to start on someone else’s, it starts on its own.
    assert.equal(accountRotation(claude, { path, caller: SULEIMAN, prefer: 'Dani 2' }).first(env)?.name, 'Suleiman')
  }))

test('the command, run for a person, lists theirs and changes only theirs', () =>
  inDir(async env => {
    seed(accountsPath('claude', env))
    const run = async (argv: string[], caller: TeamCaller) => {
      const out: string[] = []
      const err: string[] = []
      const asThem = { ...env, ...callerEnv(caller) }
      const wiring = { ...loginWiring(asThem), logins: () => Promise.resolve([testLogins('claude'), testLogins('codex')]) }
      const code = await runCli(argv, { stdout: line => out.push(line), stderr: line => err.push(line), env: asThem, wiring })
      return { code, out, err }
    }
    const listed = JSON.parse((await run(['list'], SULEIMAN)).out[0]!) as { claude: { name: string }[] }
    assert.deepEqual(listed.claude.map(a => a.name), ['Suleiman'])
    const refused = await run(['remove', 'claude', 'Dani 2'], SULEIMAN)
    assert.deepEqual([refused.code, refused.err], [1, ['That claude account is someone else’s: only they change it.']])
    assert.equal((await run(['logout', 'claude'], SULEIMAN)).err[0], 'That claude account is the team owner’s: only they change it.')
    const shared = await run(['share', 'claude', 'Suleiman', 'on'], SULEIMAN)
    assert.equal(shared.code, 0)
    assert.equal(readAccounts(accountsPath('claude', env)).find(a => a.name === 'Suleiman')?.shared, true)
    assert.deepEqual(
      (JSON.parse((await run(['list'], DANI)).out[0]!) as { claude: { name: string }[] }).claude.map(a => a.name),
      ['This computer', 'Dani 2', 'Suleiman'],
    )
  }))

test('a run keeps whom it was started for on its record, and hands it to every step', () => {
  const mark = lasting({ startedFor: SULEIMAN, profile: 'default' })
  assert.deepEqual(mark.startedFor, SULEIMAN)
  assert.deepEqual(markOptions(mark).caller, SULEIMAN)
  assert.deepEqual(forReaders(mark).startedFor, SULEIMAN)
  // A mark that says something else there keeps nothing of it.
  assert.equal(lasting({ startedFor: { login: 'x' } }).startedFor, undefined)
})

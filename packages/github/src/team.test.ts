import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { TeamCaller } from '@openagt/hooks'
import { changeTeamPicks, forgetAccount, readTeamPicks, useForRuns } from './accounts.js'
import type { GithubAccounts } from './cli.js'
import { accountsFor, addingFor, loginsFor, mayForget, runsLoginFor, shareAs, teamLogin, useForRunsAs } from './team.js'

// OpenAgent's GitHub accounts on a machine shared by a team: each its adder's, one from before the
// team owner's; shared or not by its owner; each person's runs on their own pick.

const DANI: TeamCaller = { login: 'nitedani', owner: true, teamOwner: 'nitedani' }
const SULEIMAN: TeamCaller = { login: 'suleimansh', owner: false, teamOwner: 'nitedani' }
const LOGINS = ['dani-bot', 'suleiman-bot', 'old-bot']

function withPicks(body: (path: string) => void): () => void {
  return () => {
    const dir = mkdtempSync(join(tmpdir(), 'github-team-'))
    try {
      const path = join(dir, 'openagent-github.json')
      // `old-bot` was there before Team mode: the team owner's.
      writeFileSync(path, JSON.stringify({ runs: { 'github.com': 'old-bot' }, team: { owners: { 'dani-bot': 'nitedani', 'suleiman-bot': 'suleimansh' }, shared: [], runsFor: {} } }))
      body(path)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }
}

test('a person works as their accounts, then the shared ones; never another’s', withPicks(path => {
  assert.deepEqual(loginsFor(DANI, LOGINS, path), ['dani-bot', 'old-bot'])
  assert.deepEqual(loginsFor(SULEIMAN, LOGINS, path), ['suleiman-bot'])
  assert.throws(() => teamLogin(SULEIMAN, 'dani-bot', LOGINS, path), /@dani-bot is not your GitHub account here/)
  shareAs(DANI, 'dani-bot', true, path)
  assert.deepEqual(loginsFor(SULEIMAN, LOGINS, path), ['suleiman-bot', 'dani-bot'])
  assert.equal(teamLogin(SULEIMAN, 'dani-bot', LOGINS, path), 'dani-bot')
  assert.throws(() => shareAs(SULEIMAN, 'dani-bot', false, path), /someone else’s/)
  assert.equal(mayForget(SULEIMAN, 'dani-bot', path), false)
  assert.equal(mayForget(DANI, 'old-bot', path), true)
}))

test('each person picks the account their runs use; the machine’s own pick is untouched', withPicks(path => {
  assert.equal(runsLoginFor(SULEIMAN, LOGINS, path), 'suleiman-bot')
  shareAs(DANI, 'dani-bot', true, path)
  useForRunsAs(SULEIMAN, 'dani-bot', LOGINS, path)
  assert.equal(runsLoginFor(SULEIMAN, LOGINS, path), 'dani-bot')
  assert.equal(runsLoginFor(DANI, LOGINS, path), 'dani-bot')
  assert.throws(() => useForRunsAs(DANI, 'suleiman-bot', LOGINS, path), /not your GitHub account/)
  // Stopped sharing, it is no longer theirs to run as: their own takes over.
  shareAs(DANI, 'dani-bot', false, path)
  assert.equal(runsLoginFor(SULEIMAN, LOGINS, path), 'suleiman-bot')
  // The pick every runner of one person uses, and the team's word, live side by side in the file.
  useForRuns('dani-bot', LOGINS.map(login => ({ login, ok: true })), path)
  const file = JSON.parse(readFileSync(path, 'utf8')) as { runs: Record<string, string>; team: { runsFor: Record<string, string> } }
  assert.deepEqual([file.runs['github.com'], file.team.runsFor['suleimansh']], ['dani-bot', 'dani-bot'])
}))

test('the list a person sees: theirs and the shared ones, whose, and their runs’ one', withPicks(path => {
  const read = { accounts: LOGINS.map(login => ({ login, ok: true, runs: login === 'old-bot', avatar: '' })) } as unknown as GithubAccounts
  const seen = (caller?: TeamCaller) => accountsFor(read, caller, path).accounts.map(a => [a.login, a.of, a.mine, a.runs])
  assert.deepEqual(seen(SULEIMAN), [['suleiman-bot', 'suleimansh', true, true]])
  assert.deepEqual(seen(DANI), [
    ['dani-bot', 'nitedani', true, true],
    ['old-bot', 'nitedani', true, false],
  ])
  assert.deepEqual(seen(), LOGINS.map(login => [login, undefined, undefined, login === 'old-bot']))
}))

test('an account forgotten takes its team word with it; a login started for a person is theirs', withPicks(path => {
  shareAs(DANI, 'dani-bot', true, path)
  useForRunsAs(SULEIMAN, 'dani-bot', LOGINS, path)
  const root = mkdtempSync(join(tmpdir(), 'github-root-'))
  try {
    forgetAccount(root, 'dani-bot', path)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
  const team = readTeamPicks(path)
  assert.deepEqual([team.owners['dani-bot'], team.shared, team.runsFor['suleimansh']], [undefined, [], undefined])
  addingFor(SULEIMAN, path)
  assert.equal(readTeamPicks(path).adding, 'suleimansh')
  addingFor(undefined, path)
  changeTeamPicks(({ adding: _done, ...rest }) => rest, path)
  assert.equal(readTeamPicks(path).adding, undefined)
}))

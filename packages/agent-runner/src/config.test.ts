import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readPersonal, readProjectAccounts, writeProjectAccounts } from './config.js'

async function project(config?: string): Promise<string> {
  const repo = await mkdtemp(join(tmpdir(), 'agent-runner-config-'))
  if (config !== undefined) {
    await mkdir(join(repo, '.agent-runner'))
    await writeFile(join(repo, '.agent-runner', 'config.yml'), config)
  }
  return repo
}

const ON = { memory: true, connectors: true, skills: true }

test('a run loads every part of the person\'s own setup unless this machine\'s `personal:` turns it off', async () => {
  const log: string[] = []
  assert.deepEqual(await readPersonal(await project(), l => log.push(l)), ON, 'no file: all on')
  assert.deepEqual(await readPersonal(await project('ended: echo hi\n'), l => log.push(l)), ON, 'no map: all on')
  assert.deepEqual(await readPersonal(await project('personal:\n  memory: off\n'), l => log.push(l)), { ...ON, memory: false }, 'one part off, the others on')
  assert.deepEqual(await readPersonal(await project('personal:\n  memory: off\n  connectors: False\n  skills: off\n'), l => log.push(l)), { memory: false, connectors: false, skills: false }, 'YAML false is off too')
  assert.deepEqual(await readPersonal(await project('personal:\n  memory: on\n  connectors: true\n  skills:\n'), l => log.push(l)), ON)
  assert.equal(log.length, 0)
  assert.deepEqual(await readPersonal(await project('personal:\n  memory: Off\n  skills: off\n'), l => log.push(l)), { ...ON, skills: false }, 'a value neither on nor off: that part on, and said')
  assert.match(log[0]!, /`personal.memory` is not on or off/)
  assert.deepEqual(await readPersonal(await project('personal:\n  plugins: off\n'), l => log.push(l)), ON, 'an unknown part: said, nothing off')
  assert.match(log[1]!, /`personal` has no part `plugins`; the parts are memory, connectors, skills/)
  assert.deepEqual(await readPersonal(await project('personal: off\n'), l => log.push(l)), ON, 'not a map: all on, and said')
  assert.match(log[2]!, /`personal` is not a map of memory, connectors, skills/)
  assert.deepEqual(await readPersonal(await project('personal: "unclosed\n'), l => log.push(l)), ON, 'a broken file: all on, and said')
  assert.equal(log.length, 4)
})

test('the project\'s own accounts: read off `accounts:`, anything else in it said; written in place, the rest of the file kept, and taken out again', async () => {
  const log: string[] = []
  assert.deepEqual(await readProjectAccounts(await project(), l => log.push(l)), {})
  const repo = await project('# mine\npersonal:\n  memory: off\naccounts:\n  git-host: octo-agent\n  claude-code: [Rom, Dani]\n  slack: x\n')
  assert.deepEqual(await readProjectAccounts(repo, l => log.push(l)), { gitHost: 'octo-agent', claude: ['Rom', 'Dani'] })
  assert.match(log.join('\n'), /`accounts` has no `slack`/)
  assert.deepEqual(await readProjectAccounts(await project('accounts:\n  git-host: [a]\n  claude-code: Rom\n'), l => log.push(l)), {})

  await writeProjectAccounts(repo, { gitHost: 'octo' })
  let file = await readFile(join(repo, '.agent-runner', 'config.yml'), 'utf8')
  assert.match(file, /^# mine/)
  assert.match(file, /memory: off/)
  assert.deepEqual(await readProjectAccounts(repo, () => {}), { gitHost: 'octo', claude: ['Rom', 'Dani'] })
  await writeProjectAccounts(repo, { claude: null })
  await writeProjectAccounts(repo, { gitHost: null })
  file = await readFile(join(repo, '.agent-runner', 'config.yml'), 'utf8')
  assert.doesNotMatch(file, /git-host|claude-code/)
  // What the person wrote there stays.
  assert.match(file, /slack: x/)
  assert.match(file, /memory: off/)
  // A map left empty goes with its last account.
  const alone = await project('accounts:\n  git-host: octo\n')
  await writeProjectAccounts(alone, { gitHost: null })
  assert.equal(await readFile(join(alone, '.agent-runner', 'config.yml'), 'utf8'), '')

  // A project with no config yet gets one.
  const fresh = await project()
  await writeProjectAccounts(fresh, { claude: ['Dani'] })
  assert.deepEqual(await readProjectAccounts(fresh, () => {}), { claude: ['Dani'] })
})

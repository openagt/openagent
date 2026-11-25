import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { nodeGitRunner } from '@openagt/agent-data'
import { PERSON_INFO } from '@openagt/hooks'
import { distributionSettings } from '../distribution-hooks.js'
import { handDownTestDistribution } from '../test-distribution.js'
import { callModule } from './module-calls.js'
import { onPerson } from './person.js'

handDownTestDistribution()

// The person at the dashboard through its call: what Settings › Profile saved with the person
// (`user-info`, through the distribution's store), in the personal folder under a temp $XDG_CONFIG_HOME.

async function withComputer(body: (folder: string) => Promise<void>): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'oa-person-rpc-'))
  const previous = process.env.XDG_CONFIG_HOME
  process.env.XDG_CONFIG_HOME = join(dir, 'cfg')
  mkdirSync(process.env.XDG_CONFIG_HOME, { recursive: true })
  try {
    await body(join(process.env.XDG_CONFIG_HOME, 'openagent'))
  } finally {
    if (previous === undefined) delete process.env.XDG_CONFIG_HOME
    else process.env.XDG_CONFIG_HOME = previous
    rmSync(dir, { recursive: true, force: true })
  }
}

/** The person as the call answers them, without git's email, which is whatever this computer's is. */
const said = async () => {
  const { email: _email, ...person } = await onPerson()
  return person
}

test("the person is what was saved with them, through the distribution's store: committed in their own folder, which their other computers sync", () =>
  withComputer(async folder => {
    assert.equal((await onPerson()).own, undefined, "none set yet: the computer's name")
    await (await distributionSettings()).set(PERSON_INFO, { name: 'Ada Lovelace', picture: 'https://avatars.githubusercontent.com/u/1', login: 'ada' })
    assert.deepEqual(await said(), { name: 'Ada Lovelace', avatar: 'https://avatars.githubusercontent.com/u/1', login: 'ada', own: true })
    assert.match(readFileSync(join(folder, 'person', 'settings.json'), 'utf8'), /Ada Lovelace/)
    assert.match(await nodeGitRunner()(['log', '-1', '--format=%s'], folder), /setting user-info\.person/)
  }))

test("Settings › Profile saves through user-info's own function, called in no project, as the package is this computer's", () =>
  withComputer(async () => {
    assert.deepEqual(await callModule(null, '@openagt/user-info', 'saveName', { name: 'Ada King' }), { ok: true, output: null })
    assert.deepEqual(await said(), { name: 'Ada King', own: true })
    assert.deepEqual(await callModule(null, '@openagt/user-info', 'saveName', { name: 'a\nb' }), { ok: false, error: 'A name is one line of at most 60 characters.' })
    // A package a project has is called in that project, never in none.
    assert.deepEqual(await callModule(null, '@openagt/ui-pane-files', 'project', {}), { ok: false, error: "@openagt/ui-pane-files is not this computer's" })
  }))

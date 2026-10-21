import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { homeUrlFromRemote, homeUrlFor, pushFork } from './home.js'

test('the home URL from the common remote forms: scp, ssh, https, with a credential, a .git suffix, a trailing newline', () => {
  const expected = 'https://github.com/openagt/openagent'
  assert.equal(homeUrlFromRemote('git@github.com:openagt/openagent.git'), expected)
  assert.equal(homeUrlFromRemote('git@github.com:openagt/openagent'), expected)
  assert.equal(homeUrlFromRemote('ssh://git@github.com/openagt/openagent.git'), expected)
  assert.equal(homeUrlFromRemote('https://github.com/openagt/openagent.git'), expected)
  assert.equal(homeUrlFromRemote('https://github.com/openagt/openagent'), expected)
  assert.equal(homeUrlFromRemote('https://user@github.com/openagt/openagent.git\n'), expected)
})

test('no home URL for a remote that is not GitHub, or junk', () => {
  assert.equal(homeUrlFromRemote('git@gitlab.com:o/r.git'), undefined)
  assert.equal(homeUrlFromRemote('https://example.com/o/r.git'), undefined)
  assert.equal(homeUrlFromRemote('https://github.com/'), undefined)
  assert.equal(homeUrlFromRemote('https://github.com/only-owner'), undefined)
  assert.equal(homeUrlFromRemote(''), undefined)
})

test('the home URL is read off origin; no origin is no URL', async () => {
  assert.equal(await homeUrlFor('/x', async () => 'git@github.com:openagt/openagent.git\n'), 'https://github.com/openagt/openagent')
  assert.equal(
    await homeUrlFor('/x', async () => {
      throw new Error('no origin')
    }),
    undefined,
  )
})

test("the fork pushes go to: origin's push address when it names another GitHub repository; none when it is origin's own, in any form, or there is no origin", async () => {
  const remotes = (read: string, pushed: string) => async (args: string[]) => (args.includes('--push') ? pushed : read)
  assert.equal(await pushFork('/x', remotes('https://github.com/brillout/gemskills.git\n', 'git@github.com:brillout-agent/gemskills.git\n')), 'brillout-agent/gemskills')
  assert.equal(await pushFork('/x', remotes('https://github.com/brillout/gemskills.git\n', 'git@github.com:Brillout/GemSkills.git\n')), undefined)
  assert.equal(await pushFork('/x', remotes('https://github.com/brillout/gemskills.git\n', 'git@gitlab.com:brillout-agent/gemskills.git\n')), undefined)
  assert.equal(
    await pushFork('/x', async () => {
      throw new Error('no origin')
    }),
    undefined,
  )
})

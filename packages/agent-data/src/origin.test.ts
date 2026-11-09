import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { projectNameOf, repositoryAddress } from './origin.js'

test('repositoryAddress reads origin, and a repository with none has no address', async () => {
  const asked: string[][] = []
  const withOrigin = async (args: string[]) => {
    asked.push(args)
    return 'git@github.com:acme/shop.git\n'
  }
  assert.equal(await repositoryAddress('/repo', withOrigin), 'github.com/acme/shop')
  assert.deepEqual(asked, [['remote', 'get-url', 'origin']])
  const none = async (): Promise<string> => {
    throw new Error("error: No such remote 'origin'")
  }
  assert.equal(await repositoryAddress('/repo', none), undefined)
})

test("a project is named as its repository is, in the letters origin writes it with, so it reads the same on every computer; one with no address by its folder", async () => {
  assert.equal(await projectNameOf('/Users/me/Projects/gemstack', async () => 'https://github.com/openagt/OpenAgent.git\n'), 'OpenAgent')
  assert.equal(await projectNameOf('/home/openagent/projects/openagent', async () => 'git@github.com:openagt/OpenAgent.git\n'), 'OpenAgent')
  assert.equal(await projectNameOf('/Users/me/notes', async () => Promise.reject(new Error("error: No such remote 'origin'"))), 'notes')
  assert.equal(await projectNameOf('/Users/me/mirror', async () => '/srv/git/shop.git\n'), 'mirror')
})

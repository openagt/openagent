import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { addressOfRemote, projectNameOf, spellingOfRemote, repositoryAddress } from './repository-address.js'

test('one repository reads the same however it was cloned', () => {
  for (const remote of [
    'git@github.com:Acme/Shop.git',
    'https://github.com/acme/shop',
    'https://github.com/acme/shop.git',
    'https://someone@github.com/acme/shop/',
    'ssh://git@github.com:22/acme/shop.git',
    '  git://github.com/acme/shop.git\n',
  ]) {
    assert.equal(addressOfRemote(remote), 'github.com/acme/shop', remote)
  }
})

test('another host, and a path with groups in it, keep their own address', () => {
  assert.equal(addressOfRemote('git@gitlab.example.com:team/tools/shop.git'), 'gitlab.example.com/team/tools/shop')
  assert.notEqual(addressOfRemote('https://gitlab.com/acme/shop'), addressOfRemote('https://github.com/acme/shop'))
})

test('what is not part of the name is dropped: a query, a fragment, a slash after .git, a password with an @ in it', () => {
  for (const remote of [
    'https://github.com/acme/shop.git?ref=main',
    'https://github.com/acme/shop#readme',
    'https://github.com/acme/shop/.git/',
    'https://me:p@ss@github.com/acme/shop.git',
    'me@work@github.com:acme/shop.git',
  ]) {
    assert.equal(addressOfRemote(remote), 'github.com/acme/shop', remote)
  }
})

test('a folder on this disk is no address', () => {
  for (const remote of ['/Users/me/code/shop', '../shop.git', 'file:///srv/git/shop.git', 'file://nas/share/shop.git', 'C:\\code\\shop', '']) {
    assert.equal(addressOfRemote(remote), undefined, remote)
  }
})

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

test('a remote\'s spelling keeps the letters it was written with: what another machine is given to clone from', () => {
  assert.equal(spellingOfRemote('git@github.com:Acme/Shop.git'), 'github.com/Acme/Shop')
  assert.equal(spellingOfRemote('https://GitHub.com/Acme/Shop/'), 'GitHub.com/Acme/Shop')
  assert.equal(addressOfRemote('https://GitHub.com/Acme/Shop/'), 'github.com/acme/shop')
  assert.equal(spellingOfRemote('/home/ada/shop'), undefined)
  assert.equal(spellingOfRemote('file:///home/ada/shop'), undefined)
})

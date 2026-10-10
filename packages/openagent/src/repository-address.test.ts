import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { addressOfRemote, repositoryAddress } from './repository-address.js'

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

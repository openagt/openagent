import { strict as assert } from 'node:assert'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { addressOfRemote, remoteHostOf, spellingOfRemote, typedRepository } from './repository-address.js'

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

test('a remote\'s spelling keeps the letters it was written with: what another machine is given to clone from', () => {
  assert.equal(spellingOfRemote('git@github.com:Acme/Shop.git'), 'github.com/Acme/Shop')
  assert.equal(spellingOfRemote('https://GitHub.com/Acme/Shop/'), 'GitHub.com/Acme/Shop')
  assert.equal(addressOfRemote('https://GitHub.com/Acme/Shop/'), 'github.com/acme/shop')
  assert.equal(spellingOfRemote('/home/ada/shop'), undefined)
  assert.equal(spellingOfRemote('file:///home/ada/shop'), undefined)
})

test('the host of a remote: scp-like, ssh and https addresses; none for a folder or a file address', () => {
  assert.equal(remoteHostOf('git@github.com:me/a.git'), 'github.com')
  assert.equal(remoteHostOf('ssh://git@GitHub.com:22/me/a'), 'github.com')
  assert.equal(remoteHostOf('https://github.com/me/a.git'), 'github.com')
  assert.equal(remoteHostOf('/Users/me/a.git'), undefined)
  assert.equal(remoteHostOf('file:///Users/me/a.git'), undefined)
})

test("a repository's address as a person types it gives what git is given, the one address every machine knows it by, and its name; a search word gives none", () => {
  assert.deepEqual(typedRepository('github.com/ada/shop'), { url: 'https://github.com/ada/shop', address: 'github.com/ada/shop', name: 'shop' })
  assert.deepEqual(typedRepository('git@github.com:ada/Shop.git'), { url: 'git@github.com:ada/Shop.git', address: 'github.com/ada/shop', name: 'Shop' })
  assert.deepEqual(typedRepository('gitlab.example.com/Team/Sub/My.App'), { url: 'https://gitlab.example.com/Team/Sub/My.App', address: 'gitlab.example.com/team/sub/my.app', name: 'My.App' })
  for (const typed of ['', 'shop', 'ada/shop', '/Users/ada/shop', 'https://me:token@github.com/ada/shop', 'github.com/ada/../etc']) assert.equal(typedRepository(typed), undefined, typed)
})

// Browser-side code imports this entry (`@openagt/hooks/repository-address`): one node module here
// drags node-only code into a page's bundle, and the bundler says so only as a warning, in another
// package's build.
test('the repository address imports nothing, so browser-side code can import it', async () => {
  const source = await readFile(new URL('./repository-address.js', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /^\s*(import|export .* from)\b/m)
})

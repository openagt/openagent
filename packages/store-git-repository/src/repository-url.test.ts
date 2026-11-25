import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { repositoryUrlOf } from './repository-url.js'

test('a repository address as typed: a host address as it is, host/path alone as its https address, anything else none', () => {
  assert.equal(repositoryUrlOf('https://github.com/me/agent'), 'https://github.com/me/agent')
  assert.equal(repositoryUrlOf(' git@github.com:me/agent.git '), 'git@github.com:me/agent.git')
  assert.equal(repositoryUrlOf('github.com/me/agent'), 'https://github.com/me/agent.git')
  assert.equal(repositoryUrlOf('github.com/me/agent.git/'), 'https://github.com/me/agent.git')
  for (const typed of ['', '   ', '/Users/me/agent', '../agent', 'file:///srv/agent.git', '--upload-pack=x', 'agent', 'me/agent']) {
    assert.equal(repositoryUrlOf(typed), undefined, typed)
  }
})

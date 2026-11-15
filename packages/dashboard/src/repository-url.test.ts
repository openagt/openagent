import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { remoteHostName, repositoryUrlOf } from './repository-url.js'

test('a repository address as typed: a host address as it is, host/path alone as its https address, anything else none', () => {
  assert.equal(repositoryUrlOf('https://github.com/me/agent'), 'https://github.com/me/agent')
  assert.equal(repositoryUrlOf(' git@github.com:me/agent.git '), 'git@github.com:me/agent.git')
  assert.equal(repositoryUrlOf('github.com/me/agent'), 'https://github.com/me/agent.git')
  assert.equal(repositoryUrlOf('github.com/me/agent.git/'), 'https://github.com/me/agent.git')
  for (const typed of ['', '   ', '/Users/me/agent', '../agent', 'file:///srv/agent.git', '--upload-pack=x', 'agent', 'me/agent']) {
    assert.equal(repositoryUrlOf(typed), undefined, typed)
  }
})

test('the remote is named for a person by its host, in any of git\'s spellings of the address', () => {
  assert.equal(remoteHostName('https://github.com/suleimansh/test-project.git'), 'GitHub')
  assert.equal(remoteHostName('git@gitlab.com:team/app.git'), 'GitLab')
  assert.equal(remoteHostName('ssh://git@bitbucket.org:22/team/app.git'), 'Bitbucket')
  assert.equal(remoteHostName('https://user:token@git.example.com/team/app'), 'git.example.com')
  assert.equal(remoteHostName('/srv/git/app.git'), undefined)
  assert.equal(remoteHostName('../origin.git'), undefined)
  assert.equal(remoteHostName('file:///srv/git/app.git'), undefined)
  assert.equal(remoteHostName(''), undefined)
})

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { agentBranchName, isAgentBranch, isSafeAgentId, publishedBase, publishedBranch, sessionNameOf } from './branch-names.js'

test('sessionNameOf reads the session name off a renamed agent branch (#1725)', () => {
  assert.equal(sessionNameOf('agent-add-comments', 'r1'), 'add-comments')
  // A suffixed name is the name the agent was told it got.
  assert.equal(sessionNameOf('agent-add-comments-2', 'r1'), 'add-comments-2')
  // A name that itself starts with `agent-` is a name like any other.
  assert.equal(sessionNameOf('agent-agent-smith', 'r1'), 'agent-smith')
})

test('sessionNameOf: the branch a checkout was created on, a user branch and no branch carry no name (#1725)', () => {
  assert.equal(sessionNameOf(agentBranchName('r1'), 'r1'), undefined)
  // Another agent's birth branch is a name for this one only by accident; it is still an agent branch.
  assert.equal(sessionNameOf(agentBranchName('r2'), 'r1'), 'r2')
  assert.equal(sessionNameOf('main', 'r1'), undefined)
  assert.equal(sessionNameOf('feat/mine', 'r1'), undefined)
  assert.equal(sessionNameOf(undefined, 'r1'), undefined)
})

test('an agent branch is the one a checkout was created on or a renamed one; never the user\'s own', () => {
  assert.equal(agentBranchName('r1'), 'agent-r1')
  assert.equal(isAgentBranch(agentBranchName('r1')), true)
  assert.equal(isAgentBranch('agent-add-comments'), true)
  assert.equal(isAgentBranch('main'), false)
  assert.equal(isAgentBranch('data'), false)
  assert.equal(isAgentBranch('agent-data'), false, 'the data branch carries the prefix but is nobody\'s')
  assert.equal(isSafeAgentId('data'), false, 'agent-data is the data branch')
  assert.equal(isSafeAgentId('data-2'), true)
})

// Browser-side code imports this entry (`@openagt/git-branches/branch-names`): one node module
// here drags node-only code into a page's bundle, and the bundler says so only as a warning, in
// another package's build.
test('the branch names import nothing, so browser-side code can import them', async () => {
  const source = await readFile(new URL('./branch-names.js', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /^\s*(import|export .* from)\b/m)
})

test('a run is told to start from origin\'s copy of a branch by its full name, read back as the branch', () => {
  assert.equal(publishedBase('main'), 'refs/remotes/origin/main')
  assert.equal(publishedBranch(publishedBase('main')), 'main')
  assert.equal(publishedBranch('main'), undefined)
})

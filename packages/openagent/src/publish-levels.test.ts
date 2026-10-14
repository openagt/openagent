import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { offeredPublishPicks, publishLevelOf, publishPickIn } from './publish-levels.js'

test('a project with a git host is offered every pick; one without is offered Off, Commit and Publish branch', () => {
  assert.deepEqual(offeredPublishPicks(true), ['nothing', 'commit', 'branch', 'pr', 'merge'])
  assert.deepEqual(offeredPublishPicks(false), ['nothing', 'commit', 'branch'])
})

test('the pick in force: Commit until one is saved; a pull request pick is Publish branch where there is no git host', () => {
  assert.equal(publishPickIn(undefined, true), 'commit')
  assert.equal(publishPickIn(undefined, false), 'commit')
  assert.equal(publishPickIn('nothing', true), 'nothing')
  assert.equal(publishPickIn('commit', true), 'commit')
  assert.equal(publishPickIn('merge', true), 'merge')
  assert.equal(publishPickIn('pr', false), 'branch')
  assert.equal(publishPickIn('merge', false), 'branch')
  assert.equal(publishPickIn('branch', false), 'branch')
  assert.equal(publishPickIn('nothing', false), 'nothing')
})

test('Off hands the start hook no level; every other pick is its own level', () => {
  assert.equal(publishLevelOf('nothing'), undefined)
  assert.equal(publishLevelOf('commit'), 'commit')
  assert.equal(publishLevelOf('branch'), 'branch')
  assert.equal(publishLevelOf('pr'), 'pr')
  assert.equal(publishLevelOf('merge'), 'merge')
})

test('a project with no remote is offered Off and Commit; a publish pick is Commit there, and so is no pick', () => {
  assert.deepEqual(offeredPublishPicks(true, false), ['nothing', 'commit'])
  assert.deepEqual(offeredPublishPicks(false, false), ['nothing', 'commit'])
  assert.equal(publishPickIn('merge', true, false), 'commit')
  assert.equal(publishPickIn('branch', false, false), 'commit')
  assert.equal(publishPickIn(undefined, true, false), 'commit')
  assert.equal(publishPickIn('nothing', true, false), 'nothing')
  // With a remote, a saved pick the project is not offered falls back to the branch.
  assert.equal(publishPickIn('merge', false, true), 'branch')
})

import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { isPublishLevel, offeredPublishLevels, publishLevelIn } from './publish-levels.js'

test('a project with a git host is offered every level; one without is offered Commit and Publish branch', () => {
  assert.deepEqual(offeredPublishLevels(true), ['commit', 'branch', 'pr', 'merge'])
  assert.deepEqual(offeredPublishLevels(false), ['commit', 'branch'])
})

test('the level in force: Commit until one is saved; a pull request level is Publish branch where there is no git host', () => {
  assert.equal(publishLevelIn(undefined, true), 'commit')
  assert.equal(publishLevelIn(undefined, false), 'commit')
  assert.equal(publishLevelIn('commit', true), 'commit')
  assert.equal(publishLevelIn('merge', true), 'merge')
  assert.equal(publishLevelIn('pr', false), 'branch')
  assert.equal(publishLevelIn('merge', false), 'branch')
  assert.equal(publishLevelIn('branch', false), 'branch')
})

test('"nothing" is no level: every run commits, so a saved one is not kept', () => {
  assert.equal(isPublishLevel('nothing'), false)
  assert.equal(isPublishLevel('commit'), true)
})

test('a project with no remote is offered Commit alone; a publish level is Commit there, and so is none', () => {
  assert.deepEqual(offeredPublishLevels(true, false), ['commit'])
  assert.deepEqual(offeredPublishLevels(false, false), ['commit'])
  assert.equal(publishLevelIn('merge', true, false), 'commit')
  assert.equal(publishLevelIn('branch', false, false), 'commit')
  assert.equal(publishLevelIn(undefined, true, false), 'commit')
  // With a remote, a saved level the project is not offered falls back to the branch.
  assert.equal(publishLevelIn('merge', false, true), 'branch')
})

import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { pickIn, publishLevelOf } from './publish-levels.js'

test('among the levels offered, the pick in force is the one saved, else Commit, else the furthest offered short of the saved one', () => {
  assert.equal(pickIn('pr', ['nothing', 'commit', 'branch', 'pr']), 'pr')
  assert.equal(pickIn(undefined, ['nothing', 'commit', 'branch']), 'commit')
  assert.equal(pickIn('merge', ['nothing', 'commit', 'branch']), 'branch')
  assert.equal(pickIn('branch', ['nothing', 'commit']), 'commit')
})

test('Off hands the run no level; every other pick is its own level', () => {
  assert.equal(publishLevelOf('nothing'), undefined)
  assert.equal(publishLevelOf('commit'), 'commit')
  assert.equal(publishLevelOf('branch'), 'branch')
  assert.equal(publishLevelOf('pr'), 'pr')
  assert.equal(publishLevelOf('merge'), 'merge')
})

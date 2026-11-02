import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { projectErrorStore } from './project-errors.js'

/** A clock that advances one second per read, so `since` values are distinguishable. */
function ticking(start = Date.parse('2026-08-20T10:00:00.000Z')): () => Date {
  let t = start
  return () => new Date((t += 1000))
}

test('a project with nothing recorded lists no errors', () => {
  const errors = projectErrorStore(ticking())
  assert.deepEqual(errors.list('/repos/app'), [])
})

test('a recorded error carries its code, message and when it was first seen', () => {
  const errors = projectErrorStore(ticking())
  errors.set('/repos/app', 'data-sync', 'the data branch could not be pushed: permission denied')
  assert.deepEqual(errors.list('/repos/app'), [
    { code: 'data-sync', message: 'the data branch could not be pushed: permission denied', since: '2026-08-20T10:00:01.000Z' },
  ])
})

test('re-reporting the same code refreshes the message and keeps since (#1500)', () => {
  // The sync re-reports every minute; a banner that said "since 1 minute ago" forever would
  // hide how long the project has actually been stranded.
  const errors = projectErrorStore(ticking())
  errors.set('/repos/app', 'data-sync', 'first failure')
  errors.set('/repos/app', 'data-sync', 'second failure')
  assert.deepEqual(errors.list('/repos/app'), [{ code: 'data-sync', message: 'second failure', since: '2026-08-20T10:00:01.000Z' }])
})

test('clearing removes the error, and clearing what was never set is a no-op', () => {
  const errors = projectErrorStore(ticking())
  errors.clear('/repos/app', 'data-sync')
  errors.set('/repos/app', 'data-sync', 'failure')
  errors.clear('/repos/app', 'data-sync')
  assert.deepEqual(errors.list('/repos/app'), [])
  // Cleared means gone for good: a later report starts its own clock.
  errors.set('/repos/app', 'data-sync', 'again')
  assert.equal(errors.list('/repos/app')[0]?.since, '2026-08-20T10:00:02.000Z')
})

test('errors are per project', () => {
  const errors = projectErrorStore(ticking())
  errors.set('/repos/a', 'data-sync', 'a is stranded')
  assert.deepEqual(errors.list('/repos/b'), [])
  assert.equal(errors.list('/repos/a').length, 1)
})

test('why a project\'s data stays on this machine is a note beside the errors, per project, set and unset', () => {
  const errors = projectErrorStore(ticking())
  assert.deepEqual(errors.read('/repos/a'), { errors: [] })
  errors.setReach('/repos/a', 'no-remote')
  assert.deepEqual(errors.read('/repos/a'), { errors: [], local: 'no-remote' })
  assert.deepEqual(errors.list('/repos/a'), [], 'a note is no error')
  assert.deepEqual(errors.read('/repos/b'), { errors: [] })
  errors.setReach('/repos/a', 'kept')
  assert.deepEqual(errors.read('/repos/a'), { errors: [], local: 'kept' })
  errors.setReach('/repos/a', 'origin')
  assert.deepEqual(errors.read('/repos/a'), { errors: [] })
})

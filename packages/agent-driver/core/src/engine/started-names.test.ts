import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { forgetStartedNames, nameStarted, withStartedNames } from './started-names.js'

test("a list shows the name asked at Start on the run's row until its record has its own, and the row as being named while it is asked", async () => {
  let named: (title: string | undefined) => void = () => {}
  nameStarted('run-1', new Promise(resolve => (named = resolve)))
  nameStarted('run-3', Promise.resolve(undefined))
  await new Promise(resolve => setImmediate(resolve))
  const rows = () => withStartedNames([{ id: 'run-1' }, { id: 'run-2' }, { id: 'run-3' }] as { id: string; title?: string; naming?: true }[])
  assert.deepEqual(rows(), [{ id: 'run-1', naming: true }, { id: 'run-2' }, { id: 'run-3' }], 'a name still asked for holds the place; an ask that ended with none does not')
  named('Fix flaky login test')
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(rows()[0], { id: 'run-1', title: 'Fix flaky login test' })
  // The record's own name, once it has one, is the one shown.
  assert.equal(withStartedNames([{ id: 'run-1', title: 'Its own' }])[0]!.title, 'Its own')
  forgetStartedNames()
})

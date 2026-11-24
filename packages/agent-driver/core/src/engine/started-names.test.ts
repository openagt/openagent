import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { forgetStartedNames, nameStarted, startedName, withStartedNames } from './started-names.js'

test("a list shows the name asked at Start on the run's row until its record has its own", async () => {
  nameStarted('run-1', Promise.resolve('Fix flaky login test'))
  await new Promise(resolve => setImmediate(resolve))
  const rows = withStartedNames([{ id: 'run-1' }, { id: 'run-2' }] as { id: string; title?: string }[])
  assert.deepEqual(rows.map(row => row.title), ['Fix flaky login test', undefined])
  // The record's own name, once it has one, is the one shown.
  assert.equal(withStartedNames([{ id: 'run-1', title: 'Its own' }])[0]!.title, 'Its own')
  assert.equal(await startedName('run-1'), 'Fix flaky login test')
  assert.equal(await startedName('run-unknown'), undefined, 'a run not started here has none')
  forgetStartedNames()
})

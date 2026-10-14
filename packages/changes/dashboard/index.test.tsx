import { expect, test } from 'vitest'
import changes from './index.js'

test('the module adds the Changes pane, with its icon, and the count in a working run’s bar', () => {
  expect(changes.panels?.map(panel => panel.id)).toEqual(['changes'])
  expect(changes.panels?.[0]?.icon).toBeTruthy()
  expect(changes.run?.summary).toBeTruthy()
})

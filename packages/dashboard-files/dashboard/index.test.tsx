import { expect, test } from 'vitest'
import files from './index.js'

test('the module adds the Files pane, with its icon', () => {
  expect(files.panels?.map(panel => panel.id)).toEqual(['files'])
  expect(files.panels?.[0]?.icon).toBeTruthy()
})

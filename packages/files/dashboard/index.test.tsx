import { expect, test } from 'vitest'
import files from './index.js'

test('the module adds two panes, each with its icon, Changes first', () => {
  expect(files.panels?.map(panel => panel.id)).toEqual(['changes', 'files'])
  for (const panel of files.panels ?? []) expect(panel.icon).toBeTruthy()
})

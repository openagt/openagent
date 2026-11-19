import { expect, test } from 'vitest'
import markdown from './index.js'
import { Markdown } from './Markdown.js'

test('the module draws the markdown kind', () => {
  expect(markdown.hooks['ui.render']).toEqual([{ kind: 'markdown', Render: Markdown }])
})

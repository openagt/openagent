import { expect, test } from 'vitest'
import mermaid from './index.js'
import { MermaidDiagram } from './MermaidDiagram.js'

test('the module draws the mermaid blocks of a text in markdown', () => {
  expect(mermaid.hooks['ui.render']).toEqual([{ kind: 'mermaid', Render: MermaidDiagram }])
})

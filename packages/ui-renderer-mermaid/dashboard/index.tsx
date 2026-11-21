// ui-renderer-mermaid's UI part: the package's `./dashboard` export. A mermaid block in a text in
// markdown, drawn as its diagram (`ui.render`, the block's language), wherever the dashboard shows
// one while the plugin is on.
import { defineUiModule } from '@openagt/ui/module'
import { MermaidDiagram } from './MermaidDiagram.js'

export default defineUiModule({
  name: 'ui-renderer-mermaid',
  hooks: {
    'ui.render': [{ kind: 'mermaid', Render: MermaidDiagram }],
  },
})

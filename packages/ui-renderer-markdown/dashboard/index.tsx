// ui-renderer-markdown's UI part: the package's `./dashboard` export. How a text in markdown looks
// wherever the dashboard shows one (`ui.render`, the `markdown` kind): the shell draws none itself.
import { defineUiModule } from '@openagt/ui/module'
import { Markdown } from './Markdown.js'

export default defineUiModule({
  name: 'ui-renderer-markdown',
  hooks: {
    'ui.render': [{ kind: 'markdown', Render: Markdown }],
  },
})

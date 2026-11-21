// host-claude-web's UI part: the package's `./dashboard` export. Settings › Claude web, where the
// person picks the browser that does the extension's work and sets it up, and the strip above the
// chat of a run on the web, its question and the mirror of its session. Both read and act through
// the module's own server part (`../src/server.ts`).
import { defineUiModule } from '@openagt/ui/module'
import { Globe } from 'lucide-react'
import { ClaudeWebSettings } from './ClaudeWebSettings.js'
import { WebRunNotice } from './WebRunNotice.js'

export default defineUiModule({
  name: 'host-claude-web',
  hooks: {
    'ui.view': [
      { place: 'settings.section', id: 'claude-web', title: 'Claude web', icon: Globe, order: 70, View: ClaudeWebSettings },
      { place: 'chat.notice', id: 'web-run', View: WebRunNotice },
    ],
  },
})

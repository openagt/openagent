import { defineUiModule } from '@openagt/ui/module'
import { ActionsRunNotice } from './ActionsRunNotice.js'

/** host-github-actions' UI part: the strip above the chat of a run it runs (`chat.notice`). */
export default defineUiModule({
  name: 'host-github-actions',
  hooks: { 'ui.view': [{ place: 'chat.notice', id: 'actions-run', View: ActionsRunNotice }] },
})

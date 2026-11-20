// saved-prompts' UI part: the package's `./dashboard` export. The message box's saved prompts
// (`composer.prompts`): the person's, then the project's, which its menus load into the box, and
// the panel that saves what the box holds as one. It reads and changes them through its own server
// part (`../src/server.ts`).
import { defineUiModule } from '@openagt/ui/module'
import { offered, remove } from './calls.js'
import { SavePrompt } from './SavePrompt.js'

export default defineUiModule({
  name: 'saved-prompts',
  hooks: {
    'ui.view': [
      {
        place: 'composer.prompts',
        id: 'saved-prompts',
        list: offered,
        remove: (host, projectId, id) =>
          remove(host, projectId, id).then(
            () => ({ ok: true as const }),
            (error: unknown) => ({ ok: false as const, error: error instanceof Error ? error.message : String(error) }),
          ),
        View: SavePrompt,
      },
    ],
  },
})

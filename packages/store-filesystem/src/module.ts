import { defineModule } from '@openagt/hooks'
import { filesystemBackend } from './backend.js'
import { dataHere } from './data-here.js'

/**
 * store-filesystem, core: the end of the store's chain, every scope's files on this computer; and
 * why a project's data stays on this computer, said under its name (`data-here.ts`).
 */
export default defineModule({
  name: 'store-filesystem',
  hooks: {
    'store.backend': filesystemBackend(),
    'app.attention': async ({ project }) => (project ? dataHere(project) : []),
  },
})

import { defineModule } from '@openagt/hooks'
import { filesystemBackend } from './backend.js'

/** store-filesystem, core: the end of the store's chain, every scope's files on this computer. */
export default defineModule({
  name: 'store-filesystem',
  hooks: { 'store.backend': filesystemBackend() },
})

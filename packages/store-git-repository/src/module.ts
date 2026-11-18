import { defineModule } from '@openagt/hooks'
import { gitRepositoryBackend } from './backend.js'

/**
 * store-git-repository, a plugin kept per computer: the person's own folder as a git repository,
 * synced with a repository of theirs. Its link of the store's chain is there whatever its row
 * says, as every store's is: the rows are read through the store.
 */
export default defineModule({
  name: 'store-git-repository',
  plugin: { scope: 'computer' },
  hooks: { 'store.backend': gitRepositoryBackend() },
})

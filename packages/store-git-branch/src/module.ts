import { defineModule } from '@openagt/hooks'
import { gitBranchBackend } from './backend.js'

/**
 * store-git-branch, a plugin kept per project: a shared project's data on its `agent-data`
 * branch. Its link of the store's chain is there whatever its row says, as every store's is: the
 * rows are read through the store. A project is kept on the branch while the person shares it.
 */
export default defineModule({
  name: 'store-git-branch',
  plugin: { scope: 'project' },
  hooks: { 'store.backend': gitBranchBackend() },
})

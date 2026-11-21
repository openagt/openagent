import { defineModule } from '@openagt/hooks'

/**
 * ui-renderer-mermaid, a plugin kept per person (#2394: a heavy dependency, so opt-in): a mermaid
 * block in a text in markdown is drawn as its diagram. All of it is the package's page part
 * (`../dashboard`): this module only makes it a plugin, off until the person's Enabled row is on.
 */
export default defineModule({ name: 'ui-renderer-mermaid', plugin: { scope: 'person' }, hooks: {} })

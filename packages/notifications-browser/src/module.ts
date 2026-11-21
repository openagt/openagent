import { defineModule } from '@openagt/hooks'

export { NOTIFY_ACTIVITY, NOTIFY_WAITING } from './kinds.js'

/**
 * notifications-browser, a plugin kept per person (#2394: notifications are plugins): desktop
 * notifications in the browser while the dashboard is open. All of it is the package's page part
 * (`../dashboard`), and its switches are settings (`kinds.ts`): this module only makes it a plugin,
 * on where the person's Enabled row says.
 */
export default defineModule({ name: 'notifications-browser', plugin: { scope: 'person' }, hooks: {} })

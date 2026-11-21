import { defineSetting } from '@openagt/hooks'

/** How long the person's command may be. */
export const COMMAND_MAX = 4000

/** What a command may be: one line, of at most {@link COMMAND_MAX} characters; empty is none. */
export function isCommandLine(value: unknown): value is string {
  return typeof value === 'string' && value.length <= COMMAND_MAX && !/[\r\n\u0000]/.test(value)
}

/**
 * The person's command, a shell line, run when a run needs them (`notify.ts`). Kept per computer:
 * where to post is set per machine, and a teammate's machine should not post to your channel.
 * Only this package reads it, so it is its own and not the catalog's. Empty, nothing runs.
 */
export const NOTIFY_COMMAND = defineSetting<string>({
  key: 'notifications-command.command',
  scope: 'computer',
  default: '',
  parse: value => (isCommandLine(value) ? value.trim() : undefined),
})

import { defineSetting } from '@openagt/hooks'

/**
 * Which browser does the extension's work (#1332): one OpenAgent runs (`app`), Chrome for Testing
 * with the extension in it, signed in to claude.ai once and kept minimized, so web runs work with
 * the person's own Chrome closed; or the person's own Chrome (`yours`), the extension set up there
 * by hand. Kept per computer: the browser runs on this one.
 */
export const BROWSER = defineSetting<'app' | 'yours'>({
  key: 'host-claude-web.browser',
  scope: 'computer',
  default: 'yours',
  parse: value => (value === 'app' || value === 'yours' ? value : undefined),
})

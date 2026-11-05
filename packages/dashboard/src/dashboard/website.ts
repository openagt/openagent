import { stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { fileIn, sendFile } from './static.js'

/**
 * The website on an installed computer (#1919). There, the website's own name is answered by this
 * dashboard (the secure address), which carries a copy of the website, built with it into
 * `dist/website`. Its `/` shows the dashboard, or the landing page once the person picks it on
 * the toggle under the logo; the website's other pages are at their own paths, beside the
 * dashboard's, whose files never have the same names.
 */

/** Where the toggle is answered: `HEAD /_view` says this is the dashboard's copy, `/_view/<view>` picks one. */
export const VIEW_PREFIX = '/_view'
/** What `/` shows, kept in the browser. */
export const VIEW_COOKIE = 'openagent-view'

export type View = 'dashboard' | 'landing'

/** The website's copy, when the dashboard was built with one. */
export async function resolveWebsite(): Promise<string | undefined> {
  // From the package root, as the dashboard bundle is: the same folder from `dist/`, `dist-test/` and `src/`.
  const dir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'dist', 'website')
  return (await stat(join(dir, 'index.html')).then(s => s.isFile()).catch(() => false)) ? dir : undefined
}

/** The view this browser picked, if it picked one. */
function pickedView(req: IncomingMessage): View | undefined {
  const cookies = (req.headers.cookie ?? '').split(';').map(part => part.trim())
  if (cookies.includes(`${VIEW_COOKIE}=landing`)) return 'landing'
  return cookies.includes(`${VIEW_COOKIE}=dashboard`) ? 'dashboard' : undefined
}

/** What `/` shows this browser: the dashboard, unless it picked the landing page. */
export function viewOf(req: IncomingMessage): View {
  return pickedView(req) ?? 'dashboard'
}

/** The cookie that keeps `view`. Readable by the page: it is how the dashboard knows to draw the toggle. */
function viewCookie(view: View): string {
  return `${VIEW_COOKIE}=${view}; Path=/; Max-Age=31536000; Secure; SameSite=Lax`
}

/**
 * A browser on the secure address that picked nothing yet is given the dashboard as its pick, so
 * the dashboard's page knows from its first frame that the toggle is there (its `ViewToggle`).
 */
export function keepView(req: IncomingMessage, res: ServerResponse): void {
  if (pickedView(req) === undefined) res.setHeader('set-cookie', viewCookie('dashboard'))
}

/**
 * The toggle's own route. `/_view` answers 204, which is how a page tells this copy from the
 * public website (404 there). `/_view/landing` and `/_view/dashboard` keep the pick and go to `/`.
 */
export function handleViewRequest(res: ServerResponse, pathname: string): void {
  if (pathname === VIEW_PREFIX) {
    res.writeHead(204).end()
    return
  }
  const view = pathname.slice(VIEW_PREFIX.length + 1)
  if (view !== 'landing' && view !== 'dashboard') {
    res.writeHead(404, { 'content-type': 'text/plain' }).end('no such view')
    return
  }
  res
    .writeHead(303, {
      location: '/',
      'set-cookie': viewCookie(view),
      'cache-control': 'no-store',
    })
    .end()
}

/**
 * Serve the website's file for this request, when it is one: its landing page at `/` when this
 * browser picked it, and any of its other files at its own path. Resolves false when the request
 * is the dashboard's.
 */
export async function serveWebsite(req: IncomingMessage, res: ServerResponse, dir: string, pathname: string): Promise<boolean> {
  if (pathname === '/' && viewOf(req) === 'dashboard') return false
  const target = await fileIn(dir, pathname)
  if (target === undefined) return false
  // A browser asks again for `/` each time, and the two pages are told apart by their tags, so a switch shows at once.
  await sendFile(req, res, dir, target)
  return true
}

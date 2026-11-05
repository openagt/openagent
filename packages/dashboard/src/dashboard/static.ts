import { readFile, stat } from 'node:fs/promises'
import { fileTag, sendBody } from './compress.js'
import { join, normalize, sep } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { contentTypeFor } from './content-type.js'
import { requestPathname } from '../request-path.js'

// Serve the built dashboard bundle (#405). The dashboard is a plain Vite SPA — one static
// `index.html` plus `assets/**` — so the daemon serves it as
// plain files with an SPA fallback (any non-asset path yields `index.html`, which boots
// the client router). Assets are copied into the
// OpenAgent package at build time (see scripts/bundle-dashboard.mjs).

/** Whether a real, readable file exists at `path`. */
async function isFile(path: string): Promise<boolean> {
  return stat(path).then(s => s.isFile()).catch(() => false)
}

/** Decode a percent-encoded path; a malformed escape names no file, so it decodes to nothing. */
function tryDecode(pathname: string): string {
  try {
    return decodeURIComponent(pathname)
  } catch {
    return ''
  }
}

/**
 * The file `pathname` names in `dir`: the file itself, or a folder's `index.html` (`/press` is
 * `press/index.html`, `/` is `index.html`). Undefined when there is none, when the escape is
 * malformed, or when the path leaves `dir`: path-traversal never reads outside it.
 */
export async function fileIn(dir: string, pathname: string): Promise<string | undefined> {
  const rel = tryDecode(pathname).replace(/^\/+/, '')
  const root = normalize(dir)
  const candidate = normalize(join(root, rel))
  if (candidate !== root && !candidate.startsWith(root + sep)) return undefined
  if (rel && (await isFile(candidate))) return candidate
  const index = join(candidate, 'index.html')
  return (await isFile(index)) ? index : undefined
}

/**
 * Send `target`, a file in the bundle `root`. Only the fingerprinted files under `assets/` are
 * immutable, the host files a module imports among them: index.html, which names this version's
 * in its import map, and everything else at a stable path must always revalidate, or a dashboard
 * upgrade would not reach a browser that kept the old page until its cache expired a year later.
 */
export async function sendFile(req: IncomingMessage, res: ServerResponse, root: string, target: string): Promise<void> {
  const body = await readFile(target).catch(() => undefined)
  const facts = await stat(target).catch(() => undefined)
  if (body === undefined) {
    res.writeHead(404, { 'content-type': 'text/plain' })
    res.end('dashboard bundle not built')
    return
  }
  const cacheControl = target.startsWith(join(normalize(root), 'assets') + sep) ? 'public, max-age=31536000, immutable' : 'no-cache'
  // A file's packed copy is kept while the file is the same one.
  await sendBody(req, res, 200, { 'content-type': contentTypeFor(target), 'cache-control': cacheControl, ...(facts ? { etag: fileTag(facts) } : {}) }, body, facts ? `${target} ${facts.mtimeMs} ${facts.size}` : undefined)
}

/**
 * Serve `dir`'s static bundle for this request: the requested file when it exists,
 * otherwise `index.html` (the SPA fallback, so client routes and unknown paths still
 * boot the app). A request that escapes `dir` falls back to `index.html` rather than reading
 * outside the bundle.
 */
export async function serveClientBundle(req: IncomingMessage, res: ServerResponse, dir: string): Promise<void> {
  // Neither an unparseable request target nor a malformed escape (`/%zz`) may throw: this
  // runs void-dispatched, so an exception here would be an unhandled rejection that takes
  // the daemon down (#938). Both fall back to the SPA shell like any other unknown path.
  const target = (await fileIn(dir, requestPathname(req) ?? '/')) ?? join(dir, 'index.html')
  await sendFile(req, res, dir, target)
}

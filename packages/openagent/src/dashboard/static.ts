import { readFile, stat } from 'node:fs/promises'
import { sendBody } from './compress.js'
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
 * Serve `dir`'s static bundle for this request: the requested file when it exists,
 * otherwise `index.html` (the SPA fallback, so client routes and unknown paths still
 * boot the app). Path-traversal is guarded — a request that escapes `dir` falls back to
 * `index.html` rather than reading outside the bundle.
 */
export async function serveClientBundle(req: IncomingMessage, res: ServerResponse, dir: string): Promise<void> {
  // Neither an unparseable request target nor a malformed escape (`/%zz`) may throw: this
  // runs void-dispatched, so an exception here would be an unhandled rejection that takes
  // the daemon down (#938). Both fall back to the SPA shell like any other unknown path.
  const pathname = requestPathname(req) ?? '/'
  const rel = tryDecode(pathname).replace(/^\/+/, '')
  const root = normalize(dir)
  const candidate = normalize(join(root, rel))
  const within = candidate === root || candidate.startsWith(root + sep)

  const target = within && rel && (await isFile(candidate)) ? candidate : join(root, 'index.html')
  const body = await readFile(target).catch(() => undefined)
  const facts = await stat(target).catch(() => undefined)
  if (body === undefined) {
    res.writeHead(404, { 'content-type': 'text/plain' })
    res.end('dashboard bundle not built')
    return
  }
  const type = contentTypeFor(target)
  // Only the fingerprinted files under `assets/` are immutable. Everything at a stable path
  // (index.html, the host files a module imports as `/host/*.js`) must always revalidate: a
  // browser that kept `/host/module.js` from the last version would hand every module a host
  // missing whatever the new version added, until its cache expired a year later.
  const cacheControl = target.startsWith(join(root, 'assets') + sep) ? 'public, max-age=31536000, immutable' : 'no-cache'
  // A file's packed copy is kept while the file is the same one.
  await sendBody(req, res, 200, { 'content-type': type, 'cache-control': cacheControl }, body, facts ? `${target} ${facts.mtimeMs} ${facts.size}` : undefined)
}

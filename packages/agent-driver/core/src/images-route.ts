import type { AppRoute } from '@openagt/hooks'
import { IMAGES_ROUTE } from './image-bounds.js'
import { imageMediaType, isImageName, readImage } from './images.js'

/**
 * The images kept on this computer, for a message box's tile and the chat's (`composer.images`'
 * `src`): `GET /_images/<name>`, by its name only, which is its content's hash, so it never changes
 * and is cached for good, and only a page that was shown the image's name can ask for it. A request
 * the browser says another site's page sent is refused: such a page cannot show the image either.
 */
export const imagesRoute: AppRoute = {
  path: IMAGES_ROUTE,
  async handle(req, res) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return void res.writeHead(405, { 'content-type': 'text/plain', allow: 'GET' }).end('images are read here')
    if (req.headers['sec-fetch-site'] === 'cross-site') return void res.writeHead(403, { 'content-type': 'text/plain' }).end('cross-site request forbidden')
    const name = nameIn(new URL(req.url ?? '/', 'http://localhost').pathname)
    const bytes = name !== undefined ? await readImage(name).catch(() => undefined) : undefined
    if (name === undefined || bytes === undefined) return void res.writeHead(404, { 'content-type': 'text/plain', 'cache-control': 'no-store' }).end('no such image on this computer')
    res.writeHead(200, { 'content-type': imageMediaType(name), 'content-length': bytes.length, 'cache-control': 'private, max-age=31536000, immutable', 'x-content-type-options': 'nosniff' })
    res.end(req.method === 'HEAD' ? undefined : bytes)
  },
}

/** The image's name a path past the route names: `/_images/<name>`; none for any other path. */
function nameIn(path: string): string | undefined {
  if (!path.startsWith(`${IMAGES_ROUTE}/`)) return undefined
  try {
    const name = decodeURIComponent(path.slice(IMAGES_ROUTE.length + 1))
    return isImageName(name) ? name : undefined
  } catch {
    return undefined
  }
}

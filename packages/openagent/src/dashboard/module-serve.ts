import { readFile, stat } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { join } from 'node:path'
import { fileTag, fileVersion, sendBody } from './compress.js'
import { contentTypeFor } from './content-type.js'
import { defaultProjectsProvider, type ProjectsProvider } from './projects.js'
import { moduleFile, type ProjectModule } from '@openagt/skill-ui'
import { findBroughtModule, findComputerModule, findProjectModule } from '../project-modules.js'

/** Where module files are served: `/_modules/<project id>/<package>/<file>`, each segment encoded. */
export const MODULES_PREFIX = '/_modules'

/** Where the files of the computer's modules are served, which are no project's: `/_computer-modules/<package>/<file>`. */
export const COMPUTER_MODULES_PREFIX = '/_computer-modules'

/** Where the files of the modules OpenAgent brings to projects are served from its own copy: `/_brought-modules/<package>/<file>`. */
export const BROUGHT_MODULES_PREFIX = '/_brought-modules'

const encoded = (path: string): string => path.split('/').map(encodeURIComponent).join('/')

/** The URL a module's browser part is served at from one project. */
export function moduleUrl(projectId: string, module: Pick<ProjectModule, 'package' | 'entry'>): string {
  return `${MODULES_PREFIX}/${encodeURIComponent(projectId)}/${encodeURIComponent(module.package)}/${encoded(module.entry)}`
}

/** The URL the browser part of one of the computer's modules is served at. */
export function computerModuleUrl(module: Pick<ProjectModule, 'package' | 'entry'>): string {
  return `${COMPUTER_MODULES_PREFIX}/${encodeURIComponent(module.package)}/${encoded(module.entry)}`
}

/** The URL the browser part of a module OpenAgent brings to projects is served at from its own copy. */
export function broughtModuleUrl(module: Pick<ProjectModule, 'package' | 'entry'>): string {
  return `${BROUGHT_MODULES_PREFIX}/${encodeURIComponent(module.package)}/${encoded(module.entry)}`
}

/**
 * A module's URL with its entry file's version (`?v=`): a browser keeps that file for good, and
 * the next version of the module is another URL. Without the file there to read, the URL as it is.
 */
export async function versionedModuleUrl(url: string, module: Pick<ProjectModule, 'dir' | 'entry'>): Promise<string> {
  const facts = await stat(join(module.dir, module.entry)).catch(() => undefined)
  return facts ? `${url}?v=${fileVersion(facts)}` : url
}

function decode(segment: string): string | undefined {
  try {
    return decodeURIComponent(segment)
  } catch {
    return undefined
  }
}

/**
 * Serve one module file (#1774): the project must be registered, the package must be a module of
 * that project, and the file must sit inside the module's browser part's own directory. Anything else is a
 * 404, never a fallback: a module URL is asked for by the dashboard's loader, not typed by a person.
 * Asked for with the file's own version ({@link versionedModuleUrl}), it is kept for good: a page
 * opened again does not ask for it at all. Otherwise it is served as `no-cache`, since a module is
 * rebuilt in place under the same name (its stylesheet, a file another of its files imports, a URL
 * naming a version gone since), with a tag of the file's own: a page opened again asks with it and
 * is answered "not changed", with no body. Sent gzipped, a module's code being a page's largest file.
 */
export async function serveModuleFile(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  projects: ProjectsProvider = defaultProjectsProvider(),
): Promise<void> {
  const [projectSegment, ...rest] = pathname.slice(MODULES_PREFIX.length + 1).split('/')
  const projectId = projectSegment !== undefined ? decode(projectSegment) : undefined
  return serveFileOf(req, res, rest, async pkg => {
    const root = projectId ? await projects.resolvePath(projectId) : undefined
    return root ? findProjectModule(root, pkg) : undefined
  })
}

/** Serve one file of a module that is the computer's: as {@link serveModuleFile}, with no project to be registered. */
export async function serveComputerModuleFile(req: IncomingMessage, res: ServerResponse, pathname: string): Promise<void> {
  return serveFileOf(req, res, pathname.slice(COMPUTER_MODULES_PREFIX.length + 1).split('/'), findComputerModule)
}

/** Serve one file of a module OpenAgent brings to projects, from its own copy: as {@link serveComputerModuleFile}. */
export async function serveBroughtModuleFile(req: IncomingMessage, res: ServerResponse, pathname: string): Promise<void> {
  return serveFileOf(req, res, pathname.slice(BROUGHT_MODULES_PREFIX.length + 1).split('/'), findBroughtModule)
}

/** Answer the file `<package>/<file>` names, of the module `find` knows the package as. */
async function serveFileOf(req: IncomingMessage, res: ServerResponse, [packageSegment, ...rest]: string[], find: (pkg: string) => Promise<ProjectModule | undefined>): Promise<void> {
  const notFound = () => void res.writeHead(404, { 'content-type': 'text/plain' }).end('no such module file')
  if (req.method !== 'GET' && req.method !== 'HEAD') return void res.writeHead(405, { allow: 'GET, HEAD' }).end()
  const pkg = packageSegment !== undefined ? decode(packageSegment) : undefined
  const rel = rest.map(decode)
  if (!pkg || rel.length === 0 || rel.some(part => part === undefined)) return notFound()
  const module = await find(pkg).catch(() => undefined)
  const file = module ? await moduleFile(module, rel.join('/')) : undefined
  const facts = file ? await stat(file).catch(() => undefined) : undefined
  const body = file && facts ? await readFile(file).catch(() => undefined) : undefined
  if (!file || !facts || body === undefined) return notFound()
  const asked = new URL(req.url ?? '/', 'http://x').searchParams.get('v')
  const cacheControl = asked === fileVersion(facts) ? 'public, max-age=31536000, immutable' : 'no-cache'
  const headers = { 'content-type': contentTypeFor(file), 'cache-control': cacheControl, etag: fileTag(facts) }
  if (req.method === 'HEAD') return void res.writeHead(200, headers).end()
  await sendBody(req, res, 200, headers, body, `${file} ${facts.mtimeMs} ${facts.size}`)
}

import { readFile, stat } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { fileTag, sendBody } from './compress.js'
import { contentTypeFor } from './content-type.js'
import { defaultProjectsProvider, type ProjectsProvider } from './projects.js'
import { findComputerModule, findProjectModule, moduleFile, type ProjectModule } from '../project-modules.js'

/** Where module files are served: `/_modules/<project id>/<package>/<file>`, each segment encoded. */
export const MODULES_PREFIX = '/_modules'

/** Where the files of the computer's modules are served, which are no project's: `/_computer-modules/<package>/<file>`. */
export const COMPUTER_MODULES_PREFIX = '/_computer-modules'

const encoded = (path: string): string => path.split('/').map(encodeURIComponent).join('/')

/** The URL a module's browser part is served at from one project. */
export function moduleUrl(projectId: string, module: Pick<ProjectModule, 'package' | 'entry'>): string {
  return `${MODULES_PREFIX}/${encodeURIComponent(projectId)}/${encodeURIComponent(module.package)}/${encoded(module.entry)}`
}

/** The URL the browser part of one of the computer's modules is served at. */
export function computerModuleUrl(module: Pick<ProjectModule, 'package' | 'entry'>): string {
  return `${COMPUTER_MODULES_PREFIX}/${encodeURIComponent(module.package)}/${encoded(module.entry)}`
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
 * Served as `no-cache`, since a module is rebuilt in place under the same name, with a tag of the
 * file's own: a page opened again asks with it and is answered "not changed", with no body. Sent
 * gzipped, a module's code being a page's largest file.
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
  const headers = { 'content-type': contentTypeFor(file), 'cache-control': 'no-cache', etag: fileTag(facts) }
  if (req.method === 'HEAD') return void res.writeHead(200, headers).end()
  await sendBody(req, res, 200, headers, body, `${file} ${facts.mtimeMs} ${facts.size}`)
}

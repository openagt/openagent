import { readFile, stat } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { createHash } from 'node:crypto'
import { dirname, join, relative } from 'node:path'
import { fileTag, fileVersion, sendBody } from './compress.js'
import { contentTypeFor } from './content-type.js'
import { compilePageSheet, dashboardStylesVersion, type SheetPart } from './page-styles.js'
import { defaultProjectsProvider, type ProjectsProvider } from './projects.js'
import { findBroughtModule, findComputerModule, findProjectModule, moduleFile, type ProjectModule } from '../project-modules.js'

/** Where module files are served: `/_modules/<project id>/<package>/<file>`, each segment encoded. */
export const MODULES_PREFIX = '/_modules'

/** Where the files of the computer's modules are served, which are no project's: `/_computer-modules/<package>/<file>`. */
export const COMPUTER_MODULES_PREFIX = '/_computer-modules'

/** Where the files of the modules OpenAgent brings to projects are served from its own copy: `/_brought-modules/<package>/<file>`. */
export const BROUGHT_MODULES_PREFIX = '/_brought-modules'

/**
 * Where the page sheet is served: `/_styles/page.css?v=<the dashboard's version>&m=<module URL>…`,
 * the dashboard's own classes and the listed modules' compiled as one sheet (page-styles.ts).
 */
export const PAGE_SHEET_PATH = '/_styles/page.css'

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
 * that project (or, under its own prefix, the computer's, or one OpenAgent brings to projects, from
 * its own copy), and the file must sit inside the module's browser part's own directory. Anything else is a
 * 404, never a fallback: a module URL is asked for by the dashboard's loader, not typed by a person.
 * Asked for with the file's own version ({@link versionedModuleUrl}), it is kept for good: a page
 * opened again does not ask for it at all. Otherwise it is served as `no-cache`, since a module is
 * rebuilt in place under the same name (its class list, a file another of its files imports, a URL
 * naming a version gone since), with a tag of the file's own: a page opened again asks with it and
 * is answered "not changed", with no body. Sent gzipped, a module's code being a page's largest file.
 */
export async function serveModuleFile(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  projects: ProjectsProvider = defaultProjectsProvider(),
): Promise<void> {
  return serveFileOf(req, res, () => moduleFileAt(pathname, projects))
}

/**
 * The file a module URL's path names, by the prefix it is served under: `<package>/<file>` of the
 * module that package is to that project, to the computer, or of OpenAgent's own copy.
 */
async function moduleFileAt(pathname: string, projects: ProjectsProvider): Promise<{ module: ProjectModule; file: string } | undefined> {
  const after = (prefix: string) => pathname.slice(prefix.length + 1).split('/')
  if (pathname.startsWith(`${COMPUTER_MODULES_PREFIX}/`)) return fileOf(after(COMPUTER_MODULES_PREFIX), findComputerModule)
  if (pathname.startsWith(`${BROUGHT_MODULES_PREFIX}/`)) return fileOf(after(BROUGHT_MODULES_PREFIX), findBroughtModule)
  if (!pathname.startsWith(`${MODULES_PREFIX}/`)) return undefined
  const [projectSegment, ...rest] = after(MODULES_PREFIX)
  const projectId = projectSegment !== undefined ? decode(projectSegment) : undefined
  return fileOf(rest, async pkg => {
    const root = projectId ? await projects.resolvePath(projectId) : undefined
    return root ? findProjectModule(root, pkg) : undefined
  })
}

/** The file `<package>/<file>` names, of the module `find` knows the package as. */
async function fileOf([packageSegment, ...rest]: string[], find: (pkg: string) => Promise<ProjectModule | undefined>): Promise<{ module: ProjectModule; file: string } | undefined> {
  const pkg = packageSegment !== undefined ? decode(packageSegment) : undefined
  const rel = rest.map(decode)
  if (!pkg || rel.length === 0 || rel.some(part => part === undefined)) return undefined
  const module = await find(pkg).catch(() => undefined)
  const file = module ? await moduleFile(module, rel.join('/')) : undefined
  return module && file ? { module, file } : undefined
}

/** Answer the module file `found` finds. */
async function serveFileOf(req: IncomingMessage, res: ServerResponse, found: () => Promise<{ file: string } | undefined>): Promise<void> {
  const notFound = () => void res.writeHead(404, { 'content-type': 'text/plain' }).end('no such module file')
  if (req.method !== 'GET' && req.method !== 'HEAD') return void res.writeHead(405, { allow: 'GET, HEAD' }).end()
  const file = (await found())?.file
  const facts = file ? await stat(file).catch(() => undefined) : undefined
  const body = file && facts ? await readFile(file).catch(() => undefined) : undefined
  if (!file || !facts || body === undefined) return notFound()
  const asked = new URL(req.url ?? '/', 'http://x').searchParams.get('v')
  const cacheControl = asked === fileVersion(facts) ? 'public, max-age=31536000, immutable' : 'no-cache'
  const headers = { 'content-type': contentTypeFor(file), 'cache-control': cacheControl, etag: fileTag(facts) }
  if (req.method === 'HEAD') return void res.writeHead(200, headers).end()
  await sendBody(req, res, 200, headers, body, `${file} ${facts.mtimeMs} ${facts.size}`)
}

/**
 * Serve the page sheet (#1774): the dashboard's class list (`classes.txt` in its bundle, with the
 * vocabulary it was built against) and every listed module's, beside its browser module, compiled
 * as one sheet. Asked for with the dashboard's version and every module's (in its URL's `v`), it is
 * kept for good, as a module file is; a module no longer there is left out, and the sheet is then
 * `no-cache`. A module whose own rules would change the vocabulary is refused, by name.
 */
export async function servePageSheet(req: IncomingMessage, res: ServerResponse, bundleDir: string, projects: ProjectsProvider = defaultProjectsProvider()): Promise<void> {
  if (req.method !== 'GET' && req.method !== 'HEAD') return void res.writeHead(405, { allow: 'GET, HEAD' }).end()
  const asked = new URL(req.url ?? '/', 'http://x').searchParams
  const [vocabulary, classes] = await Promise.all([readFile(join(bundleDir, 'vocabulary.css'), 'utf8'), readFile(join(bundleDir, 'classes.txt'), 'utf8')])
  let kept = asked.get('v') === dashboardStylesVersion(vocabulary, classes)
  const parts: SheetPart[] = [{ module: '@openagt/dashboard', classes }]
  for (const url of asked.getAll('m')) {
    const at = new URL(url, 'http://x')
    const found = await moduleFileAt(at.pathname, projects)
    const facts = found ? await stat(found.file).catch(() => undefined) : undefined
    kept &&= facts !== undefined && at.searchParams.get('v') === fileVersion(facts)
    if (!found) continue
    const beside = (name: string) => moduleFile(found.module, join(dirname(relative(found.module.dir, found.file)), name)).then(file => (file ? readFile(file, 'utf8') : undefined))
    const [list, rules] = await Promise.all([beside('classes.txt'), beside('styles.css')])
    parts.push({ module: found.module.package, classes: list ?? '', ...(rules !== undefined ? { rules } : {}) })
  }
  let sheet: string
  try {
    sheet = await compilePageSheet(vocabulary, parts)
  } catch (error) {
    return void res.writeHead(500, { 'content-type': 'text/plain' }).end(error instanceof Error ? error.message : String(error))
  }
  const etag = `"${createHash('sha256').update(sheet).digest('base64url').slice(0, 16)}"`
  const headers = { 'content-type': 'text/css; charset=utf-8', 'cache-control': kept ? 'public, max-age=31536000, immutable' : 'no-cache', etag }
  if (req.method === 'HEAD') return void res.writeHead(200, headers).end()
  await sendBody(req, res, 200, headers, sheet, etag)
}

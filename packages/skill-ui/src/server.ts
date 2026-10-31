import { readFile, stat } from 'node:fs/promises'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { homedir } from 'node:os'
import { basename, extname, join, normalize, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { projectPackages } from '@openagt/agent-data'
import { moduleFile, readModule, runModuleCommand, type ProjectModule } from './modules.js'

// The page of one folder's skills: their cards, and the commands those cards run. On this computer
// alone: it listens on the loopback address, answers only a `Host` naming it (a site that rebinds
// its own name to this address names itself there), and runs a command only when asked by its own
// page, and only one its package declares.

/** A skill of the folder with a browser part, as the page loads it. */
export interface PageModule {
  package: string
  url: string
}

/** What the page reads first. */
export interface PageFolder {
  /** The folder, as the one project a card is given. */
  project: { id: string; name: string; gitHost: boolean }
  modules: PageModule[]
}

/** What a card asks the page to run. */
interface RunAsked {
  package?: unknown
  args?: unknown
  command?: unknown
  input?: unknown
  /** Run in the person's home folder, as what a package keeps for the whole computer, rather than in the folder. */
  computer?: unknown
}

/** The id the folder goes by: there is only one. */
const FOLDER_ID = 'folder'
/** Where the built page is. */
const PAGE_DIR = fileURLToPath(new URL('./page/', import.meta.url))
const MODULES_PREFIX = '/_skill/module/'
/** A command line, not a payload. */
const MAX_BODY = 1024 * 1024

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
}
const contentType = (file: string): string => CONTENT_TYPES[extname(file)] ?? 'application/octet-stream'

/** The skills of the folder that have a browser part. */
async function folderModules(root: string): Promise<ProjectModule[]> {
  const modules = await Promise.all((await projectPackages(root)).map(readModule))
  return modules.filter(module => module !== undefined).sort((a, b) => a.package.localeCompare(b.package))
}

/** Whether a `Host` header names the loopback address this page listens on: the exact port, so another page of this computer is no way in either. */
export function isOwnHost(host: string | undefined, port: number): boolean {
  return host === `127.0.0.1:${port}` || host === `localhost:${port}`
}

/** Whether a request to run a command comes from the page itself: a browser says where a call comes from, and any other site is refused. */
function fromOwnPage(req: IncomingMessage): boolean {
  return req.headers.origin === `http://${req.headers.host}` && (req.headers['content-type'] ?? '').startsWith('application/json')
}

function json(res: ServerResponse, status: number, value: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }).end(JSON.stringify(value))
}

async function readBody(req: IncomingMessage): Promise<string | undefined> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length
    if (size > MAX_BODY) return undefined
    chunks.push(chunk)
  }
  return Buffer.concat(chunks).toString('utf8')
}

async function run(req: IncomingMessage, res: ServerResponse, root: string): Promise<void> {
  if (!fromOwnPage(req)) return json(res, 403, { ok: false, error: 'only the page itself runs commands' })
  const body = await readBody(req)
  let asked: RunAsked
  try {
    asked = JSON.parse(body ?? '') as RunAsked
  } catch {
    return json(res, 400, { ok: false, error: 'not a request' })
  }
  const { args, command, input } = asked
  if (!Array.isArray(args) || args.some(arg => typeof arg !== 'string')) return json(res, 400, { ok: false, error: 'arguments must be a list of words' })
  const module = (await folderModules(root)).find(each => each.package === asked.package)
  if (!module) return json(res, 404, { ok: false, error: `${String(asked.package)} is no skill of this folder` })
  json(res, 200, await runModuleCommand(asked.computer === true ? homedir() : root, module, args as string[], typeof command === 'string' ? command : undefined, undefined, typeof input === 'string' ? input : undefined))
}

async function sendFile(res: ServerResponse, file: string | undefined): Promise<void> {
  const body = file ? await readFile(file).catch(() => undefined) : undefined
  if (!file || body === undefined) return void res.writeHead(404, { 'content-type': 'text/plain' }).end('no such file')
  res.writeHead(200, { 'content-type': contentType(file), 'cache-control': 'no-cache' }).end(body)
}

/** One file of a skill's browser part: only from the directory that part sits in. */
async function moduleAsset(res: ServerResponse, root: string, pathname: string): Promise<void> {
  const [packageSegment, ...rest] = pathname.slice(MODULES_PREFIX.length).split('/')
  let pkg: string
  let rel: string
  try {
    pkg = decodeURIComponent(packageSegment ?? '')
    rel = rest.map(decodeURIComponent).join('/')
  } catch {
    return sendFile(res, undefined)
  }
  const module = (await folderModules(root)).find(each => each.package === pkg)
  return sendFile(res, module ? await moduleFile(module, rel) : undefined)
}

/** One file of the page itself; the page for `/`. */
async function pageFile(res: ServerResponse, pathname: string, dir: string): Promise<void> {
  const file = normalize(join(dir, pathname === '/' ? 'index.html' : pathname))
  const inside = file.startsWith(dir.endsWith(sep) ? dir : dir + sep)
  const found = inside && (await stat(file).then(s => s.isFile(), () => false))
  return sendFile(res, found ? file : undefined)
}

/** The server of the page of the folder at `root`, not yet listening. `pageDir` is the built page, for tests. */
export function pageServer(root: string, pageDir: string = PAGE_DIR): Server {
  const server = createServer((req, res) => {
    const address = server.address()
    const port = address && typeof address === 'object' ? address.port : 0
    if (!isOwnHost(req.headers.host, port)) return void res.writeHead(403, { 'content-type': 'text/plain' }).end('not this page')
    const { pathname } = new URL(req.url ?? '/', 'http://localhost')
    const answer = async (): Promise<void> => {
      if (pathname === '/_skill/folder' && req.method === 'GET') {
        const modules = await folderModules(root)
        const folder: PageFolder = {
          project: { id: FOLDER_ID, name: basename(root) || root, gitHost: false },
          modules: modules.map(module => ({ package: module.package, url: `${MODULES_PREFIX}${encodeURIComponent(module.package)}/${module.entry.split('/').map(encodeURIComponent).join('/')}` })),
        }
        return json(res, 200, folder)
      }
      if (pathname === '/_skill/run' && req.method === 'POST') return run(req, res, root)
      if (req.method !== 'GET') return void res.writeHead(405, { allow: 'GET' }).end()
      if (pathname.startsWith(MODULES_PREFIX)) return moduleAsset(res, root, pathname)
      return pageFile(res, pathname, pageDir)
    }
    answer().catch((error: unknown) => {
      if (!res.headersSent) json(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) })
      else res.destroy()
    })
  })
  return server
}

import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { DATA_BRANCH, nodeGitRunner } from '@openagt/git-branches'
import { writeSharing } from '@openagt/store-filesystem'
import type { FetchLike } from './actions.js'

// What the tests work with: a GitHub that answers the REST calls a run's turns make, from what a
// test says (#610), and a project whose runs' records are kept where a real one keeps them.

/**
 * A real `claude-code-action@v1` `execution_file`, trimmed: the same SDKMessage objects the
 * CLI prints one per line, wrapped in an array. That array-vs-JSONL difference is the entire
 * adapter, which is what makes this host cheap.
 */
export const EXECUTION = JSON.stringify([
  { type: 'system', subtype: 'init', session_id: 'sess-abc' },
  { type: 'assistant', session_id: 'sess-abc', message: { content: [{ type: 'text', text: 'Adding the flag.' }] } },
  { type: 'assistant', session_id: 'sess-abc', message: { content: [{ type: 'tool_use', name: 'Edit' }] } },
  {
    type: 'result',
    subtype: 'success',
    session_id: 'sess-abc',
    result: 'Added the --verbose flag.',
    total_cost_usd: 0.42,
    usage: { input_tokens: 120, output_tokens: 30, cache_read_input_tokens: 900, cache_creation_input_tokens: 40 },
  },
])

/** A minimal stored (uncompressed) zip, which is what the artifact download returns. */
export function makeZip(files: { name: string; body: string }[]): Buffer {
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0
  for (const file of files) {
    const data = Buffer.from(file.body, 'utf8')
    const name = Buffer.from(file.name, 'utf8')
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(name.length, 26)
    locals.push(local, name, data)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt32LE(data.length, 20)
    central.writeUInt32LE(data.length, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt32LE(offset, 42)
    centrals.push(central, name)
    offset += local.length + name.length + data.length
  }
  const centralBytes = Buffer.concat(centrals)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(files.length, 8)
  eocd.writeUInt16LE(files.length, 10)
  eocd.writeUInt32LE(centralBytes.length, 12)
  eocd.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, centralBytes, eocd])
}

export interface Call {
  url: string
  method: string
  body: unknown
}

export interface FakeOptions {
  /** Statuses the run reports on successive polls. Default: completed straight away. */
  agents?: { status: string; conclusion?: string }[]
  execution?: string
  meta?: string
  /** Files the contents API serves, by path. */
  contents?: Record<string, string>
  /** Whether the repository has the workflow, as its page in the API says. Default: it has. */
  workflow?: boolean
  /** Told each call before it is answered: what a test reads of the world at that moment. */
  onCall?: (call: Call) => Promise<void>
}

/** A GitHub REST double that records every call. */
export function fakeGitHub(opts: FakeOptions = {}): { fetch: FetchLike; calls: Call[] } {
  const calls: Call[] = []
  const agents = opts.agents ?? [{ status: 'completed', conclusion: 'success' }]
  let poll = 0

  const json = (body: unknown): Response => ({ ok: true, status: 200, statusText: 'OK', json: async () => body }) as unknown as Response

  const fetch: FetchLike = async (url, init = {}) => {
    const method = init.method ?? 'GET'
    const call = { url, method, body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined }
    calls.push(call)
    await opts.onCall?.(call)

    if (url.includes('/dispatches')) return { ok: true, status: 204, statusText: 'No Content' } as unknown as Response

    if (/\/actions\/workflows\/[^/]+$/.test(url)) {
      if (opts.workflow === false) return { ok: false, status: 404, statusText: 'Not Found', text: async () => 'Not Found' } as unknown as Response
      return json({ id: 9, path: '.github/workflows/openagent-agent.yml', state: 'active' })
    }

    if (url.endsWith('/cancel')) return { ok: true, status: 202, statusText: 'Accepted' } as unknown as Response

    if (url.includes('/actions/runs?')) {
      const state = agents[Math.min(poll++, agents.length - 1)]!
      // The run we are looking for is the one the *latest* dispatch created, not the first:
      // a second turn polls for its own correlation id, never the previous turn's.
      const correlation = calls.filter(c => c.url.includes('/dispatches')).at(-1)?.body as { inputs?: { correlation_id?: string } } | undefined
      return json({
        workflow_runs: [
          { id: 77, name: `agent ${correlation?.inputs?.correlation_id}`, status: state.status, conclusion: state.conclusion ?? null, html_url: 'https://github.com/o/r/actions/runs/77' },
        ],
      })
    }

    if (url.includes('/artifacts') && !url.endsWith('/zip')) return json({ artifacts: [{ id: 5, name: 'run-actions-1-turn-1' }] })

    if (url.endsWith('/zip')) {
      const zip = makeZip([
        { name: 'execution.json', body: opts.execution ?? EXECUTION },
        { name: 'meta.json', body: opts.meta ?? JSON.stringify({ branch: 'claude/issue-610', session_id: 'sess-abc' }) },
      ])
      return { ok: true, status: 200, statusText: 'OK', arrayBuffer: async () => zip.buffer.slice(zip.byteOffset, zip.byteOffset + zip.byteLength) } as unknown as Response
    }

    if (url.includes('/contents/')) {
      const path = decodeURIComponent(url.split('/contents/')[1]!.split('?')[0]!)
      const body = opts.contents?.[path]
      if (body === undefined) return { ok: false, status: 404, statusText: 'Not Found', text: async () => 'not found' } as unknown as Response
      return json({ content: Buffer.from(body, 'utf8').toString('base64'), encoding: 'base64' })
    }

    throw new Error(`unexpected call: ${url}`)
  }
  return { fetch, calls }
}

const git = nodeGitRunner()

/**
 * A project for the tests: one commit on `main`, a bare `origin`, the `agent-data` branch born on
 * origin, its records shared. Real git, because the records are.
 */
export async function testRepo(): Promise<string> {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'host-github-actions-')))
  const repo = join(base, 'repo')
  const origin = join(base, 'origin.git')
  await mkdir(repo)
  await git(['init', '-q', '-b', 'main'], repo)
  await git(['config', 'user.email', 'tester@example.com'], repo)
  await git(['config', 'user.name', 'tester'], repo)
  await writeFile(join(repo, 'README.md'), '# t\n')
  await git(['add', '-A'], repo)
  await git(['commit', '-q', '-m', 'init'], repo)
  await git(['init', '-q', '--bare', origin], base)
  await git(['remote', 'add', 'origin', origin], repo)
  await git(['push', '-q', '-u', 'origin', 'main'], repo)
  const tree = (await git(['hash-object', '-t', 'tree', '/dev/null'], repo)).trim()
  const commit = (await git(['commit-tree', tree, '-m', `create the ${DATA_BRANCH} branch`], repo)).trim()
  await git(['push', '-q', 'origin', `${commit}:refs/heads/${DATA_BRANCH}`], repo)
  await git(['fetch', '-q', 'origin'], repo)
  await writeSharing(repo, true)
  return repo
}

/** The repository and its origin go together. */
export async function removeRepo(repo: string): Promise<void> {
  await rm(dirname(repo), { recursive: true, force: true, maxRetries: 10 })
}

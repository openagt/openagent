import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { act, read, rpcKind, type ComputerRpcClient, type RpcClient, type RpcComputerHost, type RpcHost } from './rpc.js'
import { computerRpcHost, memorySettings, rpcHost } from './testing.js'

const SETTINGS = memorySettings()
const HOST: RpcHost = rpcHost({ settings: SETTINGS, root: '/work/shop', run: async () => undefined, mergeCommit: async () => ({ pending: false }) })

// A module's server part, as a UI part's client is typed by it.
const server = {
  files: read(async (host: RpcHost, input: { path?: string }) => [host.root, input.path ?? '.']),
  claim: act(async (_host: RpcHost, input: { id: string }) => ({ claimed: input.id })),
  helper: (x: number) => x + 1,
}

test('a function says whether it only reads or changes something, and is called as it was written', async () => {
  assert.equal(rpcKind(server.files), 'read')
  assert.equal(rpcKind(server.claim), 'act')
  assert.deepEqual(await server.files(HOST, { path: 'src' }), ['/work/shop', 'src'])
  assert.deepEqual(await server.claim(HOST, { id: 't1' }), { claimed: 't1' })
  // Anything else a server file exports is no function to call: a plain function, a value, a function that says another word.
  for (const other of [server.helper, 'read', { rpc: 'read' }, Object.assign(() => 1, { rpc: 'write' }), undefined]) assert.equal(rpcKind(other), undefined)
})

test("a client is typed by the server file: each function by its name, in a project, with the function's own input and answer", async () => {
  const calls: unknown[] = []
  const client = new Proxy({}, { get: (_target, name) => async (projectId: string, input: unknown) => (calls.push([name, projectId, input]), name === 'files' ? ['x'] : { claimed: 'y' }) }) as RpcClient<typeof server>
  const files: unknown[] = await client.files('shop-1', { path: 'src' })
  const claimed: { claimed: string } = await client.claim('shop-1', { id: 't1' })
  assert.deepEqual([files, claimed], [['x'], { claimed: 'y' }])
  assert.deepEqual(calls, [['files', 'shop-1', { path: 'src' }], ['claim', 'shop-1', { id: 't1' }]])
  // @ts-expect-error a plain function of the file is no function of the client
  void client.helper
  // @ts-expect-error the input is the function's own
  void client.claim('shop-1', { path: 'src' })
})

test("a module of the computer's is called in no project: its client takes the input alone, and leaves out a function that needs a project", async () => {
  const computer = {
    pace: read(async (host: RpcComputerHost, _input: object) => host.settings === SETTINGS),
    rename: act(async (_host: RpcComputerHost, input: { name: string }) => input.name.toUpperCase()),
    files: server.files,
  }
  assert.equal(await computer.pace(computerRpcHost({ settings: SETTINGS }), {}), true)
  const calls: unknown[] = []
  const client = new Proxy({}, { get: (_target, name) => async (input: unknown) => (calls.push([name, input]), name === 'pace' ? true : 'ADA') }) as ComputerRpcClient<typeof computer>
  const pace: boolean = await client.pace({})
  const renamed: string = await client.rename({ name: 'ada' })
  assert.deepEqual([pace, renamed, calls], [true, 'ADA', [['pace', {}], ['rename', { name: 'ada' }]]])
  // @ts-expect-error a function that reads a project's folder is called in a project
  void client.files
})

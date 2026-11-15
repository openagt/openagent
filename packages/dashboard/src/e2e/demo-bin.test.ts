import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { execFile } from 'node:child_process'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { fileURLToPath } from 'node:url'

const BIN = fileURLToPath(new URL('./demo-bin.js', import.meta.url))

/** `pnpm demo` with `args`: its exit code and what it said. */
function demo(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise(resolve => {
    execFile(process.execPath, [BIN, ...args], (error, stdout, stderr) => resolve({ code: error ? Number(error.code) : 0, stdout, stderr }))
  })
}

test('a port another program holds is said in the dashboard’s words, with no stack', async () => {
  const other = createServer((_req, res) => res.writeHead(200, { 'content-type': 'text/html' }).end('<html>a dev server</html>'))
  await new Promise<void>(resolve => other.listen(0, '127.0.0.1', resolve))
  const { port } = other.address() as AddressInfo
  try {
    const { code, stdout, stderr } = await demo(['--port', String(port)])
    assert.equal(code, 1)
    assert.equal(stdout, 'Starting the demo…\n')
    assert.match(stderr, new RegExp(`port ${port} is taken by another program\\. Pass --port <n> to use another one\\.`))
    assert.doesNotMatch(stderr, /^\s+at /m)
  } finally {
    await new Promise(resolve => other.close(resolve))
  }
})

test('an argument the demo cannot read is named, then the usage', async () => {
  for (const [args, refused] of [
    [['--bogus'], 'unknown option: --bogus'],
    [['--port', 'abc'], 'invalid --port: must be a port number from 0 to 65535'],
    [['--port', '4300', 'shop'], 'unknown command: shop'],
  ] as const) {
    const { code, stdout, stderr } = await demo([...args])
    assert.equal(code, 2, args.join(' '))
    assert.equal(stdout, '')
    assert.match(stderr, new RegExp(`^${refused}\\n\\nUsage: pnpm demo `), args.join(' '))
  }
})

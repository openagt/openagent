import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { builtInServices } from './built-in.js'
import { startPackageServices } from './package-services.js'

/** Wait until `read` answers something; fails after five seconds. */
async function eventually<T>(read: () => Promise<T | undefined>): Promise<T> {
  const deadline = Date.now() + 5_000
  for (;;) {
    const value = await read().catch(() => undefined)
    if (value !== undefined) return value
    if (Date.now() > deadline) assert.fail('it never happened')
    await new Promise(resolve => setTimeout(resolve, 20))
  }
}

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/** A service that writes down how it was started, then runs until told to end. */
async function service(dir: string, body = 'setInterval(() => {}, 1000)'): Promise<string> {
  const bin = join(dir, 'service.mjs')
  await writeFile(bin, `import { appendFileSync } from 'node:fs'\nappendFileSync(${JSON.stringify(join(dir, 'started'))}, JSON.stringify({ pid: process.pid, args: process.argv.slice(2), url: process.env.OPENAGENT_URL, home: process.env.XDG_CONFIG_HOME }) + '\\n')\nconsole.error('service: up')\n${body}\n`)
  return bin
}

const starts = async (dir: string): Promise<{ pid: number; args: string[]; url: string; home: string }[]> =>
  (await readFile(join(dir, 'started'), 'utf8')).trim().split('\n').map(line => JSON.parse(line) as { pid: number; args: string[]; url: string; home: string })

test('a declared service runs `serve`, is told where OpenAgent is, and ends with it', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'package-services-'))
  const log: string[] = []
  const services = startPackageServices({ commands: [{ package: 'a-package', name: 'a-command', bin: await service(dir) }], url: 'http://127.0.0.1:4200', env: { XDG_CONFIG_HOME: '/a/home' }, log: line => log.push(line) })
  try {
    const [started] = await eventually(async () => starts(dir))
    assert.deepEqual({ ...started, pid: 0 }, { pid: 0, args: ['serve'], url: 'http://127.0.0.1:4200', home: '/a/home' })
    await eventually(async () => (log.includes('service: up') ? true : undefined))
    assert.equal(alive(started!.pid), true)
    await services.stop()
    assert.equal(alive(started!.pid), false)
    assert.equal((await starts(dir)).length, 1, 'ended on purpose, it is not started again')
  } finally {
    await services.stop()
    await rm(dir, { recursive: true, force: true })
  }
})

test('a service that ends by itself is started again, and not once OpenAgent has ended', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'package-services-'))
  const log: string[] = []
  const services = startPackageServices({ commands: [{ package: 'a-package', name: 'a-command', bin: await service(dir, 'process.exit(3)') }], url: 'http://127.0.0.1:4200', env: {}, log: line => log.push(line), restartMs: 30 })
  try {
    await eventually(async () => ((await starts(dir)).length >= 3 ? true : undefined))
    assert.ok(log.includes('a-package: its service ended (exit 3); it is started again shortly'))
    await services.stop()
    const count = (await starts(dir)).length
    await new Promise(resolve => setTimeout(resolve, 150))
    assert.equal((await starts(dir)).length, count)
  } finally {
    await services.stop()
    await rm(dir, { recursive: true, force: true })
  }
})

test('no service declared, nothing runs', async () => {
  const services = startPackageServices({ commands: [], url: 'http://127.0.0.1:4200', env: {}, log: () => assert.fail('nothing to say') })
  await services.stop()
})

test('the services OpenAgent brings are the ones its every-project packages declare', async () => {
  assert.deepEqual((await builtInServices()).map(command => [command.package, command.name]), [['@openagt/remote-access', 'remote-access']])
})

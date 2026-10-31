import assert from 'node:assert/strict'
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import type { Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, test } from 'node:test'
import { isOwnHost, pageServer } from './server.js'

let root: string
let server: Server
let origin: string

/** A folder with one skill that has a card and a command, one package with no browser part, and a built page. */
before(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'skill-ui-')))
  const skill = join(root, 'node_modules', 'a-skill')
  await mkdir(join(skill, 'dist'), { recursive: true })
  await writeFile(join(skill, 'package.json'), JSON.stringify({ name: 'a-skill', bin: { 'a-skill': 'cmd.mjs' }, exports: { './dashboard': './dist/card.js' } }))
  await writeFile(join(skill, 'cmd.mjs'), `console.log(JSON.stringify({ args: process.argv.slice(2), cwd: process.cwd() }))\n`)
  await writeFile(join(skill, 'secret.txt'), 'not served')
  await writeFile(join(skill, 'dist', 'card.js'), 'export default {}\n')
  const plain = join(root, 'node_modules', 'plain')
  await mkdir(plain, { recursive: true })
  await writeFile(join(plain, 'package.json'), JSON.stringify({ name: 'plain', bin: { plain: 'cmd.mjs' } }))
  await writeFile(join(plain, 'cmd.mjs'), `console.log('{}')\n`)
  await writeFile(join(root, 'package.json'), JSON.stringify({ dependencies: { 'a-skill': '1.0.0', plain: '1.0.0' } }))
  const page = join(root, 'page')
  await mkdir(page)
  await writeFile(join(page, 'index.html'), '<!doctype html>the page')
  await writeFile(join(root, 'outside.txt'), 'not served')
  await symlink(join(root, 'outside.txt'), join(page, 'link.txt'))
  server = pageServer(root, page)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  origin = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`
})

after(async () => {
  await new Promise(resolve => server.close(resolve))
  await rm(root, { recursive: true, force: true })
})

const run = (body: unknown, headers: Record<string, string> = { origin, 'content-type': 'application/json' }): Promise<Response> => fetch(`${origin}/_skill/run`, { method: 'POST', headers, body: JSON.stringify(body) })

test('the folder lists its skills with a browser part, as its one project', async () => {
  const folder = (await (await fetch(`${origin}/_skill/folder`)).json()) as { project: { name: string }; modules: { package: string; url: string }[] }
  assert.equal(folder.project.name, root.split('/').at(-1))
  assert.deepEqual(folder.modules, [{ package: 'a-skill', url: '/_skill/module/a-skill/card.js' }])
})

test('it serves the page and a skill\'s browser part, and nothing beside them', async () => {
  assert.equal(await (await fetch(`${origin}/`)).text(), '<!doctype html>the page')
  assert.equal((await fetch(`${origin}/_skill/module/a-skill/card.js`)).status, 200)
  assert.equal((await fetch(`${origin}/_skill/module/a-skill/..%2Fsecret.txt`)).status, 404)
  assert.equal((await fetch(`${origin}/_skill/module/plain/cmd.mjs`)).status, 404)
  assert.equal((await fetch(`${origin}/_skill/module/%E0%A4%A/card.js`)).status, 404)
  assert.equal((await fetch(`${origin}/%2e%2e/outside.txt`)).status, 404)
})

test('a card runs its package\'s command, in the folder or for the computer', async () => {
  const inFolder = (await (await run({ package: 'a-skill', args: ['list'] })).json()) as { ok: true; output: { args: string[]; cwd: string } }
  assert.deepEqual(inFolder.output, { args: ['list'], cwd: root })
  const forComputer = (await (await run({ package: 'a-skill', args: [], computer: true })).json()) as { ok: true; output: { cwd: string } }
  assert.notEqual(forComputer.output.cwd, root)
})

test('it refuses a command no skill of the folder declares', async () => {
  assert.deepEqual(await (await run({ package: 'left-pad', args: [] })).json(), { ok: false, error: 'left-pad is no skill of this folder' })
  assert.deepEqual(await (await run({ package: 'plain', args: [] })).json(), { ok: false, error: 'plain is no skill of this folder' })
  assert.deepEqual(await (await run({ package: 'a-skill', args: [], command: '../../evil' })).json(), { ok: false, error: 'a-skill has no command ../../evil' })
  assert.equal((await run({ package: 'a-skill', args: [1] })).status, 400)
})

test('only the page itself runs a command', async () => {
  const body = { package: 'a-skill', args: [] }
  assert.equal((await run(body, { origin: 'http://evil.example', 'content-type': 'application/json' })).status, 403)
  assert.equal((await run(body, { 'content-type': 'application/json' })).status, 403)
  assert.equal((await run(body, { origin, 'content-type': 'text/plain' })).status, 403)
})

test('it answers only its own address', () => {
  assert.equal(isOwnHost('127.0.0.1:4260', 4260), true)
  assert.equal(isOwnHost('localhost:4260', 4260), true)
  assert.equal(isOwnHost('localhost:4200', 4260), false)
  assert.equal(isOwnHost('evil.example:4260', 4260), false)
  assert.equal(isOwnHost('127.evil.example:4260', 4260), false)
  assert.equal(isOwnHost(undefined, 4260), false)
})

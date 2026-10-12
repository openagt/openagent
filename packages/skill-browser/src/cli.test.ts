import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { appendFile, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolveChromePath } from './chrome.js'
import { runCli, stateFile } from './cli.js'
import { absoluteUrl } from './page.js'
import { inputCalls } from './screen.js'
import { CONSOLE, FRAME, jpegSize, readConsoleLine, readState, STATE, streamReader, type ConsoleLine } from './stream.js'

const chrome = resolveChromePath()
const needsChrome = chrome ? {} : { skip: 'no Chrome on this machine' }

const PAGES: Record<string, string> = {
  '/': `<!doctype html><title>Form</title>
    <p id="out">nothing yet</p>
    <input id="name" placeholder="Your name">
    <select aria-label="Colour"><option>Red</option><option>Blue</option></select>
    <button onclick="document.getElementById('out').textContent = 'Saved ' + document.getElementById('name').value + ' ' + document.querySelector('select').value">Save</button>
    <a href="/two">Page two</a>
    <form onsubmit="event.preventDefault(); document.getElementById('out').textContent = 'Submitted'"><input placeholder="search"></form>`,
  '/two': '<!doctype html><title>Two</title><p>Second page</p>',
  '/dialog': `<!doctype html><title>Dialog</title><p id="out">waiting</p>
    <button onclick="alert('hello'); document.getElementById('out').textContent = confirm('sure?') ? 'confirmed' : 'refused'">Ask</button>
    <input type="date" aria-label="Day">`,
  '/noisy': `<!doctype html><title>Noisy</title><p>noisy</p>
    <script src="/missing.js"></script>
    <script>console.log('hello %s', 'Ada', { a: 1, b: 'x' }, [1, 2]); console.warn('careful'); console.error(new Error('logged'))</script>
    <script>setTimeout(() => { throw new TypeError('boom') }, 0)</script>
    <button onclick="console.error('clicked wrong')">Break</button>
    <a href="/two">Page two</a>`,
  '/opener': `<!doctype html><title>Opener</title><p>first tab</p>
    <a href="/two" target="_blank">In a new tab</a>
    <button onclick="console.error('in the first tab')">Log</button>`,
}

async function site(): Promise<{ url: string; server: Server }> {
  const server = createServer((req, res) => {
    // Chrome asks every site for its icon: this one has none to miss, so a console holds only what a test's page said.
    if (req.url === '/favicon.ico') return void res.writeHead(204).end()
    const page = PAGES[req.url ?? '']
    res.writeHead(page ? 200 : 404, { 'content-type': 'text/html' }).end(page ?? 'not found')
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, server }
}

/** A run of the command in a fresh project, with a diary the way a run's tool hands it over. */
async function project(): Promise<{ cwd: string; diary: string; cli: (...argv: string[]) => Promise<{ code: number; out: string; err: string }> }> {
  const cwd = await mkdtemp(join(tmpdir(), 'skill-browser-test-'))
  const diary = join(cwd, 'diary.jsonl')
  await writeFile(diary, '')
  const cli = async (...argv: string[]) => {
    const out: string[] = []
    const err: string[] = []
    const code = await runCli(argv, { cwd, env: { ...process.env, AGENT_DIARY: diary }, stdout: l => out.push(l), stderr: l => err.push(l) })
    return { code, out: out.join('\n'), err: err.join('\n') }
  }
  return { cwd, diary, cli }
}

async function lines(diary: string): Promise<Record<string, unknown>[]> {
  return (await readFile(diary, 'utf8')).split('\n').filter(Boolean).map(l => JSON.parse(l) as Record<string, unknown>)
}

async function until(check: () => Promise<boolean>, ms = 10_000): Promise<boolean> {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    if (await check()) return true
    await new Promise(r => setTimeout(r, 200))
  }
  return false
}

const gone = (path: string) => stat(path).then(() => false, () => true)

test('the agent opens a page, reads it, types, picks, clicks and presses; the chat gets a screen; close ends it all', needsChrome, async () => {
  const { url, server } = await site()
  const { cwd, diary, cli } = await project()
  try {
    const opened = await cli('open', url)
    assert.equal(opened.code, 0, opened.err)
    assert.match(opened.out, /^Title: Form$/m)
    assert.match(opened.out, /\[1\] input "Your name" value=""/)
    assert.match(opened.out, /\[2\] select "Colour" value="Red"/)
    assert.match(opened.out, /\[4\] link "Page two" -> \/two/)

    assert.match((await cli('type', '1', 'Ada')).out, /\[1\] input "Your name" value="Ada"/)
    assert.match((await cli('type', '2', 'Blue')).out, /value="Blue"/)
    assert.match((await cli('click', '3')).out, /Saved Ada Blue/)
    await cli('type', '5', 'hello')
    assert.match((await cli('press', 'Enter')).out, /Submitted/)
    assert.equal((await cli('eval', 'document.title')).out, '"Form"')
    const shot = await cli('screenshot', 'shot.png')
    assert.equal(shot.out, join(cwd, 'shot.png'))
    assert.deepEqual([...(await readFile(join(cwd, 'shot.png'))).subarray(1, 4)], [...Buffer.from('PNG')])
    assert.match((await cli('click', '4')).out, /Second page/)

    const [screen] = await lines(diary)
    assert.equal(screen?.['kind'], 'screen')
    assert.equal(screen?.['label'], `browser · ${url}/`)
    const view = String(screen?.['url'])
    const screenAt = (path: string, token = new URL(view).searchParams.get('t')) => `${new URL(view).origin}${path}?t=${token}`

    // Someone watching gets what the address bar says and a picture of the page, and can click in it.
    const watching = new AbortController()
    const stream = await fetch(screenAt('/stream'), { signal: watching.signal })
    assert.equal(stream.status, 200)
    const read = streamReader()
    const seen = new Map<number, Uint8Array>()
    for await (const chunk of stream.body!) {
      for (const part of read(chunk)) seen.set(part.kind, part.bytes)
      if (seen.has(FRAME) && seen.has(STATE)) break
    }
    watching.abort()
    assert.deepEqual([...seen.get(FRAME)!.subarray(0, 3)], [0xff, 0xd8, 0xff], 'the picture is a JPEG')
    const size = jpegSize(seen.get(FRAME)!)
    assert.ok(size && size.width > 0 && size.width <= 1280 && size.height > 0 && size.height <= 800, `the picture says its size: ${JSON.stringify(size)}`)
    assert.deepEqual(readState(seen.get(STATE)!), { url: `${url}/two`, title: 'Two' })
    assert.equal((await fetch(screenAt('/input'), { method: 'POST', body: JSON.stringify({ type: 'back' }) })).status, 204)
    assert.ok(await until(async () => /^Title: Form$/m.test((await cli('read')).out)), 'the person went back a page')

    // The screen's address opens the screen and nothing else; the command's token opens no screen.
    assert.equal((await fetch(screenAt('/stream', ''))).status, 403, 'no token, no screen')
    assert.equal((await fetch(screenAt('/command'), { method: 'POST', body: JSON.stringify({ name: 'eval', args: ['1'] }) })).status, 403, 'who watches runs no command')
    assert.equal((await fetch(screenAt('/alive'))).status, 403)
    const state = JSON.parse(await readFile(stateFile(cwd), 'utf8')) as { token: string }
    assert.equal((await fetch(screenAt('/stream', state.token))).status, 403, 'the command\'s token watches nothing')
    assert.equal((await fetch(view)).status, 403, 'the browser serves no page of its own')

    assert.equal((await cli('close')).code, 0)
    assert.ok(await until(() => gone(stateFile(cwd))), 'the state file goes with the browser')
    const { at, ...closed } = (await lines(diary)).at(-1) ?? {}
    assert.deepEqual(closed, { kind: 'screen', url: view, label: 'browser · closed', ended: true })
    assert.equal(new Date(String(at)).toISOString(), at, 'the line says when it was written')
    const after = await cli('read')
    assert.equal(after.code, 1)
    assert.match(after.err, /No browser is open/)
  } finally {
    await cli('close')
    server.close()
  }
})

test('the run ending closes its browser, a question does not, and the ended run gets no more lines', needsChrome, async () => {
  const { url, server } = await site()
  const { cwd, diary, cli } = await project()
  try {
    assert.equal((await cli('open', url)).code, 0)
    // A run that stops on a question keeps its browser for the answer.
    await appendFile(diary, JSON.stringify({ kind: 'ended', status: 'waiting' }) + '\n')
    await new Promise(r => setTimeout(r, 2500))
    assert.equal((await cli('read')).code, 0, 'still open while the run waits')
    // The line arrives in two writes, the way a check can catch a writer halfway.
    const ended = JSON.stringify({ kind: 'ended', status: 'done' }) + '\n'
    await appendFile(diary, ended.slice(0, 9))
    await new Promise(r => setTimeout(r, 2500))
    await appendFile(diary, ended.slice(9))
    assert.ok(await until(() => gone(stateFile(cwd))), 'the browser closes once the diary says the run ended')
    assert.equal((await lines(diary)).at(-1)?.['kind'], 'ended')
  } finally {
    await cli('close')
    server.close()
  }
})

test('a dialog never blocks the page: it is accepted and named; wrong input is refused in words', needsChrome, async () => {
  const { url, server } = await site()
  const { cli } = await project()
  try {
    await cli('open', `${url}/dialog`)
    const asked = await cli('click', '1')
    assert.equal(asked.code, 0, asked.err)
    assert.match(asked.out, /^Dialog, accepted: alert "hello"\nDialog, accepted: confirm "sure\?"\n/)
    assert.match(asked.out, /confirmed/)
    const typed = await cli('type', '1', 'x')
    assert.equal(typed.code, 1)
    assert.match(typed.err, /takes no text: click it instead/)
    assert.equal((await cli('eval', '1/0')).out, 'Infinity')
    assert.equal((await cli('eval', 'await Promise.resolve(7)')).out, '7')
    assert.match((await cli('type', '2', '2024-01-31')).out, /\[2\] input\[date\] "Day" value="2024-01-31"/)
    const badDay = await cli('type', '2', 'soon')
    assert.equal(badDay.code, 1)
    assert.match(badDay.err, /is not a date value; give it as 2024-01-31/)
    const shot = await cli('screenshot', '/nonexistent-dir/shot.png')
    assert.equal(shot.code, 1)
    assert.match(shot.err, /could not be saved/)
  } finally {
    await cli('close')
    server.close()
  }
})

test('the page\'s console is kept: the agent is told of new errors and reads them, and who watches gets every line', needsChrome, async () => {
  const { url, server } = await site()
  const { diary, cli } = await project()
  try {
    assert.equal((await cli('open', url)).code, 0)
    assert.equal((await cli('console')).out, 'The console is empty.')

    const opened = await cli('open', `${url}/noisy`)
    assert.equal(opened.code, 0, opened.err)
    assert.match(opened.out, /^Console: \d new errors\. Read them with the `console` command\.\n\nTitle: Noisy$/m)

    // Every kind of line, each with where it was said; a line that breaks is set in under its time.
    let said = ''
    assert.ok(await until(async () => /TypeError: boom/.test((said = (await cli('console')).out))), said)
    assert.match(said, /^Console: \d+ messages, 3 errors\.$/m)
    assert.match(said, new RegExp(`^\\d\\d:\\d\\d:\\d\\d → ${url}/noisy$`, 'm'))
    assert.match(said, new RegExp(`^\\S+ error: Failed to load resource: the server responded with a status of 404 \\(Not Found\\) \\(${url}/missing\\.js\\)$`, 'm'))
    assert.match(said, new RegExp(`^\\S+ log: hello Ada \\{a: 1, b: "x"\\} \\[1, 2\\] \\(${url}/noisy:3\\)$`, 'm'))
    assert.match(said, new RegExp(`^\\S+ warning: careful \\(${url}/noisy:3\\)$`, 'm'))
    assert.match(said, /^\S+ error: Error: logged\n {8}at /m)
    assert.match(said, new RegExp(`^\\S+ error: Uncaught TypeError: boom\\n {8}at .*\\(${url}/noisy:4\\)$`, 'm'))

    // Told once: a print after the console was read names no error, until the page logs a new one.
    assert.doesNotMatch((await cli('read')).out, /^Console:/m)
    assert.match((await cli('click', '1')).out, /^Console: 1 new error\. Read it with the `console` command\.\n\nTitle: Noisy$/m)
    assert.doesNotMatch((await cli('read')).out, /^Console:/m)
    assert.equal((await cli('eval', 'console.info("from eval"), 1')).out, '1')

    // Going to another address empties nothing: a line says where the page went.
    await cli('click', '2')
    const after = (await cli('console')).out
    assert.match(after, /error: clicked wrong/)
    assert.match(after, /info: from eval/)
    assert.match(after, new RegExp(`→ ${url}/two$`))

    // Someone who starts watching gets the lines so far, in order, each once; then each new one.
    const [screen] = await lines(diary)
    const view = new URL(String(screen?.['url']))
    const watching = new AbortController()
    const stream = await fetch(`${view.origin}/stream?t=${view.searchParams.get('t')}`, { signal: watching.signal })
    const read = streamReader()
    const got: ConsoleLine[] = []
    let asked = false
    for await (const chunk of stream.body!) {
      for (const part of read(chunk)) if (part.kind === CONSOLE) got.push(readConsoleLine(part.bytes)!)
      if (!asked && got.some(line => line.text === `${url}/two`)) {
        asked = true
        void cli('eval', 'console.debug("while watched")')
      }
      if (got.some(line => line.text === 'while watched')) break
    }
    watching.abort()
    assert.deepEqual(got.map(line => line.n), got.map((_, i) => i + 1), 'numbered from 1, none twice, none left out')
    assert.deepEqual(got.filter(line => line.level === 'went').map(line => line.text), [`${url}/`, `${url}/noisy`, `${url}/two`])
    assert.deepEqual(got.at(-1) && { level: got.at(-1)!.level, text: got.at(-1)!.text }, { level: 'debug', text: 'while watched' })
    assert.ok(got.every(line => Math.abs(line.at - Date.now()) < 120_000), 'each line says when it was said')
  } finally {
    await cli('close')
    server.close()
  }
})

test('a tab the agent comes back to says nothing twice, and its errors are still counted', needsChrome, async () => {
  const { url, server } = await site()
  const { diary, cli } = await project()
  try {
    await cli('open', `${url}/opener`)
    assert.match((await cli('click', '2')).out, /^Console: 1 new error\./)
    assert.match((await cli('click', '1')).out, /^Title: Two$/m, 'the agent is on the new tab')
    await cli('eval', 'console.log("in the second tab")')
    // The new tab closes itself: the agent is on the first one again.
    await cli('eval', 'setTimeout(() => window.close(), 0)')
    assert.ok(await until(async () => /^Title: Opener$/m.test((await cli('read')).out)), 'back on the first tab')
    await cli('eval', 'console.log("back in the first tab")')

    const said = (await cli('console')).out
    assert.equal(said.match(/error: in the first tab/g)?.length, 1, said)
    assert.match(said, /^Console: 3 messages, 1 error\.$/m)
    assert.match(said, /log: back in the first tab$/)
    assert.deepEqual(said.match(/^\S+ → .*$/gm)?.map(line => line.split(' → ')[1]), [`${url}/opener`, `${url}/two`, `${url}/opener`])

    // Who watches is told the first tab had an error already, where the console says the agent came back to it.
    const [screen] = await lines(diary)
    const view = new URL(String(screen?.['url']))
    const watching = new AbortController()
    const stream = await fetch(`${view.origin}/stream?t=${view.searchParams.get('t')}`, { signal: watching.signal })
    const read = streamReader()
    const got: ConsoleLine[] = []
    for await (const chunk of stream.body!) {
      for (const part of read(chunk)) if (part.kind === CONSOLE) got.push(readConsoleLine(part.bytes)!)
      if (got.some(line => line.text === 'back in the first tab')) break
    }
    watching.abort()
    assert.deepEqual(got.filter(line => line.level === 'went').map(line => line.errors ?? 0), [0, 0, 1])
  } finally {
    await cli('close')
    server.close()
  }
})

test('a page that logs without end is no longer listened to, until it goes to another address', needsChrome, async () => {
  const { url, server } = await site()
  const { cli } = await project()
  try {
    await cli('open', url)
    await cli('eval', 'for (let i = 0; i < 5000; i++) console.log("again and again " + i)')
    let said = ''
    assert.ok(await until(async () => /The page logs too much/.test((said = (await cli('console')).out))), said.slice(0, 300))
    const heard = Number(/Console: (\d+) messages/.exec(said)?.[1])
    assert.ok(heard <= 500, `${heard} lines kept`)
    await cli('eval', 'console.log("said to nobody")')
    assert.doesNotMatch((await cli('console')).out, /said to nobody/)

    assert.match((await cli('open', `${url}/two`)).out, /^Title: Two$/m)
    await cli('eval', 'console.log("heard again")')
    assert.ok(await until(async () => /log: heard again/.test((said = (await cli('console')).out))), said.slice(-300))
  } finally {
    await cli('close')
    server.close()
  }
})

test('two opens at once start one browser', needsChrome, async () => {
  const { url, server } = await site()
  const { diary, cli } = await project()
  try {
    const [a, b] = await Promise.all([cli('open', url), cli('open', `${url}/two`)])
    assert.equal(a.code, 0, a.err)
    assert.equal(b.code, 0, b.err)
    const screens = new Set((await lines(diary)).map(line => line['url']))
    assert.equal(screens.size, 1, 'both opens went to the same browser')
  } finally {
    await cli('close')
    server.close()
  }
})

test('a command before open refuses, close has nothing to do; a wrong command line is a usage error', async () => {
  const { cli } = await project()
  const read = await cli('read')
  assert.equal(read.code, 1)
  assert.match(read.err, /browser open <address>/)
  const close = await cli('close')
  assert.deepEqual([close.code, close.out], [0, 'No browser is open.'])
  assert.equal((await cli('click')).code, 2)
  assert.equal((await cli('fly', 'away')).code, 2)
})

test('an address without a scheme is http; other schemes are refused', () => {
  assert.equal(absoluteUrl('localhost:3000/a'), 'http://localhost:3000/a')
  assert.equal(absoluteUrl('https://example.com'), 'https://example.com')
  assert.throws(() => absoluteUrl('file:///etc/passwd'), /only http and https/)
  assert.throws(() => absoluteUrl('javascript:alert(1)'), /only http and https/)
})

test('the screen passes on only input it knows', () => {
  assert.equal(inputCalls({ type: 'click', x: 1, y: 2 }).length, 2)
  assert.deepEqual(inputCalls({ type: 'click', x: Number.NaN, y: 2 }), [])
  assert.deepEqual(inputCalls({ type: 'navigate', url: 'file:///etc/passwd' }), [])
  assert.deepEqual(inputCalls({ type: 'key', key: 'F13' }), [])
  assert.deepEqual(inputCalls({ type: 'text', text: '' }), [])
  assert.deepEqual(inputCalls({ type: 'bogus' } as never), [])
})

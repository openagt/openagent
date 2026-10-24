import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { isSignInCode, mintClaude, mintedIn, notMinted, signInUrl, startedAs } from './claude-login.js'

const CLAUDE_LOGIN = `sk-ant-oat01-${'Zx9_-q'.repeat(16)}`

/**
 * What Claude Code draws once the person said yes, as a terminal gets it: recorded from the real
 * `claude setup-token` (2.1.296) in the terminal lent to it, with a made-up login in the real
 * one's place. Its last two lines hold no space: each word is put at its column.
 */
const screen = (login: string): string =>
  [
    '\x1b[2GPaste\x1b[8Gcode\x1b[13Ghere\x1b[18Gif\x1b[21Gprompted\x1b[30G>\r\r\n',
    '\x1b[?2026l\x1b[?2026h\r\x1b[1C\x1b[7A\x1b[K\r\x1b[1C\x1b[1B\x1b[38;2;78;186;101m✓ Long-lived authentication token created successfully!\r\x1b[1B\x1b[39m\x1b[K',
    '\r\x1b[1B Your OAuth token (valid for 1 year):\x1b[K',
    `\r\x1b[1C\x1b[2B\x1b[38;2;255;193;7m${login}\r\x1b[1C\x1b[1B\x1b[39m\x1b[K\r\r\n`,
    "\x1b[2G\x1b[38;2;153;153;153mStore\x1b[8Gthis\x1b[13Gtoken\x1b[19Gsecurely.\x1b[29GYou\x1b[33Gwon't\x1b[39Gbe\x1b[42Gable\x1b[47Gto\x1b[50Gsee\x1b[54Git\x1b[57Gagain.\x1b[39m\r\r\n\r\r\n",
    '\x1b[2G\x1b[38;2;153;153;153mUse\x1b[6Gthis\x1b[11Gtoken\x1b[17Gby\x1b[20Gsetting:\x1b[29Gexport\x1b[36GCLAUDE_CODE_OAUTH_TOKEN=<token>\x1b[39m\r\r\n\r\r\n',
  ].join('')

test('the Claude login is read off what Claude Code shows once all of it is there, and only what reads as one; what is told of a failure never holds a part of one', () => {
  assert.equal(mintedIn(screen(CLAUDE_LOGIN)), CLAUDE_LOGIN)
  // Drawn again, as a terminal's screen is: still the one login.
  assert.equal(mintedIn(screen(CLAUDE_LOGIN) + screen(CLAUDE_LOGIN)), CLAUDE_LOGIN)
  // The same words with plain spaces between them, as a screen that puts no word at a column would hold them.
  assert.equal(mintedIn(`Your OAuth token (valid for 1 year):\r\n\r\n${CLAUDE_LOGIN}\r\n\r\nStore this token securely. You won't be able to see it again.\r\n`), CLAUDE_LOGIN)
  // Half a screen is no login: the rest of it may still come.
  const whole = screen(CLAUDE_LOGIN)
  assert.equal(mintedIn(whole.slice(0, whole.indexOf(CLAUDE_LOGIN) + 40)), undefined)
  assert.equal(mintedIn(whole.slice(0, whole.indexOf('Store'))), undefined)
  assert.equal(mintedIn("Browser didn't open? Use the url below to sign in\r\nhttps://claude.ai/oauth/authorize?code=true&client_id=9d1c250a-e61b-44d9-88ed-5944d1962f5e\r\n"), undefined)
  // Other letters in the login's place are not one, and neither is a login with something drawn into it.
  assert.equal(mintedIn(screen('a'.repeat(80))), undefined)
  assert.equal(mintedIn(screen(`${CLAUDE_LOGIN.slice(0, 50)} ${CLAUDE_LOGIN.slice(50)}`)), undefined)
  // Whatever moves the cursor inside a login: two pieces put side by side are not the login that was made.
  for (const moved of ['\x1b[60G', '\x1b[1C', '\x1b[5D', '\x1b[2;60H', '\x1b[K', '\x1b[1B', '\x1bM']) {
    assert.equal(mintedIn(screen(`${CLAUDE_LOGIN.slice(0, 50)}${moved}${CLAUDE_LOGIN.slice(50)}`)), undefined, JSON.stringify(moved))
  }
  // A colour inside it is only a colour.
  assert.equal(mintedIn(screen(`${CLAUDE_LOGIN.slice(0, 50)}\x1b[33m${CLAUDE_LOGIN.slice(50)}`)), CLAUDE_LOGIN)
  // The words around the login, put at their place another way: a space beside a column, or a row and a column.
  assert.equal(mintedIn(` Your \x1b[7GOAuth token (valid for 1 year):\r\n${CLAUDE_LOGIN}\r\nStore \x1b[8Gthis\x1b[13Gtoken\x1b[19Gsecurely.`), CLAUDE_LOGIN)
  assert.equal(mintedIn(`\x1b[3;2HYour\x1b[3;7HOAuth\x1b[3;13Htoken:\x1b[5;2H${CLAUDE_LOGIN}\x1b[7;2HStore\x1b[7;8Hthis\x1b[7;13Htoken\x1b[7;19Hsecurely.`), CLAUDE_LOGIN)

  assert.equal(notMinted('started as 4242\r\n\x1b[31mThis command requires a Claude subscription.\x1b[39m\r\n\r\nGoodbye\r\nGoodbye\r\n'), 'Claude Code ended without a login.\nThis command requires a Claude subscription.\nGoodbye')
  const unread = 'Claude Code made a login, and this OpenAgent could not read it off what Claude Code showed.'
  assert.equal(notMinted(whole.slice(0, whole.indexOf(CLAUDE_LOGIN) + 40)), unread)
  // A screen that holds a login this OpenAgent does not read, however its heading is drawn or cut: none of the screen is told.
  for (const odd of [`Your OAuth t\x1b[1Cken:\r\n${CLAUDE_LOGIN}\r\n`, `${CLAUDE_LOGIN}\r\nGoodbye\r\n`, `Your\x1b[7GOAuth\x1b[13Gtoken:\r\n${CLAUDE_LOGIN.slice(0, 50)}\x1b[5D${CLAUDE_LOGIN.slice(50)}\r\n`]) {
    assert.equal(mintedIn(odd), undefined)
    assert.equal(notMinted(odd), unread)
  }
  // The lent terminal's first line names a process only once the whole line is there.
  assert.equal(startedAs('started as 42'), undefined)
  assert.equal(startedAs('started as 4242\r\nOpening the browser'), 4242)
})

test('a program that draws on a terminal is lent one, wide enough for a login on one line; one that ends without a login, takes too long or is stopped is told so, and nothing is left running, even a program that does not heed a terminal that went away', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'claude-mint-'))
  try {
    // Stands in for Claude Code: it needs a terminal, as Claude Code does, and draws what Claude Code draws.
    const stub = join(dir, 'stub.mjs')
    await writeFile(
      stub,
      `import { writeFileSync } from 'node:fs'
writeFileSync(${JSON.stringify(join(dir, 'pid'))}, String(process.pid))
if (!process.stdout.isTTY || !process.stdin.isTTY) { console.log('no terminal'); process.exit(1) }
process.stdin.setRawMode(true)
process.stdin.on('data', key => console.log('a key nobody pressed', JSON.stringify(String(key))))
const how = process.argv[2]
if (how === 'refuse') { console.log('This command requires a Claude subscription.'); process.exit(1) }
if (how === 'deaf') { process.on('SIGHUP', () => {}); process.on('SIGTERM', () => {}) }
if (how === 'wait' || how === 'deaf') setInterval(() => {}, 1000)
else setTimeout(() => {
  if (process.stdout.columns < 200) console.log('too narrow', process.stdout.columns)
  else process.stdout.write(${JSON.stringify(screen(CLAUDE_LOGIN))})
  setInterval(() => {}, 1000)
}, 100)
`,
    )
    const command = (how: string): string => `node ${stub} ${how}`
    const gone = async (): Promise<boolean> => {
      const pid = Number(await readFile(join(dir, 'pid'), 'utf8'))
      for (let tries = 0; tries < 40; tries++) {
        try {
          process.kill(pid, 0)
        } catch {
          return true
        }
        await new Promise(resolve => setTimeout(resolve, 50))
      }
      return false
    }

    assert.deepEqual(await mintClaude({ command: command('show') }), { ok: true, login: CLAUDE_LOGIN })
    // It would have gone on for ever: it was ended with the login in hand.
    assert.equal(await gone(), true)

    assert.deepEqual(await mintClaude({ command: command('refuse') }), { ok: false, error: 'Claude Code ended without a login.\nThis command requires a Claude subscription.' })
    assert.deepEqual(await mintClaude({ command: 'no-such-program-here setup-token' }), { ok: false, error: 'Claude Code ended without a login.\nClaude Code is not on this computer.' })

    const late = await mintClaude({ command: command('wait'), timeoutMs: 600 })
    assert.deepEqual(late, { ok: false, error: 'No yes came from the browser in 0 minutes.' })
    assert.equal(await gone(), true)

    assert.equal((await mintClaude({ command: command('deaf'), timeoutMs: 600 })).ok, false)
    assert.equal(await gone(), true)

    const stop = new AbortController()
    setTimeout(() => stop.abort(), 300)
    assert.deepEqual(await mintClaude({ command: command('wait'), signal: stop.signal }), { ok: false, error: 'The login was stopped.' })
    assert.equal(await gone(), true)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

/** The sign-in link as Claude Code (2.1.310) draws it with no browser to open: a link around words the screen wraps. */
const SIGN_IN = 'https://claude.com/cai/oauth/authorize?code=true&client_id=9d1c250a-e61b-44d9-88ed-5944d1962f5e&response_type=code&redirect_uri=https%3A%2F%2Fplatform.claude.com%2Foauth%2Fcode%2Fcallback&scope=user%3Ainference&state=abc'
const linkScreen = `\x1b[38;2;153;153;153mBrowser didn't open? Use the url below to sign in (c to copy)\x1b[39m\r\n\r\n\x1b]8;id=x;${SIGN_IN}\x07\x1b[38;2;153;153;153m${SIGN_IN.slice(0, 120)}\x1b[39m\x1b]8;;\x07\r\n\x1b]8;id=x;${SIGN_IN}\x07${SIGN_IN.slice(120)}\x1b]8;;\x07\r\n\x1b[2GPaste\x1b[8Gcode\x1b[13Ghere\x1b[18Gif\x1b[21Gprompted\x1b[30G>`

test('the sign-in page is read whole off the link Claude Code draws, however its words wrap; a code to paste back is a word and nothing else', () => {
  assert.equal(signInUrl(linkScreen), SIGN_IN)
  assert.equal(signInUrl("Browser didn't open? Use the url below\r\nhttps://example.com/x\r\n"), undefined)
  assert.equal(isSignInCode('Ab3_-x9#stateOf.it~'), true)
  assert.equal(isSignInCode('short'), false)
  assert.equal(isSignInCode('code\rexit\r'), false)
  assert.equal(isSignInCode('two words here'), false)
})

test('with no browser here, the sign-in page is handed over, and the code pasted back reaches Claude Code, which then shows the login', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'claude-mint-'))
  try {
    // Stands in for Claude Code with no browser: it draws the link, and takes the code typed into its terminal.
    const stub = join(dir, 'stub.mjs')
    await writeFile(
      stub,
      `if (!process.stdout.isTTY || !process.stdin.isTTY) { console.log('no terminal'); process.exit(1) }
process.stdin.setRawMode(true)
process.stdout.write(${JSON.stringify(linkScreen)})
let typed = ''
process.stdin.on('data', key => {
  typed += String(key)
  if (!typed.endsWith('\\r')) return
  if (typed === 'Good-code_42#state\\r') process.stdout.write(${JSON.stringify(screen(CLAUDE_LOGIN))})
  else console.log('Invalid code')
  typed = ''
})
setInterval(() => {}, 1000)
`,
    )
    const links: string[] = []
    const login = await mintClaude({
      command: `node ${stub}`,
      timeoutMs: 20_000,
      onLink: (url, paste) => {
        links.push(url)
        // A code that is no code never reaches Claude Code; a good one does.
        assert.equal(paste('bad\rcode'), false)
        assert.equal(paste(' Good-code_42#state '), true)
      },
    })
    assert.deepEqual(login, { ok: true, login: CLAUDE_LOGIN })
    assert.deepEqual(links, [SIGN_IN])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

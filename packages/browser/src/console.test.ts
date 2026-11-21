import assert from 'node:assert/strict'
import { test } from 'node:test'
import { consoleCall, consoleLog, errorsNote, flooded, heardOnce, logEntry, printConsole, PRINT_LIMIT, thrown, went } from './console.js'
import { CONSOLE, MAX_CONSOLE, MAX_CONSOLE_TEXT, MAX_CONSOLE_WHERE, readConsoleLine, streamPart, type ConsoleLine } from './stream.js'

const NOW = Date.UTC(2026, 0, 2, 3, 4, 5)
const text = (value: string) => ({ type: 'string', value })
const call = (type: string, ...args: object[]) => consoleCall({ type, args, timestamp: NOW }, 0)

test('a console call is one line: its values side by side, at its level, with where it was said', () => {
  assert.deepEqual(consoleCall({ type: 'log', args: [text('hello'), { type: 'number', value: 3 }], timestamp: NOW + 0.4, stackTrace: { callFrames: [{ url: 'http://a.test/app.js', lineNumber: 11 }] } }, 0), {
    at: NOW,
    level: 'log',
    text: 'hello 3',
    where: 'http://a.test/app.js:12',
  })
  assert.equal(call('error', text('bad'))?.level, 'error')
  assert.equal(call('warning', text('careful'))?.level, 'warning')
  assert.equal(call('debug', text('fine'))?.level, 'debug')
  assert.equal(call('table', text('rows'))?.level, 'log')
  assert.deepEqual([call('assert', text('x is set'))?.level, call('assert', text('x is set'))?.text], ['error', 'Assertion failed: x is set'])
  assert.equal(call('clear'), undefined, 'clearing says nothing: the lines stay')
  assert.equal(call('endGroup'), undefined)
  assert.equal(consoleCall({ type: 'log', args: [text('late')] }, NOW)?.at, NOW, 'a call with no time is said now')
  assert.equal(call('log', text('x'))?.where, undefined, 'code with no address is said nowhere')
})

test('values read as a console shows them', () => {
  const said = (...args: object[]) => call('log', ...args)?.text
  assert.equal(said({ type: 'undefined' }, { type: 'object', subtype: 'null' }, { type: 'boolean', value: false }), 'undefined null false')
  assert.equal(said({ type: 'number', unserializableValue: 'NaN' }, { type: 'bigint', unserializableValue: '12n' }), 'NaN 12n')
  assert.equal(said({ type: 'object', description: 'Object', preview: { description: 'Object', properties: [{ name: 'a', type: 'number', value: '1' }, { name: 'b', type: 'string', value: 'x' }] } }), '{a: 1, b: "x"}')
  assert.equal(said({ type: 'object', subtype: 'array', description: 'Array(3)', preview: { subtype: 'array', overflow: true, properties: [{ name: '0', type: 'number', value: '1' }, { name: '1', type: 'object', value: 'Object' }] } }), '[1, Object, …]')
  assert.equal(said({ type: 'object', description: 'Point', preview: { description: 'Point', properties: [{ name: 'x', type: 'number', value: '2' }] } }), 'Point {x: 2}')
  assert.equal(said({ type: 'object', subtype: 'error', description: 'Error: boom\n    at run (app.js:3)' }), 'Error: boom\n    at run (app.js:3)')
  assert.equal(said({ type: 'object', subtype: 'node', description: 'div#app', preview: { subtype: 'node', properties: [{ name: 'align', type: 'string', value: '' }] } }), 'div#app')
  assert.equal(said({ type: 'function', description: 'function save(a) {\n  return a\n}' }), 'ƒ function save(a) {')
  assert.equal(said({ type: 'symbol', description: 'Symbol(key)' }), 'Symbol(key)')
})

test('the marks in the first value are filled in from the next ones, and a style says nothing', () => {
  const said = (...args: object[]) => call('log', ...args)?.text
  assert.equal(said(text('Warning: %s has %d items%s'), text('List'), { type: 'number', value: 2 }, text('.')), 'Warning: List has 2 items.')
  assert.equal(said(text('%cStyled%c plain'), text('color: red'), text('')), 'Styled plain')
  assert.equal(said(text('100%% of %s'), text('it'), text('and more')), '100% of it and more')
  assert.equal(said(text('nothing for %s')), 'nothing for %s')
})

test('an error nothing caught is an error line, said once', () => {
  const error = thrown({ timestamp: NOW, exceptionDetails: { text: 'Uncaught', lineNumber: 4, url: 'http://a.test/app.js', exception: { type: 'object', subtype: 'error', description: 'TypeError: x is not a function\n    at http://a.test/app.js:5:3' } } }, 0)
  assert.deepEqual(error, { at: NOW, level: 'error', text: 'Uncaught TypeError: x is not a function\n    at http://a.test/app.js:5:3', where: 'http://a.test/app.js:5' })
  const syntax = thrown({ exceptionDetails: { text: "Uncaught SyntaxError: Unexpected token '}'", exception: { type: 'object', subtype: 'error', description: "SyntaxError: Unexpected token '}'" }, stackTrace: { callFrames: [{ url: 'http://a.test/b.js', lineNumber: 0 }] } } }, NOW)
  assert.deepEqual(syntax, { at: NOW, level: 'error', text: "Uncaught SyntaxError: Unexpected token '}'", where: 'http://a.test/b.js:1' })
  assert.equal(thrown({ exceptionDetails: { text: 'Uncaught', exception: text('just a string') } }, NOW)?.text, 'Uncaught just a string')
  assert.equal(thrown({ exceptionDetails: { text: 'Uncaught', exception: text('\nbelow a line break') } }, NOW)?.text, 'Uncaught \nbelow a line break')
  assert.equal(thrown({}, NOW), undefined)
})

test('what the browser says about the page is a line: a file that did not load names the file', () => {
  const missing = logEntry({ entry: { source: 'network', level: 'error', text: 'Failed to load resource: the server responded with a status of 404 (Not Found)', timestamp: NOW, url: 'http://a.test/missing.js', lineNumber: 0 } }, 0)
  assert.deepEqual(missing, { at: NOW, level: 'error', text: 'Failed to load resource: the server responded with a status of 404 (Not Found)', where: 'http://a.test/missing.js' })
  assert.equal(logEntry({ entry: { source: 'deprecation', level: 'verbose', text: 'old', url: 'http://a.test/app.js', lineNumber: 7 } }, NOW)?.where, 'http://a.test/app.js:7')
  assert.equal(logEntry({ entry: { source: 'other', level: 'verbose', text: 'old' } }, NOW)?.level, 'debug')
  assert.equal(logEntry({ entry: { level: 'error' } }, NOW), undefined)
  assert.equal(logEntry({}, NOW), undefined)
})

test('a line is the page\'s own text: it is cut to a length and holds no control character', () => {
  const long = call('log', text('x'.repeat(MAX_CONSOLE_TEXT * 2)))!
  assert.equal(long.text.length, MAX_CONSOLE_TEXT)
  assert.ok(long.text.endsWith('…'))
  assert.equal(call('log', text('a\u001b[31mred\u0007\r\nnext\tcolumn\u009b'))?.text, 'a[31mred\nnext\tcolumn')
  // Every line break is the one the print sets in, and nothing turns the text around.
  assert.equal(call('log', text('one\u2028two\u2029three \u202edesrever\u202c \u2066x\u2069'))?.text, 'one\ntwo\nthree desrever x')
  const far = consoleCall({ type: 'log', args: [], stackTrace: { callFrames: [{ url: `http://a.test/${'p'.repeat(1000)}\n`, lineNumber: 0 }] } }, NOW)!
  assert.equal(far.where!.length, MAX_CONSOLE_WHERE)
  assert.ok(far.where!.endsWith('…:1'))
  assert.equal(went('http://a.test/\nnext', NOW).text, 'http://a.test/next')
  assert.deepEqual(went('http://a.test/', NOW, 2), { at: NOW, level: 'went', text: 'http://a.test/', errors: 2 })
  assert.equal('errors' in went('http://a.test/', NOW, 0), false)
  assert.deepEqual([flooded(NOW).level, flooded(NOW).at], ['warning', NOW])

  // A value of any length costs no more to read than a line is long, and a call's values are counted.
  const started = Date.now()
  const huge = '\u0007a'.repeat(20_000_000)
  assert.equal(call('log', text(huge), text(huge))?.text.length, MAX_CONSOLE_TEXT)
  assert.equal(call('log', text(`%s ${huge}`), text(huge))?.text.length, MAX_CONSOLE_TEXT)
  assert.equal(call('log', ...Array.from({ length: 5000 }, () => text('v')))?.text, Array(50).fill('v').join(' '))
  assert.ok(Date.now() - started < 1_000, `read in ${Date.now() - started} ms`)

  // The longest line a writer sends is one a reader takes, whatever its characters cost as JSON.
  const worst = { n: 1, at: NOW, level: 'error' as const, text: '\ud800'.repeat(MAX_CONSOLE_TEXT), where: '\ud800'.repeat(MAX_CONSOLE_WHERE) }
  const bytes = new TextEncoder().encode(JSON.stringify(worst))
  assert.ok(bytes.length <= MAX_CONSOLE, `${bytes.length} bytes`)
  assert.deepEqual(readConsoleLine(bytes), worst)
})

test('a console message of the stream is read only when it is a line of a console', () => {
  const said = (value: unknown) => readConsoleLine(new TextEncoder().encode(JSON.stringify(value)))
  const good = { n: 3, at: NOW, level: 'warning', text: 'careful', where: 'http://a.test/app.js:2' }
  assert.deepEqual(said(good), good)
  assert.deepEqual(said({ n: 1, at: NOW, level: 'went', text: 'http://a.test/', where: '' }), { n: 1, at: NOW, level: 'went', text: 'http://a.test/' })
  assert.equal(said({ n: 1, at: NOW, level: 'went', text: 'http://a.test/', errors: 3 })?.errors, 3)
  for (const errors of [0, -1, 1.5, '3', 1e300]) assert.equal('errors' in said({ n: 1, at: NOW, level: 'went', text: 'http://a.test/', errors })!, false, String(errors))
  assert.equal('errors' in said({ ...good, errors: 3 })!, false, 'only where the page went says how many errors it had')
  assert.equal(said({ ...good, text: 'x'.repeat(MAX_CONSOLE_TEXT + 50) })?.text.length, MAX_CONSOLE_TEXT)
  for (const bad of [null, 'text', { ...good, n: 0 }, { ...good, n: 1.5 }, { ...good, at: 'now' }, { ...good, level: 'loud' }, { ...good, level: 'constructor' }, { ...good, text: 5 }]) assert.equal(said(bad), undefined, JSON.stringify(bad))
  assert.equal(readConsoleLine(new Uint8Array(MAX_CONSOLE + 1).fill(0x20)), undefined, 'longer than any line')
  assert.equal(readConsoleLine(new TextEncoder().encode('not json')), undefined)
  assert.equal(streamPart(CONSOLE, new Uint8Array(2))[0], CONSOLE)
})

test('the agent reads the console as text: how much there is, then the newest lines that fit', () => {
  assert.equal(printConsole([]), 'The console is empty.')
  assert.equal(printConsole([{ n: 1, ...went('http://a.test/', NOW) }]), 'The console is empty.', 'a page that said nothing')

  const lines: ConsoleLine[] = [
    { n: 1, ...went('http://a.test/', NOW) },
    { n: 2, at: NOW, level: 'log', text: 'hello' },
    { n: 3, at: NOW, level: 'error', text: 'Uncaught Error: boom\n    at run (app.js:3)', where: 'http://a.test/app.js:3' },
  ]
  const [head, ...rest] = printConsole(lines).split('\n')
  assert.equal(head, 'Console: 2 messages, 1 error.')
  assert.match(rest[0]!, /^\d\d:\d\d:\d\d → http:\/\/a\.test\/$/)
  assert.match(rest[1]!, /^\d\d:\d\d:\d\d log: hello$/)
  assert.match(rest[2]!, /^\d\d:\d\d:\d\d error: Uncaught Error: boom$/)
  assert.equal(rest[3], '        at run (app.js:3) (http://a.test/app.js:3)')

  const many: ConsoleLine[] = Array.from({ length: 500 }, (_, i) => ({ n: i + 1, at: NOW, level: 'log' as const, text: `line ${i + 1} ${'x'.repeat(2000)}` }))
  const print = printConsole(many)
  assert.ok(print.length <= PRINT_LIMIT + 200, `${print.length} characters`)
  assert.match(print, /^Console: 500 messages, 0 errors\.\n… 491 lines not printed: the errors come first, then the newest lines\n/)
  assert.match(print, /log: line 500 x+…$/, 'the newest line is the last one printed, cut to a length')

  // An error is printed whatever the page said after it: it is what the agent came to read.
  const buried: ConsoleLine[] = [{ n: 1, at: NOW, level: 'error', text: 'Uncaught Error: the one that matters' }, ...many.slice(1)]
  const found = printConsole(buried).split('\n')
  assert.equal(found[0], 'Console: 500 messages, 1 error.')
  assert.match(found[1]!, /^… 49\d lines not printed/)
  assert.match(found[2]!, /error: Uncaught Error: the one that matters$/, 'first, since it is the oldest line printed')
  assert.match(found.at(-1)!, /log: line 500 /)
  // Nor does a line made of line breaks take the room: so many are printed, and the print says it stopped.
  const tall = printConsole([{ n: 1, at: NOW, level: 'error', text: 'the error' }, { n: 2, at: NOW, level: 'log', text: 'top\n'.repeat(1000) }, { n: 3, at: NOW, level: 'log', text: 'top\n'.repeat(1000) }])
  assert.match(tall, /error: the error$/m)
  assert.equal(tall.split('\n').length, 1 + 1 + 2 * 14)
  assert.doesNotMatch(tall, /not printed/)
  // More errors than fit: the newest ones, and the print says some are left out.
  const failing = printConsole(Array.from({ length: 40 }, (_, i) => ({ n: i + 1, at: NOW, level: 'error' as const, text: `error ${i + 1} ${'x'.repeat(2000)}` })))
  assert.match(failing, /^Console: 40 messages, 40 errors\.\n… 31 lines not printed/)
  assert.match(failing, /error: error 40 x+…$/)

  assert.equal(errorsNote(1), 'Console: 1 new error. Read it with the `console` command.')
  assert.equal(errorsNote(3), 'Console: 3 new errors. Read them with the `console` command.')
})

test('a browser keeps the newest lines, numbered: who follows them gets each once, and skips what is gone', () => {
  const log = consoleLog(3)
  assert.deepEqual([log.newest, log.from(0), log.from(1), log.errorsAfter(0)], [0, undefined, undefined, 0])
  for (const [i, level] of (['log', 'error', 'log', 'error', 'error'] as const).entries()) log.add({ at: NOW + i, level, text: `line ${i + 1}` })
  assert.equal(log.newest, 5)
  assert.deepEqual(log.lines.map(line => line.n), [3, 4, 5], 'the newest three')
  assert.equal(log.from(4)?.text, 'line 4')
  assert.equal(log.from(0)?.n, 3, 'a follower that is behind what is kept goes on from the oldest kept')
  assert.equal(log.from(2)?.n, 3)
  assert.equal(log.from(5)?.n, 5)
  assert.equal(log.from(6), undefined, 'nothing past the newest')
  // A follower: each line once, in order, whatever was dropped meanwhile.
  const got: number[] = []
  let next = 0
  for (let line = log.from(next); line; line = log.from(next)) {
    got.push(line.n)
    next = line.n + 1
  }
  assert.deepEqual(got, [3, 4, 5])
  assert.deepEqual([log.errorsAfter(0), log.errorsAfter(4), log.errorsAfter(5)], [2, 1, 0], 'the errors still kept, after the line the agent was told up to')
})

test('a page listened to again says its old lines again: each is heard once', () => {
  const once = heardOnce()
  const first = once('tab-a')
  assert.ok(first.fresh(NOW) && first.fresh(NOW + 5) && first.fresh(NOW + 5), 'a page heard for the first time: every line, also two in one millisecond')
  first.settled()

  // The agent went to another tab and came back: tab A says its three lines again, then new ones.
  assert.ok(once('tab-b').fresh(NOW + 1), 'another page has its own lines')
  const again = once('tab-a')
  assert.deepEqual([again.fresh(NOW), again.fresh(NOW + 5), again.fresh(NOW + 5)], [false, false, false])
  assert.ok(again.fresh(NOW + 9), 'said while nobody listened: newer than any heard')
  again.settled()
  assert.ok(again.fresh(NOW + 9), 'once the old lines are through, a line is new whatever its time')

  const third = once('tab-a')
  assert.equal(third.fresh(NOW + 9), false)
  assert.ok(third.fresh(NOW + 10))
})

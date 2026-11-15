import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { HELP_WIDTH, helpRows, helpText } from './help.js'

const LONG = 'one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen'

test('every description starts on one column, wraps on it, and no line is wider than the help', () => {
  const rows = helpRows([
    ['list', 'every ticket'],
    ['show <file>', LONG],
    ['a form far too long to keep its description beside it', 'said under it'],
    ['close <file>', 'first line\nsecond line'],
  ])
  assert.equal(
    rows,
    [
      '  list          every ticket',
      '  show <file>   one two three four five six seven eight nine ten eleven twelve thirteen fourteen',
      '                fifteen sixteen seventeen',
      '  a form far too long to keep its description beside it',
      '                said under it',
      '  close <file>  first line',
      '                second line',
    ].join('\n'),
  )
  for (const line of rows.split('\n')) assert.ok(line.length <= HELP_WIDTH, line)
})

test('a form wider than the help wraps between its bracketed parts, under itself', () => {
  assert.equal(
    helpRows([['edit <name> [--prompt <text>] [--every <N<m|h|d|w|mo>>] [--when <shell line>] [--waits-for <line>] [--was <version>]', 'change it']]),
    ['  edit <name> [--prompt <text>] [--every <N<m|h|d|w|mo>>] [--when <shell line>]', '      [--waits-for <line>] [--was <version>]', '    change it'].join('\n'),
  )
})

test('a heading stands at the left after a blank line, and the rows under every heading share the column', () => {
  assert.equal(
    helpRows(['Usage:', ['openagent', 'serve the dashboard'], 'Options:', ['--port <n>', 'the port'], ['-h, --help', '']]),
    ['Usage:', '  openagent   serve the dashboard', '', 'Options:', '  --port <n>  the port', '  -h, --help'].join('\n'),
  )
})

test('a paragraph wraps under the help width, between words', () => {
  const text = helpText(`${LONG} ${LONG}`)
  assert.equal(
    text,
    [
      'one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen',
      'seventeen one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen',
      'sixteen seventeen',
    ].join('\n'),
  )
})

import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { browserCommand } from './browser.js'

test('the browser is opened by each platform\'s own command', () => {
  const url = 'http://127.0.0.1:4200/app-1x2y3z'
  assert.deepEqual(browserCommand('darwin', url), { command: 'open', args: [url] })
  assert.deepEqual(browserCommand('linux', url), { command: 'xdg-open', args: [url] })
  assert.deepEqual(browserCommand('win32', url), { command: 'cmd', args: ['/c', 'start', '""', url] })
})

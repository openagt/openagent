import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { howToGetIn, notInPage } from './pages.js'

test("a server behind Tailscale names the command its people run there, with whose device it is", () => {
  assert.match(howToGetIn('tailscale-server'), /run openagent-devices add --for <your name> --qr/)
  // A computer that is not a server keeps the npx line: its own user runs it.
  assert.match(howToGetIn('tailscale'), /npx @openagt\/dashboard-devices add --qr/)
})

test('what HTML would read as a tag is shown as written', () => {
  assert.ok(notInPage('tailscale-server').includes('run openagent-devices add --for &lt;your name&gt; --qr, and scan'))
})

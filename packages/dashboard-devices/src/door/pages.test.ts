import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { enterPage, howToGetIn, notInPage, type DoorKind } from './pages.js'

const KINDS: DoorKind[] = ['wifi', 'server', 'tailscale', 'tailscale-server']
const PAGES = [...KINDS.map(kind => notInPage(kind)), ...KINDS.map(kind => enterPage('/_door/enter', 'n0nce', kind))]
const dashboardFile = (path: string): string => readFileSync(fileURLToPath(new URL(`../../../dashboard/dashboard/${path}`, import.meta.url)), 'utf8')

/** The custom properties a CSS block sets, by name. */
function propertiesOf(block: string): Map<string, string> {
  return new Map([...block.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map(([, name, value]) => [name!, value!.trim()]))
}

test("a server behind Tailscale names the command its people run there, with whose device it is", () => {
  assert.match(howToGetIn('tailscale-server'), /run `openagent-devices add --for <your name> --qr`/)
  // A computer that is not a server keeps the npx line: its own user runs it.
  assert.match(howToGetIn('tailscale'), /`npx @openagt\/dashboard-devices add --qr`/)
})

test('a command is drawn as code, and what HTML would read as a tag is shown as written', () => {
  assert.ok(notInPage('tailscale-server').includes('run <code>openagent-devices add --for &lt;your name&gt; --qr</code>, and scan'))
  assert.ok(notInPage('tailscale').includes('<code>npx @openagt/dashboard-devices add --qr</code>'))
  // The answer a spent code gets is drawn by the page's script, the same way.
  assert.ok(enterPage('/_door/enter', 'n0nce', 'tailscale-server').includes(JSON.stringify('<code>openagent-devices add --for &lt;your name&gt; --qr</code>').slice(1, -1)))
})

test("the pages are in the dashboard's palette, light and dark, and carry its logo", () => {
  const css = dashboardFile('tailwind.css')
  const light = propertiesOf(css.slice(css.indexOf(':root {'), css.indexOf('}', css.indexOf(':root {'))))
  const dark = propertiesOf(css.slice(css.indexOf('.dark {'), css.indexOf('}', css.indexOf('.dark {'))))
  const strands = [...dashboardFile('components/Logo.tsx').matchAll(/d: '([^']+)'/g)].map(([, d]) => d!)
  assert.equal(strands.length, 6)
  for (const html of PAGES) {
    const style = html.slice(html.indexOf('<style>'), html.indexOf('</style>'))
    const pageLight = propertiesOf(style.slice(style.indexOf(':root {'), style.indexOf('}', style.indexOf(':root {'))))
    const pageDark = propertiesOf(style.slice(style.indexOf('@media (prefers-color-scheme: dark)')))
    assert.ok(pageLight.size >= 10)
    for (const [name, value] of pageLight) assert.equal(value, light.get(name), `light ${name}`)
    for (const [name, value] of pageDark) assert.equal(value, dark.get(name), `dark ${name}`)
    assert.deepEqual([...pageDark.keys()], [...pageLight.keys()])
    for (const d of strands) assert.ok(html.includes(`d="${d}"`), d.slice(0, 20))
  }
})

test('a page fetches nothing: no font, image, script or stylesheet from anywhere', () => {
  for (const html of PAGES) {
    assert.doesNotMatch(html, /<link|<img|\ssrc=|\shref=|url\(|@import|@font-face/i)
    // Its one script is written in the page.
    assert.equal(html.match(/<script/g)?.length ?? 0, html.includes('nonce=') ? 1 : 0)
  }
})

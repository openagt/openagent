import { strict as assert } from 'node:assert'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { CODE_FONTS, DOCUMENT_FONTS, FONTS, fontFace } from '../appearance.js'

// Every font Settings › Appearance offers ships in the dashboard's stylesheet (dashboard/lib/fonts.ts),
// under the name the page asks for: one left out draws the fallback with nothing said. Reads the
// build: `pnpm build` first.

test('every font Settings › Appearance offers has its faces in the built stylesheet, under the name the page asks for', () => {
  const assets = fileURLToPath(new URL('../../dist/dashboard-bundle/assets/', import.meta.url))
  assert.ok(existsSync(assets), 'the dashboard is not built: run `pnpm build` first')
  const css = readdirSync(assets)
    .filter(file => /^main-.*\.css$/.test(file))
    .map(file => readFileSync(join(assets, file), 'utf8'))
    .join('')
  const declared = new Set([...css.matchAll(/@font-face\{[^}]*?font-family:\s*["']?([^;"'}]+)/g)].map(match => match[1]!.trim()))
  const offered = [...Object.values(FONTS), ...Object.values(CODE_FONTS), ...Object.entries(DOCUMENT_FONTS).filter(([key]) => key !== 'app').map(([, family]) => family)]
  assert.deepEqual(
    offered.filter(family => !declared.has(fontFace(family))),
    [],
    'a font with no faces in the stylesheet: import its @fontsource package in dashboard/lib/fonts.ts',
  )
})

// The website as it is published: every page prerendered to HTML that holds its words. A page that
// renders nothing at build time, or is left out of it, fails here instead of on openagent.build.
// Reads the build: `pnpm build` builds the website, as part of the dashboard's.
import { strict as assert } from 'node:assert'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { test } from 'node:test'

const client = new URL('../dist/client/', import.meta.url)

/** The prerendered file of a page of `pages/`. */
const built = page => new URL(page === 'index' ? 'index.html' : `${page}/index.html`, client)

/** A built page's words, as a reader sees them: its HTML without its head, scripts, styles and tags. */
function words(page) {
  const file = built(page)
  assert.ok(existsSync(file), `the page ${page} was not built: run \`pnpm build\` first`)
  return readFileSync(file, 'utf8')
    .replace(/<head[\s\S]*?<\/head>/, ' ')
    .replace(/<(script|style)[\s\S]*?<\/\1>/g, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
}

/** What each page says, at least. */
const SAYS = {
  index: ['Make the important decisions, let AI do the rest.', 'npx @openagt/install'],
  banner: ['Make the important decisions, let AI do the rest.'],
  'go-to-dashboard': ['Go to dashboard', 'The dashboard runs 100% locally'],
  press: ['Press', 'Logos, banners, and naming'],
}

test('every page of pages/ is prerendered, and says what it is for', () => {
  const pages = readdirSync(new URL('../pages/', import.meta.url), { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
  assert.deepEqual(pages.sort(), Object.keys(SAYS).sort(), 'a new page gets its words here')
  for (const page of pages) {
    const text = words(page)
    for (const said of SAYS[page]) assert.ok(text.includes(said), `the page ${page} says "${said}"`)
  }
})

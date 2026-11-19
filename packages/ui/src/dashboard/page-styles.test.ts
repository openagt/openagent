import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { moduleUrl, PAGE_SHEET_PATH, servePageSheet, versionedModuleUrl } from './module-serve.js'
import { dashboardStylesVersion } from './page-styles.js'
import type { ProjectsProvider } from './projects.js'

const VOCABULARY = new URL('../../dashboard/module/theme.css', import.meta.url)

/** A daemon serving the page sheet of a bundle whose class list is `dashboard`, with a project of the modules `modules` names (package → class list, own rules). */
async function daemon(dashboard: string[], modules: Record<string, { classes: string[]; rules?: string }>) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'openagent-page-sheet-')))
  const bundle = join(root, 'bundle')
  await mkdir(bundle)
  const vocabulary = await readFile(VOCABULARY, 'utf8')
  const classes = `${dashboard.join('\n')}\n`
  await writeFile(join(bundle, 'vocabulary.css'), vocabulary)
  await writeFile(join(bundle, 'classes.txt'), classes)
  const project = join(root, 'project')
  const urls: Record<string, string> = {}
  await mkdir(project)
  await writeFile(join(project, 'package.json'), JSON.stringify({ dependencies: Object.fromEntries(Object.keys(modules).map(name => [name, '1'])) }))
  for (const [name, { classes, rules }] of Object.entries(modules)) {
    const dir = join(project, 'node_modules', name)
    await mkdir(join(dir, 'dist'), { recursive: true })
    await writeFile(join(dir, 'package.json'), JSON.stringify({ name, exports: { './dashboard': './dist/dashboard.js' } }))
    await writeFile(join(dir, 'dist', 'dashboard.js'), 'export default {}')
    await writeFile(join(dir, 'dist', 'classes.txt'), `${classes.join('\n')}\n`)
    if (rules !== undefined) await writeFile(join(dir, 'dist', 'styles.css'), rules)
    urls[name] = await versionedModuleUrl(moduleUrl('app-abc', { package: name, entry: 'dashboard.js' }), { dir: join(dir, 'dist'), entry: 'dashboard.js' })
  }
  const projects: ProjectsProvider = { list: async () => [], resolvePath: async id => (id === 'app-abc' ? project : undefined) }
  const server = createServer((req, res) => void servePageSheet(req, res, bundle, projects))
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  return {
    version: dashboardStylesVersion(vocabulary, classes),
    urls,
    /** The page sheet's answer for the dashboard's version `v` and the modules named. */
    sheet: (names: string[], v = dashboardStylesVersion(vocabulary, classes)) => fetch(`${base}${PAGE_SHEET_PATH}?${new URLSearchParams([['v', v], ...names.map((name): [string, string] => ['m', urls[name]!])])}`),
    project,
    close: async () => {
      await new Promise(resolve => server.close(resolve))
      await rm(root, { recursive: true, force: true })
    },
  }
}

/** The utilities' rules of a sheet, in its order (every utilities layer it has), each by its selector's class. */
function utilities(css: string): { name: string; text: string }[] {
  const rules: { name: string; text: string }[] = []
  for (let layer = css.indexOf('@layer utilities {'); layer >= 0; layer = css.indexOf('@layer utilities {', layer + 1)) {
    let depth = 0
    let start = -1
    for (let at = css.indexOf('{', layer) + 1; at < css.length && depth >= 0; at++) {
      if (css[at] === '{' && depth++ === 0) start = css.lastIndexOf('\n', at) + 1
      if (css[at] === '}' && --depth === 0) {
        const text = css.slice(start, at + 1).trim()
        rules.push({ name: text.slice(1, text.search(/\s/)).replace(/\\/g, ''), text })
      }
    }
  }
  assert.ok(rules.length > 0, 'the sheet has its utilities')
  return rules
}

test("a dashboard's class said for one width wins over a module's plain class, whichever came first", async () => {
  const at = await daemon(['hidden', 'md:flex'], { '@acme/tickets': { classes: ['hidden', 'flex'] } })
  try {
    const css = await (await at.sheet(['@acme/tickets'])).text()
    const order = utilities(css).map(rule => rule.name)
    assert.ok(['hidden', 'md:flex', 'flex'].every(name => order.includes(name)), order.join(' '))
    assert.ok(order.indexOf('md:flex') > order.indexOf('hidden'), 'md:flex comes after hidden')
    assert.ok(order.indexOf('md:flex') > order.indexOf('flex'), "md:flex comes after the module's flex")
  } finally {
    await at.close()
  }
})

test('a module that arrives keeps every class already on the page as it was, in the same order', async () => {
  const at = await daemon(['hidden', 'md:flex', 'p-2', 'pt-0', 'dark:inline-flex', 'pointer-coarse:hidden'], {
    '@acme/tickets': { classes: ['flex', 'px-3'] },
    '@acme/logs': { classes: ['inline-flex', 'block', 'md:hidden', 'pl-7'] },
  })
  try {
    const before = utilities(await (await at.sheet(['@acme/tickets'])).text())
    const after = utilities(await (await at.sheet(['@acme/tickets', '@acme/logs'])).text())
    const had = new Set(before.map(rule => rule.name))
    assert.deepEqual(
      after.filter(rule => had.has(rule.name)),
      before,
    )
    assert.ok(after.length > before.length, "the module's own classes are in the sheet")
  } finally {
    await at.close()
  }
})

test("a module's own rules come after the classes, and one that would change the vocabulary is refused by name", async () => {
  const at = await daemon(['flex'], {
    '@acme/browser': { classes: ['absolute'], rules: '.agent-pointer-ring { opacity: 0; }' },
    '@acme/rogue': { classes: [], rules: '/* the brand */\n@theme { --color-primary: red; }' },
  })
  try {
    const css = await (await at.sheet(['@acme/browser'])).text()
    assert.ok(css.lastIndexOf('.agent-pointer-ring') > css.indexOf('@layer utilities'))
    const refused = await at.sheet(['@acme/browser', '@acme/rogue'])
    assert.equal(refused.status, 500)
    assert.match(await refused.text(), /@acme\/rogue's styles\.css says @theme/)
  } finally {
    await at.close()
  }
})

test('the page sheet is kept for good when every version it names is the one on disk, and asked for again otherwise', async () => {
  const at = await daemon(['flex'], { '@acme/tickets': { classes: ['hidden'] } })
  try {
    const kept = await at.sheet(['@acme/tickets'])
    assert.equal(kept.status, 200)
    assert.match(kept.headers.get('content-type') ?? '', /text\/css/)
    assert.equal(kept.headers.get('cache-control'), 'public, max-age=31536000, immutable')

    assert.equal((await at.sheet(['@acme/tickets'], 'another-build')).headers.get('cache-control'), 'no-cache', 'another build of the dashboard')
    await writeFile(join(at.project, 'node_modules', '@acme/tickets', 'dist', 'dashboard.js'), 'export default { rebuilt: true }')
    const rebuilt = await at.sheet(['@acme/tickets'])
    assert.equal(rebuilt.headers.get('cache-control'), 'no-cache', 'a module rebuilt since')
    const tag = rebuilt.headers.get('etag')
    assert.ok(tag)
    assert.equal((await fetch(rebuilt.url, { headers: { 'if-none-match': tag } })).status, 304, 'the same sheet is not sent again')
    assert.equal((await fetch(rebuilt.url, { method: 'POST' })).status, 405)
  } finally {
    await at.close()
  }
})

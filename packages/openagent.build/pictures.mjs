// The site's pictures of the dashboard (public/pictures/), taken again in one command whenever the
// dashboard's look changes: `pnpm --filter __private__website pictures`. Each is the offline demo
// (packages/dashboard/src/e2e/README.md) in Chrome, dark and light, at twice its pixels, once for each
// width of room the site gives it, so the site shows it at its own size (Screenshot, pages/index/ui.tsx).
// Needs `pnpm build` and the dashboard's test build (`pnpm exec tsc -p tsconfig.test.json` there), and a
// Chrome (`CHROME_PATH`, or one where Chrome usually is). Run it without `claude` and `codex` on PATH, as
// the demo is: with them, the demo's runs ask the real ones for their titles and usage.
import { existsSync } from 'node:fs'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { homedir, hostname } from 'node:os'
import { pathToFileURL } from 'node:url'

const dashboard = new URL('../dashboard/', import.meta.url)
const demoBuild = new URL('dist-test/e2e/demo.js', dashboard)
if (!existsSync(new URL('dist/cli/bin.js', dashboard)) || !existsSync(demoBuild)) {
  console.error('The dashboard is not built: run `pnpm build` at the root, then `pnpm exec tsc -p tsconfig.test.json` in packages/dashboard.')
  process.exit(1)
}
// The browser the dashboard's own smoke stories drive, from the dashboard's dependencies.
const require = createRequire(new URL('package.json', dashboard))
const { chromium } = require('playwright-core')
const { resolveChromePath } = await import(pathToFileURL(require.resolve('@openagt/skill-browser')).href)
const { startDemo } = await import(demoBuild.href)

const out = new URL('public/pictures/', import.meta.url)
const sizes = new URL('pages/index/pictures.json', import.meta.url)

/**
 * What each picture shows: the page and what it waits for, then one shot for each width of room the site gives
 * it, each for the screens its `media` names (the last one for every other screen): the part of the dashboard to
 * keep, `width` wide, the window's width or its main column's from a margin over one element to a margin under
 * another (`rows`), or an element's box (`around`), in a window about `window` wide: as much wider as
 * the part must be to have its width beside the dashboard's own margins and sidebar.
 */
const PICTURES = [
  // A run waiting on the person's decision: the hero, the column's width, the window's top beside the sidebar's;
  // where the column is narrower than the dashboard with its sidebar, the question alone.
  {
    name: 'run',
    path: (demo, runs) => `${demo.project.id}/${runs.waiting}`,
    ready: 'text=Which way?',
    shots: [
      { window: 1120, width: 1120, media: '(min-width: 1184px)', keep: 'window', rows: [undefined, 'main >> role=button[name=/^Answer/]'] },
      { window: 960, width: 960, media: '(min-width: 1024px)', keep: 'window', rows: [undefined, 'main >> role=button[name=/^Answer/]'] },
      { window: 704, width: 662, media: '(min-width: 768px)', around: 'main >> role=region[name="Which way?"]' },
      { window: 390, width: 348, media: '', around: 'main >> role=region[name="Which way?"]' },
    ],
  },
  // The launcher's "Waiting on you": the Human Queue as a person meets it, in two thirds of the column (the
  // dashboard's sidebar beside it in the window).
  {
    name: 'waiting',
    path: demo => demo.project.id,
    ready: 'main >> text=Waiting on you',
    shots: [
      { window: 970, width: 714, media: '(min-width: 1184px)', keep: 'main', rows: ['main >> text=Waiting on you', 'main >> text=Needs push'] },
      { window: 499, width: 499, media: '(min-width: 861px)', keep: 'main', rows: ['main >> text=Waiting on you', 'main >> text=Needs push'] },
      { window: 960, width: 704, media: '(min-width: 768px)', keep: 'main', rows: ['main >> text=Waiting on you', 'main >> text=Needs push'] },
      { window: 358, width: 358, media: '', keep: 'main', rows: ['main >> text=Waiting on you', 'main >> text=Needs push'] },
    ],
  },
  // The project's tickets, each a plan away, under both lists of "Autonomous AI": from the title and its presses;
  // on a phone, whose own bar holds the title, from the presses the page keeps there.
  {
    name: 'tickets',
    path: demo => `${demo.project.id}/tickets`,
    ready: 'main >> text=Login page',
    shots: [
      { window: 1024, width: 768, media: '(min-width: 832px)', keep: 'main', rows: ['main >> h1', 'main >> text=Dark mode'] },
      { window: 960, width: 704, media: '(min-width: 768px)', keep: 'main', rows: ['main >> h1', 'main >> text=Dark mode'] },
      { window: 358, width: 358, media: '', keep: 'main', rows: ['main >> text=New ticket', 'main >> text=Dark mode'] },
    ],
  },
]

/** Below this the dashboard is a phone's, without its sidebar (`useIsMobile`). */
const PHONE = 768

const started = Date.now()
const demo = await startDemo({ seed: true })
const browser = await chromium.launch({ executablePath: resolveChromePath(), args: ['--mute-audio'] })
const written = {}
// Every picture is taken before the folder changes, so a run that fails leaves the site's pictures as they were.
const files = []
try {
  const agents = await demo.call('onAgents', demo.project.id)
  const runs = { waiting: agents.find(agent => agent.status === 'waiting').id }
  for (const picture of PICTURES) {
    written[picture.name] = []
    const path = picture.path(demo, runs)
    for (const shot of picture.shots) {
      // The window whose part has the shot's width: the part grows with the window, beside the same margins.
      let { window } = shot
      let clip = await taken(path, picture.ready, shot, window, 'dark', async page => part(page, shot))
      if (clip.width !== shot.width) {
        window += shot.width - clip.width
        clip = await taken(path, picture.ready, shot, window, 'dark', async page => part(page, shot))
        if (clip.width !== shot.width) throw new Error(`${picture.name}: no window gives a part ${shot.width} wide (${clip.width} at ${window})`)
      }
      for (const scheme of ['dark', 'light']) {
        await taken(path, picture.ready, shot, window, scheme, async (page, context) => {
          // Both schemes of one width have one size, so the site lays out either before it arrives.
          const own = await part(page, shot)
          if (own.width !== clip.width || own.height !== clip.height) throw new Error(`${picture.name} at ${window} is ${own.width}x${own.height} in ${scheme}, ${clip.width}x${clip.height} in dark`)
          // Chrome's own capture, which writes WebP; Playwright's writes PNG or JPEG only.
          const cdp = await context.newCDPSession(page)
          const { data } = await cdp.send('Page.captureScreenshot', { format: 'webp', quality: 90, clip: { ...clip, scale: 1 } })
          files.push([`${picture.name}-${window}-${scheme}.webp`, Buffer.from(data, 'base64')])
          console.log(`public/pictures/${files.at(-1)[0]} ${clip.width}x${clip.height}`)
        })
      }
      written[picture.name].push({ window, width: clip.width, height: clip.height, media: shot.media })
    }
  }
  await rm(out, { recursive: true, force: true })
  await mkdir(out, { recursive: true })
  for (const [name, data] of files) await writeFile(new URL(name, out), data)
  await writeFile(sizes, JSON.stringify(written, null, 2) + '\n')
  console.log(`${files.length} pictures in ${Math.round((Date.now() - started) / 1000)} s`)
} finally {
  await browser.close()
  await demo.stop()
}

/** The page at `path` in a window `window` wide, at rest once `ready` shows, handed to `use`. */
async function taken(path, ready, shot, window, scheme, use) {
  const context = await browser.newContext({ viewport: { width: window, height: 900 }, deviceScaleFactor: 2, colorScheme: scheme, reducedMotion: 'reduce' })
  try {
    const page = await context.newPage()
    await page.goto(`${demo.url}/${path}`, { waitUntil: 'load' })
    await page.locator(ready).first().waitFor()
    // Every page of the project is in the sidebar once the project's skills are read, which the first page of a
    // run waits on longest.
    if (window >= PHONE) await page.locator('a[href$="/tickets"]').first().waitFor({ state: 'attached', timeout: 120_000 })
    await page.evaluate(() => document.fonts.ready)
    // A picture shows the page at rest: no caret, nothing focused.
    await page.addStyleTag({ content: '* { caret-color: transparent !important }' })
    await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur())
    // A picture for a public page names no computer and no one's home folder.
    await page.evaluate(([scrub]) => {
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        for (const [from, to] of scrub) if (node.nodeValue.includes(from)) node.nodeValue = node.nodeValue.replaceAll(from, to)
      }
    }, [[[demo.home, '~'], [homedir(), '~'], [hostname(), 'this computer']]])
    for (const row of [shot.around, ...(shot.rows ?? [])].filter(Boolean)) await page.locator(row).first().waitFor()
    return await use(page, context)
  } finally {
    await context.close()
  }
}

/**
 * The part of the page to keep, on whole pixels: an element's box, or the window's or the main column's
 * width from a margin over its first row (or the window's top) to one under its last, moved down to fall between
 * two rows of every column it crosses (the sidebar's beside the main column's), never through one.
 */
async function part(page, { keep, rows, around }) {
  if (around) {
    const box = await page.locator(around).first().boundingBox()
    const x = Math.floor(box.x)
    const y = Math.floor(box.y)
    return { x, y, width: Math.ceil(box.x + box.width) - x, height: Math.ceil(box.y + box.height) - y }
  }
  const [top, bottom] = rows
  const margin = 24
  const across = keep === 'main' ? await page.locator('main').boundingBox() : { x: 0, width: page.viewportSize().width }
  const first = top === undefined ? { y: margin } : await page.locator(top).first().boundingBox()
  const last = await page.locator(bottom).first().boundingBox()
  const y = Math.max(0, Math.floor(first.y - margin))
  const x = Math.ceil(across.x)
  const width = Math.floor(across.width)
  const end = await page.evaluate(([end, left, right]) => {
    // A row: a press, a link, a list's item or a line of text, each its own height.
    const boxes = [...document.querySelectorAll('a, button, li, [role=row]')].map(e => e.getBoundingClientRect())
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!node.nodeValue.trim()) continue
      const range = document.createRange()
      range.selectNodeContents(node)
      boxes.push(...range.getClientRects())
    }
    const rows = boxes.filter(box => box.height > 0 && box.height < 80 && box.right > left && box.left < right)
    const through = () => rows.filter(box => box.top < end && box.bottom > end)
    for (let cut = through(); cut.length; cut = through()) {
      // The edge goes under the rows it cuts, halfway to the next one.
      const under = Math.max(...cut.map(box => box.bottom))
      const next = Math.min(under + 24, ...rows.filter(box => box.top >= under).map(box => box.top))
      end = (under + next) / 2
    }
    return end
  }, [last.y + last.height + margin, x, x + width])
  return { x, y, width, height: Math.ceil(end) - y }
}

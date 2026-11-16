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
 * it, each for the screens its `media` names (the last one for every other screen): the dashboard in a window
 * `window` wide, and the part of it to keep, the window's width or its main column's from a margin over one
 * element to a margin under another (`rows`), or the box around an element (`around`).
 */
const PICTURES = [
  // A run waiting on the person's decision: the hero, the column's width, the window's top beside the sidebar's;
  // where the column is narrower than the dashboard with its sidebar, the question alone.
  {
    name: 'run',
    path: (demo, runs) => `${demo.project.id}/${runs.waiting}`,
    ready: 'text=Which way?',
    shots: [
      { window: 1120, media: '(min-width: 1184px)', keep: 'window', rows: [undefined, 'main >> text=Submit'] },
      { window: 960, media: '(min-width: 1024px)', keep: 'window', rows: [undefined, 'main >> text=Submit'] },
      { window: 704, media: '(min-width: 768px)', around: 'main >> text=Which way?' },
      { window: 390, media: '', around: 'main >> text=Which way?' },
    ],
  },
  // The launcher's "Waiting on you": the Human Queue as a person meets it, in two thirds of the column (the
  // dashboard's sidebar, 256 wide, beside it in the window).
  {
    name: 'waiting',
    path: demo => demo.project.id,
    ready: 'text=Waiting on you',
    shots: [
      { window: 970, media: '(min-width: 1184px)', keep: 'main', rows: ['text=Waiting on you', 'text=Needs push'] },
      { window: 499, media: '(min-width: 861px)', keep: 'main', rows: ['text=Waiting on you', 'text=Needs push'] },
      { window: 960, media: '(min-width: 768px)', keep: 'main', rows: ['text=Waiting on you', 'text=Needs push'] },
      { window: 358, media: '', keep: 'main', rows: ['text=Waiting on you', 'text=Needs push'] },
    ],
  },
  // The project's tickets, each a plan away, under both lists of "Autonomous AI": from the presses over the
  // title; on a phone, whose own bar holds the title, from the presses the page keeps there.
  {
    name: 'tickets',
    path: demo => `${demo.project.id}/tickets`,
    ready: 'text=Login page',
    shots: [
      { window: 1024, media: '(min-width: 832px)', keep: 'main', rows: ['main >> text=Add to queue', 'main >> text=Login page'] },
      { window: 960, media: '(min-width: 768px)', keep: 'main', rows: ['main >> text=Add to queue', 'main >> text=Login page'] },
      { window: 358, media: '', keep: 'main', rows: ['main >> text=New ticket', 'main >> text=Login page'] },
    ],
  },
]

/** Below this the dashboard is a phone's, without its sidebar (`useIsMobile`). */
const PHONE = 768

const started = Date.now()
const demo = await startDemo({ seed: true })
const browser = await chromium.launch({ executablePath: resolveChromePath(), args: ['--mute-audio'] })
const written = {}
try {
  const agents = await demo.call('onAgents', demo.project.id)
  const runs = { waiting: agents.find(agent => agent.status === 'waiting').id }
  await rm(out, { recursive: true, force: true })
  await mkdir(out, { recursive: true })
  for (const picture of PICTURES) {
    written[picture.name] = []
    for (const shot of picture.shots) {
      const { window, media } = shot
      let size
      for (const scheme of ['dark', 'light']) {
        const context = await browser.newContext({ viewport: { width: window, height: 900 }, deviceScaleFactor: 2, colorScheme: scheme, reducedMotion: 'reduce' })
        const page = await context.newPage()
        await page.goto(`${demo.url}/${picture.path(demo, runs)}`, { waitUntil: 'load' })
        await page.locator(picture.ready).first().waitFor()
        // Every page of the project is in the sidebar once the project's skills are read.
        if (window >= PHONE) await page.locator('a[href$="/tickets"]').first().waitFor({ state: 'attached' })
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
        // Both schemes of one width have one size, so the site lays out either before it arrives.
        const clip = await part(page, shot)
        size ??= clip
        if (clip.width !== size.width || clip.height !== size.height) throw new Error(`${picture.name} at ${window} is ${clip.width}x${clip.height} in ${scheme}, ${size.width}x${size.height} in dark`)
        // Chrome's own capture, which writes WebP; Playwright's writes PNG or JPEG only.
        const cdp = await context.newCDPSession(page)
        const { data } = await cdp.send('Page.captureScreenshot', { format: 'webp', quality: 90, clip: { ...clip, scale: 1 } })
        const file = new URL(`${picture.name}-${window}-${scheme}.webp`, out)
        await writeFile(file, Buffer.from(data, 'base64'))
        console.log(`${file.pathname.slice(file.pathname.indexOf('public/'))} ${clip.width}x${clip.height}`)
        await context.close()
      }
      written[picture.name].push({ window, width: size.width, height: size.height, media })
    }
  }
  await writeFile(sizes, JSON.stringify(written, null, 2) + '\n')
  console.log(`${Object.values(written).flat().length * 2} pictures in ${Math.round((Date.now() - started) / 1000)} s`)
} finally {
  await browser.close()
  await demo.stop()
}

/**
 * The part of the page to keep, on whole pixels: the box around an element, or the window's or the main column's
 * width from a margin over its first row (or the window's top) to one under its last.
 */
async function part(page, { keep, rows, around }) {
  if (around) {
    // The nearest box with an edge of its own.
    const box = await page.locator(around).first().evaluate(element => {
      for (let e = element; e; e = e.parentElement) {
        if (parseFloat(getComputedStyle(e).borderTopWidth) > 0) return e.getBoundingClientRect().toJSON()
      }
    })
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
  return { x: Math.ceil(across.x), y, width: Math.floor(across.width), height: Math.ceil(last.y + last.height + margin) - y }
}

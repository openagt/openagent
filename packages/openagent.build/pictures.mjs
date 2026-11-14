// The site's pictures of the dashboard (public/pictures/), taken again in one command whenever the
// dashboard's look changes: `pnpm --filter __private__website pictures`. Each is the offline demo
// (packages/dashboard/src/e2e/README.md) in Chrome, dark and light, at twice the size the site shows it.
// Needs `pnpm build` and the dashboard's test build (`pnpm exec tsc -p tsconfig.test.json` there), and a
// Chrome (`CHROME_PATH`, or one where Chrome usually is). Run it without `claude` and `codex` on PATH, as
// the demo is: with them, the demo's runs ask the real ones for their titles and usage.
import { mkdir, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { homedir, hostname } from 'node:os'
import { pathToFileURL } from 'node:url'

// The browser the dashboard's own smoke stories drive, from the dashboard's dependencies.
const dashboard = new URL('../dashboard/', import.meta.url)
const require = createRequire(new URL('package.json', dashboard))
const { chromium } = require('playwright-core')
const { resolveChromePath } = await import(pathToFileURL(require.resolve('@openagt/skill-browser')).href)
const { startDemo } = await import(new URL('dist-test/e2e/demo.js', dashboard).href)

const out = new URL('public/pictures/', import.meta.url)

/**
 * What each picture shows: the page, what it waits for, and the part of the window to keep: a box, or
 * the page's main column from the top of one element to the bottom of another.
 */
const PICTURES = [
  // A run waiting on the person's decision, beside the sidebar: the hero.
  { name: 'run', viewport: { width: 1440, height: 900 }, path: (demo, runs) => `${demo.project.id}/${runs.waiting}`, ready: 'text=Which way?', clip: { x: 0, y: 0, width: 1440, height: 600 } },
  // The launcher's "Waiting on you": the Human Queue as a person meets it.
  { name: 'waiting', viewport: { width: 1024, height: 768 }, path: demo => demo.project.id, ready: 'text=Waiting on you', rows: ['text=This machine', 'text=Needs push'] },
  // The project's tickets, each a plan away.
  { name: 'tickets', viewport: { width: 1024, height: 768 }, path: demo => `${demo.project.id}/tickets`, ready: 'text=Login page', rows: ['main h1', 'main >> text=Login page'] },
]

const demo = await startDemo({ seed: true })
const browser = await chromium.launch({ executablePath: resolveChromePath(), args: ['--mute-audio'] })
try {
  const agents = await demo.call('onAgents', demo.project.id)
  const runs = { waiting: agents.find(agent => agent.status === 'waiting').id }
  await mkdir(out, { recursive: true })
  for (const scheme of ['dark', 'light']) {
    for (const picture of PICTURES) {
      const context = await browser.newContext({ viewport: picture.viewport, deviceScaleFactor: 2, colorScheme: scheme, reducedMotion: 'reduce' })
      const page = await context.newPage()
      await page.goto(`${demo.url}/${picture.path(demo, runs)}`, { waitUntil: 'load' })
      await page.locator(picture.ready).first().waitFor()
      // The sidebar has every page of the project once the project's skills are read.
      await page.locator('a[href$="/tickets"]').first().waitFor({ state: 'attached' })
      await page.evaluate(() => document.fonts.ready)
      await page.addStyleTag({ content: '* { caret-color: transparent !important }' })
      // A picture for a public page names no computer and no one's home folder.
      await page.evaluate(([scrub]) => {
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          for (const [from, to] of scrub) if (node.nodeValue.includes(from)) node.nodeValue = node.nodeValue.replaceAll(from, to)
        }
      }, [[[demo.home, '~'], [homedir(), '~'], [hostname(), 'this computer']]])
      const clip = picture.clip ?? (await rows(page, picture.rows))
      // Chrome's own capture, which writes WebP; Playwright's writes PNG or JPEG only.
      const cdp = await context.newCDPSession(page)
      const { data } = await cdp.send('Page.captureScreenshot', { format: 'webp', quality: 90, clip: { ...clip, scale: 1 } })
      const file = new URL(`${picture.name}-${scheme}.webp`, out)
      await writeFile(file, Buffer.from(data, 'base64'))
      console.log(`${file.pathname.slice(file.pathname.indexOf('public/'))} ${clip.width * 2}x${clip.height * 2}`)
      await context.close()
    }
  }
} finally {
  await browser.close()
  await demo.stop()
}

/** The main column, from a margin over the first element to a margin under the second, on whole pixels. */
async function rows(page, [top, bottom]) {
  const main = await page.locator('main').boundingBox()
  const first = await page.locator(top).first().boundingBox()
  const last = await page.locator(bottom).first().boundingBox()
  const margin = 24
  const y = Math.max(0, Math.floor(first.y - margin))
  return { x: Math.ceil(main.x), y, width: Math.floor(main.width), height: Math.ceil(last.y + last.height + margin) - y }
}

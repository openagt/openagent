// What the browser smoke stories share (smoke-*.test.ts, see README.md): the demo's real dashboard
// in a real browser, for the flows a person goes through most. The page as it is laid out and run,
// its calls to the daemon over HTTP, the project's hooks, a run's own files: what the jsdom tests (no
// layout, the calls stubbed) and the backend stories (the calls made directly) each stop short of.
// A flow that fails leaves a screenshot in test-results/. Skipped on a machine with no Chrome; the
// demo needs `pnpm build`.
import { strict as assert } from 'node:assert'
import { mkdir } from 'node:fs/promises'
import { after, before } from 'node:test'
import { resolveChromePath } from '@openagt/skill-browser'
import { chromium, type Browser, type Page } from 'playwright-core'
import type { AgentMeta } from '../store/index.js'
import { startDemo, type Demo } from './demo.js'

const chrome = resolveChromePath()

/** The options of a smoke story: skipped where the machine has no Chrome. */
export const needsChrome = chrome ? {} : { skip: 'no Chrome on this machine' }

export interface Smoke {
  /** The demo of this file's stories. */
  demo(): Demo
  /** Go through one flow on a fresh page of the demo's project; a failure leaves a screenshot of the page. */
  flow(name: string, steps: (page: Page) => Promise<void>): Promise<void>
  /** Start a run from the launcher, as a person does. */
  start(page: Page, prompt: string): Promise<void>
  /** The project's runs, as the daemon lists them. */
  runs(): Promise<AgentMeta[]>
  /**
   * Wait until the run whose prompt this was is listed in one of `states`. The page shows a run's
   * first lines from its diary a moment before the list has the run.
   */
  runIn(prompt: string, states: AgentMeta['status'][]): Promise<AgentMeta>
}

/** A demo and a browser for the stories of the file that calls this, stood up before them and taken down after. */
export function smoke(): Smoke {
  let demo: Demo | undefined
  let browser: Browser | undefined

  before(async () => {
    if (!chrome) return
    demo = await startDemo()
    browser = await chromium.launch({ executablePath: chrome })
  })
  after(async () => {
    await browser?.close()
    await demo?.stop()
  })

  const theDemo = (): Demo => {
    if (!demo) throw new Error('no demo: the stories run only once it is up')
    return demo
  }
  const runs = (): Promise<AgentMeta[]> => theDemo().call<AgentMeta[]>('onAgents', theDemo().project.id)

  return {
    demo: theDemo,
    runs,

    async flow(name, steps) {
      const page = await browser!.newPage({ viewport: { width: 1280, height: 800 } })
      const thrown: string[] = []
      page.on('pageerror', err => thrown.push(err.message))
      try {
        await page.goto(`${theDemo().url}/${theDemo().project.id}`)
        await steps(page)
        assert.deepEqual(thrown, [], 'the page threw')
      } catch (err) {
        await mkdir('test-results', { recursive: true })
        await page.screenshot({ path: `test-results/smoke-${name}.png`, fullPage: true }).catch(() => {})
        throw err
      } finally {
        await page.close()
      }
    },

    async start(page, prompt) {
      await page.getByLabel('Prompt').click()
      await page.keyboard.type(prompt)
      await page.getByRole('button', { name: 'Start agent' }).click()
    },

    async runIn(prompt, states) {
      const deadline = Date.now() + 30_000
      let last: AgentMeta | undefined
      for (;;) {
        last = (await runs()).find(agent => agent.intent === prompt)
        if (last && states.includes(last.status)) return last
        if (Date.now() > deadline) throw new Error(`the run "${prompt}" was not ${states.join('/')} (last seen: ${last?.status ?? 'not listed'})`)
        await new Promise(r => setTimeout(r, 200))
      }
    },
  }
}

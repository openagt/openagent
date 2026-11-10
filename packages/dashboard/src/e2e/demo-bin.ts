// `pnpm demo` (see README.md): the demo, for a person. The real dashboard on a throwaway home, with a
// project whose runs are scripted and offline, opened in the browser. Ctrl+C stops it all and
// removes it.
import { openInBrowser } from '../cli/browser.js'
import { startDemo } from './demo.js'

const at = process.argv.indexOf('--port')
const port = at === -1 ? 0 : Number(process.argv[at + 1])
if (!Number.isInteger(port) || port < 0) {
  console.error('usage: pnpm demo [--port <n>]')
  process.exit(2)
}

console.log('Starting the demo…')
const demo = await startDemo({ port, seed: true })
const page = `${demo.url}/${demo.project.id}`
console.log(`
◆ OpenAgent demo: ${page}

  A dashboard of its own, on a throwaway home: none of your projects, agents or logins are in it.
  Its coding agent is scripted and offline. A word in the prompt picks what a run does:
    ask      asks a question, and waits for your answer
    hold     keeps working until you stop it
    commit   commits a file, so its branch has work on it
    refuse   fails to start, and the page says why
  Any other prompt is answered at once, and the run ends.

  The project "shop" has a run in each state, and two tickets.
  A project to add: ${demo.toAdd}

  Ctrl+C stops the demo and removes all of it.
`)
openInBrowser(page)

// Kept for every signal, not only the first: a second Ctrl+C must not cut the clean-up short and
// leave the dashboard, which runs in a process group of its own, behind.
await new Promise<void>(resolve => {
  process.on('SIGINT', () => resolve())
  process.on('SIGTERM', () => resolve())
})
console.log('Stopping the demo…')
await demo.stop()

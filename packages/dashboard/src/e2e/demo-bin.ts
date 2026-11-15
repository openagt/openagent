// `pnpm demo` (see README.md): the demo, for a person. The real dashboard on a throwaway home, with a
// project whose runs are scripted and offline, opened in the browser. Ctrl+C stops it all and
// removes it.
import { openInBrowser } from '../cli/browser.js'
import { portOf } from '../cli/cli.js'
import { projectAddresses } from '../project-address.js'
import { startDemo } from './demo.js'

const USAGE = `Usage: pnpm demo [--port <n>]

  The real dashboard on a throwaway home, with a project whose runs are scripted and offline.
  --port <n>  the port it listens on; a free one otherwise.`

/** The port the arguments ask for, 0 for a free one; or the first of them that cannot be read, said as `openagent` says it. */
function portAsked([first, value, extra]: string[]): number | { refused: string } {
  const unknown = (arg: string) => ({ refused: arg.startsWith('-') ? `unknown option: ${arg}` : `unknown command: ${arg}` })
  if (first === undefined) return 0
  if (first !== '--port') return unknown(first)
  const port = portOf(value)
  if (port === undefined) return { refused: 'invalid --port: must be a port number from 0 to 65535' }
  return extra === undefined ? port : unknown(extra)
}

const args = process.argv.slice(2)
if (args.length === 1 && (args[0] === '--help' || args[0] === '-h')) {
  console.log(USAGE)
  process.exit(0)
}
const port = portAsked(args)
if (typeof port !== 'number') {
  console.error(`${port.refused}\n\n${USAGE}`)
  process.exit(2)
}

console.log('Starting the demo…')
// The dashboard's last lines, said if it stops on its own.
const said: string[] = []
const demo = await startDemo({
  port,
  seed: true,
  log: line => {
    said.push(line)
    if (said.length > 20) said.shift()
  },
}).catch((err: unknown) => {
  // What went wrong is in the message, with the dashboard's own lines; a stack would only bury it.
  console.error(err instanceof Error ? err.message : String(err))
  process.exit(1)
})
// Printed at the address the page shows, opened by its id, as `openagent` does with a project.
const address = projectAddresses([demo.project.id], []).addressOf(demo.project.id)
console.log(`
◆ OpenAgent demo: ${demo.url}/${address}

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
openInBrowser(`${demo.url}/${demo.project.id}`)

// Kept for every signal, not only the first: a second Ctrl+C must not cut the clean-up short and
// leave the dashboard, which runs in a process group of its own, behind.
const signalled = new Promise<void>(resolve => {
  process.on('SIGINT', () => resolve())
  process.on('SIGTERM', () => resolve())
})
const died = await Promise.race([signalled.then(() => undefined), demo.exited.then(end => ({ end }))])
if (died) console.error(`\nThe dashboard stopped on its own (${typeof died.end === 'number' ? `exit ${died.end}` : died.end}). Its last lines:\n${said.join('\n')}\n`)
console.log('Stopping the demo…')
await demo.stop()
console.log('The demo is stopped.')
if (died) process.exit(1)

#!/usr/bin/env node
import { fileURLToPath } from 'node:url'
import { runCli } from '@openagt/ui/cli'

// `openagent`: the dashboard's command (`@openagt/ui`), serving this distribution's modules
// (`distribution.ts`). Exited outright once the command is done: a handle left over (a child, a
// timer, a socket) must not keep the process up after the dashboard stopped (#2141).
runCli(process.argv.slice(2), { distribution: fileURLToPath(new URL('./distribution.js', import.meta.url)) })
  .then(code => process.exit(code))
  .catch((err: unknown) => {
    console.error(err)
    process.exit(1)
  })

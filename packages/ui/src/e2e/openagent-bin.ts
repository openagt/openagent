#!/usr/bin/env node
import { fileURLToPath } from 'node:url'
import { runCli } from '../cli/cli.js'

// The demo's `openagent` (`demo.ts`): `ui`'s command as a distribution runs it, with the demo's
// distribution, whose runs are scripted (`distribution.ts`). Exited outright once the command is
// done, as `@openagt/dashboard`'s is.
runCli(process.argv.slice(2), { distribution: fileURLToPath(new URL('./distribution.js', import.meta.url)) })
  .then(code => process.exit(code))
  .catch((err: unknown) => {
    console.error(err)
    process.exit(1)
  })

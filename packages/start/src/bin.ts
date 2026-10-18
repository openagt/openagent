#!/usr/bin/env node
import { runCli } from './cli.js'

// Exited outright once the CLI is done: a handle left over (a child, a timer, a socket) must not
// keep the process up after the dashboard stopped (#2141).
runCli(process.argv.slice(2))
  .then(code => process.exit(code))
  .catch((err: unknown) => {
    console.error(err)
    process.exit(1)
  })

#!/usr/bin/env node
import { runCli } from './cli.js'

runCli(process.argv.slice(2))
  .then(code => {
    process.exitCode = code
  })
  .catch((err: unknown) => {
    console.error(err)
    process.exitCode = 1
  })

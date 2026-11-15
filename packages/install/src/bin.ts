#!/usr/bin/env node
import { runCommand } from './command.js'

runCommand('install', process.argv.slice(2))
  .then(code => process.exit(code))
  .catch((err: unknown) => {
    console.error(err)
    process.exit(1)
  })

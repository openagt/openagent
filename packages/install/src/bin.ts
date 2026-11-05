#!/usr/bin/env node
import { install } from './install.js'

install()
  .then(code => process.exit(code))
  .catch((err: unknown) => {
    console.error(err)
    process.exit(1)
  })

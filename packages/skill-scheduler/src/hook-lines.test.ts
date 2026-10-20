import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { lineRuns } from './hook-lines.js'

const TOOL = { name: '@openagt/skill-scheduler', commands: ['scheduler'] }

test('a line runs a tool by its bare command, by a path, or by its package\'s name with or without a version', () => {
  for (const line of [
    'scheduler start',
    'npx scheduler start',
    'npx @openagt/skill-scheduler start',
    'npx @openagt/skill-scheduler@0.1 start',
    'npx @openagt/skill-scheduler@^0.1.2 start',
    'FOO=1 scheduler start',
    './node_modules/.bin/scheduler start',
    'node /opt/tools/bin/scheduler start --foreground',
    'cd sub&&scheduler start',
    '"scheduler" stop --unless-keep-alive',
    'echo `scheduler status`',
  ])
    assert.equal(lineRuns(line, TOOL), true, line)
})

test('a name inside another word, and a line that names nothing of the tool, do not run it', () => {
  for (const line of ['npx my-scheduler-wrapper start', 'echo scheduler-is-not-here', 'agent-runner run --detach "$PROMPT"', 'npx @other/scheduler-plus start', ''])
    assert.equal(lineRuns(line, TOOL), false, line)
})

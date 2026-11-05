import { strict as assert } from 'node:assert'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

// Codex's request_user_input is under development (`features.default_mode_request_user_input`, off
// by default) and its messages are marked EXPERIMENTAL. The `codex` on this machine says what it
// speaks in a schema of its own (`codex app-server generate-json-schema`), so this checks that every
// field the driver reads and every request it sends is still there, and fails when an update takes
// one away. No model is asked. Skipped where no `codex` is installed.

const installed = spawnSync('codex', ['--version'], { encoding: 'utf8' })
const skip = installed.status === 0 ? false : 'no `codex` on PATH: the wire test of request_user_input did not run'

type Schema = { oneOf?: Schema[]; properties?: Record<string, Schema>; required?: string[]; enum?: string[]; $ref?: string; items?: Schema; definitions?: Record<string, Schema> }

/** The request `method` names in a ServerRequest or ClientRequest schema, with the definition of its params. */
function requestParams(file: Schema, method: string): Schema | undefined {
  const request = file.oneOf?.find(one => one.properties?.['method']?.enum?.includes(method))
  const ref = request?.properties?.['params']?.$ref?.replace('#/definitions/', '')
  return ref === undefined ? undefined : file.definitions?.[ref]
}

/** The definition a `$ref` names. */
const defined = (file: Schema, ref: string | undefined): Schema | undefined => (ref === undefined ? undefined : file.definitions?.[ref.replace('#/definitions/', '')])

test('the installed codex still asks request_user_input, and is still stopped, in the shape the driver reads', { skip }, () => {
  const features = execFileSync('codex', ['features', 'list'], { encoding: 'utf8' })
  assert.match(features, /^default_mode_request_user_input\s/m, 'the feature that gives the agent its question tool')

  const dir = mkdtempSync(join(tmpdir(), 'codex-schema-'))
  try {
    execFileSync('codex', ['app-server', 'generate-json-schema', '--out', dir], { stdio: 'ignore' })
    const read = (name: string): Schema => JSON.parse(readFileSync(join(dir, name), 'utf8')) as Schema
    const server = read('ServerRequest.json')
    const asked = requestParams(server, 'item/tool/requestUserInput')
    assert.ok(asked, 'Codex asks with item/tool/requestUserInput')
    for (const key of ['threadId', 'turnId', 'questions']) assert.ok(asked.required?.includes(key), `its params carry ${key}`)
    const question = defined(server, asked.properties?.['questions']?.items?.$ref)
    for (const key of ['question', 'header']) assert.ok(question?.required?.includes(key), `a question has its ${key}`)
    for (const key of ['options', 'isSecret']) assert.ok(question?.properties?.[key], `a question may have ${key}`)
    const option = defined(server, question?.properties?.['options']?.items?.$ref)
    for (const key of ['label', 'description']) assert.ok(option?.required?.includes(key), `an option has its ${key}`)

    const interrupt = requestParams(read('ClientRequest.json'), 'turn/interrupt')
    assert.deepEqual(interrupt?.required, ['threadId', 'turnId'], 'a turn is stopped by its conversation and its id')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { parsePlan, taskId, taskText } from './tasks.js'

const PLAN = `# Split the static site

In this repo (a single static GitHub Pages site, no build step) every task works in
\`site/\` and nowhere else.

## 1. Add the landing page

Level: simple
Files: site/index.html, \`site/index.css\`
Check: \`npx html-validate site/index.html\`
Uncertainty: 0

Write the page with a title and one paragraph.

## 2. Add the about page

Level: hard
Needs: Add the landing page
Uncertainty: 0

Reuse the landing page's stylesheet.
`

test('parsePlan: the prose above the first task is every task\'s context, and each `## ` heading is one task', () => {
  const plan = parsePlan(PLAN)
  assert.equal(plan.context, 'In this repo (a single static GitHub Pages site, no build step) every task works in\n`site/` and nowhere else.')
  assert.deepEqual(plan.problems, [])
  assert.deepEqual(plan.tasks, [
    {
      id: 'add-the-landing-page',
      name: '1. Add the landing page',
      level: 'simple',
      files: ['site/index.html', 'site/index.css'],
      check: 'npx html-validate site/index.html',
      uncertainty: 0,
      body: 'Write the page with a title and one paragraph.',
    },
    {
      id: 'add-the-about-page',
      name: '2. Add the about page',
      level: 'hard',
      depends: ['add-the-landing-page'],
      uncertainty: 0,
      body: "Reuse the landing page's stylesheet.",
    },
  ])
})

test('parsePlan: a plan with nothing above its first task has no context, and a plan with no title is all context', () => {
  assert.equal(parsePlan('# Only a title\n\n## Do it\n\nUncertainty: 0\n').context, undefined)
  assert.equal(parsePlan('Read the README first.\n\n## Do it\n').context, 'Read the README first.')
  assert.equal(parsePlan('# T\n\nThe context.\n').context, 'The context.', 'with no task at all, what is there is still context')
})

test('taskId: the heading lowercased, one dash per run of anything else, a leading ordinal dropped, and the place when nothing is left', () => {
  assert.equal(taskId('Add the tests'), 'add-the-tests')
  assert.equal(taskId('2. Add the docs'), 'add-the-docs')
  assert.equal(taskId('3) Fix the CSS'), 'fix-the-css')
  assert.equal(taskId('Make `site/a.ts` smaller!'), 'make-site-a-ts-smaller')
  assert.equal(taskId('Fix 2 tests'), 'fix-2-tests', 'a number that is not the heading\'s own ordinal stays')
  assert.equal(taskId('???'), '')
  assert.deepEqual(
    parsePlan('## ???\n\n## ...\n').tasks.map(one => one.id),
    ['task-1', 'task-2'],
    'a heading that slugs to nothing is named by its place',
  )
})

test('parsePlan: a `Check:` line above the first task is the plan\'s own check, and no part of the context a subagent is told', () => {
  const plan = parsePlan('# T\n\nWork in `src/`.\n\nCheck: `pnpm -w test`\n\n## Do it\n\nLevel: simple\nCheck: pnpm test\nUncertainty: 0\n')
  assert.equal(plan.check, 'pnpm -w test')
  assert.equal(plan.context, 'Work in `src/`.', 'the check line is out of the context')
  assert.equal(plan.tasks[0]?.check, 'pnpm test', 'a task keeps its own check line')
  assert.equal(taskText(plan, plan.tasks[0]!), 'Work in `src/`.\n\nDo it\n\nCheck your work with: pnpm test', 'the plan\'s check is nowhere in what a subagent is given')
  assert.equal(parsePlan('check: pnpm verify\n\n## A\n').check, 'pnpm verify', 'whatever its case, and with no title above it')
  const twice = parsePlan('# T\n\nCheck: one\nCheck: two\n\n## A\n')
  assert.deepEqual([twice.check, twice.context], ['one', undefined], 'the first line is the check, and neither line is context')
  assert.equal(parsePlan('# T\n\nThe prose.\n\n## A\n').check, undefined)
  assert.equal(parsePlan('# T\n\nCheck:\n\n## A\n').check, undefined, 'a line that names no command is no check')
})

test('parsePlan: a key is read whatever its case and wherever it stands under the heading, and never twice', () => {
  const plan = parsePlan('## Do it\n\nFirst, read the README.\n\nlevel: HARD\nUNCERTAINTY: 2\nLevel: simple\nCheck: pnpm test\n')
  assert.deepEqual(plan.tasks[0], { id: 'do-it', name: 'Do it', level: 'hard', check: 'pnpm test', uncertainty: 2, body: 'First, read the README.' })
  assert.deepEqual(plan.problems, [], 'the second Level: is a line of the plan the first one already answered')
})

test('parsePlan: a value that is no value leaves its key out, and a level that is no level is a problem', () => {
  const plan = parsePlan('## Do it\n\nLevel: medium\nUncertainty: 15\nFiles:\nCheck: ``\n')
  assert.deepEqual(plan.tasks[0], { id: 'do-it', name: 'Do it', body: '' })
  assert.deepEqual(plan.problems, ['the task "Do it" is at level "medium": a task is simple or hard'])
  for (const written of ['11', '2.5', ' ', 'zero', '-1']) assert.equal(parsePlan(`## Do it\n\nUncertainty: ${written}\n`).tasks[0]?.uncertainty, undefined, written)
  for (const written of ['0', '10', '7']) assert.equal(parsePlan(`## Do it\n\nUncertainty: ${written}\n`).tasks[0]?.uncertainty, Number(written), written)
})

test('parsePlan: a `Needs:` is read as the ids of the tasks it names, by id or by name, and waiting for nothing is no dependency', () => {
  const plan = parsePlan('## A\n\n## B\n\nNeeds: a, A\n\n## C\n\nNeeds: nothing\n\n## D\n\nNeeds: B, c\n')
  assert.deepEqual(
    plan.tasks.map(one => one.depends),
    [undefined, ['a'], undefined, ['b', 'c']],
  )
  assert.deepEqual(plan.problems, [], 'one task named twice in a Needs: is one dependency the plan has')
})

test('parsePlan: what makes a text no task list', () => {
  assert.deepEqual(parsePlan('# A plan with no task\n\nJust prose.\n').problems, ['the plan has no task: write one `## ` heading per task, and the prose every task needs above the first'])
  assert.deepEqual(parsePlan('## Add the tests\n\n## Add the tests\n').problems, ['two tasks are named "Add the tests": give each task a heading of its own'])
  assert.deepEqual(parsePlan('## 1. Add the tests\n\n## 2) add-the-tests\n').problems.length, 1, 'two headings one id names are two tasks `--task` cannot tell apart')
  assert.deepEqual(parsePlan('## A\n\nNeeds: the other one, B\n\n## B\n').problems, ['the task "A" needs "the-other-one", which is no task in this plan'])
  assert.deepEqual(parsePlan('## A\n\nNeeds: A\n').problems, [], 'a task that names itself waits for nothing')
})

test('taskText: the shared context, then the task\'s own words, then the files it owns and how to check it', () => {
  const plan = parsePlan(PLAN)
  assert.equal(
    taskText(plan, plan.tasks[0]!),
    'In this repo (a single static GitHub Pages site, no build step) every task works in\n`site/` and nowhere else.\n\n' +
      '1. Add the landing page\n\nWrite the page with a title and one paragraph.\n\n' +
      'The files this task changes: site/index.html, site/index.css\n\n' +
      'Check your work with: npx html-validate site/index.html',
  )
  assert.equal(taskText(plan, plan.tasks[1]!), plan.context + '\n\n2. Add the about page\n\nReuse the landing page\'s stylesheet.', 'nothing is said about files or a check the task does not name')
  assert.equal(taskText({ tasks: [], problems: [] }, { id: 'a', name: 'Do it', body: '' }), 'Do it', 'a plan with no context and a task with no words is its name alone')
})

import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { makeWorld } from './harness.js'
import { runModuleCommand } from '../dashboard-rpc/modules.js'
import { DATA_BRANCH } from '@openagt/git-branches'
import { pullFileBranch } from '@openagt/store-filesystem'
import { onAttention } from '../dashboard-rpc/attention.js'
import { callModule } from '../dashboard-rpc/module-calls.js'

// The roadmap stories (README.md): tickets are proposals, the agent queue holds confirmed work —
// the propose -> decide half of the loop the Tickets page and the AI Queue card drive. Both are a
// project package's (#1774, #2394): OpenAgent reads neither, and writes neither; the packages' own
// modules read them through their server parts, change them in the browser through their commands,
// and say what the onboarding asks of them (`app.attention`). Working the queue is the scheduler's: it starts an agent when the branch moves, and
// that agent reads the skills itself.

const TICKET_FILE = '2026-08-01_login-page.md'
/** The fixture's module packages: the modules' commands are these packages' own. */
const QUEUE_PACKAGE = '@openagt/queue'
const TICKETS_PACKAGE = '@openagt/tickets'
const TICKET = [
  'priority: 8',
  '',
  '# Login page',
  '',
  '## TLDR',
  '',
  'Add a login page with session cookies.',
  '',
].join('\n')

/** One ticket as the tickets command lists it. */
interface TicketRow {
  file: string
  title: string
  summary: string
  priority?: string
  lockedBy?: string
}

test('browse the ticket backlog: the module reads the list and one ticket through the tickets command (#697/#1144/#1774)', async () => {
  const world = await makeWorld()
  const rpc = world.rpc
  try {
    const project = await world.addProject({
      'README.md': '# fixture\n',
      [`tickets/${TICKET_FILE}`]: TICKET,
      'tickets/2026-08-02_dark-mode.md': '# Dark mode\n\n## TLDR\n\nHonor prefers-color-scheme.\n',
    })

    // The Tickets page is the tickets package's module: it lists through the package's own
    // command, in this machine's copy of the branch.
    const listed = await rpc(runModuleCommand)(project.id, TICKETS_PACKAGE, ['list', '--local'])
    assert.equal(listed.ok, true, `the list failed: ${listed.ok ? '' : listed.error}`)
    const tickets = listed.output as TicketRow[]
    assert.equal(tickets.length, 2)
    const login = tickets.find(t => t.file === TICKET_FILE)
    assert.equal(login?.title, 'Login page')
    assert.equal(login?.priority, '8')
    assert.equal(login?.summary, 'Add a login page with session cookies.')

    // The ticket's own page carries the full text; a sibling/path name is refused by the command.
    const shown = await rpc(runModuleCommand)(project.id, TICKETS_PACKAGE, ['show', TICKET_FILE, '--local'])
    assert.equal(shown.ok, true)
    const detail = shown.output as { ok: boolean; ticket: { content: string } }
    assert.ok(detail.ticket.content.includes('session cookies'))
    const escaped = await rpc(runModuleCommand)(project.id, TICKETS_PACKAGE, ['show', '../escape.md', '--local'])
    assert.equal(escaped.ok, false, 'a path that is no ticket filename is refused')

    // The project has tickets: the tickets do not ask to be populated among the first steps.
    const { items } = await rpc(onAttention)(null)
    assert.deepEqual(items.filter(item => item.module === 'tickets'), [])
  } finally {
    await world.close()
  }
})

test("a claim released by hand from the module is the tickets command's own act, and the next read shows it gone at once (#1420/#1774)", async () => {
  const world = await makeWorld()
  const rpc = world.rpc
  try {
    const project = await world.addProject({
      'README.md': '# fixture\n',
      [`tickets/${TICKET_FILE}`]: TICKET,
      [`tickets/${TICKET_FILE.replace(/\.md$/, '.lock.md')}`]: 'CLAIMED: agent-2026-08-01T00-00-00-000Z\n',
    })
    const synced = await pullFileBranch(project.cwd, DATA_BRANCH)
    assert.equal(synced.ok, true, `the fixture's data branch did not converge: ${synced.ok ? '' : synced.error}`)

    const holderOf = async (): Promise<string | undefined> => {
      const shown = await rpc(runModuleCommand)(project.id, TICKETS_PACKAGE, ['show', TICKET_FILE, '--local'])
      assert.equal(shown.ok, true, `the show failed: ${shown.ok ? '' : shown.error}`)
      return (shown.output as { holder?: string }).holder
    }
    assert.equal(await holderOf(), 'agent-2026-08-01T00-00-00-000Z')

    // The release, as the module runs it: the package's command with `--force` (a person's act on
    // a claim nobody answers to), marked as an act so this machine's copy converges with origin
    // and the page's next read sees the lock gone, not the daemon's next sync.
    const released = await rpc(runModuleCommand)(project.id, TICKETS_PACKAGE, ['release', TICKET_FILE, '--force'], undefined, true)
    assert.equal(released.ok, true, `the release failed: ${released.ok ? '' : released.error}`)
    assert.deepEqual(released.output, { ok: true, file: `tickets/${TICKET_FILE}` })
    assert.equal(await holderOf(), undefined, "the lock is gone from this machine's copy at once")
    // Released, the ticket still lists, unclaimed.
    const listed = await rpc(runModuleCommand)(project.id, TICKETS_PACKAGE, ['list', '--local'])
    assert.equal(listed.ok, true)
    const row = (listed.output as { file: string; lockedBy?: string }[]).find(t => t.file === TICKET_FILE)
    assert.deepEqual({ listed: row !== undefined, holder: row?.lockedBy }, { listed: true, holder: undefined })
  } finally {
    await world.close()
  }
})

test('the queue is read through the queue module, the boards show a queued ticket, and the queue module\'s action is seen at once (#1164/#1774)', async () => {
  const world = await makeWorld()
  const rpc = world.rpc
  try {
    // The queue as an agent left it: a link back to the ticket in the priority section the
    // ticket's own priority earns, on the `agent-data` branch, on origin and in this machine's
    // copy, as the daemon's data sync keeps them.
    const project = await world.addProject({
      'README.md': '# fixture\n',
      [`tickets/${TICKET_FILE}`]: TICKET,
      'TODO_AGENTS.md': `## Priority 8\n\n- [Login page](tickets/${TICKET_FILE})\n`,
    })
    const synced = await pullFileBranch(project.cwd, DATA_BRANCH)
    assert.equal(synced.ok, true, `the fixture's data branch did not converge: ${synced.ok ? '' : synced.error}`)

    // The queue's own server part reads it, as its page and its card do.
    const entries = async () => {
      const read = await rpc(callModule)(project.id, QUEUE_PACKAGE, 'entries', {})
      return read.ok ? (read.output as { entry: string }[]).map(one => one.entry) : read.error
    }
    assert.deepEqual(await entries(), [`[Login page](tickets/${TICKET_FILE})`], 'the entry, as the command prints it')

    // The queue package's "Add to queue" action, as the dashboard runs it: the package's own
    // command, marked as an act. The command writes as a remote writer, straight to origin;
    // OpenAgent then converges this machine's copy, so the boards show the entry at
    // once, in its own lower section, not at the daemon's next sync.
    const added = await rpc(runModuleCommand)(project.id, QUEUE_PACKAGE, ['add', '[Dark mode](tickets/2026-08-02_dark-mode.md)', '--priority', '3'], undefined, true)
    assert.equal(added.ok, true, `the add failed: ${added.ok ? '' : added.error}`)
    assert.deepEqual(await entries(), [`[Login page](tickets/${TICKET_FILE})`, '[Dark mode](tickets/2026-08-02_dark-mode.md)'])
  } finally {
    await world.close()
  }
})

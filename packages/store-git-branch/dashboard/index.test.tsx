import { expect, test } from 'vitest'
import { fakeHost } from '@openagt/ui/module/testing'
import gitBranch from './index.js'

test("the module adds a project's Agent data to Settings, one project at a time, and the project's menu opens it", async () => {
  const views = gitBranch.hooks['ui.view'] ?? []
  expect(views.map(view => `${view.place} ${view.id}`)).toEqual(['settings.section project-agent-data'])
  const entry = views[0]
  expect(entry?.place === 'settings.section' && [entry.title, entry.order, entry.pickProject !== undefined]).toEqual(['Project agent data', 50, true])
  const action = (gitBranch.hooks['ui.action'] ?? []).find(each => each.place === 'project.menu')
  expect(action?.label).toBe('Agent data…')
  const host = fakeHost('@openagt/store-git-branch')
  expect(await action?.run?.(host, { projectId: 'p1' } as never)).toEqual({ ok: true })
  expect(host.openSettings).toHaveBeenCalledWith('project-agent-data', 'p1')
})

import { describe, it, expect } from 'vitest'
import { parseRoute, formatRoute, keepPageQuery, pageHref } from './route.js'

describe('parseRoute', () => {
  it('reads the Overview from the root', () => {
    expect(parseRoute('/')).toEqual({ projectId: null, agentId: null })
    expect(parseRoute('')).toEqual({ projectId: null, agentId: null })
  })

  it('reads a project home', () => {
    expect(parseRoute('/my-repo-a1b2')).toEqual({ projectId: 'my-repo-a1b2', agentId: null, scope: 'my-repo-a1b2' })
  })

  it('reads a session', () => {
    expect(parseRoute('/my-repo-a1b2/2026-07-19-1200-ab')).toEqual({
      projectId: 'my-repo-a1b2',
      agentId: '2026-07-19-1200-ab',
      scope: 'my-repo-a1b2',
    })
  })

  it('ignores a trailing slash and extra segments', () => {
    expect(parseRoute('/my-repo/run-1/')).toEqual({ projectId: 'my-repo', agentId: 'run-1', scope: 'my-repo' })
    expect(parseRoute('/my-repo/run-1/whatever')).toEqual({ projectId: 'my-repo', agentId: 'run-1', scope: 'my-repo' })
  })

  it('decodes segments, and keeps a malformed one as typed', () => {
    expect(parseRoute('/a%20b/c%2Fd')).toEqual({ projectId: 'a b', agentId: 'c/d', scope: 'a b' })
    expect(parseRoute('/%E0%A4%A')).toEqual({ projectId: '%E0%A4%A', agentId: null, scope: '%E0%A4%A' })
  })

  it('reads no tickets view: `/tickets` is a module page like any other bare word (#1774)', () => {
    expect(parseRoute('/tickets')).toEqual({ projectId: null, agentId: null, page: 'tickets', pagePath: [] })
    expect(parseRoute('/tickets/my-repo-a1b2/2026-07-20_do-the-thing.md/plan')).toEqual({
      projectId: null,
      agentId: null,
      page: 'tickets',
      pagePath: ['my-repo-a1b2', '2026-07-20_do-the-thing.md', 'plan'],
    })
    // Under a project, `tickets` is an agent id like any other second segment.
    expect(parseRoute('/my-repo-a1b2/tickets')).toEqual({ projectId: 'my-repo-a1b2', agentId: 'tickets', scope: 'my-repo-a1b2' })
  })

  it('reads the Settings dialog over any page, by its entry', () => {
    expect(parseRoute('/?settings=agent')).toEqual({ projectId: null, agentId: null, settings: 'agent' })
    expect(parseRoute('/?settings=')).toEqual({ projectId: null, agentId: null, settings: '' })
    expect(parseRoute('/app-a1/run-1?settings=machines')).toEqual({ projectId: 'app-a1', agentId: 'run-1', scope: 'app-a1', settings: 'machines' })
    expect(parseRoute('/logs/x?settings=agent')).toEqual({ projectId: null, agentId: null, page: 'logs', pagePath: ['x'], settings: 'agent' })
  })

  it('reads the old Settings page\'s address as the dialog over the Overview (#958)', () => {
    expect(parseRoute('/settings')).toEqual({ projectId: null, agentId: null, settings: '' })
    expect(parseRoute('/settings/')).toEqual({ projectId: null, agentId: null, settings: '' })
    expect(parseRoute('/settings/machines')).toEqual({ projectId: null, agentId: null, settings: 'machines' })
  })

  it('leaves every other first segment a project, so only the reserved word is taken (#958)', () => {
    // A generated project id is `<name>-<hash>`, so it can never be the bare reserved word —
    // but anything merely starting with it still has to route to a project.
    expect(parseRoute('/settings-a1b2')).toEqual({ projectId: 'settings-a1b2', agentId: null, scope: 'settings-a1b2' })
    expect(parseRoute('/my-settings')).toEqual({ projectId: 'my-settings', agentId: null, scope: 'my-settings' })
  })
})

describe('formatRoute', () => {
  it('writes each route', () => {
    expect(formatRoute({ projectId: null, agentId: null })).toBe('/')
    expect(formatRoute({ projectId: 'my-repo', agentId: null, scope: 'my-repo' })).toBe('/my-repo')
    expect(formatRoute({ projectId: 'my-repo', agentId: 'run-1', scope: 'my-repo' })).toBe('/my-repo/run-1')
  })

  it('has no session without a project', () => {
    expect(formatRoute({ projectId: null, agentId: 'run-1' })).toBe('/')
  })

  it('encodes segments', () => {
    expect(formatRoute({ projectId: 'a b', agentId: 'c/d', scope: 'a b' })).toBe('/a%20b/c%2Fd')
  })

  it('writes the Settings dialog after the page it is open over', () => {
    expect(formatRoute({ projectId: null, agentId: null, settings: '' })).toBe('/?settings=')
    expect(formatRoute({ projectId: 'my-repo', agentId: 'run-1', scope: 'my-repo', settings: 'agent' })).toBe('/my-repo/run-1?settings=agent')
  })

  it('round-trips', () => {
    for (const route of [
      { projectId: null, agentId: null },
      { projectId: 'my-repo', agentId: null, scope: 'my-repo' },
      { projectId: 'my-repo', agentId: 'run-1', scope: 'my-repo' },
      { projectId: 'a b', agentId: 'c/d', scope: 'a b' },
      { projectId: null, agentId: null, settings: '' },
      { projectId: 'my-repo', agentId: 'run-1', scope: 'my-repo', settings: 'agent' },
      { projectId: null, agentId: null, page: 'tickets', pagePath: ['my-repo', '2026-07-20_thing.md', 'plan'] },
      { projectId: null, agentId: null, page: 'logs', pagePath: [] },
      { projectId: null, agentId: null, page: 'logs', pagePath: ['a b', 'c'] },
    ]) {
      expect(parseRoute(formatRoute(route))).toEqual(route)
    }
  })

  it('a first segment with no dash names a module\'s page, never a project (#1774)', () => {
    expect(parseRoute('/logs')).toEqual({ projectId: null, agentId: null, page: 'logs', pagePath: [] })
    expect(parseRoute('/logs/run-1')).toEqual({ projectId: null, agentId: null, page: 'logs', pagePath: ['run-1'] })
    // A project id always has its `-<hash>`, and the one reserved word opens Settings.
    expect(parseRoute('/my-repo')).toEqual({ projectId: 'my-repo', agentId: null, scope: 'my-repo' })
    expect(parseRoute('/settings')).toEqual({ projectId: null, agentId: null, settings: '' })
    expect(formatRoute({ projectId: null, agentId: null, page: 'logs' })).toBe('/logs')
  })
})

describe('the picked project (#1513)', () => {
  it('reads `?project=` on the Overview, a module\'s page and Settings', () => {
    expect(parseRoute('/?project=app-a1')).toEqual({ projectId: null, agentId: null, scope: 'app-a1' })
    expect(parseRoute('/logs/x?project=app-a1')).toEqual({ projectId: null, agentId: null, page: 'logs', pagePath: ['x'], scope: 'app-a1' })
    expect(parseRoute('/settings?project=app-a1')).toEqual({ projectId: null, agentId: null, settings: '', scope: 'app-a1' })
    expect(parseRoute('/?project=app-a1&settings=agent')).toEqual({ projectId: null, agentId: null, scope: 'app-a1', settings: 'agent' })
  })

  it('reads none when the parameter is absent or empty', () => {
    expect(parseRoute('/?other=1')).toEqual({ projectId: null, agentId: null })
    expect(parseRoute('/logs?project=')).toEqual({ projectId: null, agentId: null, page: 'logs', pagePath: [] })
  })

  it('on a project\'s own page, the picked project is that project unless `?all` says every project shows', () => {
    expect(parseRoute('/app-a1')).toEqual({ projectId: 'app-a1', agentId: null, scope: 'app-a1' })
    expect(parseRoute('/app-a1/run-1?all')).toEqual({ projectId: 'app-a1', agentId: 'run-1' })
    expect(parseRoute('/app-a1?all&settings=agent')).toEqual({ projectId: 'app-a1', agentId: null, settings: 'agent' })
    // Its id is never written twice, and a `?project=` there names nothing.
    expect(parseRoute('/app-a1/run-1?project=other-b2')).toEqual({ projectId: 'app-a1', agentId: 'run-1', scope: 'app-a1' })
    expect(formatRoute({ projectId: 'app-a1', agentId: null, scope: 'other-b2' })).toBe('/app-a1')
    expect(formatRoute({ projectId: 'app-a1', agentId: 'run-1' })).toBe('/app-a1/run-1?all')
    expect(formatRoute({ projectId: 'app-a1', agentId: null, settings: 'agent' })).toBe('/app-a1?all&settings=agent')
  })

  it('writes it after the path, encoded, and round-trips', () => {
    expect(formatRoute({ projectId: null, agentId: null, scope: 'a b-1' })).toBe('/?project=a%20b-1')
    expect(formatRoute({ projectId: null, agentId: null, scope: 'app-a1', settings: 'agent' })).toBe('/?project=app-a1&settings=agent')
    for (const route of [
      { projectId: null, agentId: null, scope: 'app-a1' },
      { projectId: 'app-a1', agentId: 'run-1', scope: 'app-a1' },
      { projectId: 'app-a1', agentId: 'run-1' },
      { projectId: null, agentId: null, page: 'logs', pagePath: ['x', 'y'], scope: 'app-a1' },
    ])
      expect(parseRoute(formatRoute(route))).toEqual(route)
  })

  it('keeps what a page mirrored into the query, and replaces only the picked project', () => {
    expect(keepPageQuery('/tickets?project=app-a1', '?q=races&project=old-b2')).toBe('/tickets?q=races&project=app-a1')
    expect(keepPageQuery('/tickets', '?q=races&project=old-b2')).toBe('/tickets?q=races')
    expect(keepPageQuery('/', '?project=old-b2')).toBe('/')
    // Settings opening or closing over a page keeps the page's own query, and never a stale entry.
    expect(keepPageQuery('/tickets?settings=agent', '?q=races')).toBe('/tickets?q=races&settings=agent')
    expect(keepPageQuery('/tickets', '?q=races&settings=agent')).toBe('/tickets?q=races')
    // A project's own page says "every project" with a bare word, and drops it when one is picked.
    expect(keepPageQuery('/app-a1?all', '?settings=agent')).toBe('/app-a1?all')
    expect(keepPageQuery('/app-a1?settings=', '?all')).toBe('/app-a1?settings=')
  })
})

describe('pageHref', () => {
  it("a module page's address for a link, with the one project the dashboard shows when one is picked", () => {
    expect(pageHref('queue', '/')).toBe('/queue')
    expect(pageHref('queue', '/?project=shop-1abc')).toBe('/queue?project=shop-1abc')
    // A project's own page picks its project unless every project shows.
    expect(pageHref('queue', '/shop-1abc/run-1')).toBe('/queue?project=shop-1abc')
    expect(pageHref('queue', '/shop-1abc/run-1?all')).toBe('/queue')
    // What else the page mirrored in its address is that page's own, and is not carried to another.
    expect(pageHref('automations', '/tickets?q=login&project=shop-1abc')).toBe('/automations?project=shop-1abc')
  })
})

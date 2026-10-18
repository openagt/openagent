import { describe, it, expect } from 'vitest'
import { parseRoute, formatRoute, keepPageQuery, type Route } from './route.js'
import { projectAddresses, NO_PROJECTS } from '../../src/project-address.js'

// Two projects named `shop` (the second one added gets its id as its address), one named `app`,
// and one named as a page's word.
const projects = projectAddresses(['shop-1abc', 'app-a1', 'shop-2def', 'logs-9zz'], ['logs', 'tickets'])
const parse = (url: string): Route => parseRoute(url, projects)
const format = (route: Route): string => formatRoute(route, projects)

describe('parseRoute', () => {
  it('reads the Overview of every project from the root', () => {
    expect(parse('/')).toEqual({ projectId: null, agentId: null })
    expect(parse('')).toEqual({ projectId: null, agentId: null })
  })

  it('reads a module page over every project', () => {
    expect(parse('/logs')).toEqual({ projectId: null, agentId: null, page: 'logs', pagePath: [] })
    expect(parse('/logs/a%20b/c')).toEqual({ projectId: null, agentId: null, page: 'logs', pagePath: ['a b', 'c'] })
  })

  it("reads a project's New agent page, with the project picked", () => {
    expect(parse('/app')).toEqual({ projectId: 'app-a1', agentId: null, scope: 'app-a1' })
    expect(parse('/shop-2def')).toEqual({ projectId: 'shop-2def', agentId: null, scope: 'shop-2def' })
    expect(parse('/logs-9zz')).toEqual({ projectId: 'logs-9zz', agentId: null, scope: 'logs-9zz' })
  })

  it("reads a project's agent: a second segment that starts with a digit", () => {
    expect(parse('/app/2026-07-19T12-00-00-000Z')).toEqual({ projectId: 'app-a1', agentId: '2026-07-19T12-00-00-000Z', scope: 'app-a1' })
  })

  it("reads a project's Overview and its module pages: a second segment that is a word", () => {
    expect(parse('/app/overview')).toEqual({ projectId: null, agentId: null, scope: 'app-a1' })
    expect(parse('/app/logs')).toEqual({ projectId: null, agentId: null, page: 'logs', pagePath: [], scope: 'app-a1' })
    expect(parse('/app/tickets/2026-07-20_do-the-thing.md/plan')).toEqual({
      projectId: null,
      agentId: null,
      page: 'tickets',
      pagePath: ['2026-07-20_do-the-thing.md', 'plan'],
      scope: 'app-a1',
    })
  })

  it('reads a project named by its id as that project', () => {
    expect(parse('/app-a1')).toEqual({ projectId: 'app-a1', agentId: null, scope: 'app-a1' })
    expect(parse('/shop-1abc/logs')).toEqual({ projectId: null, agentId: null, page: 'logs', pagePath: [], scope: 'shop-1abc' })
  })

  it('reads a first segment no project has and no page can be as a project nobody registered', () => {
    expect(parse('/gone-7x/1-run')).toEqual({ projectId: 'gone-7x', agentId: '1-run', scope: 'gone-7x' })
    // A word is a page's, even one no package adds: the page then says so.
    expect(parse('/gone')).toEqual({ projectId: null, agentId: null, page: 'gone', pagePath: [] })
  })

  it('ignores a trailing slash and extra segments', () => {
    expect(parse('/app/1-run/')).toEqual({ projectId: 'app-a1', agentId: '1-run', scope: 'app-a1' })
    expect(parse('/app/1-run/whatever')).toEqual({ projectId: 'app-a1', agentId: '1-run', scope: 'app-a1' })
    expect(parse('/app/overview/whatever')).toEqual({ projectId: null, agentId: null, scope: 'app-a1' })
  })

  it('decodes segments, and keeps a malformed one as typed', () => {
    expect(parse('/a%20b-1/1%2Fd')).toEqual({ projectId: 'a b-1', agentId: '1/d', scope: 'a b-1' })
    expect(parse('/%E0%A4%A')).toEqual({ projectId: '%E0%A4%A', agentId: null, scope: '%E0%A4%A' })
  })

  it('reads the Settings dialog over any page, by its entry', () => {
    expect(parse('/?settings=agent')).toEqual({ projectId: null, agentId: null, settings: 'agent' })
    expect(parse('/?settings=')).toEqual({ projectId: null, agentId: null, settings: '' })
    expect(parse('/app/1-run?settings=machines')).toEqual({ projectId: 'app-a1', agentId: '1-run', scope: 'app-a1', settings: 'machines' })
    expect(parse('/app/logs/x?settings=agent')).toEqual({ projectId: null, agentId: null, page: 'logs', pagePath: ['x'], scope: 'app-a1', settings: 'agent' })
  })

  it("reads the old Settings page's address as the dialog over the Overview (#958)", () => {
    expect(parse('/settings')).toEqual({ projectId: null, agentId: null, settings: '' })
    expect(parse('/settings/')).toEqual({ projectId: null, agentId: null, settings: '' })
    expect(parse('/settings/machines')).toEqual({ projectId: null, agentId: null, settings: 'machines' })
  })

  it('reads `/overview` as the Overview of every project', () => {
    expect(parse('/overview')).toEqual({ projectId: null, agentId: null })
  })

  it('names a project by its name only once the projects are known', () => {
    expect(parseRoute('/app', NO_PROJECTS)).toEqual({ projectId: null, agentId: null, page: 'app', pagePath: [] })
    expect(parseRoute('/app-a1', NO_PROJECTS)).toEqual({ projectId: 'app-a1', agentId: null, scope: 'app-a1' })
  })
})

describe('formatRoute', () => {
  it('writes each route, the project first by its address', () => {
    expect(format({ projectId: null, agentId: null })).toBe('/')
    expect(format({ projectId: null, agentId: null, page: 'logs' })).toBe('/logs')
    expect(format({ projectId: 'app-a1', agentId: null, scope: 'app-a1' })).toBe('/app')
    expect(format({ projectId: null, agentId: null, scope: 'app-a1' })).toBe('/app/overview')
    expect(format({ projectId: null, agentId: null, page: 'logs', scope: 'app-a1' })).toBe('/app/logs')
    expect(format({ projectId: null, agentId: null, page: 'tickets', pagePath: ['a.md', 'plan'], scope: 'app-a1' })).toBe('/app/tickets/a.md/plan')
    expect(format({ projectId: 'app-a1', agentId: '1-run', scope: 'app-a1' })).toBe('/app/1-run')
    expect(format({ projectId: 'shop-2def', agentId: null, scope: 'shop-2def' })).toBe('/shop-2def')
    expect(format({ projectId: null, agentId: null, page: 'logs', scope: 'logs-9zz' })).toBe('/logs-9zz/logs')
  })

  it('has no session without a project', () => {
    expect(format({ projectId: null, agentId: '1-run' })).toBe('/')
  })

  it('encodes segments', () => {
    expect(format({ projectId: 'a b-1', agentId: '1/d', scope: 'a b-1' })).toBe('/a%20b-1/1%2Fd')
  })

  it('writes the Settings dialog after the page it is open over', () => {
    expect(format({ projectId: null, agentId: null, settings: '' })).toBe('/?settings=')
    expect(format({ projectId: 'app-a1', agentId: '1-run', scope: 'app-a1', settings: 'agent' })).toBe('/app/1-run?settings=agent')
    expect(format({ projectId: null, agentId: null, scope: 'app-a1', settings: 'agent' })).toBe('/app/overview?settings=agent')
  })

  it('round-trips', () => {
    for (const route of [
      { projectId: null, agentId: null },
      { projectId: 'app-a1', agentId: null, scope: 'app-a1' },
      { projectId: 'app-a1', agentId: '1-run', scope: 'app-a1' },
      { projectId: 'app-a1', agentId: '1-run' },
      { projectId: 'shop-2def', agentId: '1-run', scope: 'shop-2def' },
      { projectId: 'a b-1', agentId: '1/d', scope: 'a b-1' },
      { projectId: null, agentId: null, settings: '' },
      { projectId: 'app-a1', agentId: '1-run', scope: 'app-a1', settings: 'agent' },
      { projectId: null, agentId: null, scope: 'app-a1' },
      { projectId: null, agentId: null, page: 'tickets', pagePath: ['2026-07-20_thing.md', 'plan'], scope: 'app-a1' },
      { projectId: null, agentId: null, page: 'logs', pagePath: [] },
      { projectId: null, agentId: null, page: 'logs', pagePath: ['a b', 'c'] },
      { projectId: null, agentId: null, page: 'logs', pagePath: [], scope: 'logs-9zz' },
    ]) {
      expect(parse(format(route))).toEqual(route)
    }
  })
})

describe('the picked project (#1513)', () => {
  it("on a project's own page, the picked project is that project unless `?all` says every project shows", () => {
    expect(parse('/app/1-run?all')).toEqual({ projectId: 'app-a1', agentId: '1-run' })
    expect(parse('/app?all&settings=agent')).toEqual({ projectId: 'app-a1', agentId: null, settings: 'agent' })
    expect(format({ projectId: 'app-a1', agentId: null, scope: 'shop-1abc' })).toBe('/app')
    expect(format({ projectId: 'app-a1', agentId: '1-run' })).toBe('/app/1-run?all')
    expect(format({ projectId: 'app-a1', agentId: null, settings: 'agent' })).toBe('/app?all&settings=agent')
  })

  it('has no `?all` anywhere else, and no `?project=`', () => {
    expect(parse('/logs?all')).toEqual({ projectId: null, agentId: null, page: 'logs', pagePath: [] })
    expect(parse('/app/overview?all')).toEqual({ projectId: null, agentId: null, scope: 'app-a1' })
    expect(parse('/?project=app-a1')).toEqual({ projectId: null, agentId: null })
  })

  it("keeps what a page mirrored into the query, and drops what is the route's own", () => {
    expect(keepPageQuery('/app/tickets', '?q=races')).toBe('/app/tickets?q=races')
    expect(keepPageQuery('/', '?all')).toBe('/')
    // Settings opening or closing over a page keeps the page's own query, and never a stale entry.
    expect(keepPageQuery('/tickets?settings=agent', '?q=races')).toBe('/tickets?q=races&settings=agent')
    expect(keepPageQuery('/tickets', '?q=races&settings=agent')).toBe('/tickets?q=races')
    // A project's own page says "every project" with a bare word, and drops it when one is picked.
    expect(keepPageQuery('/app?all', '?settings=agent')).toBe('/app?all')
    expect(keepPageQuery('/app?settings=', '?all')).toBe('/app?settings=')
  })
})

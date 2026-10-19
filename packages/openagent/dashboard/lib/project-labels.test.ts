import { describe, it, expect } from 'vitest'
import { projectLabels } from './project-labels.js'

const project = (id: string, path: string) => ({ id, name: path.split(/[\\/]/).pop()!, path })

describe('projectLabels', () => {
  it('keeps a name no other project has', () => {
    expect(projectLabels([project('shop-1', '/home/me/shop'), project('app-1', '/home/me/app')])).toEqual(
      new Map([
        ['shop-1', 'shop'],
        ['app-1', 'app'],
      ]),
    )
  })

  it('names the parent folder of two projects with the same name', () => {
    const labels = projectLabels([project('shop-1', '/home/me/work/shop'), project('shop-2', '/home/me/clients/shop'), project('app-1', '/home/me/app')])
    expect(labels.get('shop-1')).toBe('work/shop')
    expect(labels.get('shop-2')).toBe('clients/shop')
    expect(labels.get('app-1')).toBe('app')
  })

  it('goes up as many folders as each one takes, when the parents clash too', () => {
    const labels = projectLabels([project('shop-1', '/a/x/shop'), project('shop-2', '/b/x/shop'), project('shop-3', '/c/y/shop')])
    expect(labels.get('shop-1')).toBe('a/x/shop')
    expect(labels.get('shop-2')).toBe('b/x/shop')
    expect(labels.get('shop-3')).toBe('y/shop')
  })

  it('says the whole path of a project whose every folder another one ends with', () => {
    const labels = projectLabels([project('shop-1', '/x/shop'), project('shop-2', '/a/x/shop')])
    expect(labels.get('shop-1')).toBe('/x/shop')
    expect(labels.get('shop-2')).toBe('a/x/shop')
  })

  it('reads a Windows path', () => {
    const labels = projectLabels([project('shop-1', 'C:\\work\\shop'), project('shop-2', 'C:\\clients\\shop')])
    expect(labels.get('shop-1')).toBe('work/shop')
    expect(labels.get('shop-2')).toBe('clients/shop')
  })
})

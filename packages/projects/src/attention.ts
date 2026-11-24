import type { AttentionItem } from '@openagt/hooks'

/** "No project yet": what the person sets up first, on this computer, while the list has no project. */
export function noProjectYet(listed: number): AttentionItem[] {
  if (listed > 0) return []
  return [
    {
      kind: 'setup',
      scope: 'computer',
      id: 'no-project',
      words: 'Add your first project',
      detail: 'A git repo your agents work in, each in its own copy and on its own branch. Your files and your branch stay as they are.',
      fix: { label: 'Add a project', action: ADD_PROJECT },
    },
  ]
}

/** The id of the module's `attention.fix` action that adds a project: the Add project dialog. */
export const ADD_PROJECT = 'add-project'

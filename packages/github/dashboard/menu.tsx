import { CloudUpload, ExternalLink } from 'lucide-react'
import type { UiActionAt } from '@openagt/ui/module'
import { server } from './calls.js'

// The project's GitHub entries in its menu (`project.menu`) and a session's (`chat.menu`): its page
// on GitHub, and, for a project that lives on this computer only, a private repository created
// for it. Creating one puts the project's code on GitHub under the person's account, so it is asked
// once more before it happens.

/** Open the project's page on GitHub: offered where its origin is there. */
function openOnGithub<P extends 'project.menu' | 'chat.menu'>(place: P): UiActionAt<P> {
  return {
    place,
    id: 'open-on-github',
    label: 'Open on GitHub',
    icon: ExternalLink,
    order: 10,
    offer: async (host, on) => {
      const { url } = await server(host).home(on.projectId, {})
      return url !== undefined ? { href: url } : undefined
    },
  }
}

/** Create a private repository on GitHub for a project with no origin, and push the project to it. */
const createRepository: UiActionAt<'project.menu'> = {
  place: 'project.menu',
  id: 'create-repository',
  label: 'Create a repository on GitHub…',
  busyLabel: 'Creating…',
  icon: CloudUpload,
  order: 11,
  offer: async (host, on) => {
    const { repository } = await server(host).repositoryOffer(on.projectId, {})
    if (repository === undefined) return undefined
    return {
      confirm: {
        title: 'Create a private repository on GitHub?',
        description: `This creates the private repository ${repository} on your GitHub account and pushes this project to it. The project’s code leaves this machine.`,
        confirmLabel: 'Create and push',
      },
    }
  },
  run: async (host, on) => server(host).createRepository(on.projectId, {}),
}

export const menuActions = [openOnGithub('project.menu'), openOnGithub('chat.menu'), createRepository]

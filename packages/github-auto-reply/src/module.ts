import { defineModule } from '@openagt/hooks'
import { forgetLooks } from './replies.js'

/**
 * github-auto-reply, a plugin kept per project (#2394): an agent whose pull request got a
 * maintainer's comment, a red check or a conflict answers it. Where its Enabled row is on, the
 * project's runs get its skill, whose front matter is the scheduler's row; the row's check is this
 * package's command, `github-auto-reply replies`. What the check keeps in a project's clone goes
 * when the project is removed.
 */
export default defineModule({
  name: 'github-auto-reply',
  plugin: { scope: 'project' },
  hooks: {
    'run.skills': () => [{ name: 'reply', dir: new URL('../', import.meta.url) }],
    'app.lifecycle': { projectRemoved: project => forgetLooks(project.dir) },
  },
})

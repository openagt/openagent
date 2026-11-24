// skills' UI part: the package's `./dashboard` export. One entry of Settings, in the Project group
// and first there: Skills, each project's own skills, listed as its repository keeps them. The
// gear's Skills line under the message box, after the profile's: the plugins a run goes without and
// the project skills it gets. And the project's command skills, which the message box offers in its
// `/` menu and its Commands menu. What it reads is its own server part's (`../src/server.ts`).
import { defineUiModule } from '@openagt/ui/module'
import { Puzzle } from 'lucide-react'
import { readCommands } from './calls.js'
import { SkillsControl } from './SkillsControl.js'
import { SkillsSettings } from './SkillsSettings.js'

export default defineUiModule({
  name: 'skills',
  hooks: {
    'ui.view': [
      { place: 'settings.section', id: 'skills', title: 'Skills', icon: Puzzle, order: 10, readOnly: true, View: SkillsSettings },
      { place: 'composer.control', id: 'skills', at: 'setup', order: 20, View: SkillsControl },
    ],
    'ui.option': [{ place: 'composer.commands', id: 'commands', list: (host, projectId) => readCommands(host, projectId) }],
  },
})

// skills' UI part: the package's `./dashboard` export. One entry of Settings, in the Project group
// and first there: Skills, each project's own skills, listed as its repository keeps them. What it
// reads is its own server part's (`../src/server.ts`).
import { defineUiModule } from '@openagt/ui/module'
import { Puzzle } from 'lucide-react'
import { SkillsSettings } from './SkillsSettings.js'

export default defineUiModule({
  name: 'skills',
  hooks: {
    'ui.view': [{ place: 'settings.section', id: 'skills', title: 'Skills', icon: Puzzle, order: 10, readOnly: true, View: SkillsSettings }],
  },
})

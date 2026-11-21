// ui-card-waiting's UI part: the package's `./dashboard` export. The Overview's card of what waits
// on the person, the Human Queue (#632/#1139, #2394): the `waiting` items of `app.attention` in the
// projects the Overview shows, as the shell read them once for every part that shows them. It is
// the card of what needs the person: the first steps of a new install stand under it.
import { defineUiModule } from '@openagt/ui/module'
import { HumanQueue } from './HumanQueue.js'

export default defineUiModule({
  name: 'ui-card-waiting',
  hooks: {
    'ui.view': [{ place: 'overview.card', id: 'waiting', label: 'Human Queue', width: '2/3', minWidth: '1/2', order: 5, needsYou: true, View: HumanQueue }],
  },
})

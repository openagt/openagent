// ask's UI part: the package's `./dashboard` export. How a question a run stopped on looks in the
// chat (`ui.render`, kind `question`): its card, answered through the module's own server part
// (`../src/server.ts`). The question block in the agent's message is shown elsewhere (kind
// `await-choices`, the block's language, with no look of its own): the card under the message asks it.
import { defineUiModule } from '@openagt/ui/module'
import { QuestionCard } from './QuestionCard.js'
import { QUESTION_TAG } from '../src/question.js'

export default defineUiModule({
  name: 'ask',
  hooks: {
    'ui.render': [{ kind: 'question', Render: QuestionCard }, { kind: QUESTION_TAG }],
  },
})

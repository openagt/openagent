// The skill's UI: the package's `./dashboard` export. One card, built only on the `account-rotation`
// command and on `@openagt/skill-ui/module`, so it is the same on OpenAgent's Overview and on the page
// of `npx @openagt/skill-ui`.
import { defineModule } from '@openagt/skill-ui/module'
import { AccountsCard } from './AccountsCard.js'
import './dashboard.css'

export default defineModule({
  cards: [{ id: 'accounts', label: 'Accounts', order: 45, width: '1/3', minWidth: '1/4', Card: AccountsCard }],
  stylesheet: 'dashboard.css',
})

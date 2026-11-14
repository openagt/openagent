import '../index/styles.css'
import { CommandChip, PmTabs } from '../index/commands'
import type { Command } from '../index/commands'
import { pStyle, Step, Subpage } from '../index/Subpage'
import { text } from '../index/ui'

/** Package-manager tabs sitting tight above their command, in a larger chip than the hero's, as wide as the other; both snippets share the global choice. */
function PmSnippet({ command }: { command: Command }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-start' }}>
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
        <PmTabs />
      </div>
      <CommandChip command={command} style={{ width: 'min(100%, 320px)', boxSizing: 'border-box', padding: '8px 12px', ...text('sm') }} />
    </div>
  )
}

export default function Page() {
  return (
    <Subpage title="Go to dashboard" lead="The dashboard runs 100% locally, on your computer.">
      <Step title="Install">
        <p style={pStyle}>
          Install it, and from then on openagent.build opens your dashboard on this computer. It starts when you log in. macOS and Linux for now:
        </p>
        <PmSnippet command="install" />
      </Step>
      <Step title="One-time run">
        <p style={pStyle}>You just want to try it out? Run it once, no install:</p>
        <PmSnippet command="try" />
      </Step>
    </Subpage>
  )
}

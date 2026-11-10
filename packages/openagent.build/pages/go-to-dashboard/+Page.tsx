import '../index/styles.css'
import { CommandChip, PmTabs } from '../index/commands'
import type { Command } from '../index/commands'
import { pStyle, Step, Subpage } from '../index/Subpage'

/** Package-manager tabs sitting tight above their command, in a larger chip than the hero's; both snippets share the global choice. */
function PmSnippet({ command }: { command: Command }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-start' }}>
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
        <PmTabs />
      </div>
      <CommandChip command={command} style={{ alignSelf: 'flex-start', borderRadius: 8, padding: '10px 14px', fontSize: 14 }} />
    </div>
  )
}

export default function Page() {
  return (
    <Subpage title="Go to dashboard" lead="The dashboard runs 100% locally, on your computer.">
      <Step kicker="Install">
        <p style={pStyle}>
          Install it, and from then on openagent.build opens your dashboard on this computer. It starts when you log in. macOS and Linux for now:
        </p>
        <PmSnippet command="install" />
      </Step>
      <Step kicker="One-time run">
        <p style={pStyle}>You just want to try it out? Run it once, no install:</p>
        <PmSnippet command="try" />
      </Step>
    </Subpage>
  )
}

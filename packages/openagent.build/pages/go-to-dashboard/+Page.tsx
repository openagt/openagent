import '../index/styles.css'
import { CommandBox, PmTabs } from '../index/commands'
import { pStyle, Step, Subpage } from '../index/Subpage'

export default function Page() {
  return (
    <Subpage title="Go to dashboard" lead="The dashboard runs 100% locally, on your computer.">
      {/* One choice of package manager at the head of the two commands it picks for, the way in first. */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-items)' }}>
        <PmTabs />
        <Step title="Install">
          <p style={pStyle}>
            Install it, and from then on openagent.build opens your dashboard on this computer. It starts when you log in. macOS and Linux for now:
          </p>
          <CommandBox command="install" />
        </Step>
        {/* Installing is the way the page recommends; running it once, the quiet second under it. */}
        <Step title="One-time run" quiet>
          <p style={pStyle}>You just want to try it out? Run it once, no install:</p>
          <CommandBox command="try" quiet />
        </Step>
      </div>
    </Subpage>
  )
}

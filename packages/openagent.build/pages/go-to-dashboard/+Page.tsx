import '../index/styles.css'
import { CommandBox, PmTabs } from '../index/commands'
import { pStyle, Step, Subpage } from '../index/Subpage'

export default function Page() {
  return (
    // One choice of package manager, for both commands.
    <Subpage title="Go to dashboard" lead="The dashboard runs 100% locally, on your computer." under={<PmTabs />}>
      <Step title="Install">
        <p style={pStyle}>
          Install it, and from then on openagent.build opens your dashboard on this computer. It starts when you log in. macOS and Linux for now:
        </p>
        <CommandBox command="install" size="large" />
      </Step>
      <Step title="One-time run">
        <p style={pStyle}>You just want to try it out? Run it once, no install:</p>
        <CommandBox command="try" size="large" />
      </Step>
    </Subpage>
  )
}

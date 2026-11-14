import './styles.css'
import { TopNav } from './TopNav'
import { Hero } from './Hero'
import { SectionNav } from './SectionNav'
import { StopBabysitting } from './StopBabysitting'
import { AutonomousAi } from './AutonomousAi'
import { HowItWorks } from './HowItWorks'
import { Features } from './Features'
import { YourFramework } from './YourFramework'
import { Cta } from './Cta'
import { Footer } from './Footer'

export default function Page() {
  return (
    <>
      <TopNav />
      <main id="main">
        <Hero />
        <SectionNav />
        <StopBabysitting />
        <AutonomousAi />
        <HowItWorks />
        <Features />
        <YourFramework />
        <Cta />
      </main>
      <Footer />
    </>
  )
}

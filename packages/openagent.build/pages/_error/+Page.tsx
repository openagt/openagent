import '../index/styles.css'
import { usePageContext } from 'vike-react/usePageContext'
import { Subpage } from '../index/Subpage'

/** An address with no page, or a page that failed: said in the site's own look, with the way home. */
export default function Page() {
  const { is404 } = usePageContext()
  return (
    <Subpage
      title={is404 ? 'Page not found' : 'Something went wrong'}
      lead={is404 ? 'There is no page at this address.' : 'This page could not be shown.'}
    >
      <p style={{ margin: 0 }}>
        <a href="/" className="press press-primary">
          Go to the home page
        </a>
      </p>
    </Subpage>
  )
}

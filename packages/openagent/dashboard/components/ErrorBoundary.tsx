import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Button } from './ui/button.js'

// The white blank screen (#1194). When a render error escapes every boundary React unmounts the
// whole tree to the root, and the dashboard had none — so one bad line off the live feed, or one
// panel reading a field the daemon has not written yet, took the entire app with it: nothing on
// screen, nothing to click, and (since ssr:false) not even an SSR error page to fall back to. It
// looked random because it was data-driven — a particular event, a particular poll, a particular
// moment. This is the net under all of it. A render error is caught here and shown as a recoverable
// card on the themed shell, so a crash costs you a view and a click, not the session, and the stack
// reaches the console for whoever hits it next.

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // The daemon never sees the browser console, and a blank page carries no trace on its own, so
    // this is the one record of a "random" crash (#1194) — keep the stack for whoever debugs it.
    console.error('Dashboard render error:', error, info.componentStack)
  }

  // Clearing the error re-mounts the children. A transient cause (a stream hiccup, a half-written
  // read that the next poll completes) then renders through; a durable one throws straight back
  // here, no worse than before, which is why Reload sits beside it as the sure way out.
  private reset = (): void => this.setState({ error: null })

  render(): ReactNode {
    const { error } = this.state
    if (!error) return this.props.children
    return (
      <div
        role="alert"
        className="flex min-h-screen flex-col items-center justify-center gap-3 bg-background p-8 text-center text-foreground"
      >
        <p className="text-base font-medium">Something went wrong</p>
        <p className="max-w-md text-sm text-muted-foreground">
          The dashboard hit an error and could not finish drawing this view. Your session is safe — the daemon keeps
          running. Try again, or reload the page.
        </p>
        {error.message && (
          <pre className="max-w-md overflow-x-auto rounded-md bg-muted px-3 py-2 text-left text-xs text-muted-foreground">
            {error.message}
          </pre>
        )}
        <div className="flex gap-2">
          <Button variant="outline" onClick={this.reset}>
            Try again
          </Button>
          <Button onClick={() => window.location.reload()}>Reload</Button>
        </div>
      </div>
    )
  }
}

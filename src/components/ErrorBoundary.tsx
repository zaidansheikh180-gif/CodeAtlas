// Render-error containment (phase 9 part 1): a crash inside any view records
// a categorized diagnostic and shows a friendly fallback instead of a blank
// page. The user can retry the subtree or go back to the landing page.

import { Component, type ReactNode } from 'react'
import { recordError } from '../lib/errors'

interface Props {
  children: ReactNode
  onReset?: () => void
}

interface State {
  error: Error | null
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error): void {
    recordError('visualization', 'A view crashed while rendering.', error.message)
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 bg-night p-6 text-center">
        <p className="text-sm font-semibold text-ink">Something went wrong drawing this view.</p>
        <p className="max-w-md text-xs text-ink-3">
          The error was recorded in the diagnostics log (Status on the landing page). Your indexed data is safe.
        </p>
        <div className="flex gap-2">
          <button
            onClick={() => this.setState({ error: null })}
            className="rounded-lg bg-dragon px-3 py-1.5 text-xs font-semibold text-night"
          >
            Try again
          </button>
          {this.props.onReset && (
            <button onClick={this.props.onReset} className="rounded-lg border border-line px-3 py-1.5 text-xs text-ink-2 hover:text-ink">
              Back to start
            </button>
          )}
        </div>
      </div>
    )
  }
}

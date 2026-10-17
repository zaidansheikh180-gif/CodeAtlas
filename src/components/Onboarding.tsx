// First-run welcome and feature tour (phase 9 part 4). The welcome explains
// the three usage modes and the privacy model in one card; the tour walks
// the capabilities as a small corner card - non-blocking, skippable, and
// reopenable from the landing page. Completion persists in localStorage.

import { useState } from 'react'
import { markOnboarded, TOUR_STEPS } from '../lib/onboarding'

interface Props {
  onFinish: () => void
}

export default function Onboarding({ onFinish }: Props) {
  const [step, setStep] = useState<number | null>(null) // null = welcome card

  const finish = () => {
    markOnboarded()
    onFinish()
  }

  // Welcome card: three modes + privacy, then tour or skip.
  if (step === null) {
    return (
      <div
        role="dialog"
        aria-label="Welcome to CodeAtlas"
        className="fixed bottom-4 right-4 z-20 w-96 max-w-[calc(100%-2rem)] rounded-lg border border-line bg-surface-1 p-4 shadow-lg"
      >
        <p className="text-sm font-semibold text-ink">Welcome to CodeAtlas</p>
        <p className="mt-1 text-xs leading-5 text-ink-2">Three ways to use it:</p>
        <ol className="mt-1 list-decimal space-y-1 pl-4 text-xs leading-5 text-ink-2">
          <li>Paste a public GitHub repository and explore its architecture.</li>
          <li>Ask key-free graph questions - imports, callers, impact - answered locally with citations.</li>
          <li>Optionally connect your own model key for semantic chat.</li>
        </ol>
        <p className="mt-2 text-xs leading-5 text-ink-3">
          Privacy: indexing and graph queries run locally in your browser. Model chat sends selected context only when
          you explicitly ask - keys and file contents are never logged.
        </p>
        <div className="mt-3 flex gap-2">
          <button onClick={() => setStep(0)} className="flex-1 rounded-lg bg-dragon px-3 py-1.5 text-xs font-semibold text-night">
            Take the tour
          </button>
          <button onClick={finish} className="rounded-lg border border-line px-3 py-1.5 text-xs text-ink-2 hover:text-ink">
            Skip
          </button>
        </div>
      </div>
    )
  }

  const current = TOUR_STEPS[step]
  const last = step === TOUR_STEPS.length - 1
  return (
    <div
      role="dialog"
      aria-label={`Tour step ${step + 1} of ${TOUR_STEPS.length}: ${current.title}`}
      className="fixed bottom-4 right-4 z-20 w-96 max-w-[calc(100%-2rem)] rounded-lg border border-line bg-surface-1 p-4 shadow-lg"
    >
      <p className="text-[10px] font-semibold uppercase text-ink-3">
        Tour {step + 1} of {TOUR_STEPS.length}
      </p>
      <p className="mt-1 text-sm font-semibold text-ink">{current.title}</p>
      <p className="mt-1 text-xs leading-5 text-ink-2">{current.body}</p>
      <div className="mt-3 flex items-center gap-2">
        <button
          onClick={() => (last ? finish() : setStep(step + 1))}
          className="flex-1 rounded-lg bg-dragon px-3 py-1.5 text-xs font-semibold text-night"
        >
          {last ? 'Done' : 'Next'}
        </button>
        {step > 0 && (
          <button onClick={() => setStep(step - 1)} className="rounded-lg border border-line px-3 py-1.5 text-xs text-ink-2 hover:text-ink">
            Back
          </button>
        )}
        <button onClick={finish} className="rounded-lg border border-line px-3 py-1.5 text-xs text-ink-3 hover:text-ink">
          Skip tour
        </button>
      </div>
    </div>
  )
}

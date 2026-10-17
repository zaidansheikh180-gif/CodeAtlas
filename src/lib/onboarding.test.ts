import { describe, expect, it } from 'bun:test'
import { isOnboarded, markOnboarded, resetOnboarding, TOUR_STEPS } from './onboarding'

// In-memory storage stand-in (bun test has no localStorage).
function memStorage() {
  const map = new Map<string, string>()
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
  }
}

describe('onboarding', () => {
  it('tour covers the required capabilities in order', () => {
    const ids = TOUR_STEPS.map((s) => s.id)
    expect(ids).toEqual(['repo-input', 'indexing', 'map', 'source', 'queries', 'impact', 'model-chat', 'privacy'])
    for (const step of TOUR_STEPS) {
      expect(step.title.length).toBeGreaterThan(3)
      expect(step.body.length).toBeGreaterThan(20)
    }
  })

  it('persists completion locally and can reset', () => {
    const storage = memStorage()
    expect(isOnboarded(storage)).toBe(false)
    markOnboarded(storage)
    expect(isOnboarded(storage)).toBe(true)
    resetOnboarding(storage)
    expect(isOnboarded(storage)).toBe(false)
  })

  it('explains privacy in the model step', () => {
    const model = TOUR_STEPS.find((s) => s.id === 'model-chat')!
    expect(model.body).toContain('only when you ask')
  })
})

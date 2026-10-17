import { describe, expect, test } from 'bun:test'
import { MAX_ZOOM, MIN_ZOOM, zoomViewTransform } from './zoom'

describe('zoomViewTransform', () => {
  test('keeps the anchor point fixed while scaling', () => {
    const view = { x: 10, y: 20, k: 1 }
    const next = zoomViewTransform(view, 100, 80, 2)
    expect(next.k).toBe(2)
    // world point under (100, 80) is the same before and after
    const beforeWorld = { x: (100 - view.x) / view.k, y: (80 - view.y) / view.k }
    const afterWorld = { x: (100 - next.x) / next.k, y: (80 - next.y) / next.k }
    expect(afterWorld.x).toBeCloseTo(beforeWorld.x)
    expect(afterWorld.y).toBeCloseTo(beforeWorld.y)
  })

  test('clamps at min and max zoom', () => {
    const view = { x: 0, y: 0, k: 1 }
    expect(zoomViewTransform(view, 50, 50, 100).k).toBe(MAX_ZOOM)
    expect(zoomViewTransform(view, 50, 50, 0.0001).k).toBe(MIN_ZOOM)
  })

  test('pinch-style factor chains like repeated wheel steps', () => {
    let view = { x: 0, y: 0, k: 1 }
    view = zoomViewTransform(view, 200, 200, 1.5)
    view = zoomViewTransform(view, 200, 200, 1.5)
    expect(view.k).toBeCloseTo(2.25)
  })
})

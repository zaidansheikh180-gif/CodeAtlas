// Shared canvas zoom math (mobile pass): wheel and pinch both scale the map
// about one screen point, keeping that point anchored, with the same clamp.
export interface ViewTransform {
  x: number
  y: number
  k: number
}

export const MIN_ZOOM = 0.3
export const MAX_ZOOM = 4

export function zoomViewTransform(
  view: ViewTransform,
  px: number,
  py: number,
  factor: number,
  min: number = MIN_ZOOM,
  max: number = MAX_ZOOM,
): ViewTransform {
  const k = Math.min(max, Math.max(min, view.k * factor))
  return {
    k,
    x: px - ((px - view.x) / view.k) * k,
    y: py - ((py - view.y) / view.k) * k,
  }
}

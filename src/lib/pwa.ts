// PWA registration (production-readiness #11): registers the build-generated
// service worker in production only, and surfaces "new version ready" through
// a callback so the app can offer a reload instead of swapping mid-task.
// The worker precaches the whole build (WASM grammars included), so an
// installed CodeAtlas works offline for local-folder repos; GitHub fetching
// and model providers are cross-origin and bypass the worker entirely.

export interface PwaUpdate {
  apply: () => void
}

export function registerServiceWorker(onUpdate: (update: PwaUpdate) => void): void {
  if (!import.meta.env.PROD) return
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return

  let reloading = false
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) return
    reloading = true
    window.location.reload()
  })

  void navigator.serviceWorker.register('/sw.js').then((registration) => {
    const watch = (worker: ServiceWorker | null) => {
      if (!worker) return
      worker.addEventListener('statechange', () => {
        // A worker that finished installing while an old one still controls
        // the page is an update waiting for the visitor's go-ahead.
        if (worker.state === 'installed' && navigator.serviceWorker.controller) {
          onUpdate({
            apply: () => {
              worker.postMessage('SKIP_WAITING')
            },
          })
        }
      })
    }
    watch(registration.waiting)
    registration.addEventListener('updatefound', () => watch(registration.installing))
  })
}

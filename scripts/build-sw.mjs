// Post-build service worker generator (production-readiness #11): scans
// dist/ and writes dist/sw.js with a precache list covering the whole app -
// JS, CSS, WASM grammars, fonts, icons and the manifest - so the installed
// PWA works fully offline for local-folder repos. The cache version is a
// content hash of the file list, so any redeploy busts the old cache.
//
// Runtime policy: only same-origin GET requests touch the cache.
// Navigations are network-first with a cached index.html fallback (fresh
// deploys win when online); hashed assets are cache-first. Cross-origin
// traffic (GitHub, Gemini) and localhost (Ollama) always go straight to the
// network - the worker never intercepts model or API calls.

import { createHash } from 'node:crypto'
import { readdirSync, statSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'

export function collectFiles(distDir) {
  const out = []
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      if (name === 'sw.js') continue
      const full = join(dir, name)
      if (statSync(full).isDirectory()) walk(full)
      else out.push(relative(distDir, full).split('\\').join('/'))
    }
  }
  walk(distDir)
  return out.sort()
}

export function cacheVersion(files) {
  const hash = createHash('sha256')
  for (const f of files) hash.update(f + '\n')
  return hash.digest('hex').slice(0, 12)
}

export function serviceWorkerSource(version, files) {
  return `// CodeAtlas service worker - generated at build time by scripts/build-sw.mjs.
// Do not edit by hand; edit the generator and rebuild.
const VERSION = '${version}'
const CACHE = 'codeatlas-' + VERSION
const PRECACHE = ${JSON.stringify(files.map((f) => './' + f), null, 2)}

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)))
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

// The app's update toast posts SKIP_WAITING once the visitor asks for the
// new version; without the message the old worker keeps serving until every
// tab is gone, so nobody loses state mid-task.
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting()
})

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)
  // Only same-origin GETs are app assets. Everything else - GitHub, model
  // providers, localhost Ollama, non-GET - bypasses the worker entirely.
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const copy = response.clone()
          caches.open(CACHE).then((cache) => cache.put('./index.html', copy))
          return response
        })
        .catch(() => caches.match('./index.html')),
    )
    return
  }
  event.respondWith(
    caches.match(event.request).then((hit) => hit || fetch(event.request).then((response) => {
      if (response.ok) {
        const copy = response.clone()
        caches.open(CACHE).then((cache) => cache.put(event.request, copy))
      }
      return response
    })),
  )
})
`
}

export function buildServiceWorker(distDir) {
  const files = collectFiles(distDir)
  const version = cacheVersion(files)
  writeFileSync(join(distDir, 'sw.js'), serviceWorkerSource(version, files))
  return { version, count: files.length }
}

if (process.argv[1] && process.argv[1].endsWith('build-sw.mjs')) {
  const distDir = process.argv[2] || new URL('../dist', import.meta.url).pathname
  const { version, count } = buildServiceWorker(distDir)
  console.log(`sw.js written: ${count} files precached, cache codeatlas-${version}`)
}

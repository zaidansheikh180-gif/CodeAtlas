// Settings page (phase 7 part 1, spec-2 sections 26+27, pack-1 #23 + #26):
// model provider and key management, privacy notice and report, indexing,
// graph/search, appearance and context-budget settings, data wipe and
// reset. Every setting carries its explanation; indexing changes warn that
// they apply to new indexes only. Keys are handled by keys.ts - memory by
// default, localStorage only on explicit opt-in, never in IndexedDB.

import { useEffect, useState } from 'react'
import { listRepos } from '../lib/db'
import {
  clearKey,
  getKey,
  hasKey,
  keyIsRemembered,
  lastExternalSend,
  setKey,
  type ExternalSendMarker,
} from '../lib/keys'
import {
  DEFAULT_GEMINI_MODEL,
  DEFAULT_OLLAMA_ENDPOINT,
  DEFAULT_OLLAMA_MODEL,
  DEFAULT_SETTINGS,
  loadSettings,
  resetSettings,
  saveSettings,
  wipeAllData,
  type Settings,
} from '../lib/settings'
import type { RepoRec } from '../lib/types'

interface Props {
  onClose: () => void
}

function Field(props: { label: string; hint: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-ink">{props.label}</span>
      <span className="mt-0.5 block text-xs text-ink-3">{props.hint}</span>
      <div className="mt-1">{props.children}</div>
    </label>
  )
}

const inputCls =
  'w-full rounded-lg border border-line bg-surface-2 px-2.5 py-1.5 text-sm text-ink placeholder:text-ink-3 focus:border-dragon focus:outline-none'

function Section(props: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-line bg-surface-1 p-4">
      <h3 className="text-sm font-semibold text-ink">{props.title}</h3>
      {props.note && <p className="mt-1 text-xs text-warning">{props.note}</p>}
      <div className="mt-3 space-y-4">{props.children}</div>
    </section>
  )
}

export default function SettingsPanel({ onClose }: Props) {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [savedTick, setSavedTick] = useState(false)
  const [keyDraft, setKeyDraft] = useState('')
  const [keyState, setKeyState] = useState<{ held: boolean; remembered: boolean }>({ held: false, remembered: false })
  const [externalSend, setExternalSend] = useState<ExternalSendMarker | null>(null)
  const [latestRepo, setLatestRepo] = useState<RepoRec | null>(null)
  const [confirmWipe, setConfirmWipe] = useState(false)

  useEffect(() => {
    let alive = true
    void (async () => {
      const [loaded, repos] = await Promise.all([loadSettings(), listRepos()])
      if (!alive) return
      setSettings(loaded)
      setLatestRepo(repos.filter((r) => !r.snapshot).sort((a, b) => b.indexedAt - a.indexedAt)[0] ?? null)
      setKeyState({ held: hasKey('gemini'), remembered: keyIsRemembered('gemini') })
      setExternalSend(lastExternalSend())
    })()
    return () => {
      alive = false
    }
  }, [])

  if (!settings) return null

  function update(patch: Partial<Settings>) {
    const next = { ...settings!, ...patch }
    setSettings(next)
    void saveSettings(next).then(() => {
      setSavedTick(true)
      window.setTimeout(() => setSavedTick(false), 1500)
      if (patch.theme) document.documentElement.dataset.theme = patch.theme
    })
  }

  function saveKey(remember: boolean) {
    if (!keyDraft.trim()) return
    setKey('gemini', keyDraft, { persist: remember })
    setKeyDraft('')
    setKeyState({ held: true, remembered: remember })
    update({ rememberKey: remember })
  }

  function forgetKey() {
    clearKey('gemini')
    setKeyState({ held: false, remembered: false })
    update({ rememberKey: false })
  }

  async function wipe() {
    await wipeAllData()
    window.location.reload()
  }

  const providerLabel = settings.provider === 'none' ? 'No model configured' : settings.provider === 'gemini' ? 'Gemini' : 'Ollama'

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-night/70" role="dialog" aria-label="Settings">
      <div className="h-full w-full max-w-lg overflow-y-auto bg-night p-5 shadow-2xl">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-ink">Settings</h2>
          <div className="flex items-center gap-3">
            <span aria-live="polite" className="text-xs text-success">{savedTick ? 'Saved' : ''}</span>
            <button onClick={onClose} className="rounded-lg border border-line px-3 py-1.5 text-xs text-ink-2 hover:border-dragon hover:text-ink">
              Close
            </button>
          </div>
        </div>
        <p className="mt-1 text-xs text-ink-3">
          Everything on this page stays in this browser. CodeAtlas has no server and no accounts.
        </p>

        <div className="mt-4 space-y-4">
          <Section title="Model and privacy">
            <div className="rounded-lg border border-line bg-surface-2 p-3 text-xs text-ink-2">
              <p className="font-medium text-ink">Three ways to use CodeAtlas</p>
              <ol className="mt-1 list-decimal space-y-0.5 pl-4">
                <li>Key-free local graph mode - indexing, map, search and structural answers never leave this browser.</li>
                <li>Local indexing with optional model features - your key is used only when you ask.</li>
                <li>Model-assisted mode - only the retrieved files and symbols shown before sending go to your chosen provider.</li>
              </ol>
            </div>
            <Field label="Model provider" hint="Gemini needs your own API key. Ollama needs an endpoint you control. Neither is required for any graph feature.">
              <select
                aria-label="Model provider"
                className={inputCls}
                value={settings.provider}
                onChange={(e) => {
                  const provider = e.target.value as Settings['provider']
                  update({
                    provider,
                    model: provider === 'ollama' ? DEFAULT_OLLAMA_MODEL : DEFAULT_GEMINI_MODEL,
                  })
                }}
              >
                <option value="none">No model (key-free mode)</option>
                <option value="gemini">Gemini (your API key)</option>
                <option value="ollama">Ollama (your endpoint)</option>
              </select>
            </Field>
            {settings.provider === 'gemini' && (
              <>
                <Field label="Gemini API key" hint="Held in memory only, unless you choose to remember it in this browser. Never written to the graph database, never shown again after saving.">
                  <div className="flex gap-2">
                    <input
                      type="password"
                      aria-label="Gemini API key"
                      className={inputCls}
                      placeholder={keyState.held ? 'A key is saved - enter a new one to replace it' : 'Paste your key'}
                      value={keyDraft}
                      onChange={(e) => setKeyDraft(e.target.value)}
                      autoComplete="off"
                    />
                    <button
                      onClick={() => saveKey(settings.rememberKey)}
                      disabled={!keyDraft.trim()}
                      className="rounded-lg border border-dragon px-3 py-1.5 text-xs text-dragon hover:bg-dragon hover:text-night disabled:opacity-50"
                    >
                      Save key
                    </button>
                  </div>
                </Field>
                <label className="flex items-start gap-2 text-xs text-ink-2">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={settings.rememberKey}
                    onChange={(e) => {
                      update({ rememberKey: e.target.checked })
                      if (e.target.checked && hasKey('gemini')) {
                        const held = getKey('gemini')
                        if (held) setKey('gemini', held, { persist: true })
                        setKeyState({ held: true, remembered: true })
                      } else if (!e.target.checked && hasKey('gemini')) {
                        const held = getKey('gemini')
                        if (held) setKey('gemini', held, { persist: false })
                        setKeyState({ held: true, remembered: false })
                      }
                    }}
                  />
                  Remember my key in this browser (localStorage). Off means the key lives in memory only and is gone when the tab closes.
                </label>
                <div className="flex items-center justify-between rounded-lg border border-line bg-surface-2 px-3 py-2 text-xs">
                  <span className="text-ink-2">
                    {keyState.held
                      ? keyState.remembered
                        ? 'Key saved in this browser.'
                        : 'Key held in memory for this session.'
                      : 'No key saved.'}
                  </span>
                  {keyState.held && (
                    <button onClick={forgetKey} className="text-error hover:underline">
                      Delete key now
                    </button>
                  )}
                </div>
              </>
            )}
            {settings.provider === 'ollama' && (
              <Field label="Ollama endpoint" hint="Your own reachable Ollama server. Remote endpoints need OLLAMA_ORIGINS to allow this page's origin.">
                <input
                  aria-label="Ollama endpoint"
                  className={inputCls}
                  value={settings.ollamaEndpoint}
                  placeholder={DEFAULT_OLLAMA_ENDPOINT}
                  onChange={(e) => update({ ollamaEndpoint: e.target.value })}
                />
              </Field>
            )}
            {settings.provider !== 'none' && (
              <Field label="Model" hint="The exact model id sent to the provider.">
                <input aria-label="Model" className={inputCls} value={settings.model} onChange={(e) => update({ model: e.target.value })} />
              </Field>
            )}
            <div className="rounded-lg border border-line bg-surface-2 p-3 text-xs" aria-label="Privacy report">
              <p className="font-medium text-ink">Privacy report</p>
              <dl className="mt-1 space-y-0.5 text-ink-2">
                <div className="flex justify-between"><dt>Repository</dt><dd className="text-ink">{latestRepo ? latestRepo.fullName : 'none indexed'}</dd></div>
                <div className="flex justify-between"><dt>Ref</dt><dd className="text-ink">{latestRepo ? (latestRepo.ref ?? latestRepo.defaultBranch) : '-'}</dd></div>
                <div className="flex justify-between"><dt>Model status</dt><dd className="text-ink">{providerLabel}{settings.provider !== 'none' ? ` (${settings.model})` : ''}</dd></div>
                <div className="flex justify-between">
                  <dt>Data sent externally</dt>
                  <dd className={externalSend ? 'text-warning' : 'text-success'}>
                    {externalSend ? `Yes - ${externalSend.provider} (${externalSend.purpose})` : 'Never'}
                  </dd>
                </div>
              </dl>
            </div>
          </Section>

          <Section title="Indexing" note="Indexing changes apply to new indexes. Re-index a repository to apply them to it.">
            <Field label="Default branch" hint="Preferred branch when indexing, for example main or develop. Empty uses the repository's default branch.">
              <input aria-label="Default branch" className={inputCls} value={settings.defaultBranch} placeholder="repository default" onChange={(e) => update({ defaultBranch: e.target.value.trim() })} />
            </Field>
            <Field label="Maximum file size (KB)" hint="Files larger than this are skipped during indexing and counted as oversized.">
              <input aria-label="Maximum file size in KB" type="number" min={16} max={8192} className={inputCls} value={settings.maxFileKb} onChange={(e) => update({ maxFileKb: Math.max(16, Number(e.target.value) || DEFAULT_SETTINGS.maxFileKb) })} />
            </Field>
            <Field label="Excluded file globs" hint="One glob per line, for example **/*.snap or **/fixtures/**. Matched files are skipped during indexing.">
              <textarea aria-label="Excluded file globs" rows={3} className={inputCls} value={settings.excludeGlobs.join('\n')} onChange={(e) => update({ excludeGlobs: e.target.value.split('\n').map((g) => g.trim()).filter(Boolean) })} />
            </Field>
            <Field label="Excluded folders" hint="One folder name per line, for example e2e or fixtures. Matching folders are skipped anywhere in the tree.">
              <textarea aria-label="Excluded folders" rows={2} className={inputCls} value={settings.excludeFolders.join('\n')} onChange={(e) => update({ excludeFolders: e.target.value.split('\n').map((g) => g.trim()).filter(Boolean) })} />
            </Field>
            <Field label="Sensitive-file patterns" hint="One glob per line. Matched files are treated as credentials and never enter the graph or any model request. Built-in defaults (.env, keys, tokens) always apply.">
              <textarea aria-label="Sensitive-file patterns" rows={3} className={inputCls} value={settings.sensitiveGlobs.join('\n')} onChange={(e) => update({ sensitiveGlobs: e.target.value.split('\n').map((g) => g.trim()).filter(Boolean) })} />
            </Field>
          </Section>

          <Section title="Graph and search">
            <Field label="Maximum traversal depth" hint="How many hops impact and path answers may follow before stopping with a truncation note.">
              <input aria-label="Maximum traversal depth" type="number" min={1} max={20} className={inputCls} value={settings.maxTraversalDepth} onChange={(e) => update({ maxTraversalDepth: Math.max(1, Number(e.target.value) || DEFAULT_SETTINGS.maxTraversalDepth) })} />
            </Field>
            <Field label="Maximum search results" hint="Cap on ranked results per search.">
              <input aria-label="Maximum search results" type="number" min={5} max={500} className={inputCls} value={settings.maxSearchResults} onChange={(e) => update({ maxSearchResults: Math.max(5, Number(e.target.value) || DEFAULT_SETTINGS.maxSearchResults) })} />
            </Field>
            <Field label="Performance mode" hint="Auto reduces map detail on large graphs. On always reduces; Off always renders full detail.">
              <select aria-label="Performance mode" className={inputCls} value={settings.performanceMode} onChange={(e) => update({ performanceMode: e.target.value as Settings['performanceMode'] })}>
                <option value="auto">Auto (recommended)</option>
                <option value="on">Always on</option>
                <option value="off">Always off</option>
              </select>
            </Field>
          </Section>

          <Section title="Appearance">
            <Field label="Theme" hint="Night Violet dark is the designed default; light is a high-contrast paper variant of the same palette.">
              <select aria-label="Theme" className={inputCls} value={settings.theme} onChange={(e) => update({ theme: e.target.value as Settings['theme'] })}>
                <option value="dark">Dark (Night Violet)</option>
                <option value="light">Light</option>
              </select>
            </Field>
          </Section>

          <Section title="Context budgets (model chat)">
            <p className="text-xs text-ink-3">
              These limits shape what a model request may include. Lower-priority context (tests, then documentation) is dropped first when the budget is tight. The chat shows exactly which files and symbols were included before sending.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Max context tokens" hint="Total token budget for one request.">
                <input aria-label="Max context tokens" type="number" min={1000} step={1000} className={inputCls} value={settings.maxContextTokens} onChange={(e) => update({ maxContextTokens: Math.max(1000, Number(e.target.value) || DEFAULT_SETTINGS.maxContextTokens) })} />
              </Field>
              <Field label="Max output tokens" hint="Cap on the model's answer length.">
                <input aria-label="Max output tokens" type="number" min={128} step={128} className={inputCls} value={settings.maxOutputTokens} onChange={(e) => update({ maxOutputTokens: Math.max(128, Number(e.target.value) || DEFAULT_SETTINGS.maxOutputTokens) })} />
              </Field>
              <Field label="Max files" hint="Retrieved files per request.">
                <input aria-label="Max retrieved files" type="number" min={1} max={100} className={inputCls} value={settings.maxRetrievedFiles} onChange={(e) => update({ maxRetrievedFiles: Math.max(1, Number(e.target.value) || DEFAULT_SETTINGS.maxRetrievedFiles) })} />
              </Field>
              <Field label="Max symbols" hint="Retrieved symbols per request.">
                <input aria-label="Max retrieved symbols" type="number" min={1} max={500} className={inputCls} value={settings.maxRetrievedSymbols} onChange={(e) => update({ maxRetrievedSymbols: Math.max(1, Number(e.target.value) || DEFAULT_SETTINGS.maxRetrievedSymbols) })} />
              </Field>
              <Field label="Graph depth" hint="Hops from matched nodes when gathering context.">
                <input aria-label="Retrieval graph depth" type="number" min={1} max={6} className={inputCls} value={settings.maxGraphDepth} onChange={(e) => update({ maxGraphDepth: Math.max(1, Number(e.target.value) || DEFAULT_SETTINGS.maxGraphDepth) })} />
              </Field>
              <Field label="Snippets per file" hint="Source excerpts per retrieved file.">
                <input aria-label="Max snippets per file" type="number" min={1} max={10} className={inputCls} value={settings.maxSnippetsPerFile} onChange={(e) => update({ maxSnippetsPerFile: Math.max(1, Number(e.target.value) || DEFAULT_SETTINGS.maxSnippetsPerFile) })} />
              </Field>
            </div>
            <div className="space-y-2">
              {([
                ['includeTests', 'Include test files', 'Related tests help answers about behavior; excluded first when the budget is tight.'],
                ['includeDocs', 'Include documentation', 'Markdown and docs files as context.'],
                ['includeReadme', 'Include README files', 'README content as architectural context.'],
              ] as const).map(([key, label, hint]) => (
                <label key={key} className="flex items-start gap-2 text-xs text-ink-2">
                  <input type="checkbox" className="mt-0.5" checked={settings[key]} onChange={(e) => update({ [key]: e.target.checked })} />
                  <span>
                    <span className="text-ink">{label}</span>
                    <span className="block text-ink-3">{hint}</span>
                  </span>
                </label>
              ))}
            </div>
          </Section>

          <Section title="Data">
            <div className="flex flex-wrap items-center gap-3">
              <button
                onClick={() => void resetSettings().then((fresh) => { setSettings(fresh); document.documentElement.dataset.theme = fresh.theme })}
                className="rounded-lg border border-line px-3 py-1.5 text-xs text-ink-2 hover:border-dragon hover:text-ink"
              >
                Reset settings to defaults
              </button>
              {!confirmWipe ? (
                <button onClick={() => setConfirmWipe(true)} className="rounded-lg border border-error/50 px-3 py-1.5 text-xs text-error hover:bg-error hover:text-night">
                  Clear all CodeAtlas data
                </button>
              ) : (
                <span className="flex items-center gap-2 text-xs text-error">
                  Deletes every index, snapshot, setting and key in this browser.
                  <button onClick={() => void wipe()} className="rounded-lg bg-error px-3 py-1.5 font-medium text-night">
                    Confirm wipe
                  </button>
                  <button onClick={() => setConfirmWipe(false)} className="text-ink-2 hover:underline">
                    Cancel
                  </button>
                </span>
              )}
            </div>
          </Section>
        </div>
      </div>
    </div>
  )
}

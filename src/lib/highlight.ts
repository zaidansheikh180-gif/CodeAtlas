// Syntax coloring for the source preview (phase 1 polish, user request
// 2026-10-16). Prism is lazy-loaded the first time a source file opens and
// only the grammars the app can parse are bundled. Tokens are flattened and
// split per line so the preview keeps its sticky line-number gutter.
//
// Colors come straight from DESIGN.md: Dragonfruit is the single accent
// (keywords), the rest are the derived palette steps. Flat, no italics.

export interface HighlightSegment {
  text: string
  color: string
}

export type HighlightedLine = HighlightSegment[]

const INK = '#F2EDFA'
const INK_2 = '#B8A8D9'
const INK_3 = '#8A76B3'
const DRAGON = '#FF4696'
const GREEN = '#3ECF8E'
const AMBER = '#F5B942'
const BLUE = '#7AB8FF'

function tokenColor(type: string): string {
  if (/^(comment|prolog|doctype|cdata)/.test(type)) return INK_3
  if (/^(keyword|important|atrule|rule|builtin)/.test(type)) return DRAGON
  if (/^(string|char|template-string|regex|attr-value|interpolation)/.test(type)) return GREEN
  if (/^(number|boolean|constant|unit|symbol)/.test(type)) return AMBER
  if (/^(function|function-variable|method|tag|selector|class-name|maybe-class-name)/.test(type)) return BLUE
  if (/^(operator|punctuation|delimiter)/.test(type)) return INK_2
  if (/^(property|attr-name|variable|parameter)/.test(type)) return INK
  return INK
}

const EXT_TO_LANG: Record<string, string> = {
  js: 'javascript', mjs: 'javascript', cjs: 'javascript',
  jsx: 'jsx', ts: 'typescript', tsx: 'tsx', mts: 'typescript', cts: 'typescript',
  py: 'python', pyi: 'python',
  json: 'json', css: 'css', html: 'markup', htm: 'markup', xml: 'markup', svg: 'markup',
  md: 'markdown', sh: 'bash', bash: 'bash', yml: 'yaml', yaml: 'yaml', toml: 'toml', sql: 'sql',
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let prismPromise: Promise<any> | null = null

function loadPrism() {
  if (!prismPromise) {
    prismPromise = (async () => {
      const Prism = (await import('prismjs')).default
      // Grammars with no internal dependencies first, then the ones that
      // extend them. jsx/tsx need markup + javascript + typescript loaded.
      await Promise.all([
        import('prismjs/components/prism-markup.js'),
        import('prismjs/components/prism-css.js'),
        import('prismjs/components/prism-json.js'),
        import('prismjs/components/prism-python.js'),
        import('prismjs/components/prism-bash.js'),
        import('prismjs/components/prism-yaml.js'),
        import('prismjs/components/prism-toml.js'),
        import('prismjs/components/prism-sql.js'),
        import('prismjs/components/prism-markdown.js'),
      ])
      await import('prismjs/components/prism-jsx.js')
      await import('prismjs/components/prism-typescript.js')
      await import('prismjs/components/prism-tsx.js')
      return Prism
    })().catch(() => null)
  }
  return prismPromise
}

export function langForPath(path: string): string | null {
  const ext = path.split('.').pop()?.toLowerCase() ?? ''
  return EXT_TO_LANG[ext] ?? null
}

interface FlatToken {
  type: string
  text: string
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function flatten(tokens: any[], parentType: string, out: FlatToken[]) {
  for (const token of tokens) {
    if (typeof token === 'string') {
      out.push({ type: parentType, text: token })
    } else {
      const type = parentType ? `${parentType} ${token.type}` : token.type
      if (typeof token.content === 'string') out.push({ type, text: token.content })
      else if (Array.isArray(token.content)) flatten(token.content, type, out)
      else flatten([token.content], type, out)
    }
  }
}

// Highlight one file into per-line colored segments. Returns null when the
// language is unknown, the file is too large to highlight cheaply, or Prism
// fails to load; the caller falls back to plain text.
export async function highlightToLines(code: string, path: string): Promise<HighlightedLine[] | null> {
  const lang = langForPath(path)
  if (!lang || code.length > 300_000) return null
  const Prism = await loadPrism()
  const grammar = Prism?.languages?.[lang]
  if (!Prism || !grammar) return null

  const flat: FlatToken[] = []
  flatten(Prism.tokenize(code, grammar) as unknown[], '', flat)

  const lines: HighlightedLine[] = [[]]
  for (const token of flat) {
    const parts = token.text.split('\n')
    for (let i = 0; i < parts.length; i++) {
      if (i > 0) lines.push([])
      if (parts[i]) lines[lines.length - 1].push({ text: parts[i], color: tokenColor(token.type) })
    }
  }
  return lines
}

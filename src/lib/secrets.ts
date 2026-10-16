// Secret scanning before any code reaches the parse/graph stores (and later, a
// model). A hit excludes the whole file and the exclusion is listed in the UI.
// This reduces exposure; it is not a guarantee, and the UI copy says so.

export interface SecretHit {
  path: string
  pattern: string
}

interface Pattern {
  name: string
  re: RegExp
}

const PATTERNS: Pattern[] = [
  { name: 'AWS access key', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'GitHub token', re: /\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b/ },
  { name: 'GitHub fine-grained token', re: /\bgithub_pat_[A-Za-z0-9_]{20,}\b/ },
  { name: 'Google API key', re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { name: 'Slack token', re: /\bxox[baprs]-[0-9A-Za-z-]{10,}\b/ },
  { name: 'OpenAI-style key', re: /\bsk-[A-Za-z0-9]{20,}\b/ },
  { name: 'Private key block', re: /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/ },
  {
    name: 'Hardcoded credential',
    re: /(?:api[_-]?key|api[_-]?secret|secret[_-]?key|access[_-]?token|auth[_-]?token|password)\s*[:=]\s*['"][A-Za-z0-9+/=_-]{20,}['"]/i,
  },
]

export function scanForSecrets(path: string, text: string): string | null {
  // Very large single-line files (often bundled output) are handled by the
  // generated-file filter; scan at most the first 200 KB here.
  const sample = text.length > 200 * 1024 ? text.slice(0, 200 * 1024) : text
  for (const pattern of PATTERNS) {
    if (pattern.re.test(sample)) return pattern.name
  }
  return null
}

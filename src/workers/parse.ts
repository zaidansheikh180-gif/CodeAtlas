// Tree-sitter (WASM) extraction for JavaScript/TypeScript and Python.
// Reads symbols (functions, classes, methods), imports and calls straight from
// the syntax tree. No LLM is involved, which is why the map works with no key.

import { Parser, Language, Node } from 'web-tree-sitter'
import type { FileLanguage } from '../lib/filter'

import treeSitterWasmUrl from 'web-tree-sitter/tree-sitter.wasm?url'
import javascriptWasmUrl from 'tree-sitter-wasms/out/tree-sitter-javascript.wasm?url'
import typescriptWasmUrl from 'tree-sitter-wasms/out/tree-sitter-typescript.wasm?url'
import tsxWasmUrl from 'tree-sitter-wasms/out/tree-sitter-tsx.wasm?url'
import pythonWasmUrl from 'tree-sitter-wasms/out/tree-sitter-python.wasm?url'

export interface ParsedSymbol {
  kind: 'function' | 'class' | 'method'
  name: string
  startLine: number
  endLine: number
}

export interface ParsedImport {
  source: string
  names: string[]
  line: number
  /** True for Python relative imports (leading dots) - resolved package-locally. */
  relativeDots?: number
}

export interface ParsedCall {
  name: string
  line: number
}

export interface ParseResult {
  symbols: ParsedSymbol[]
  imports: ParsedImport[]
  calls: ParsedCall[]
}

let parserPromise: Promise<Parser> | null = null
const languages = new Map<string, Language>()

async function getParser(): Promise<Parser> {
  if (!parserPromise) {
    parserPromise = (async () => {
      await Parser.init({ locateFile: () => treeSitterWasmUrl })
      return new Parser()
    })()
  }
  return parserPromise
}

async function grammarFor(language: FileLanguage, ext: string): Promise<Language | null> {
  // .tsx files need the tsx grammar; plain .ts the typescript one.
  const key =
    language === 'typescript' ? (ext === 'tsx' ? 'tsx' : 'typescript')
    : language === 'javascript' ? 'javascript'
    : language === 'python' ? 'python'
    : null
  if (!key) return null
  const cached = languages.get(key)
  if (cached) return cached
  const url =
    key === 'tsx' ? tsxWasmUrl
    : key === 'typescript' ? typescriptWasmUrl
    : key === 'javascript' ? javascriptWasmUrl
    : pythonWasmUrl
  const lang = await Language.load(url)
  languages.set(key, lang)
  return lang
}

export async function parseFile(
  language: FileLanguage,
  text: string,
  ext: string,
): Promise<ParseResult | null> {
  // .jsx and .tsx parse fine with the javascript / typescript grammars.
  const effective = language === 'typescript' || language === 'javascript' || language === 'python'
    ? language
    : null
  if (!effective) return null
  const parser = await getParser()
  const grammar = await grammarFor(effective, ext)
  if (!grammar) return null
  parser.setLanguage(grammar)
  const tree = parser.parse(text)
  if (!tree) return null
  try {
    const result: ParseResult = { symbols: [], imports: [], calls: [] }
    if (effective === 'python') walkPython(tree.rootNode, result)
    else walkJs(tree.rootNode, result)
    return result
  } finally {
    tree.delete()
  }
}

function unquote(text: string): string {
  return text.replace(/^['"`]|['"`]$/g, '')
}

function lineOf(node: Node): number {
  return node.startPosition.row + 1
}

function addSymbol(
  result: ParseResult,
  kind: ParsedSymbol['kind'],
  nameNode: Node | null,
  node: Node,
): void {
  if (!nameNode) return
  result.symbols.push({
    kind,
    name: nameNode.text,
    startLine: node.startPosition.row + 1,
    endLine: node.endPosition.row + 1,
  })
}

// --- JavaScript / TypeScript ---

function walkJs(node: Node, result: ParseResult): void {
  switch (node.type) {
    case 'import_statement': {
      const sourceNode = node.childForFieldName('source')
      if (sourceNode) {
        const names: string[] = []
        const clause = node.namedChildren.find((c) => c?.type === 'import_clause')
        if (clause) collectJsImportNames(clause, names)
        result.imports.push({ source: unquote(sourceNode.text), names, line: lineOf(node) })
      }
      return
    }
    case 'function_declaration':
    case 'generator_function_declaration':
      addSymbol(result, 'function', node.childForFieldName('name'), node)
      break
    case 'class_declaration':
      addSymbol(result, 'class', node.childForFieldName('name'), node)
      break
    case 'method_definition':
      addSymbol(result, 'method', node.childForFieldName('name'), node)
      break
    case 'assignment_expression': {
      // exports.foo = function / module.exports.bar = () => - common in JS packages.
      const value = node.childForFieldName('right')
      const left = node.childForFieldName('left')
      if (value && (value.type === 'function_expression' || value.type === 'arrow_function') && left) {
        if (left.type === 'member_expression') {
          const prop = left.childForFieldName('property')
          addSymbol(result, 'function', prop, node)
        } else if (left.type === 'identifier') {
          addSymbol(result, 'function', left, node)
        }
      }
      break
    }
    case 'variable_declarator': {
      const value = node.childForFieldName('value')
      if (value && (value.type === 'arrow_function' || value.type === 'function_expression')) {
        addSymbol(result, 'function', node.childForFieldName('name'), node)
      }
      break
    }
    case 'call_expression': {
      const fn = node.childForFieldName('function')
      if (fn) {
        if (fn.type === 'identifier') {
          if (fn.text === 'require') {
            const args = node.childForFieldName('arguments')
            const first = args?.namedChildren[0]
            if (first && first.type === 'string') {
              result.imports.push({ source: unquote(first.text), names: [], line: lineOf(node) })
              return
            }
          }
          result.calls.push({ name: fn.text, line: lineOf(node) })
        } else if (fn.type === 'member_expression') {
          const prop = fn.childForFieldName('property')
          if (prop) result.calls.push({ name: prop.text, line: lineOf(node) })
        }
      }
      break
    }
  }
  for (const child of node.namedChildren) {
    if (child) walkJs(child, result)
  }
}

function collectJsImportNames(clause: Node, names: string[]): void {
  for (const child of clause.namedChildren) {
    if (!child) continue
    if (child.type === 'named_imports') {
      for (const spec of child.namedChildren) {
        if (spec?.type === 'import_specifier') {
          const name = spec.childForFieldName('name')
          if (name) names.push(name.text)
        }
      }
    } else if (child.type === 'namespace_import' || child.type === 'identifier') {
      const id = child.namedChildren.find((c) => c?.type === 'identifier')
      names.push((id ?? child).text)
    }
  }
}

// --- Python ---

function walkPython(node: Node, result: ParseResult): void {
  switch (node.type) {
    case 'import_statement': {
      for (const child of node.namedChildren) {
        if (!child) continue
        if (child.type === 'dotted_name' || child.type === 'aliased_import') {
          const target = child.type === 'aliased_import' ? child.namedChildren[0] : child
          if (target) result.imports.push({ source: target.text, names: [], line: lineOf(node) })
        }
      }
      return
    }
    case 'import_from_statement': {
      const moduleNode = node.childForFieldName('module_name')
      let source = ''
      let relativeDots = 0
      if (moduleNode) {
        if (moduleNode.type === 'relative_import') {
          const dots = moduleNode.text.match(/^\.+/)
          relativeDots = dots ? dots[0].length : 1
          source = moduleNode.text.replace(/^\.+/, '')
        } else {
          source = moduleNode.text
        }
      }
      const names: string[] = []
      for (const child of node.namedChildren) {
        if (!child) continue
        if (child.type === 'dotted_name' && child !== moduleNode) names.push(child.text.split('.')[0] ?? child.text)
        if (child.type === 'aliased_import') {
          const target = child.namedChildren[0]
          if (target) names.push(target.text.split('.')[0] ?? target.text)
        }
      }
      result.imports.push({ source, names, line: lineOf(node), relativeDots })
      return
    }
    case 'function_definition':
      addSymbol(result, 'function', node.childForFieldName('name'), node)
      break
    case 'class_definition':
      addSymbol(result, 'class', node.childForFieldName('name'), node)
      break
    case 'call': {
      const fn = node.childForFieldName('function')
      if (fn) {
        if (fn.type === 'identifier') result.calls.push({ name: fn.text, line: lineOf(node) })
        else if (fn.type === 'attribute') {
          const attr = fn.childForFieldName('attribute')
          if (attr) result.calls.push({ name: attr.text, line: lineOf(node) })
        }
      }
      break
    }
  }
  for (const child of node.namedChildren) {
    if (child) walkPython(child, result)
  }
}

import { warn } from '$lib/logger'

/**
 * Context keys: named facts about where the user is and what the app is
 * doing, which a command's `when` expression is evaluated against.
 *
 * Well-known keys (set by whichever module owns the fact; unset means falsy):
 *
 * | Key               | Meaning                                              |
 * | ----------------- | ---------------------------------------------------- |
 * | `editorFocus`     | An editor surface has focus (text or not)            |
 * | `editorTextFocus` | The editor's text area itself has focus              |
 * | `canvasFocus`     | A canvas view has focus                              |
 * | `notebookFocus`   | A notebook view has focus                            |
 * | `pdfFocus`        | A PDF viewer has focus                               |
 * | `chatFocus`       | The chat panel has focus                             |
 * | `paletteOpen`     | The command palette is open (palette-state)          |
 * | `meetingActive`   | A meeting is in progress                             |
 * | `recording`       | Audio/screen recording is running                    |
 * | `isMac`           | Running on macOS (set once by `initCommands()`)      |
 * | `offline`         | The network is unreachable                           |
 * | `pro`             | The user holds a Pro entitlement                     |
 *
 * Keys are free-form: a feature can introduce its own without registering it
 * here, but add it to the table when it becomes part of the shared vocabulary.
 */

let _keys = $state<Record<string, unknown>>({})

export function setContextKey(key: string, value: unknown): void {
  _keys[key] = value
}

export function getContextKey(key: string): unknown {
  return _keys[key]
}

/** Clears every key. For tests; the app never needs to forget its context. */
export function resetContextKeys(): void {
  _keys = {}
}

// ── Expression grammar ───────────────────────────────────────────────────────
//
//   or      := and ('||' and)*
//   and     := compare ('&&' compare)*
//   compare := unary (('==' | '!=') literal)?     -- left side must be a key
//   unary   := '!' unary | primary
//   primary := key | 'true' | 'false' | '(' or ')'
//   literal := 'single-quoted string' | number | true | false
//
// Precedence therefore runs `!` > `==`/`!=` > `&&` > `||`.

type Literal = string | number | boolean

export type WhenNode =
  | { type: 'key'; key: string }
  | { type: 'const'; value: boolean }
  | { type: 'not'; operand: WhenNode }
  | { type: 'and' | 'or'; left: WhenNode; right: WhenNode }
  | { type: 'eq' | 'ne'; key: string; value: Literal }

type Token =
  | { kind: 'ident'; value: string }
  | { kind: 'string'; value: string }
  | { kind: 'number'; value: number }
  | { kind: 'op'; value: '!' | '&&' | '||' | '==' | '!=' | '(' | ')' }

const IDENT_START = /[A-Za-z_]/
const IDENT_PART = /[A-Za-z0-9_.:-]/
const NUMBER = /^-?\d+(\.\d+)?/

function tokenize(expr: string): Token[] {
  const tokens: Token[] = []
  let i = 0
  while (i < expr.length) {
    const ch = expr[i]!
    if (/\s/.test(ch)) {
      i++
      continue
    }
    const two = expr.slice(i, i + 2)
    if (two === '&&' || two === '||' || two === '==' || two === '!=') {
      tokens.push({ kind: 'op', value: two })
      i += 2
      continue
    }
    if (ch === '!' || ch === '(' || ch === ')') {
      tokens.push({ kind: 'op', value: ch })
      i++
      continue
    }
    if (ch === "'") {
      const end = expr.indexOf("'", i + 1)
      if (end === -1) throw new Error('unterminated string')
      tokens.push({ kind: 'string', value: expr.slice(i + 1, end) })
      i = end + 1
      continue
    }
    const num = NUMBER.exec(expr.slice(i))
    if (num) {
      tokens.push({ kind: 'number', value: Number(num[0]) })
      i += num[0].length
      continue
    }
    if (IDENT_START.test(ch)) {
      let j = i + 1
      while (j < expr.length && IDENT_PART.test(expr[j]!)) j++
      tokens.push({ kind: 'ident', value: expr.slice(i, j) })
      i = j
      continue
    }
    throw new Error(`unexpected character '${ch}'`)
  }
  return tokens
}

/**
 * Parses a `when` expression into an AST. Throws on malformed input — use
 * {@link evaluateWhen} for the forgiving, cached path.
 */
export function parseWhen(expr: string): WhenNode {
  const tokens = tokenize(expr)
  let pos = 0

  const peek = (): Token | undefined => tokens[pos]
  const isOp = (value: string): boolean => {
    const tok = peek()
    return tok?.kind === 'op' && tok.value === value
  }

  function parseOr(): WhenNode {
    let left = parseAnd()
    while (isOp('||')) {
      pos++
      left = { type: 'or', left, right: parseAnd() }
    }
    return left
  }

  function parseAnd(): WhenNode {
    let left = parseCompare()
    while (isOp('&&')) {
      pos++
      left = { type: 'and', left, right: parseCompare() }
    }
    return left
  }

  function parseCompare(): WhenNode {
    const left = parseUnary()
    if (!isOp('==') && !isOp('!=')) return left
    const op = isOp('==') ? 'eq' : 'ne'
    pos++
    if (left.type !== 'key') {
      throw new Error('the left side of a comparison must be a context key')
    }
    return { type: op, key: left.key, value: parseLiteral() }
  }

  function parseUnary(): WhenNode {
    if (isOp('!')) {
      pos++
      return { type: 'not', operand: parseUnary() }
    }
    return parsePrimary()
  }

  function parsePrimary(): WhenNode {
    const tok = peek()
    if (!tok) throw new Error('unexpected end of expression')
    if (tok.kind === 'op' && tok.value === '(') {
      pos++
      const inner = parseOr()
      if (!isOp(')')) throw new Error("expected ')'")
      pos++
      return inner
    }
    if (tok.kind === 'ident') {
      pos++
      if (tok.value === 'true') return { type: 'const', value: true }
      if (tok.value === 'false') return { type: 'const', value: false }
      return { type: 'key', key: tok.value }
    }
    throw new Error(`unexpected token '${String(tok.value)}'`)
  }

  function parseLiteral(): Literal {
    const tok = peek()
    pos++
    if (tok?.kind === 'string' || tok?.kind === 'number') return tok.value
    if (
      tok?.kind === 'ident' &&
      (tok.value === 'true' || tok.value === 'false')
    )
      return tok.value === 'true'
    throw new Error('expected a string, number, or boolean literal')
  }

  const ast = parseOr()
  if (pos < tokens.length) {
    throw new Error(`unexpected token '${String(tokens[pos]!.value)}'`)
  }
  return ast
}

function evaluateNode(node: WhenNode): boolean {
  switch (node.type) {
    case 'key':
      return Boolean(_keys[node.key])
    case 'const':
      return node.value
    case 'not':
      return !evaluateNode(node.operand)
    case 'and':
      return evaluateNode(node.left) && evaluateNode(node.right)
    case 'or':
      return evaluateNode(node.left) || evaluateNode(node.right)
    case 'eq':
      return _keys[node.key] === node.value
    case 'ne':
      return _keys[node.key] !== node.value
  }
}

/**
 * Parsed ASTs by source text; `null` records a parse failure so the warning
 * is logged once per expression rather than once per keypress. Not reactive
 * on purpose — it memoises a pure function of the string.
 */
// eslint-disable-next-line svelte/prefer-svelte-reactivity
const _cache = new Map<string, WhenNode | null>()

function getAst(expr: string): WhenNode | null {
  if (_cache.has(expr)) return _cache.get(expr)!
  let ast: WhenNode | null
  try {
    ast = parseWhen(expr)
  } catch (e) {
    warn(`Invalid when expression "${expr}": ${(e as Error).message}`)
    ast = null
  }
  _cache.set(expr, ast)
  return ast
}

/**
 * Whether `expr` holds against the current context keys. An empty or missing
 * expression always holds; a malformed one never does. Reactive: reading it
 * inside `$derived`/`$effect` tracks the keys it touches.
 */
export function evaluateWhen(expr: string | undefined): boolean {
  if (!expr?.trim()) return true
  const ast = getAst(expr)
  return ast ? evaluateNode(ast) : false
}

function countTerms(node: WhenNode): number {
  switch (node.type) {
    case 'not':
      return countTerms(node.operand)
    case 'and':
    case 'or':
      return countTerms(node.left) + countTerms(node.right)
    default:
      return 1
  }
}

/**
 * How narrowly `expr` scopes a binding: 0 for none, otherwise the number of
 * terms. Used to prefer `editorFocus && recording` over `editorFocus` when
 * both claim the same combo.
 */
export function whenSpecificity(expr: string | undefined): number {
  if (!expr?.trim()) return 0
  const ast = getAst(expr)
  return ast ? countTerms(ast) : 0
}

/**
 * Minimal Excel formula evaluator — ONLY what the Director's SC score cells use:
 * nested IF / AND / OR, TIME(h,m,s), comparisons (=, <>, >=, <=, >, <),
 * + - * /, unary minus, percent literals (95%), numbers, "strings",
 * cell refs ($N$7, P14, AF34).
 *
 * Purpose (wave B7 historical validation): recompute what the sheet's OWN
 * formula says the score should be, so a workbook cell whose cached value
 * disagrees with its own formula can be classified as a MANUAL OVERRIDE.
 * Never used in any live scoring path.
 */

export type CellResolver = (col: string, row: number) => number | string | null;

export type ExcelValue = number | string | boolean | null;

class Parser {
  private pos = 0;
  constructor(private readonly src: string, private readonly resolve: CellResolver) {}

  parse(): ExcelValue {
    const v = this.parseComparison();
    this.skipWs();
    if (this.pos < this.src.length) throw new Error(`Unexpected trailing input at ${this.pos}: "${this.src.slice(this.pos, this.pos + 20)}"`);
    return v;
  }

  private skipWs() {
    while (this.pos < this.src.length && /\s/.test(this.src[this.pos])) this.pos++;
  }

  private peek(n = 1): string {
    return this.src.slice(this.pos, this.pos + n);
  }

  private parseComparison(): ExcelValue {
    let left = this.parseAdditive();
    this.skipWs();
    for (;;) {
      let op: string | null = null;
      if (this.peek(2) === '>=' || this.peek(2) === '<=' || this.peek(2) === '<>') op = this.peek(2);
      else if (this.peek() === '>' || this.peek() === '<' || this.peek() === '=') op = this.peek();
      if (!op) return left;
      this.pos += op.length;
      const right = this.parseAdditive();
      left = this.compare(op, left, right);
      this.skipWs();
    }
  }

  private compare(op: string, a: ExcelValue, b: ExcelValue): ExcelValue {
    // Blank-cell "=\"\"" semantics: an empty/blank cell equals "".
    const blankEq = (x: ExcelValue, y: ExcelValue) =>
      (x === null || x === '') && (y === null || y === '');
    if (op === '=') {
      if (blankEq(a, b)) return true;
      return a === b || (typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) < 1e-12);
    }
    if (op === '<>') return !(this.compare('=', a, b) as boolean);
    // Ordered comparisons need numbers on both sides; anything else → null (unknown)
    if (typeof a !== 'number' || typeof b !== 'number') return null;
    switch (op) {
      case '>': return a > b;
      case '<': return a < b;
      case '>=': return a >= b || Math.abs(a - b) < 1e-12;
      case '<=': return a <= b || Math.abs(a - b) < 1e-12;
    }
    return null;
  }

  private parseAdditive(): ExcelValue {
    let left = this.parseMultiplicative();
    for (;;) {
      this.skipWs();
      const ch = this.peek();
      if (ch !== '+' && ch !== '-') return left;
      this.pos++;
      const right = this.parseMultiplicative();
      left = this.arith(ch, left, right);
    }
  }

  private parseMultiplicative(): ExcelValue {
    let left = this.parseUnary();
    for (;;) {
      this.skipWs();
      const ch = this.peek();
      if (ch !== '*' && ch !== '/') return left;
      this.pos++;
      const right = this.parseUnary();
      left = this.arith(ch, left, right);
    }
  }

  /** Excel arithmetic coercion: blank → 0; "" and other strings in + coerce to 0 only for blank ("") — else null. */
  private arith(op: string, a: ExcelValue, b: ExcelValue): ExcelValue {
    const num = (v: ExcelValue): number | null => {
      if (typeof v === 'number') return v;
      if (v === null || v === '') return 0; // blank cell / "" behaves as 0 in the SC sheets' H-sum
      if (typeof v === 'string' && v.trim() !== '' && !isNaN(Number(v))) return Number(v); // "0" string from U formula
      if (typeof v === 'boolean') return v ? 1 : 0;
      return null;
    };
    const x = num(a), y = num(b);
    if (x === null || y === null) return null;
    switch (op) {
      case '+': return x + y;
      case '-': return x - y;
      case '*': return x * y;
      case '/': return y === 0 ? null : x / y;
    }
    return null;
  }

  private parseUnary(): ExcelValue {
    this.skipWs();
    if (this.peek() === '-') {
      this.pos++;
      const v = this.parseUnary();
      return typeof v === 'number' ? -v : null;
    }
    if (this.peek() === '+') {
      this.pos++;
      return this.parseUnary();
    }
    return this.parsePostfix();
  }

  /** atom with optional % postfix */
  private parsePostfix(): ExcelValue {
    let v = this.parseAtom();
    this.skipWs();
    while (this.peek() === '%') {
      this.pos++;
      v = typeof v === 'number' ? v / 100 : null;
      this.skipWs();
    }
    return v;
  }

  private parseAtom(): ExcelValue {
    this.skipWs();
    const ch = this.peek();

    if (ch === '(') {
      this.pos++;
      const v = this.parseComparison();
      this.skipWs();
      if (this.peek() !== ')') throw new Error(`Expected ) at ${this.pos}`);
      this.pos++;
      return v;
    }

    if (ch === '"') {
      this.pos++;
      let s = '';
      while (this.pos < this.src.length && this.src[this.pos] !== '"') s += this.src[this.pos++];
      if (this.peek() !== '"') throw new Error('Unterminated string');
      this.pos++;
      return s;
    }

    // number
    const numMatch = /^\d+(\.\d+)?/.exec(this.src.slice(this.pos));
    if (numMatch) {
      this.pos += numMatch[0].length;
      return Number(numMatch[0]);
    }

    // function or cell ref
    const identMatch = /^\$?[A-Za-z]{1,10}\$?\d*/.exec(this.src.slice(this.pos));
    if (!identMatch) throw new Error(`Unexpected char "${ch}" at ${this.pos}`);
    const ident = identMatch[0];

    // function call?
    const after = this.src.slice(this.pos + ident.length).replace(/^\s*/, '');
    if (after.startsWith('(') && !/\d/.test(ident)) {
      this.pos += ident.length;
      this.skipWs();
      this.pos++; // consume (
      const args: ExcelValue[] = [];
      this.skipWs();
      if (this.peek() !== ')') {
        for (;;) {
          args.push(this.parseComparison());
          this.skipWs();
          if (this.peek() === ',' || this.peek() === ';') { this.pos++; continue; }
          break;
        }
      }
      if (this.peek() !== ')') throw new Error(`Expected ) after args of ${ident} at ${this.pos}`);
      this.pos++;
      return this.callFn(ident.toUpperCase(), args);
    }

    // cell reference like $N$7, P14, AF34
    const refMatch = /^\$?([A-Za-z]{1,3})\$?(\d+)$/.exec(ident);
    if (refMatch) {
      this.pos += ident.length;
      return this.resolve(refMatch[1].toUpperCase(), Number(refMatch[2]));
    }

    throw new Error(`Unknown token "${ident}" at ${this.pos}`);
  }

  private callFn(name: string, args: ExcelValue[]): ExcelValue {
    switch (name) {
      case 'IF': {
        const cond = args[0];
        if (cond === null) return null; // unknown condition → unknown result
        return cond ? (args[1] ?? null) : (args.length > 2 ? args[2] : false);
      }
      case 'AND': {
        if (args.some((a) => a === null)) return null;
        return args.every((a) => !!a);
      }
      case 'OR': {
        if (args.some((a) => a === null)) return null;
        return args.some((a) => !!a);
      }
      case 'TIME': {
        const [h, m, s] = args.map((a) => (typeof a === 'number' ? a : 0));
        return (h * 3600 + m * 60 + s) / 86400;
      }
      default:
        throw new Error(`Unsupported function ${name}`);
    }
  }
}

/**
 * Evaluate an Excel formula string (without the leading '=').
 * Returns null when the result cannot be determined (unsupported input,
 * non-numeric comparison, etc.) — callers must treat null as "cannot verify",
 * never as a score.
 */
export function evalExcelFormula(formula: string, resolve: CellResolver): ExcelValue {
  try {
    return new Parser(formula.trim(), resolve).parse();
  } catch {
    return null;
  }
}

/**
 * Detect the "wrong row" spreadsheet bug: a relative row reference in the
 * formula that points to a DIFFERENT row than the cell's own row (e.g. the
 * Social Media block rows 89+ whose Response-Time formula reads AF34).
 * Absolute refs ($AF$4 threshold cells) are excluded.
 */
export function formulaReferencesOtherRow(formula: string, ownRow: number): boolean {
  const re = /(\$?)([A-Z]{1,3})(\$?)(\d+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(formula)) !== null) {
    const rowAbs = m[3] === '$';
    if (!rowAbs && Number(m[4]) !== ownRow) return true;
  }
  return false;
}

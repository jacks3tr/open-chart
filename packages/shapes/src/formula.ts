import type {
  ShapeDataValue,
  ShapeDiagnostic,
  ShapeFormulaValue,
} from './types.js';

export type FormulaScope = ReadonlyMap<string, ShapeDataValue>;

export type FormulaEvaluationResult =
  | { readonly ok: true; readonly value: ShapeDataValue }
  | { readonly ok: false; readonly diagnostic: ShapeDiagnostic };

const MAX_FORMULA_TOKENS = 512;

type BinaryOperator =
  | '*'
  | '/'
  | '%'
  | '+'
  | '-'
  | '<'
  | '<='
  | '>'
  | '>='
  | '=='
  | '!='
  | '&&'
  | '||';

type Token =
  | { readonly kind: 'number'; readonly lexeme: string; readonly offset: number; readonly value: number }
  | { readonly kind: 'string'; readonly lexeme: string; readonly offset: number; readonly value: string }
  | { readonly kind: 'identifier'; readonly lexeme: string; readonly offset: number }
  | { readonly kind: 'reference'; readonly lexeme: string; readonly offset: number; readonly name: string }
  | { readonly kind: 'operator'; readonly lexeme: string; readonly offset: number }
  | { readonly kind: 'left-paren'; readonly lexeme: '('; readonly offset: number }
  | { readonly kind: 'right-paren'; readonly lexeme: ')'; readonly offset: number }
  | { readonly kind: 'eof'; readonly lexeme: ''; readonly offset: number };

type Expression =
  | { readonly kind: 'literal'; readonly value: ShapeDataValue; readonly offset: number }
  | { readonly kind: 'reference'; readonly name: string; readonly offset: number }
  | {
      readonly kind: 'unary';
      readonly operator: '!' | '+' | '-';
      readonly operand: Expression;
      readonly offset: number;
    }
  | {
      readonly kind: 'binary';
      readonly operator: BinaryOperator;
      readonly left: Expression;
      readonly right: Expression;
      readonly offset: number;
    };

class FormulaFailure extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'FormulaFailure';
  }
}

function isDigit(character: string | undefined): boolean {
  return character !== undefined && character >= '0' && character <= '9';
}

function isIdentifierStart(character: string | undefined): boolean {
  return (
    character !== undefined &&
    ((character >= 'a' && character <= 'z') ||
      (character >= 'A' && character <= 'Z') ||
      character === '_')
  );
}

function isIdentifierPart(character: string | undefined): boolean {
  return isIdentifierStart(character) || isDigit(character);
}

function tokenDescription(token: Token): string {
  return JSON.stringify(token.lexeme);
}

function unexpectedToken(token: Token): FormulaFailure {
  return new FormulaFailure(
    `Unexpected token ${tokenDescription(token)} at offset ${token.offset}`,
  );
}

function tokenize(expression: string): readonly Token[] {
  const tokens: Token[] = [];
  let offset = 0;

  while (offset < expression.length) {
    const character = expression[offset];
    if (character === undefined) {
      break;
    }

    if (/\s/.test(character)) {
      offset += 1;
      continue;
    }

    if (isDigit(character) || (character === '.' && isDigit(expression[offset + 1]))) {
      const start = offset;
      if (character === '.') {
        offset += 1;
        while (isDigit(expression[offset])) {
          offset += 1;
        }
      } else {
        while (isDigit(expression[offset])) {
          offset += 1;
        }
        if (expression[offset] === '.') {
          offset += 1;
          while (isDigit(expression[offset])) {
            offset += 1;
          }
        }
      }

      const lexeme = expression.slice(start, offset);
      const value = Number(lexeme);
      if (!Number.isFinite(value)) {
        throw new FormulaFailure(`Invalid number at offset ${start}`);
      }
      tokens.push({ kind: 'number', lexeme, offset: start, value });
      continue;
    }

    if (character === '"') {
      const start = offset;
      offset += 1;
      let closed = false;
      while (offset < expression.length) {
        const stringCharacter = expression[offset];
        if (stringCharacter === undefined) {
          break;
        }
        if (stringCharacter === '\\') {
          offset += 2;
          continue;
        }
        if (stringCharacter === '"') {
          offset += 1;
          closed = true;
          break;
        }
        if (stringCharacter === '\n' || stringCharacter === '\r') {
          break;
        }
        offset += 1;
      }

      if (!closed) {
        throw new FormulaFailure(`Unterminated string at offset ${start}`);
      }

      const lexeme = expression.slice(start, offset);
      let value: unknown;
      try {
        value = JSON.parse(lexeme) as unknown;
      } catch {
        throw new FormulaFailure(`Invalid string literal at offset ${start}`);
      }
      if (typeof value !== 'string') {
        throw new FormulaFailure(`Invalid string literal at offset ${start}`);
      }
      tokens.push({ kind: 'string', lexeme, offset: start, value });
      continue;
    }

    if (character === '@') {
      const start = offset;
      const nameStart = offset + 1;
      if (isIdentifierStart(expression[nameStart])) {
        offset = nameStart + 1;
        while (
          isIdentifierPart(expression[offset]) ||
          expression[offset] === '-' // Hyphens are allowed after the first character.
        ) {
          offset += 1;
        }
        const name = expression.slice(nameStart, offset);
        tokens.push({
          kind: 'reference',
          lexeme: expression.slice(start, offset),
          offset: start,
          name,
        });
      } else {
        offset += 1;
        tokens.push({ kind: 'operator', lexeme: '@', offset: start });
      }
      continue;
    }

    if (isIdentifierStart(character)) {
      const start = offset;
      offset += 1;
      while (isIdentifierPart(expression[offset])) {
        offset += 1;
      }
      const lexeme = expression.slice(start, offset);
      tokens.push({ kind: 'identifier', lexeme, offset: start });
      continue;
    }

    if (character === '(') {
      tokens.push({ kind: 'left-paren', lexeme: '(', offset });
      offset += 1;
      continue;
    }
    if (character === ')') {
      tokens.push({ kind: 'right-paren', lexeme: ')', offset });
      offset += 1;
      continue;
    }

    const start = offset;
    const twoCharacterOperator = expression.slice(offset, offset + 2);
    if (
      twoCharacterOperator === '<=' ||
      twoCharacterOperator === '>=' ||
      twoCharacterOperator === '==' ||
      twoCharacterOperator === '!=' ||
      twoCharacterOperator === '&&' ||
      twoCharacterOperator === '||'
    ) {
      tokens.push({ kind: 'operator', lexeme: twoCharacterOperator, offset: start });
      offset += 2;
      continue;
    }

    tokens.push({ kind: 'operator', lexeme: character, offset: start });
    offset += 1;
  }

  tokens.push({ kind: 'eof', lexeme: '', offset: expression.length });
  return tokens;
}

class Parser {
  private position = 0;

  public constructor(private readonly tokens: readonly Token[]) {}

  public parse(): Expression {
    const expression = this.parseLogicalOr();
    const token = this.peek();
    if (token.kind !== 'eof') {
      throw unexpectedToken(token);
    }
    return expression;
  }

  private peek(): Token {
    return this.tokens[this.position] ?? this.tokens[this.tokens.length - 1]!;
  }

  private consume(): Token {
    const token = this.peek();
    if (token.kind !== 'eof') {
      this.position += 1;
    }
    return token;
  }

  private parseLogicalOr(): Expression {
    let expression = this.parseLogicalAnd();
    while (this.isOperator('||')) {
      const operator = this.consume();
      expression = {
        kind: 'binary',
        operator: '||',
        left: expression,
        right: this.parseLogicalAnd(),
        offset: operator.offset,
      };
    }
    return expression;
  }

  private parseLogicalAnd(): Expression {
    let expression = this.parseEquality();
    while (this.isOperator('&&')) {
      const operator = this.consume();
      expression = {
        kind: 'binary',
        operator: '&&',
        left: expression,
        right: this.parseEquality(),
        offset: operator.offset,
      };
    }
    return expression;
  }

  private parseEquality(): Expression {
    let expression = this.parseComparison();
    while (this.isOperator('==') || this.isOperator('!=')) {
      const operator = this.consume();
      const binaryOperator = operator.lexeme as '==' | '!=';
      expression = {
        kind: 'binary',
        operator: binaryOperator,
        left: expression,
        right: this.parseComparison(),
        offset: operator.offset,
      };
    }
    return expression;
  }

  private parseComparison(): Expression {
    let expression = this.parseAdditive();
    while (
      this.isOperator('<') ||
      this.isOperator('<=') ||
      this.isOperator('>') ||
      this.isOperator('>=')
    ) {
      const operator = this.consume();
      const binaryOperator = operator.lexeme as '<' | '<=' | '>' | '>=';
      expression = {
        kind: 'binary',
        operator: binaryOperator,
        left: expression,
        right: this.parseAdditive(),
        offset: operator.offset,
      };
    }
    return expression;
  }

  private parseAdditive(): Expression {
    let expression = this.parseMultiplicative();
    while (this.isOperator('+') || this.isOperator('-')) {
      const operator = this.consume();
      const binaryOperator = operator.lexeme as '+' | '-';
      expression = {
        kind: 'binary',
        operator: binaryOperator,
        left: expression,
        right: this.parseMultiplicative(),
        offset: operator.offset,
      };
    }
    return expression;
  }

  private parseMultiplicative(): Expression {
    let expression = this.parseUnary();
    while (
      this.isOperator('*') ||
      this.isOperator('/') ||
      this.isOperator('%')
    ) {
      const operator = this.consume();
      const binaryOperator = operator.lexeme as '*' | '/' | '%';
      expression = {
        kind: 'binary',
        operator: binaryOperator,
        left: expression,
        right: this.parseUnary(),
        offset: operator.offset,
      };
    }
    return expression;
  }

  private parseUnary(): Expression {
    if (this.isOperator('!') || this.isOperator('+') || this.isOperator('-')) {
      const operator = this.consume();
      const unaryOperator = operator.lexeme as '!' | '+' | '-';
      return {
        kind: 'unary',
        operator: unaryOperator,
        operand: this.parseUnary(),
        offset: operator.offset,
      };
    }
    return this.parsePrimary();
  }

  private parsePrimary(): Expression {
    const token = this.consume();
    switch (token.kind) {
      case 'number':
        return { kind: 'literal', value: token.value, offset: token.offset };
      case 'string':
        return { kind: 'literal', value: token.value, offset: token.offset };
      case 'reference':
        return { kind: 'reference', name: token.name, offset: token.offset };
      case 'identifier': {
        const keyword = token.lexeme.toUpperCase();
        if (keyword === 'TRUE') {
          return { kind: 'literal', value: true, offset: token.offset };
        }
        if (keyword === 'FALSE') {
          return { kind: 'literal', value: false, offset: token.offset };
        }
        if (keyword === 'NULL') {
          return { kind: 'literal', value: null, offset: token.offset };
        }
        throw unexpectedToken(token);
      }
      case 'left-paren': {
        const expression = this.parseLogicalOr();
        const closing = this.consume();
        if (closing.kind !== 'right-paren') {
          throw unexpectedToken(closing);
        }
        return expression;
      }
      default:
        throw unexpectedToken(token);
    }
  }

  private isOperator(operator: string): boolean {
    const token = this.peek();
    return token.kind === 'operator' && token.lexeme === operator;
  }
}

function isScalarPrimitive(value: ShapeDataValue): value is null | boolean | number | string {
  return value === null || typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string';
}

function requireFiniteNumber(
  value: ShapeDataValue,
  operator: string,
  offset: number,
): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new FormulaFailure(`Operator "${operator}" requires finite numbers at offset ${offset}`);
  }
  return value;
}

function requireBoolean(value: ShapeDataValue, operator: string, offset: number): boolean {
  if (typeof value !== 'boolean') {
    throw new FormulaFailure(`Operator "${operator}" requires booleans at offset ${offset}`);
  }
  return value;
}

function requireScalar(value: ShapeDataValue, operator: string, offset: number): null | boolean | number | string {
  if (!isScalarPrimitive(value) || (typeof value === 'number' && !Number.isFinite(value))) {
    throw new FormulaFailure(`Operator "${operator}" requires scalar primitives at offset ${offset}`);
  }
  return value;
}

function evaluateExpression(expression: Expression, scope: FormulaScope): ShapeDataValue {
  switch (expression.kind) {
    case 'literal':
      return expression.value;
    case 'reference': {
      if (!scope.has(expression.name)) {
        throw new FormulaFailure(
          `Unknown reference "@${expression.name}" at offset ${expression.offset}`,
        );
      }
      const value = scope.get(expression.name);
      if (value === undefined) {
        throw new FormulaFailure(
          `Unknown reference "@${expression.name}" at offset ${expression.offset}`,
        );
      }
      return value;
    }
    case 'unary': {
      const operand = evaluateExpression(expression.operand, scope);
      if (expression.operator === '!') {
        return !requireBoolean(operand, expression.operator, expression.offset);
      }
      const number = requireFiniteNumber(operand, expression.operator, expression.offset);
      const result = expression.operator === '+' ? number : -number;
      if (!Number.isFinite(result)) {
        throw new FormulaFailure(`Non-finite result at offset ${expression.offset}`);
      }
      return result;
    }
    case 'binary': {
      if (expression.operator === '&&') {
        const left = requireBoolean(
          evaluateExpression(expression.left, scope),
          expression.operator,
          expression.offset,
        );
        if (!left) {
          return false;
        }
        return requireBoolean(
          evaluateExpression(expression.right, scope),
          expression.operator,
          expression.offset,
        );
      }
      if (expression.operator === '||') {
        const left = requireBoolean(
          evaluateExpression(expression.left, scope),
          expression.operator,
          expression.offset,
        );
        if (left) {
          return true;
        }
        return requireBoolean(
          evaluateExpression(expression.right, scope),
          expression.operator,
          expression.offset,
        );
      }

      const left = evaluateExpression(expression.left, scope);
      const right = evaluateExpression(expression.right, scope);
      switch (expression.operator) {
        case '+': {
          if (typeof left === 'string' || typeof right === 'string') {
            const leftScalar = requireScalar(left, expression.operator, expression.offset);
            const rightScalar = requireScalar(right, expression.operator, expression.offset);
            return String(leftScalar) + String(rightScalar);
          }
          const leftNumber = requireFiniteNumber(left, expression.operator, expression.offset);
          const rightNumber = requireFiniteNumber(right, expression.operator, expression.offset);
          const result = leftNumber + rightNumber;
          if (!Number.isFinite(result)) {
            throw new FormulaFailure(`Non-finite result at offset ${expression.offset}`);
          }
          return result;
        }
        case '-':
        case '*': {
          const leftNumber = requireFiniteNumber(left, expression.operator, expression.offset);
          const rightNumber = requireFiniteNumber(right, expression.operator, expression.offset);
          const result = expression.operator === '-' ? leftNumber - rightNumber : leftNumber * rightNumber;
          if (!Number.isFinite(result)) {
            throw new FormulaFailure(`Non-finite result at offset ${expression.offset}`);
          }
          return result;
        }
        case '/':
        case '%': {
          const leftNumber = requireFiniteNumber(left, expression.operator, expression.offset);
          const rightNumber = requireFiniteNumber(right, expression.operator, expression.offset);
          if (rightNumber === 0) {
            throw new FormulaFailure(`Division by zero at offset ${expression.offset}`);
          }
          const result = expression.operator === '/' ? leftNumber / rightNumber : leftNumber % rightNumber;
          if (!Number.isFinite(result)) {
            throw new FormulaFailure(`Non-finite result at offset ${expression.offset}`);
          }
          return result;
        }
        case '<':
        case '<=':
        case '>':
        case '>=': {
          if (typeof left === 'number' && typeof right === 'number') {
            if (!Number.isFinite(left) || !Number.isFinite(right)) {
              throw new FormulaFailure(`Operator "${expression.operator}" requires finite numbers at offset ${expression.offset}`);
            }
            if (expression.operator === '<') return left < right;
            if (expression.operator === '<=') return left <= right;
            if (expression.operator === '>') return left > right;
            return left >= right;
          }
          if (typeof left === 'string' && typeof right === 'string') {
            if (expression.operator === '<') return left < right;
            if (expression.operator === '<=') return left <= right;
            if (expression.operator === '>') return left > right;
            return left >= right;
          }
          throw new FormulaFailure(
            `Operator "${expression.operator}" requires two numbers or two strings at offset ${expression.offset}`,
          );
        }
        case '==':
        case '!=': {
          const leftScalar = requireScalar(left, expression.operator, expression.offset);
          const rightScalar = requireScalar(right, expression.operator, expression.offset);
          const equal =
            typeof leftScalar === typeof rightScalar && leftScalar === rightScalar;
          return expression.operator === '==' ? equal : !equal;
        }
      }
    }
  }
}

function invalidFormula(path: string, message: string): FormulaEvaluationResult {
  return {
    ok: false,
    diagnostic: {
      code: 'FORMULA_INVALID',
      path,
      message,
    },
  };
}

export function evaluateShapeFormula(
  input: ShapeFormulaValue,
  scope: FormulaScope,
  path: string,
): FormulaEvaluationResult {
  if (typeof input !== 'string' || !input.startsWith('=')) {
    return { ok: true, value: input };
  }

  const expression = input.slice(1);
  if (expression.trim().length === 0) {
    return invalidFormula(path, 'Empty formula at offset 0');
  }

  try {
    const tokens = tokenize(expression);
    if (tokens.length - 1 > MAX_FORMULA_TOKENS) {
      return invalidFormula(
        path,
        `Formula exceeds ${MAX_FORMULA_TOKENS} tokens`,
      );
    }
    const parsed = new Parser(tokens).parse();
    return { ok: true, value: evaluateExpression(parsed, scope) };
  } catch (error: unknown) {
    if (error instanceof FormulaFailure) {
      return invalidFormula(path, error.message);
    }
    throw error;
  }
}

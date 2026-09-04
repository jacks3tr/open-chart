import type { Edge, Node, OpenChartDocument } from '@openchart/ir';

export type RuleEntityKind = 'node' | 'edge';
export type RuleOperator = 'eq' | 'neq' | 'contains' | 'gt' | 'gte' | 'lt' | 'lte' | 'exists';
export type RuleValue = string | number | boolean | null;

export interface ConditionalRule {
  readonly id: string;
  readonly entity: RuleEntityKind;
  readonly entityIds?: readonly string[];
  readonly field: string;
  readonly operator: RuleOperator;
  readonly value?: RuleValue;
  readonly styleId: string;
}

export interface RuleChange {
  readonly entity: RuleEntityKind;
  readonly entityId: string;
  readonly field: string;
}

export interface RuleMatch {
  readonly ruleId: string;
  readonly entity: RuleEntityKind;
  readonly entityId: string;
  readonly styleId: string;
}

export interface RuleEvaluationResult {
  readonly evaluatedRuleIds: readonly string[];
  readonly matches: readonly RuleMatch[];
}

type RuleEntity = Node | Edge;

function compareIds(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function dependencyKey(entity: RuleEntityKind, entityId: string, field: string): string {
  return `${entity}\u0000${entityId}\u0000${field}`;
}

function entitiesFor(
  document: OpenChartDocument,
  kind: RuleEntityKind,
): Readonly<Record<string, RuleEntity>> {
  return kind === 'node' ? document.nodes : document.edges;
}

function readField(entity: RuleEntity, field: string): unknown {
  if (field.length === 0) {
    throw new Error('Conditional rule field cannot be empty');
  }
  let value: unknown = entity;
  for (const segment of field.split('.')) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return undefined;
    }
    value = (value as Readonly<Record<string, unknown>>)[segment];
  }
  return value;
}

function compareNumeric(actual: unknown, expected: RuleValue | undefined): number | undefined {
  return typeof actual === 'number' && Number.isFinite(actual) &&
    typeof expected === 'number' && Number.isFinite(expected)
    ? actual - expected
    : undefined;
}

function matchesPredicate(actual: unknown, rule: ConditionalRule): boolean {
  switch (rule.operator) {
    case 'exists':
      return actual !== undefined && actual !== null;
    case 'eq':
      return actual === rule.value;
    case 'neq':
      return actual !== rule.value;
    case 'contains':
      return typeof actual === 'string' && typeof rule.value === 'string'
        ? actual.toLocaleLowerCase().includes(rule.value.toLocaleLowerCase())
        : Array.isArray(actual) && actual.includes(rule.value);
    case 'gt': {
      const comparison = compareNumeric(actual, rule.value);
      return comparison !== undefined && comparison > 0;
    }
    case 'gte': {
      const comparison = compareNumeric(actual, rule.value);
      return comparison !== undefined && comparison >= 0;
    }
    case 'lt': {
      const comparison = compareNumeric(actual, rule.value);
      return comparison !== undefined && comparison < 0;
    }
    case 'lte': {
      const comparison = compareNumeric(actual, rule.value);
      return comparison !== undefined && comparison <= 0;
    }
  }
}

function validateRule(rule: ConditionalRule): void {
  if (rule.id.trim().length === 0) {
    throw new Error('Conditional rule id cannot be empty');
  }
  if (rule.field.trim().length === 0) {
    throw new Error(`Conditional rule ${JSON.stringify(rule.id)} field cannot be empty`);
  }
  if (rule.styleId.trim().length === 0) {
    throw new Error(`Conditional rule ${JSON.stringify(rule.id)} styleId cannot be empty`);
  }
  if (rule.operator !== 'exists' && rule.value === undefined) {
    throw new Error(`Conditional rule ${JSON.stringify(rule.id)} requires a value`);
  }
}

export class IncrementalRuleEngine {
  readonly #rulesById = new Map<string, ConditionalRule>();
  readonly #dependencyIndex = new Map<string, Set<string>>();

  public constructor(rules: readonly ConditionalRule[]) {
    for (const rule of rules) {
      validateRule(rule);
      if (this.#rulesById.has(rule.id)) {
        throw new Error(`Duplicate rule id ${JSON.stringify(rule.id)}`);
      }
      const normalized: ConditionalRule = {
        ...rule,
        ...(rule.entityIds === undefined
          ? {}
          : { entityIds: [...new Set(rule.entityIds)].sort(compareIds) }),
      };
      this.#rulesById.set(rule.id, normalized);
      const entityIds = normalized.entityIds ?? ['*'];
      for (const entityId of entityIds) {
        const key = dependencyKey(normalized.entity, entityId, normalized.field);
        const dependencies = this.#dependencyIndex.get(key) ?? new Set<string>();
        dependencies.add(normalized.id);
        this.#dependencyIndex.set(key, dependencies);
      }
    }
  }

  public evaluateAll(document: OpenChartDocument): RuleEvaluationResult {
    return this.#evaluate(document, [...this.#rulesById.keys()].sort(compareIds));
  }

  public evaluateChanges(
    document: OpenChartDocument,
    changes: readonly RuleChange[],
  ): RuleEvaluationResult {
    const ruleIds = new Set<string>();
    for (const change of changes) {
      for (const entityId of [change.entityId, '*']) {
        for (const ruleId of this.#dependencyIndex.get(
          dependencyKey(change.entity, entityId, change.field),
        ) ?? []) {
          ruleIds.add(ruleId);
        }
      }
    }
    return this.#evaluate(document, [...ruleIds].sort(compareIds));
  }

  #evaluate(document: OpenChartDocument, ruleIds: readonly string[]): RuleEvaluationResult {
    const matches: RuleMatch[] = [];
    for (const ruleId of ruleIds) {
      const rule = this.#rulesById.get(ruleId);
      if (rule === undefined) {
        continue;
      }
      if (document.styles[rule.styleId] === undefined) {
        throw new Error(
          `Conditional rule ${JSON.stringify(rule.id)} references missing style ${JSON.stringify(rule.styleId)}`,
        );
      }
      const entities = entitiesFor(document, rule.entity);
      const entityIds = rule.entityIds ?? Object.keys(entities).sort(compareIds);
      for (const entityId of entityIds) {
        const entity = entities[entityId];
        if (entity !== undefined && matchesPredicate(readField(entity, rule.field), rule)) {
          matches.push({
            ruleId: rule.id,
            entity: rule.entity,
            entityId,
            styleId: rule.styleId,
          });
        }
      }
    }
    return { evaluatedRuleIds: [...ruleIds], matches };
  }
}

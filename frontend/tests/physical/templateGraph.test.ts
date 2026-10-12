// The template-level view of a prepared domain (src/solver/physical/templateGraph.ts): owners, candidate edges over ACTIVE occurrences, the
// topological order and the copy bounds, on hand-built lookups; a cyclic graph is refused (owner decision 2d as amended).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTemplateGraph, PhysicalModelError, preparePhysicalWeapon, prepareSubproblemDomain, type TemplateGraph } from '../../src/solver/physical';
import type { ItemLookup } from '../../src/solver/types';
import { gun, lookupOf, mod, slot, WEAPON } from './lpFixtures';

function graphOf(lookup: ItemLookup, request: Parameters<typeof prepareSubproblemDomain>[2] = {}): { graph: TemplateGraph; ids: readonly string[] } {
  const blueprint = preparePhysicalWeapon(lookup, WEAPON);
  const domain = prepareSubproblemDomain(blueprint, lookup, request);
  return { graph: buildTemplateGraph(blueprint, domain), ids: blueprint.templateIds };
}

const edgesOf = (graph: TemplateGraph, ids: readonly string[]): string[] =>
  graph.slots.flatMap(s => s.candidates.map(c => `${ids[s.owner]}.${s.slotId}>${ids[c]}`)).sort();

test('owners, required flags and candidate edges come from the active occurrences; a template reached twice is one template', () => {
  const lookup = lookupOf(
    gun(WEAPON, { slots: [slot('mount', ['host']), slot('stock', ['butt', 'host'], true)] }),
    ['host', mod('host', { slots: [slot('rail', ['sight'])] })],
    ['sight', mod('sight')],
    ['butt', mod('butt')],
  );
  const { graph, ids } = graphOf(lookup);
  assert.deepEqual(edgesOf(graph, ids), ['gun.mount>host', 'gun.stock>butt', 'gun.stock>host', 'host.rail>sight']);
  assert.deepEqual(graph.slots.filter(s => s.required).map(s => s.slotId), ['stock']);
  assert.equal(graph.edgeCount, 4);
  assert.equal(ids[graph.topological[0]], WEAPON, 'the receiver starts the order');
  const position = new Map([...graph.topological].map((t, i) => [ids[t], i]));
  assert.ok((position.get('host') as number) < (position.get('sight') as number), 'parents before children');
});

test('the filters of the request remove templates and their edges: an excluded template, and a child whose only host is excluded', () => {
  const lookup = lookupOf(
    gun(WEAPON, { slots: [slot('mount', ['host', 'plain'])] }),
    ['host', mod('host', { slots: [slot('rail', ['sight'])] })],
    ['plain', mod('plain')],
    ['sight', mod('sight')],
  );
  const { graph, ids } = graphOf(lookup, { excludeItems: ['host'] });
  assert.deepEqual(edgesOf(graph, ids), ['gun.mount>plain']);
  assert.equal(graph.active[ids.indexOf('sight')], 0, 'a part below an excluded host has no active occurrence');
});

test('copy bounds: the exact maximum over trees on an acyclic graph, far below the occurrence count; one under a self-conflict', () => {
  // `a` fits three root slots; `h` fits one root slot and has two slots that take `a` (so up to five copies of `a`); `b` fits both slots of `a`.
  const lookup = lookupOf(
    gun(WEAPON, { slots: [slot('r1', ['a', 'h']), slot('r2', ['a']), slot('r3', ['a'])] }),
    ['a', mod('a', { slots: [slot('x', ['b']), slot('y', ['b'])] })],
    ['h', mod('h', { slots: [slot('p', ['a']), slot('q', ['a'])] })],
    ['b', mod('b')],
    ['s', mod('s', { conflictsItems: ['s'] })],
  );
  lookup[WEAPON].slots.push({ id: 'r4', name: 'r4', nameId: 'r4', required: false, allowedItems: ['s'] });
  lookup[WEAPON].slots.push({ id: 'r5', name: 'r5', nameId: 'r5', required: false, allowedItems: ['s'] });
  const blueprint = preparePhysicalWeapon(lookup, WEAPON);
  const domain = prepareSubproblemDomain(blueprint, lookup, {});
  const graph = buildTemplateGraph(blueprint, domain);
  const copies = (id: string): number => graph.maxCopies[blueprint.templateIndexOf(id)];
  // r1 = h gives two copies of a through p and q, r2 and r3 give two more: four; r1 = a gives three. The maximum is four.
  assert.equal(copies('a'), 4);
  assert.equal(copies('h'), 1);
  assert.equal(copies('b'), 8, 'two slots of each of four copies of a');
  assert.ok(domain.templateActiveCount[blueprint.templateIndexOf('b')] > copies('b'), 'the occurrence count is a looser bound');
  assert.equal(copies('s'), 1, 'two slots fit it, a self-conflict allows one copy');
  assert.equal(graph.maxCopies[0], 1);
});

test('a cycle among the templates is not ordered: it throws CYCLIC_PART_GRAPH (a gun with a cycle is refused before any model is built)', () => {
  // A and B can each host the other (reachable from different root slots, so neither occurrence has the other as an ancestor everywhere).
  const lookup = lookupOf(
    gun(WEAPON, { slots: [slot('s0', ['A']), slot('s1', ['B'])] }),
    ['A', mod('A', { slots: [slot('toB', ['B']), slot('leaf', ['C'])] })],
    ['B', mod('B', { slots: [slot('toA', ['A'])] })],
    ['C', mod('C', { slots: [slot('deeper', ['D'])] })],
    ['D', mod('D')],
    ['E', mod('E')],
  );
  lookup[WEAPON].slots.push({ id: 's2', name: 's2', nameId: 's2', required: false, allowedItems: ['E'] });
  assert.throws(() => graphOf(lookup), (e: unknown) => e instanceof PhysicalModelError && e.code === 'CYCLIC_PART_GRAPH');
  assert.equal(preparePhysicalWeapon(lookup, WEAPON).stats.prunedAncestorEdges > 0, true, 'the blueprint detects it: the ancestor rule cut an edge');
});

test('an empty domain has no template graph', () => {
  const lookup = lookupOf(gun(WEAPON, { offers: [], slots: [slot('s', ['a'])] }), ['a', mod('a')]);
  const blueprint = preparePhysicalWeapon(lookup, WEAPON);
  const domain = prepareSubproblemDomain(blueprint, lookup, {});
  assert.equal(domain.empty, true);
  assert.throws(() => buildTemplateGraph(blueprint, domain), /empty domain/);
});

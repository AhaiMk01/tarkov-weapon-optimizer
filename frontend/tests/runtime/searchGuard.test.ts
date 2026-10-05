// The request-epoch guard inside the spatial search (src/solver/physical/search.ts, ADR 0013 sections 4D and 6, Phase 2.7a): a macrotask yield
// between nodes, cancel observed only after that yield, retained state, precedence, typed native failure, first-witness stop. No HiGHS.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runSpatialSearch } from '../../src/solver/physical/search';
import type { NodeEvaluation, SearchNode } from '../../src/solver/physical/search';
import { PUBLIC_REASONS } from '../../src/solver/physical/reasons';
import { SolverError as NativeSolverError } from '../../src/solver/native/errors';
import { completionOf, SolverError } from '../../src/solver/runtimeErrors';
import type { RuntimeGuard } from '../../src/solver/runtimeGuard';
import { yieldMacrotask } from '../../src/solver/runtimeGuard';

/** A guard whose cancel flag and clock the test drives; every macrotask yield is counted (and really yields to the event loop). */
function drivenGuard(state: { cancelled: boolean; t: number }, deadline = 1e9): RuntimeGuard & { yields: number } {
  const guard = {
    yields: 0,
    deadline,
    now: (): number => state.t,
    cancelled: (): boolean => state.cancelled,
    yieldMacrotask: async (): Promise<void> => { guard.yields++; await yieldMacrotask(); },
  };
  return guard;
}

const solvedExact = (value: number): NodeEvaluation<string> => ({
  verdict: 'solved', evidence: { nativeDual: value, qualified: true, frameError: 0 }, candidate: { score: value, payload: `build ${value}` }, exact: true,
});

const options = (guard: RuntimeGuard, evaluate: (node: SearchNode) => Promise<NodeEvaluation<string>>, extra: { maxNodes?: number; roots?: ({ lo: number; hi: number } | null)[] } = {}) => ({
  roots: extra.roots ?? [{ lo: 0, hi: 1 }, { lo: 1, hi: 2 }, { lo: 2, hi: 3 }],
  evaluate,
  tolerance: 1e-9,
  maxNodes: extra.maxNodes ?? 512,
  now: guard.now,
  deadline: guard.deadline,
  guard,
});

test('the search yields a macrotask before every node it evaluates', async () => {
  const state = { cancelled: false, t: 0 };
  const guard = drivenGuard(state);
  const result = await runSpatialSearch(options(guard, async node => solvedExact(10 - node.id)));
  assert.equal(result.nodes, 3);
  assert.equal(guard.yields, 3, 'one yield per evaluated node');
  assert.equal(result.completed, true);
});

test('a cancel that arrives while a node runs is observed only after the next macrotask yield, and the retained witness is kept', async () => {
  const state = { cancelled: false, t: 0 };
  const guard = drivenGuard(state);
  const seenDuringNode: boolean[] = [];
  let calls = 0;
  const result = await runSpatialSearch(options(guard, async () => {
    calls++;
    if (calls === 1) {
      // The cancel message is a task: it is dispatched only when the worker yields to its event loop.
      setTimeout(() => { state.cancelled = true; }, 0);
      for (let i = 0; i < 5; i++) await Promise.resolve();
      seenDuringNode.push(guard.cancelled());
    }
    return solvedExact(7);
  }));
  assert.deepEqual(seenDuringNode, [false], 'microtask awaits never deliver the message');
  assert.equal(calls, 1, 'the search stopped at the first guard check after the yield, before the second node');
  assert.equal(result.nodes, 1);
  assert.equal(result.incumbent?.payload, 'build 7', 'the verified witness is retained');
  assert.equal(result.stopReason, PUBLIC_REASONS.cancelledByUser);
  assert.equal(result.completed, false);
  assert.equal(result.finished, false);
  assert.equal(result.certified, false);
  assert.equal(result.lowerBound, 7);
});

test('a request cancelled before its first node stops with nothing evaluated', async () => {
  const state = { cancelled: true, t: 0 };
  const guard = drivenGuard(state);
  let calls = 0;
  const result = await runSpatialSearch(options(guard, async () => { calls++; return solvedExact(1); }));
  assert.equal(calls, 0);
  assert.equal(result.nodes, 0);
  assert.equal(result.incumbent, null);
  assert.equal(result.stopReason, PUBLIC_REASONS.cancelledByUser);
});

test('a completed proof is never downgraded by a cancel that arrives with the last node', async () => {
  const state = { cancelled: false, t: 0 };
  const guard = drivenGuard(state);
  const result = await runSpatialSearch(options(guard, async () => {
    state.cancelled = true; // flagged while the only node ran
    return solvedExact(5);
  }, { roots: [null] }));
  assert.equal(result.completed, true);
  assert.equal(result.stopReason, null);
  assert.equal(result.certified, true, 'no live node is left, so the cancel flag is never even consulted');
  assert.equal(result.incumbent?.payload, 'build 5');
});

test('simultaneous interrupts take the precedence cancel, deadline, node limit', async () => {
  const run = async (cancelled: boolean, t: number, maxNodes: number) => {
    const state = { cancelled, t };
    const guard = drivenGuard(state, 100);
    return (await runSpatialSearch(options(guard, async () => solvedExact(1), { maxNodes }))).stopReason;
  };
  assert.equal(await run(true, 200, 0), PUBLIC_REASONS.cancelledByUser);
  assert.equal(await run(false, 200, 0), PUBLIC_REASONS.timeLimitReached);
  assert.equal(await run(false, 0, 0), PUBLIC_REASONS.nodeLimitReached);
});

test('a pure interrupt reported by a node loses to a coincident cancel, a validation failure does not', async () => {
  const stopOf = async (reason: string, verdict: 'unresolved' | 'failed') => {
    const state = { cancelled: false, t: 0 };
    const guard = drivenGuard(state);
    const result = await runSpatialSearch(options(guard, async () => {
      state.cancelled = true;
      return { verdict, evidence: null, candidate: null, exact: true, reason };
    }, { roots: [null] }));
    return result.stopReason;
  };
  assert.equal(await stopOf(PUBLIC_REASONS.timeLimitReached, 'unresolved'), PUBLIC_REASONS.cancelledByUser);
  assert.equal(await stopOf(PUBLIC_REASONS.nodeLimitReached, 'unresolved'), PUBLIC_REASONS.cancelledByUser);
  assert.equal(await stopOf(PUBLIC_REASONS.nativeSolutionLimitReached, 'unresolved'), PUBLIC_REASONS.cancelledByUser);
  assert.equal(await stopOf(PUBLIC_REASONS.independentBuildValidationFailed, 'failed'), PUBLIC_REASONS.independentBuildValidationFailed);
  assert.equal(await stopOf(PUBLIC_REASONS.requiredProofPrerequisiteUnavailable, 'unresolved'), PUBLIC_REASONS.requiredProofPrerequisiteUnavailable);
});

test('a native failure leaves the search as the same error, carrying what the search had established before it', async () => {
  const state = { cancelled: false, t: 0 };
  const guard = drivenGuard(state);
  const failure = new NativeSolverError('solve', new Error('wasm trap'));
  let calls = 0;
  await assert.rejects(
    runSpatialSearch(options(guard, async () => {
      calls++;
      if (calls === 2) throw failure;
      return solvedExact(4);
    })),
    (error: unknown) => {
      assert.equal(error, failure, 'the very error, never rewritten into a result or an interrupt reason');
      const completion = completionOf(error);
      assert.ok(completion !== null);
      assert.equal(completion.nodes, 1, 'the failing call is not counted');
      assert.equal(completion.termination, 'limit');
      assert.equal(completion.witness, true);
      assert.equal(completion.lower_bound, 4);
      assert.ok(completion.upper_bound === null || completion.upper_bound >= 4);
      return true;
    },
  );
});

test('a native failure before any witness reports no witness and null bounds', async () => {
  const state = { cancelled: false, t: 0 };
  const guard = drivenGuard(state);
  const failure = new SolverError('solve', new Error('out of memory'));
  await assert.rejects(runSpatialSearch(options(guard, async () => { throw failure; })), (error: unknown) => {
    const completion = completionOf(error);
    assert.deepEqual(completion, { nodes: 0, termination: 'limit', witness: false, lower_bound: null, upper_bound: null, absolute_gap: null });
    return true;
  });
});

test('stopAtFirstWitness ends the search at the first verified build while a node is live, and never downgrades a completed search', async () => {
  const state = { cancelled: false, t: 0 };
  const guard = drivenGuard(state);
  const stopped = await runSpatialSearch({
    ...options(guard, async node => solvedExact(10 - node.id)),
    stopAtFirstWitness: true,
  });
  assert.equal(stopped.nodes, 1, 'two roots were still live');
  assert.equal(stopped.stopReason, PUBLIC_REASONS.nativeSolutionLimitReached, 'a first-witness stop is not a timeout');
  assert.equal(stopped.incumbent?.payload, 'build 10');
  assert.equal(stopped.completed, false);
  assert.equal(stopped.certified, false);

  const single = await runSpatialSearch({
    ...options(guard, async () => solvedExact(3), { roots: [null] }),
    stopAtFirstWitness: true,
  });
  assert.equal(single.completed, true, 'a search with no live node left has completed');
  assert.equal(single.certified, true);
  assert.equal(single.stopReason, null);
});

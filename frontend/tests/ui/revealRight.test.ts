// The rule behind ResponsiveLayout's `revealRight` (src/layouts/revealRight.ts): scroll only when the trigger turns true while the panes are stacked.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shouldRevealRight } from '../../src/layouts/revealRight';

test('the first render never scrolls, even when the trigger starts true', () => {
  assert.equal(shouldRevealRight(undefined, true, true), false);
  assert.equal(shouldRevealRight(undefined, false, true), false);
});

test('false to true scrolls when stacked', () => {
  assert.equal(shouldRevealRight(false, true, true), true);
});

test('false to true does not scroll on desktop', () => {
  assert.equal(shouldRevealRight(false, true, false), false);
});

test('staying true does not scroll again', () => {
  assert.equal(shouldRevealRight(true, true, true), false);
});

test('true to false does not scroll', () => {
  assert.equal(shouldRevealRight(true, false, true), false);
});

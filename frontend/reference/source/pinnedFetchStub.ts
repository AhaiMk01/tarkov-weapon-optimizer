// Serves the pinned raw documents through `globalThis.fetch` so the production adapter can be
// run with NO network access. This module imports no production code: the differential tests
// pass the system under test in as a callback.
//
// Any URL outside https://json.tarkov.dev/regular/<pinned doc> is refused immediately, and the
// requested URLs are returned so a test can prove exactly which documents were read.
import { loadPinnedDocument } from './pins';

const BASE = 'https://json.tarkov.dev/regular/';

export interface PinnedFetchRun<T> {
  readonly result: T;
  /** Every URL the callback requested, in call order. */
  readonly requested: readonly string[];
}

/**
 * Run `run` with fetch stubbed to the pinned documents. `overrides` replaces the served body of
 * a named document (used by synthetic perturbation tests; always labelled synthetic there).
 */
export async function withPinnedFetch<T>(
  run: () => Promise<T>,
  overrides: Readonly<Record<string, string>> = {},
): Promise<PinnedFetchRun<T>> {
  const original = globalThis.fetch;
  const requested: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    requested.push(url);
    if (!url.startsWith(BASE)) throw new Error(`no-network stub: refusing ${url}`);
    const doc = url.slice(BASE.length);
    const override = overrides[doc];
    const body = override !== undefined ? override : new Uint8Array(loadPinnedDocument(doc).bytes);
    return new Response(body, { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  try {
    return { result: await run(), requested };
  } finally {
    globalThis.fetch = original;
  }
}

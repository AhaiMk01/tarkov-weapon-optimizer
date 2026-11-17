// The pre-React canvas colours in src/index.css run before antd tokens exist, so they must equal each palette's colorBgLayout.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { darkPaletteTokens, type DarkPaletteId } from '../../src/theme/darkPalettes';
import { amoledDarkToken } from '../../src/theme/amoledDark';

const css = readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/index.css'), 'utf8');

function backgroundOf(selector: string): string | undefined {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) return undefined;
  const block = css.slice(start, css.indexOf('}', start));
  return /background-color:\s*([^;]+);/.exec(block)?.[1].trim();
}

test('root background matches each dark palette colorBgLayout', () => {
  assert.equal(backgroundOf(':root'), darkPaletteTokens.onedark.colorBgLayout);
  for (const id of ['github', 'tokyo'] as DarkPaletteId[]) {
    assert.equal(backgroundOf(`:root[data-theme='dark'][data-dark-palette='${id}']`), darkPaletteTokens[id].colorBgLayout, id);
  }
});

test('root background matches the AMOLED colorBgLayout', () => {
  assert.equal(backgroundOf(":root[data-theme='amoled']"), amoledDarkToken.colorBgLayout);
});

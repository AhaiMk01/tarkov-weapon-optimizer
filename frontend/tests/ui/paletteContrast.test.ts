// antd paints Typography type="secondary" with colorTextTertiary, so all three text tiers are readable text.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AliasToken } from 'antd/es/theme/interface/alias';
import { darkPaletteTokens } from '../../src/theme/darkPalettes';
import { amoledDarkToken } from '../../src/theme/amoledDark';
import { contrastRatio, onColor } from '../../src/theme/contrast';

const themes: Record<string, Partial<AliasToken>> = { ...darkPaletteTokens, amoled: amoledDarkToken };
const surfaces = ['colorBgContainer', 'colorBgLayout', 'colorBgElevated'] as const;
const texts = ['colorText', 'colorTextSecondary', 'colorTextTertiary'] as const;

for (const [name, token] of Object.entries(themes)) {
  test(`${name} text reaches 4.5:1 on every surface`, () => {
    for (const text of texts) {
      for (const surface of surfaces) {
        const ratio = contrastRatio(token[text] as string, token[surface] as string);
        assert.ok(ratio >= 4.5, `${text} on ${surface}: ${ratio.toFixed(2)}`);
      }
    }
  });

  test(`${name} primary button text reaches 4.5:1 on colorPrimary`, () => {
    const primary = token.colorPrimary as string;
    const ratio = contrastRatio(onColor(primary), primary);
    assert.ok(ratio >= 4.5, `${onColor(primary)} on ${primary}: ${ratio.toFixed(2)}`);
  });
}

test('antd default white on the light-blue primaries is the failure onColor avoids', () => {
  for (const token of Object.values(themes)) {
    assert.ok(contrastRatio('#ffffff', token.colorPrimary as string) < 4.5);
  }
});

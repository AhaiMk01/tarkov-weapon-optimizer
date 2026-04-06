/**
 * Light UI palettes for Ant Design defaultAlgorithm.
 * - primer: GitHub / Primer-style neutrals and blues.
 * - paper: warm off-white layout (Notion-like).
 * - latte: Catppuccin Latte (https://github.com/catppuccin/catppuccin) accents on Latte surfaces.
 */
import type { AliasToken } from 'antd/es/theme/interface/alias'

export type LightPaletteId = 'primer' | 'paper' | 'latte'

/** Primer / GitHub-style light */
export const primerLightToken: Partial<AliasToken> = {
  colorPrimary: '#0969da',
  colorSuccess: '#1a7f37',
  colorWarning: '#bf8700',
  colorError: '#cf222e',
  colorInfo: '#0969da',

  colorLink: '#0969da',
  colorLinkHover: '#0550ae',
  colorLinkActive: '#033d8b',

  colorBgBase: '#ffffff',
  colorBgContainer: '#ffffff',
  colorBgElevated: '#ffffff',
  colorBgLayout: '#f6f8fa',
  colorBgSpotlight: '#ffffff',

  colorText: '#1f2328',
  colorTextSecondary: '#656d76',
  colorTextTertiary: '#8c959f',
  colorTextQuaternary: '#b4bcc4',

  colorBorder: '#d0d7de',
  colorBorderSecondary: '#eaeef2',

  colorFill: 'rgba(27, 31, 36, 0.06)',
  colorFillSecondary: 'rgba(27, 31, 36, 0.04)',
  colorFillTertiary: 'rgba(27, 31, 36, 0.025)',
  colorFillQuaternary: 'rgba(27, 31, 36, 0.015)',

  colorSplit: '#d8dee4',
}

/** Warm paper — soft layout, readable body text */
export const warmPaperLightToken: Partial<AliasToken> = {
  colorPrimary: '#2383e2',
  colorSuccess: '#0f7b6c',
  colorWarning: '#d9a006',
  colorError: '#e03e3e',
  colorInfo: '#2383e2',

  colorLink: '#2383e2',
  colorLinkHover: '#1b6cb5',
  colorLinkActive: '#155a9a',

  colorBgBase: '#fdfcfa',
  colorBgContainer: '#ffffff',
  colorBgElevated: '#ffffff',
  colorBgLayout: '#f7f6f3',
  colorBgSpotlight: '#ffffff',

  colorText: '#37352f',
  colorTextSecondary: '#787774',
  colorTextTertiary: '#9b9a97',
  colorTextQuaternary: '#b8b7b4',

  colorBorder: '#e3e2e0',
  colorBorderSecondary: '#ecebea',

  colorFill: 'rgba(55, 53, 47, 0.06)',
  colorFillSecondary: 'rgba(55, 53, 47, 0.04)',
  colorFillTertiary: 'rgba(55, 53, 47, 0.025)',
  colorFillQuaternary: 'rgba(55, 53, 47, 0.015)',

  colorSplit: '#e8e7e4',
}

/** Catppuccin Latte */
export const catppuccinLatteLightToken: Partial<AliasToken> = {
  colorPrimary: '#1e66f5',
  colorSuccess: '#40a02b',
  colorWarning: '#df8e1d',
  colorError: '#d20f39',
  colorInfo: '#209fb5',

  colorLink: '#1e66f5',
  colorLinkHover: '#1a56cf',
  colorLinkActive: '#164aad',

  colorBgBase: '#ffffff',
  colorBgContainer: '#ffffff',
  colorBgElevated: '#ffffff',
  colorBgLayout: '#eff1f5',
  colorBgSpotlight: '#e6e9ef',

  colorText: '#4c4f69',
  colorTextSecondary: '#5c5f77',
  colorTextTertiary: '#6c6f85',
  colorTextQuaternary: '#7c7f93',

  colorBorder: '#ccd0da',
  colorBorderSecondary: '#bcc0cc',

  colorFill: 'rgba(76, 79, 105, 0.08)',
  colorFillSecondary: 'rgba(76, 79, 105, 0.055)',
  colorFillTertiary: 'rgba(76, 79, 105, 0.035)',
  colorFillQuaternary: 'rgba(76, 79, 105, 0.02)',

  colorSplit: '#bcc0cc',
}

export const lightPaletteTokens: Record<LightPaletteId, Partial<AliasToken>> = {
  primer: primerLightToken,
  paper: warmPaperLightToken,
  latte: catppuccinLatteLightToken,
}

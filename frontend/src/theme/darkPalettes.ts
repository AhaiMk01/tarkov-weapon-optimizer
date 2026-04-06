/**
 * Dark UI palettes for Ant Design darkAlgorithm.
 * - onedark: One Dark–inspired accents with lifted text/border contrast for UI.
 * - github: GitHub / Primer dark high contrast–style surfaces and chroma.
 * - tokyo: Tokyo Night Storm–inspired blues and fg hierarchy.
 */
import type { AliasToken } from 'antd/es/theme/interface/alias'

export type DarkPaletteId = 'onedark' | 'github' | 'tokyo'

export const oneDarkHighContrastToken: Partial<AliasToken> = {
  colorPrimary: '#61afef',
  colorSuccess: '#98c379',
  colorWarning: '#d19a66',
  colorError: '#e06c75',
  colorInfo: '#56b6c2',

  colorLink: '#61afef',
  colorLinkHover: '#7ebef7',
  colorLinkActive: '#4a9fe8',

  colorBgBase: '#282c34',
  colorBgContainer: '#282c34',
  colorBgElevated: '#21252b',
  colorBgLayout: '#1e2127',
  colorBgSpotlight: '#21252b',

  colorText: '#c8cdd5',
  colorTextSecondary: '#9da3b0',
  colorTextTertiary: '#7e848f',
  colorTextQuaternary: '#6a707a',

  colorBorder: '#4d5566',
  colorBorderSecondary: '#323946',

  colorFill: 'rgba(255, 255, 255, 0.1)',
  colorFillSecondary: 'rgba(255, 255, 255, 0.07)',
  colorFillTertiary: 'rgba(255, 255, 255, 0.05)',
  colorFillQuaternary: 'rgba(255, 255, 255, 0.03)',

  colorSplit: '#343945',
}

export const githubDarkHcToken: Partial<AliasToken> = {
  colorPrimary: '#58a6ff',
  colorSuccess: '#56d364',
  colorWarning: '#e3b341',
  colorError: '#ff7b72',
  colorInfo: '#79c0ff',

  colorLink: '#58a6ff',
  colorLinkHover: '#79b8ff',
  colorLinkActive: '#4090e3',

  colorBgBase: '#0d1117',
  colorBgContainer: '#0d1117',
  colorBgElevated: '#161b22',
  colorBgLayout: '#010409',
  colorBgSpotlight: '#161b22',

  colorText: '#f0f3f6',
  colorTextSecondary: '#c9d1d9',
  colorTextTertiary: '#8b949e',
  colorTextQuaternary: '#6e7681',

  colorBorder: '#3d444d',
  colorBorderSecondary: '#21262d',

  colorFill: 'rgba(255, 255, 255, 0.1)',
  colorFillSecondary: 'rgba(255, 255, 255, 0.08)',
  colorFillTertiary: 'rgba(255, 255, 255, 0.06)',
  colorFillQuaternary: 'rgba(255, 255, 255, 0.04)',

  colorSplit: '#21262d',
}

export const tokyoNightStormToken: Partial<AliasToken> = {
  colorPrimary: '#7aa2f7',
  colorSuccess: '#9ece6a',
  colorWarning: '#e0af68',
  colorError: '#f7768e',
  colorInfo: '#7dcfff',

  colorLink: '#7aa2f7',
  colorLinkHover: '#9ab8f9',
  colorLinkActive: '#5b8cf0',

  colorBgBase: '#24283b',
  colorBgContainer: '#24283b',
  colorBgElevated: '#1f2335',
  colorBgLayout: '#1a1b2a',
  colorBgSpotlight: '#1f2335',

  colorText: '#c0caf5',
  colorTextSecondary: '#a9b1d6',
  colorTextTertiary: '#565f89',
  colorTextQuaternary: '#4a5170',

  colorBorder: '#3b4261',
  colorBorderSecondary: '#292e42',

  colorFill: 'rgba(199, 208, 245, 0.1)',
  colorFillSecondary: 'rgba(199, 208, 245, 0.07)',
  colorFillTertiary: 'rgba(199, 208, 245, 0.05)',
  colorFillQuaternary: 'rgba(199, 208, 245, 0.03)',

  colorSplit: '#2f3549',
}

export const darkPaletteTokens: Record<DarkPaletteId, Partial<AliasToken>> = {
  onedark: oneDarkHighContrastToken,
  github: githubDarkHcToken,
  tokyo: tokyoNightStormToken,
}

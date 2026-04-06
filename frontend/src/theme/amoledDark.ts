/**
 * Near-black (AMOLED-friendly) dark palette for Ant Design.
 * Keeps One Dark Pro accent hues for consistency; lifts text/border contrast on #000 surfaces.
 */
import type { AliasToken } from 'antd/es/theme/interface/alias'

export const amoledDarkToken: Partial<AliasToken> = {
  colorPrimary: '#61afef',
  colorSuccess: '#98c379',
  colorWarning: '#d19a66',
  colorError: '#e06c75',
  colorInfo: '#56b6c2',

  colorLink: '#61afef',
  colorLinkHover: '#7ebef7',
  colorLinkActive: '#4a9fe8',

  colorBgBase: '#000000',
  colorBgContainer: '#0a0a0a',
  colorBgElevated: '#121212',
  colorBgLayout: '#000000',
  colorBgSpotlight: '#141414',

  colorText: '#e6e8eb',
  colorTextSecondary: '#a8adb5',
  colorTextTertiary: '#7a808a',
  colorTextQuaternary: '#5c6168',

  colorBorder: '#2a2d33',
  colorBorderSecondary: '#16181c',

  colorFill: 'rgba(255, 255, 255, 0.1)',
  colorFillSecondary: 'rgba(255, 255, 255, 0.06)',
  colorFillTertiary: 'rgba(255, 255, 255, 0.04)',
  colorFillQuaternary: 'rgba(255, 255, 255, 0.02)',

  colorSplit: '#1a1c20',
}

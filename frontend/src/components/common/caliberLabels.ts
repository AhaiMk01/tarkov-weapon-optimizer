/*
 * Caliber display names and ordering.
 *
 * tarkov.dev exposes calibers as internal enum strings (`Caliber545x39`), which
 * solver.worker.ts strips to `545x39`. Those are unreadable and sort nonsensically
 * ("545x39" collates after "127x99"), so map them to real names with an explicit
 * order. Table adapted from EFTForge (https://github.com/SouthHorizons76/EFTForge,
 * MIT), rekeyed to the prefix-stripped values we carry.
 *
 * Unlike category names these are not localised upstream, so the mapping holds in
 * every language.
 */

const CALIBER_LABEL: Record<string, string> = {
  '20x1mm': '20x1mm disk',
  '762x39': '7.62x39',
  '762x51': '7.62x51',
  '762x54R': '7.62x54R',
  '556x45NATO': '5.56x45',
  '545x39': '5.45x39',
  '58x42': '5.8x42',
  '9x19PARA': '9x19',
  '9x18PM': '9x18',
  '9x18PMM': '9x18 PMM',
  '9x21': '9x21',
  '9x39': '9x39',
  '57x28': '5.7x28',
  '366TKM': '.366 TKM',
  '127x55': '12.7x55',
  '12g': '12/70',
  '20g': '20/70',
  '23x75': '23x75',
  '1143x23ACP': '.45 ACP',
  '127x99': '.50 BMG',
  '762x25TT': '7.62x25 TT',
  '784x49': '.308',
  '762x35': '.300 BLK',
  '68x51': '6.8x51',
  '40x46': '40x46mm Grenade',
  '40mmRU': '40mm VOG',
  '26x75': '26x75mm Flare',
  '9x33R': '.357 Magnum',
  '46x30': '4.6x30',
  '86x70': '.338 LM',
  '127x33': '.50 AE',
  '93x64': '9.3x64',
}

const CALIBER_ORDER = [
  '5.45x39',
  '5.56x45',
  '5.8x42',
  '6.8x51',
  '7.62x39',
  '7.62x51',
  '7.62x54R',
  '7.62x25 TT',
  '.300 BLK',
  '.308',
  '.338 LM',
  '.366 TKM',
  '9.3x64',
  '9x18',
  '9x18 PMM',
  '9x19',
  '9x21',
  '9x39',
  '5.7x28',
  '4.6x30',
  '.357 Magnum',
  '.45 ACP',
  '.50 AE',
  '12/70',
  '20/70',
  '23x75',
  '12.7x55',
  '40x46mm Grenade',
  '40mm VOG',
  '.50 BMG',
  '26x75mm Flare',
  '20x1mm disk',
]

/** Weapon classes, most-used first. Only matches the English names tarkov.dev
 *  returns for `en`; other languages fall through to alphabetical. */
const CLASS_ORDER = [
  'Assault rifle',
  'Assault carbine',
  'Marksman rifle',
  'Sniper rifle',
  'Machinegun',
  'Machine gun',
  'Machine Gun',
  'SMG',
  'Submachine gun',
  'Shotgun',
  'Handgun',
  'Revolver',
  'Grenade launcher',
  'Grenade Launcher',
  'Primary',
]

export function caliberLabel(raw: string): string {
  return CALIBER_LABEL[raw] ?? raw
}

/** Sort index for a display label; unmapped values sort last, then alphabetically. */
export function caliberRank(label: string): number {
  const i = CALIBER_ORDER.indexOf(label)
  return i === -1 ? CALIBER_ORDER.length : i
}

export function categoryRank(name: string): number {
  const i = CLASS_ORDER.indexOf(name)
  return i === -1 ? CLASS_ORDER.length : i
}

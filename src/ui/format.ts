/** 1234567 → "123万円" (rounded to 万). */
export function man(yen: number, digits = 0): string {
  const v = yen / 10_000
  const s = v.toLocaleString('ja-JP', { maximumFractionDigits: digits, minimumFractionDigits: digits })
  return `${s}万円`
}

/** Short axis label: 12,345,678 → "1,235万" / 123,456,789 → "1.23億". */
export function axisYen(yen: number): string {
  const abs = Math.abs(yen)
  if (abs >= 100_000_000) return `${(yen / 100_000_000).toLocaleString('ja-JP', { maximumFractionDigits: 2 })}億`
  return `${Math.round(yen / 10_000).toLocaleString('ja-JP')}万`
}

export function yen(v: number): string {
  return `${Math.round(v).toLocaleString('ja-JP')}円`
}

export function pct(v: number, digits = 1): string {
  return `${(v * 100).toLocaleString('ja-JP', { maximumFractionDigits: digits })}%`
}

export function ymLabel(ym: string): string {
  const [y, m] = ym.split('-')
  return `${y}年${Number(m)}月`
}

export function currentYM(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

/** 234,560,000 → "2億3,456万円" (below 1億, same as man()). */
export function manOku(yen: number): string {
  const sign = yen < 0 ? '-' : ''
  const v = Math.round(Math.abs(yen) / 10_000)
  if (v < 10_000) return `${sign}${v.toLocaleString('ja-JP')}万円`
  const rest = v % 10_000
  return `${sign}${Math.floor(v / 10_000).toLocaleString('ja-JP')}億${rest ? `${rest.toLocaleString('ja-JP')}万` : ''}円`
}

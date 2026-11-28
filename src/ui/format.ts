import type { Kpis } from '../engine/summary'

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

const ageSpan = (from: number, to: number) => (from === to ? `${from}歳` : `${from}〜${to}歳`)
const ymSpan = (from: string, to: string) => (from === to ? ymLabel(from) : `${ymLabel(from)}〜${ymLabel(to)}`)

/** Short label for a shortage of money: none, a gap that recovers, or running out. `className` colors it. */
export function shortfallLabel(k: Pick<Kpis, 'depletion' | 'gap'>): { text: string; className: string } {
  if (k.depletion) return { text: `${k.depletion.age}歳で尽きる`, className: 'neg' }
  if (k.gap) return { text: `${ageSpan(k.gap.fromAge, k.gap.toAge)}に一時不足`, className: 'warn-text' }
  return { text: 'なし', className: '' }
}

/** Sentences explaining a shortage of money, shown above the results. */
export function shortfallNotes(k: Pick<Kpis, 'depletion' | 'gap'>): string[] {
  const notes: string[] = []
  const g = k.gap
  if (g) {
    const buying = g.events.includes('住宅購入')
    const cause = buying
      ? '家の購入の頭金と諸費用が、そのときの預貯金を上回るためです。頭金を減らす、購入を遅らせる、それまでに貯めるなどで解消できます。'
      : g.events.length > 0
        ? `きっかけは「${g.events.join('、')}」です。時期や金額を見直すと解消できます。`
        : 'その時期の大きな支出を見直すと解消できます。'
    notes.push(
      `${ymSpan(g.fromYm, g.toYm)}（${ageSpan(g.fromAge, g.toAge)}）に、お金が最大${man(g.maxDeficit)}足りなくなります（預貯金がマイナスで、売れる資産も残っていない状態）。その後は持ち直します。${cause}` +
        (g.count > 1 ? `ほかにも${g.count - 1}回、一時的に足りなくなる時期があります。` : ''),
    )
  }
  if (k.depletion) {
    notes.push(`${ymLabel(k.depletion.ym)}（${k.depletion.age}歳）にお金が尽き、その後も足りないままです。預貯金がマイナスで、売れる資産も残っていません。`)
  }
  return notes
}

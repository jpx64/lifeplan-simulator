import { describe, expect, it } from 'vitest'
import { simulate } from './simulate'
import { kpis, shortfallScore, shortfallSpans } from './summary'
import type { MonthRow } from './types'
import { buildPlan, defaultWizard } from './wizard'

/** Months with only what shortfallSpans looks at. */
const months = (cash: number[]) =>
  cash.map((c, i) => ({ t: i, ym: `2030-${String(i + 1).padStart(2, '0')}`, cash: c, shortfall: c < 0, events: [] }) as unknown as MonthRow)

describe('shortfall periods', () => {
  it('splits the months short of money into runs, and marks the one that lasts to the end', () => {
    const spans = shortfallSpans(months([10, -5, -20, 3, -1, -4]))
    expect(spans.map((s) => [s.from.ym, s.to.ym, s.maxDeficit, s.toEnd])).toEqual([
      ['2030-02', '2030-03', 20, false],
      ['2030-05', '2030-06', 4, true],
    ])
  })

  it('ranks no shortage above a brief one, and a brief one above running out', () => {
    const none = shortfallScore({})
    const small = shortfallScore({ gap: { fromYm: '', fromAge: 40, toYm: '', toAge: 41, maxDeficit: 1_000_000, events: [], count: 1 } })
    const large = shortfallScore({ gap: { fromYm: '', fromAge: 40, toYm: '', toAge: 41, maxDeficit: 3_000_000, events: [], count: 1 } })
    const late = shortfallScore({ depletion: { ym: '', age: 90 } })
    const early = shortfallScore({ depletion: { ym: '', age: 70 } })
    expect(none > small && small > large && large > late && late > early).toBe(true)
  })

  it('a down payment larger than the savings is a brief gap at the purchase, not money running out', () => {
    const w = defaultWizard('2026-11')
    const plan = buildPlan({ ...w, housing: { ...w.housing, mode: 'buy' } })
    const k = kpis(plan, simulate(plan), plan.retirementAge)
    expect(k.depletion).toBeUndefined()
    expect(k.gap?.fromYm).toBe(w.housing.buyYM)
    expect(k.gap?.events).toContain('住宅購入')
    expect(k.gap!.maxDeficit).toBeGreaterThan(0)
    expect(k.gap!.toAge).toBeGreaterThanOrEqual(k.gap!.fromAge)
  })

  it('reports running out when the money never comes back', () => {
    const w = defaultWizard('2026-11')
    const plan = buildPlan({ ...w, living: 600_000 })
    const k = kpis(plan, simulate(plan), plan.retirementAge)
    expect(k.depletion).toBeDefined()
    const spans = shortfallSpans(simulate(plan).rows)
    expect(spans.at(-1)!.toEnd).toBe(true)
    expect(spans.at(-1)!.from.ym).toBe(k.depletion!.ym)
  })

  it('a plan that never runs short has neither', () => {
    const w = defaultWizard('2026-11')
    const plan = buildPlan(w)
    const k = kpis(plan, simulate(plan), plan.retirementAge)
    expect(k.depletion).toBeUndefined()
    expect(k.gap).toBeUndefined()
  })
})

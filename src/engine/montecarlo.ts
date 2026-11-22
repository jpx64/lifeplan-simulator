import { simulate } from './simulate'
import { ymToIndex, monthAtAge, yearOf } from './time'
import type { Plan } from './types'

/** Small seeded PRNG so runs are reproducible. */
export function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function normal(rand: () => number): number {
  let u = 0
  while (u === 0) u = rand()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand())
}

export interface MonteCarloResult {
  runs: number
  /** Share of runs that never run out of money. */
  successRate: number
  years: number[]
  /** Self age at each year end. */
  ages: number[]
  /** Percentiles of total assets at each year end (10, 25, 50, 75, 90). */
  bands: { p10: number[]; p25: number[]; p50: number[]; p75: number[]; p90: number[] }
  /** Self age at the first shortfall, for the runs that ran out. */
  depletionAges: number[]
}

function percentile(sorted: number[], p: number) {
  if (sorted.length === 0) return 0
  const i = (sorted.length - 1) * p
  const lo = Math.floor(i)
  const hi = Math.ceil(i)
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo)
}

/**
 * Runs the plan many times with random monthly market returns (one market factor shared by all
 * risky accounts; each account uses its own volatility). Runs in chunks so the UI stays responsive.
 */
export async function runMonteCarlo(
  plan: Plan,
  opts: { runs?: number; seed?: number; real?: boolean; onProgress?: (done: number, total: number) => void; signal?: { cancelled: boolean } } = {},
): Promise<MonteCarloResult> {
  const runs = opts.runs ?? 300
  const rand = mulberry32(opts.seed ?? 12345)
  const self = plan.members.find((m) => m.role === 'self')!
  const startT = ymToIndex(plan.settings.start)
  const endT = yearOf(monthAtAge(ymToIndex(self.birth), plan.settings.endAge)) * 12 + 11
  const months = endT - startT + 1

  const perYear = new Map<number, number[]>()
  const ageAtYear = new Map<number, number>()
  const depletionAges: number[] = []
  let ok = 0
  for (let i = 0; i < runs; i++) {
    if (opts.signal?.cancelled) break
    const shocks = new Float64Array(months)
    for (let k = 0; k < months; k++) shocks[k] = normal(rand)
    const res = simulate(plan, { shocks })
    const firstShort = res.rows.find((r) => r.shortfall)
    if (firstShort) depletionAges.push(firstShort.ages[self.id])
    else ok++
    for (const r of res.rows) {
      if (!r.ym.endsWith('-12')) continue
      const y = Math.floor(r.t / 12)
      if (!perYear.has(y)) perYear.set(y, [])
      perYear.get(y)!.push(opts.real ? r.totalAssets / r.inflationIndex : r.totalAssets)
      ageAtYear.set(y, r.ages[self.id])
    }
    if (i % 10 === 9) {
      opts.onProgress?.(i + 1, runs)
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
  }
  const done = ok + depletionAges.length
  const years = [...perYear.keys()].sort((a, b) => a - b)
  const bands = { p10: [] as number[], p25: [] as number[], p50: [] as number[], p75: [] as number[], p90: [] as number[] }
  for (const y of years) {
    const v = perYear.get(y)!.sort((a, b) => a - b)
    bands.p10.push(percentile(v, 0.1))
    bands.p25.push(percentile(v, 0.25))
    bands.p50.push(percentile(v, 0.5))
    bands.p75.push(percentile(v, 0.75))
    bands.p90.push(percentile(v, 0.9))
  }
  opts.onProgress?.(done, runs)
  return {
    runs: done,
    successRate: done > 0 ? ok / done : 0,
    years,
    ages: years.map((y) => ageAtYear.get(y)!),
    bands,
    depletionAges: depletionAges.sort((a, b) => a - b),
  }
}

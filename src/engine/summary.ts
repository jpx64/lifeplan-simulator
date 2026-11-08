import type { MonthRow, Plan, SimulationResult } from './types'

export interface YearRow {
  year: number
  ages: Record<string, number>
  income: number
  salary: number
  pension: number
  otherIncome: number
  taxAndInsurance: number
  takeHome: number
  expenses: number
  housing: number
  education: number
  /** take-home minus expenses */
  balance: number
  cash: number
  liquidAssets: number
  totalAssets: number
  loanBalance: number
  netWorth: number
  accounts: Record<string, number>
  events: string[]
  shortfall: boolean
}

export function yearly(result: SimulationResult): YearRow[] {
  const byYear = new Map<number, MonthRow[]>()
  for (const r of result.rows) {
    const y = Math.floor(r.t / 12)
    if (!byYear.has(y)) byYear.set(y, [])
    byYear.get(y)!.push(r)
  }
  const out: YearRow[] = []
  for (const [year, rows] of byYear) {
    const last = rows[rows.length - 1]
    const sum = (f: (r: MonthRow) => number) => rows.reduce((s, r) => s + f(r), 0)
    const income = sum((r) => r.income.total)
    const tax = sum((r) => r.deductions.total)
    const expenses = sum((r) => r.expenses.total)
    out.push({
      year,
      ages: last.ages,
      income,
      salary: sum((r) => r.income.salary + r.income.leaveBenefit),
      pension: sum((r) => r.income.pension),
      otherIncome: income - sum((r) => r.income.salary + r.income.leaveBenefit + r.income.pension),
      taxAndInsurance: tax,
      takeHome: income - tax,
      expenses,
      housing: sum((r) => r.expenses.housing),
      education: sum((r) => r.expenses.education),
      balance: income - tax - expenses,
      cash: last.cash,
      liquidAssets: last.liquidAssets,
      totalAssets: last.totalAssets,
      loanBalance: last.loanBalance,
      netWorth: last.totalAssets - last.loanBalance,
      accounts: Object.fromEntries(Object.entries(last.accounts).map(([k, v]) => [k, v.balance])),
      events: rows.flatMap((r) => r.events),
      shortfall: rows.some((r) => r.shortfall),
    })
  }
  return out
}

export interface Kpis {
  peakAssets: { value: number; year: number; age: number }
  minCash: { value: number; ym: string; age: number }
  firstShortfall?: { ym: string; age: number }
  assetsAtRetirement?: { value: number; age: number }
  finalAssets: { value: number; age: number }
}

export function kpis(plan: Plan, result: SimulationResult, retirementAge?: number): Kpis {
  const selfId = plan.members.find((m) => m.role === 'self')!.id
  const rows = result.rows
  let peak = rows[0]
  let minCash = rows[0]
  for (const r of rows) {
    if (r.totalAssets > peak.totalAssets) peak = r
    if (r.cash < minCash.cash) minCash = r
  }
  const short = rows.find((r) => r.shortfall)
  const atRet = retirementAge !== undefined ? rows.find((r) => r.ages[selfId] === retirementAge) : undefined
  const last = rows[rows.length - 1]
  return {
    peakAssets: { value: peak.totalAssets, year: Math.floor(peak.t / 12), age: peak.ages[selfId] },
    minCash: { value: minCash.cash, ym: minCash.ym, age: minCash.ages[selfId] },
    firstShortfall: short ? { ym: short.ym, age: short.ages[selfId] } : undefined,
    assetsAtRetirement: atRet ? { value: atRet.totalAssets, age: retirementAge! } : undefined,
    finalAssets: { value: last.totalAssets, age: last.ages[selfId] },
  }
}

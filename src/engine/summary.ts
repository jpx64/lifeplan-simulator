import type { MonthRow, Plan, SimulationResult } from './types'

export const INCOME_LABELS = {
  salary: '給与・賞与',
  leaveBenefit: '育休・産休などの給付金',
  pension: '公的年金',
  childAllowance: '児童手当',
  taxRefund: '税の還付（年末調整など）',
  retirement: '退職金（手取り）',
  accountPayout: 'iDeCo・個人年金などの受取',
  other: 'その他の収入',
} as const

export const DEDUCTION_LABELS = {
  socialInsurance: '社会保険料',
  incomeTax: '所得税',
  residentTax: '住民税',
} as const

export const EXPENSE_LABELS = {
  housing: '住居',
  education: '教育',
  childLiving: '子の生活費',
  living: '生活費',
  allowance: '小遣い',
  insurance: '保険',
  special: '特別費',
  car: '車',
  other: 'その他',
} as const

export type IncomeKey = keyof typeof INCOME_LABELS
export type DeductionKey = keyof typeof DEDUCTION_LABELS
export type ExpenseKey = keyof typeof EXPENSE_LABELS

export interface AccountFlow {
  contribution: number
  growth: number
  withdrawal: number
  balance: number
}

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
  incomeBreakdown: Record<IncomeKey, number>
  deductionBreakdown: Record<DeductionKey, number>
  expenseBreakdown: Record<ExpenseKey, number>
  accountFlows: Record<string, AccountFlow>
  events: string[]
  shortfall: boolean
  /** Monthly rows of the year (amounts converted the same way as the year row). */
  months: MonthRow[]
}

/** Convert a month row to today's prices. */
export function realMonth(r: MonthRow): MonthRow {
  const f = 1 / r.inflationIndex
  const scale = <T extends Record<string, number>>(o: T) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v * f])) as T
  return {
    ...r,
    income: scale(r.income),
    deductions: scale(r.deductions),
    expenses: scale(r.expenses),
    net: r.net * f,
    accounts: Object.fromEntries(Object.entries(r.accounts).map(([k, v]) => [k, scale(v as unknown as Record<string, number>) as unknown as typeof v])),
    cash: r.cash * f,
    loanBalance: r.loanBalance * f,
    liquidAssets: r.liquidAssets * f,
    totalAssets: r.totalAssets * f,
  }
}

/**
 * Yearly summary. With `real`, all amounts are shown in today's prices
 * (divided by the price level of each month).
 */
export function yearly(result: SimulationResult, real = false): YearRow[] {
  const byYear = new Map<number, MonthRow[]>()
  for (const raw of result.rows) {
    const r = real ? realMonth(raw) : raw
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
    const incomeBreakdown = Object.fromEntries(Object.keys(INCOME_LABELS).map((k) => [k, sum((r) => r.income[k as IncomeKey])])) as Record<IncomeKey, number>
    const deductionBreakdown = Object.fromEntries(Object.keys(DEDUCTION_LABELS).map((k) => [k, sum((r) => r.deductions[k as DeductionKey])])) as Record<
      DeductionKey,
      number
    >
    const expenseBreakdown = Object.fromEntries(Object.keys(EXPENSE_LABELS).map((k) => [k, sum((r) => r.expenses[k as ExpenseKey])])) as Record<ExpenseKey, number>
    const accountFlows: Record<string, AccountFlow> = {}
    for (const id of Object.keys(last.accounts)) {
      accountFlows[id] = {
        contribution: sum((r) => r.accounts[id]?.contribution ?? 0),
        growth: sum((r) => r.accounts[id]?.growth ?? 0),
        withdrawal: sum((r) => r.accounts[id]?.withdrawal ?? 0),
        balance: last.accounts[id]?.balance ?? 0,
      }
    }
    out.push({
      year,
      ages: last.ages,
      income,
      salary: incomeBreakdown.salary + incomeBreakdown.leaveBenefit,
      pension: incomeBreakdown.pension,
      otherIncome: income - incomeBreakdown.salary - incomeBreakdown.leaveBenefit - incomeBreakdown.pension,
      taxAndInsurance: tax,
      takeHome: income - tax,
      expenses,
      housing: expenseBreakdown.housing,
      education: expenseBreakdown.education,
      balance: income - tax - expenses,
      cash: last.cash,
      liquidAssets: last.liquidAssets,
      totalAssets: last.totalAssets,
      loanBalance: last.loanBalance,
      netWorth: last.totalAssets - last.loanBalance,
      accounts: Object.fromEntries(Object.entries(accountFlows).map(([k, v]) => [k, v.balance])),
      incomeBreakdown,
      deductionBreakdown,
      expenseBreakdown,
      accountFlows,
      events: rows.flatMap((r) => r.events),
      shortfall: rows.some((r) => r.shortfall),
      months: rows,
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
  /** Average monthly take-home minus expenses from the retirement age to 90 (negative = drawing down). */
  retirementMonthly?: { value: number; fromAge: number; toAge: number }
}

export function kpis(plan: Plan, result: SimulationResult, retirementAge?: number, real = false): Kpis {
  const selfId = plan.members.find((m) => m.role === 'self')!.id
  const rows = real ? result.rows.map(realMonth) : result.rows
  let peak = rows[0]
  let minCash = rows[0]
  for (const r of rows) {
    if (r.totalAssets > peak.totalAssets) peak = r
    if (r.cash < minCash.cash) minCash = r
  }
  const short = rows.find((r) => r.shortfall)
  const atRet = retirementAge !== undefined ? rows.find((r) => r.ages[selfId] === retirementAge) : undefined
  const last = rows[rows.length - 1]
  let retirementMonthly: Kpis['retirementMonthly']
  if (retirementAge !== undefined) {
    // after the year of retirement (skip the retirement allowance), up to 90
    const fromAge = retirementAge + 1
    const toAge = Math.min(90, last.ages[selfId])
    const span = rows.filter((r) => r.ages[selfId] >= fromAge && r.ages[selfId] <= toAge)
    if (span.length > 0) {
      const net = span.reduce((s, r) => s + r.income.total - r.income.retirement - r.deductions.total - r.expenses.total, 0)
      retirementMonthly = { value: net / span.length, fromAge, toAge }
    }
  }
  return {
    peakAssets: { value: peak.totalAssets, year: Math.floor(peak.t / 12), age: peak.ages[selfId] },
    minCash: { value: minCash.cash, ym: minCash.ym, age: minCash.ages[selfId] },
    firstShortfall: short ? { ym: short.ym, age: short.ages[selfId] } : undefined,
    assetsAtRetirement: atRet ? { value: atRet.totalAssets, age: retirementAge! } : undefined,
    finalAssets: { value: last.totalAssets, age: last.ages[selfId] },
    retirementMonthly,
  }
}

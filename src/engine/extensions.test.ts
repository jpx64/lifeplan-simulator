import { describe, expect, it } from 'vitest'
import { withoutClashes } from '../ui/store'
import { defaultSettings } from './defaults'
import { improvementHints } from './hints'
import { samplePlan, sampleWizard } from './sample'
import { buildScenarios, currentWork, defaultAssumptions, variantPlan, workPerson } from './scenarios'
import { simulate } from './simulate'
import { kpis, yearly } from './summary'
import type { Account, Plan } from './types'
import { parsePlans, planProblems } from './validate'
import { buildPlan } from './wizard'

/** Base plan without inflation or growth, so amounts can be checked by hand. */
function base(over: Partial<Plan> = {}): Plan {
  return {
    id: 'p',
    name: 'test',
    settings: { ...defaultSettings('2030-01'), inflationRate: 0, pensionGrowthRate: 0, cash: 100_000_000, cashFloor: 0, endAge: 90 },
    members: [{ id: 'self', name: '本人', role: 'self', birth: '1990-01' }],
    work: [{ id: 'w', memberId: 'self', label: '会社員', kind: 'employed', from: '2030-01', to: '2049-12', monthlySalary: 500_000, annualBonus: 0, raiseRate: 0 }],
    pensions: [],
    retirementAllowances: [],
    expenses: [],
    oneOffs: [],
    housing: { rents: [] },
    accounts: [],
    ...over,
  }
}

const dc = (over: Partial<Account> = {}): Account => ({
  id: 'dc',
  kind: 'dc',
  ownerId: 'self',
  label: 'DC',
  balance: 0,
  annualReturn: 0,
  joined: '2015-01',
  receiveAge: 60,
  contributions: [{ from: '2030-01', to: '2049-12', monthly: 20_000 }],
  ...over,
})

const sumRows = (plan: Plan, f: (r: ReturnType<typeof simulate>['rows'][number]) => number, from = '0000-01', to = '9999-12') =>
  simulate(plan)
    .rows.filter((r) => r.ym >= from && r.ym <= to)
    .reduce((s, r) => s + f(r), 0)

describe('corporate DC: matching contribution', () => {
  it('is added to the account, paid from the salary and lowers the income tax', () => {
    const without = base({ accounts: [dc()] })
    const withMatching = base({ accounts: [dc({ matchingMonthly: 10_000 })] })
    const r = simulate(withMatching).rows.find((x) => x.ym === '2030-06')!
    expect(r.accounts.dc.contribution).toBe(30_000)
    // 10,000 a month comes out of cash, minus the tax saved on it
    const cashGap = simulate(without).rows.find((x) => x.ym === '2030-12')!.cash - simulate(withMatching).rows.find((x) => x.ym === '2030-12')!.cash
    expect(cashGap).toBeLessThan(120_000)
    expect(cashGap).toBeGreaterThan(80_000)
    // deducted at the year-end adjustment (refund in December) and from the next year's resident tax
    const tax = (p: Plan) => sumRows(p, (x) => x.deductions.incomeTax - x.income.taxRefund, '2030-01', '2030-12') + sumRows(p, (x) => x.deductions.residentTax, '2031-06', '2032-05')
    expect(tax(withMatching)).toBeLessThan(tax(without) - 120_000 * 0.15)
  })
  it('stops when the employer contributions stop', () => {
    const plan = base({ accounts: [dc({ matchingMonthly: 10_000 })] })
    expect(simulate(plan).rows.find((x) => x.ym === '2050-01')!.accounts.dc.contribution).toBe(0)
  })
})

describe('iDeCo / DC received as an annuity', () => {
  const lump = base({ accounts: [dc({ balance: 10_000_000, contributions: [] })] })
  const annuity = base({ accounts: [dc({ balance: 10_000_000, contributions: [], receiveMode: 'annuity', annuityYears: 10 })] })
  const mixed = base({ accounts: [dc({ balance: 10_000_000, contributions: [], receiveMode: 'mixed', annuityYears: 5, lumpShare: 0.4 })] })

  it('pays the balance in monthly installments over the years chosen', () => {
    const rows = simulate(annuity).rows
    const paid = rows.reduce((s, r) => s + (r.accounts.dc?.withdrawal ?? 0), 0)
    expect(paid).toBeCloseTo(10_000_000, 0)
    expect(rows.find((r) => r.ym === '2050-01')!.accounts.dc.withdrawal).toBeCloseTo(10_000_000 / 120, 0)
    expect(rows.find((r) => r.ym === '2059-12')!.accounts.dc.withdrawal).toBeGreaterThan(0)
    expect(rows.find((r) => r.ym === '2060-01')!.accounts.dc.balance).toBeCloseTo(0, 0)
    expect(rows.find((r) => r.ym === '2050-01')!.events.some((e) => e.includes('年金で受け取り開始'))).toBe(true)
  })

  it('is taxed as public pension income instead of retirement income', () => {
    // a lump sum of 10M with 35 years of membership is within the retirement deduction: no tax
    expect(sumRows(lump, (r) => r.income.accountPayout)).toBeCloseTo(10_000_000, 0)
    // installments of 1M a year at 60-69 exceed the public pension deduction (600,000 under 65): some tax
    const tax = sumRows(annuity, (r) => r.deductions.incomeTax + r.deductions.residentTax, '2050-01', '2061-12')
    expect(tax).toBeGreaterThan(0)
  })

  it('mixed: part as a lump sum, the rest in installments', () => {
    const rows = simulate(mixed).rows
    const first = rows.find((r) => r.ym === '2050-01')!
    expect(first.accounts.dc.withdrawal).toBeCloseTo(4_000_000 + 6_000_000 / 60, 0)
    expect(rows.reduce((s, r) => s + (r.accounts.dc?.withdrawal ?? 0), 0)).toBeCloseTo(10_000_000, 0)
    expect(rows.find((r) => r.ym === '2055-01')!.accounts.dc.balance).toBeCloseTo(0, 0)
  })
})

describe('employee stock ownership: incentive', () => {
  const stock = (incentiveRate?: number): Account => ({
    id: 'st',
    kind: 'stock',
    ownerId: 'self',
    label: '持株会',
    balance: 0,
    annualReturn: 0,
    contributions: [{ from: '2030-01', to: '2049-12', monthly: 20_000 }],
    incentiveRate,
  })
  it('adds the incentive to the contribution and taxes it as salary', () => {
    const plan = base({ accounts: [stock(0.1)] })
    const r = simulate(plan).rows.find((x) => x.ym === '2030-06')!
    expect(r.accounts.st.contribution).toBeCloseTo(22_000, 6)
    expect(r.income.salary).toBeCloseTo(502_000, 6)
    expect(r.deductions.socialInsurance).toBeGreaterThanOrEqual(simulate(base({ accounts: [stock()] })).rows.find((x) => x.ym === '2030-06')!.deductions.socialInsurance)
  })
  it('stops when the owner no longer works', () => {
    const plan = base({ accounts: [{ ...stock(0.1), contributions: [{ from: '2030-01', monthly: 20_000 }] }] })
    expect(simulate(plan).rows.find((x) => x.ym === '2050-06')!.accounts.st.contribution).toBe(20_000)
  })
})

describe('care costs (かんたん入力)', () => {
  const w = sampleWizard()
  const plan = buildPlan({ ...w, parentCare: { enabled: true, startAge: 55, years: 5, monthly: 30_000, initial: 470_000 } }, 'c', 'c')
  it('are paid for the years given, with the one-time cost at the start', () => {
    const years = yearly(simulate(plan))
    const at = (y: number) => years.find((r) => r.year === y)!.expenseBreakdown.care
    // self born 1990-05: 55 in 2045-05
    expect(at(2044)).toBe(0)
    expect(at(2045)).toBeGreaterThan(470_000)
    expect(at(2047)).toBeGreaterThan(30_000 * 12)
    expect(at(2051)).toBe(0)
  })
  it('own care is counted for each adult', () => {
    const own = buildPlan({ ...w, ownCare: { enabled: true, startAge: 85, years: 5, monthly: 90_000, initial: 0 } }, 'o', 'o')
    expect(own.expenses.filter((e) => e.category === 'care')).toHaveLength(2)
  })
  it('are off by default', () => {
    expect(samplePlan().expenses.some((e) => e.category === 'care')).toBe(false)
  })
})

describe('scenarios: how one parent works', () => {
  const plan = samplePlan()
  it('compares the parent who gives birth', () => {
    expect(workPerson(plan)).toBe('spouse')
    expect(currentWork(plan)).toBe('dual')
    expect(workPerson({ ...plan, wizard: undefined })).toBeUndefined()
  })
  it('quitting at the birth: no return to full time, part-time later, no DC contributions after quitting', () => {
    const v = variantPlan(plan, 1, 'buy', defaultAssumptions(plan), 'quit')
    expect(v).not.toBe(plan)
    expect(v.name).toContain('出産で退職')
    const spouseWork = v.work.filter((x) => x.memberId === 'spouse')
    expect(spouseWork.some((x) => x.label === 'パートで再就職')).toBe(true)
    expect(spouseWork.some((x) => x.label === '時短勤務')).toBe(false)
    const dcAcc = v.accounts.find((a) => a.id === 'spouse-dc')!
    expect(dcAcc.contributions[0].to! < '2026-06').toBe(true)
    expect(v.retirementAllowances.some((r) => r.memberId === 'spouse')).toBe(false)
  })
  it('not working lowers the lifetime income and the assets', () => {
    const none = variantPlan(plan, 1, 'buy', defaultAssumptions(plan), 'none')
    expect(none.work.some((x) => x.memberId === 'spouse')).toBe(false)
    const k = (p: Plan) => kpis(p, simulate(p), p.retirementAge)
    expect(k(none).finalAssets.value).toBeLessThan(k(plan).finalAssets.value)
    // past employee years still count for the pension
    expect(none.pensions.find((p) => p.memberId === 'spouse')!.pastKoseiYears).toBeGreaterThan(5)
  })
  it('builds every combination, with the plan itself marked', () => {
    const s = buildScenarios(plan, [1, 2], ['buy'], defaultAssumptions(plan), ['dual', 'parttime'])
    expect(s.map((x) => `${x.children}${x.work}`)).toEqual(['1dual', '1parttime', '2dual', '2parttime'])
    expect(s.filter((x) => x.isCurrent)).toHaveLength(1)
    expect(s.find((x) => x.isCurrent)!.plan).toBe(plan)
  })
})

describe('improvement hints', () => {
  const plan = samplePlan()
  const hints = improvementHints(plan)
  const final = (p: Plan) => kpis(p, simulate(p), p.retirementAge).finalAssets.value
  it('offers the usual levers for the sample', () => {
    expect(hints.map((h) => h.id)).toEqual(expect.arrayContaining(['living', 'work-self', 'work-spouse', 'nisa', 'pension70', 'house']))
  })
  it('each one changes only a copy', () => {
    const before = JSON.stringify(plan)
    for (const h of hints) expect(h.plan).not.toBe(plan)
    expect(JSON.stringify(plan)).toBe(before)
  })
  it('spending less and working longer increase the final assets', () => {
    const f = final(plan)
    expect(final(hints.find((h) => h.id === 'living')!.plan)).toBeGreaterThan(f)
    expect(final(hints.find((h) => h.id === 'work-self')!.plan)).toBeGreaterThan(f)
  })
})

describe('plans from files and links', () => {
  it('accepts plans this app saved', () => {
    expect(planProblems(samplePlan())).toEqual([])
    const r = parsePlans({ plans: [samplePlan()] })
    expect(r.ok).toBe(true)
  })
  it('rejects plans that would break the screens', () => {
    expect(planProblems({ id: 'x', name: 'x', members: [], settings: {} }).length).toBeGreaterThan(0)
    expect(planProblems({ ...samplePlan(), accounts: undefined })).toContain('accounts がありません')
    expect(planProblems({ ...samplePlan(), members: samplePlan().members.filter((m) => m.role !== 'self') })).toContain('本人（role: self）がちょうど1人必要です')
    const broken = parsePlans({ plans: [samplePlan(), { ...samplePlan(), name: '壊れたプラン', settings: { ...samplePlan().settings, start: '2026/01' } }] })
    expect(broken.ok).toBe(false)
    expect(!broken.ok && broken.error).toContain('「壊れたプラン」')
  })
  it('added plans get new ids and names when they clash', () => {
    const a = samplePlan()
    const [b] = withoutClashes([a], [a])
    expect(b.id).not.toBe(a.id)
    expect(b.name).toBe(`${a.name}（2）`)
  })
})

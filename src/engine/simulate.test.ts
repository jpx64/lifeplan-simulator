import { describe, expect, it } from 'vitest'
import { childAllowanceMonthly, parentalLeaveBenefit } from './benefits'
import { defaultPurchase, defaultSettings, samplePlan } from './defaults'
import { loanSchedule, pmt, propertyTaxAnnual } from './housing'
import { NISA_ANNUAL_LIMIT, simulate } from './simulate'
import { schoolAge, ymToIndex } from './time'
import type { Plan } from './types'

const t = ymToIndex

/**
 * A minimal single-person plan for checking the cash arithmetic.
 * The person is "employed" with a zero salary so that no taxes, national health insurance
 * or national pension apply.
 */
function bare(over: Partial<Plan> = {}): Plan {
  return {
    id: 'p',
    name: 'test',
    settings: { ...defaultSettings('2030-01'), inflationRate: 0, pensionGrowthRate: 0, cash: 1_000_000, cashFloor: 0, endAge: 41 },
    members: [{ id: 'self', name: '本人', role: 'self', birth: '1990-01' }],
    work: [{ id: 'w', memberId: 'self', label: '給与なし', kind: 'employed', from: '2030-01', monthlySalary: 0, annualBonus: 0, raiseRate: 0 }],
    pensions: [],
    retirementAllowances: [],
    expenses: [],
    oneOffs: [],
    housing: { rents: [] },
    accounts: [],
    ...over,
  }
}

describe('time helpers', () => {
  it('school age: born May 2019 enters elementary school in April 2026', () => {
    expect(schoolAge(t('2019-05'), t('2026-04'))).toBe(6)
    expect(schoolAge(t('2019-05'), t('2026-03'))).toBe(5)
  })
  it('school age: born March 2020 is in the same grade as April 2019 births', () => {
    expect(schoolAge(t('2020-03'), t('2026-04'))).toBe(6)
  })
})

describe('child allowance', () => {
  it('15,000 under 3, 10,000 until high school, 30,000 from the 3rd child', () => {
    const births = [t('2010-05'), t('2020-05'), t('2025-05')]
    // in 2026-06: ages 16 (high school), 6, 1 → 10,000 + 10,000 + 30,000 (3rd child)
    expect(childAllowanceMonthly(births, t('2026-06'))).toBe(50_000)
  })
  it('stops after the school year the child turns 18', () => {
    expect(childAllowanceMonthly([t('2008-05')], t('2027-03'))).toBe(10_000)
    expect(childAllowanceMonthly([t('2008-05')], t('2027-04'))).toBe(0)
  })
})

describe('parental leave benefit', () => {
  it('67% for 6 months then 50%', () => {
    expect(parentalLeaveBenefit(300_000, 1, false)).toBe(201_000)
    expect(parentalLeaveBenefit(300_000, 7, false)).toBe(150_000)
  })
  it('post-birth supplement adds 13% for 28 days', () => {
    expect(parentalLeaveBenefit(300_000, 1, true)).toBe(Math.floor(300_000 * (0.67 + 0.13 * 28 / 30)))
  })
})

describe('housing loan', () => {
  it('fixed-rate schedule repays the principal exactly', () => {
    const rows = loanSchedule({ amount: 30_000_000, years: 35, rates: [{ fromYear: 1, rate: 0.015 }], prepayments: [], borrowerId: 'self' }, 0)
    expect(rows).toHaveLength(420)
    expect(rows[0].payment).toBeCloseTo(pmt(0.015, 420, 30_000_000), 6)
    expect(rows.at(-1)!.balance).toBeCloseTo(0, 3)
    expect(rows.reduce((s, r) => s + r.principal, 0)).toBeCloseTo(30_000_000, 3)
  })
  it('payment is recalculated when the rate changes', () => {
    const rows = loanSchedule(
      { amount: 30_000_000, years: 35, rates: [{ fromYear: 1, rate: 0.01 }, { fromYear: 6, rate: 0.02 }], prepayments: [], borrowerId: 'self' },
      0,
    )
    expect(rows[60].payment).toBeGreaterThan(rows[59].payment)
    expect(rows.at(-1)!.balance).toBeCloseTo(0, 3)
  })
  it('shorten-type prepayment ends the loan earlier', () => {
    const base = { amount: 30_000_000, years: 35, rates: [{ fromYear: 1, rate: 0.015 }], borrowerId: 'self' }
    const rows = loanSchedule({ ...base, prepayments: [{ ym: '0010-01', amount: 5_000_000, type: 'shorten' }] }, 0)
    expect(rows.length).toBeLessThan(420)
    expect(rows.at(-1)!.balance).toBeCloseTo(0, 3)
  })
  it('pays off at the given age', () => {
    const rows = loanSchedule(
      { amount: 30_000_000, years: 35, rates: [{ fromYear: 1, rate: 0.015 }], prepayments: [], borrowerId: 'self', payoffAge: 60 },
      t('2030-01'),
      t('1980-01'),
    )
    expect(rows.at(-1)!.t).toBe(t('2040-01'))
    expect(rows.at(-1)!.prepayment).toBeGreaterThan(0)
  })
})

describe('property tax estimate', () => {
  const p = { ...defaultPurchase('2030-01', 'self'), price: 50_000_000, landShare: 0.5 }
  it('new house: building tax halved for 3 years', () => {
    // land 25M × 70% = 17.5M; small land 1/6 → 2.917M × 1.4% = 40,833; city planning 1/3 → 5.833M × 0.3% = 17,500
    // building 25M × 60% = 15M; × 1.4% / 2 = 105,000; city planning 15M × 0.3% = 45,000
    expect(propertyTaxAnnual(p, 1)).toBeCloseTo(40_833.33 + 17_500 + 105_000 + 45_000, 0)
    expect(propertyTaxAnnual(p, 4)).toBeGreaterThan(propertyTaxAnnual(p, 3))
  })
  it('override wins', () => {
    expect(propertyTaxAnnual({ ...p, propertyTaxOverride: 123_000 }, 1)).toBe(123_000)
  })
})

describe('simulate: cash arithmetic', () => {
  it('fixed expenses only: cash decreases exactly', () => {
    const plan = bare({ expenses: [{ id: 'e', label: 'x', category: 'living', frequency: 'monthly', amount: 10_000, inflate: false }] })
    const { rows } = simulate(plan)
    expect(rows[0].ym).toBe('2030-01')
    expect(rows.at(-1)!.ym).toBe('2031-12') // December of the year self turns 41
    expect(rows.at(-1)!.cash).toBeCloseTo(1_000_000 - 24 * 10_000, 6)
  })
  it('inflation is applied every January', () => {
    const plan = bare({ expenses: [{ id: 'e', label: 'x', category: 'living', frequency: 'monthly', amount: 10_000, inflate: true }] })
    plan.settings.inflationRate = 0.1
    const { rows } = simulate(plan)
    expect(rows[11].expenses.living).toBeCloseTo(10_000, 6)
    expect(rows[12].expenses.living).toBeCloseTo(11_000, 6)
  })
  it('liquid account with 0% return: contributions move cash into the account', () => {
    const plan = bare({
      accounts: [{ id: 'n', kind: 'nisa', ownerId: 'self', label: 'NISA', balance: 0, annualReturn: 0, contributions: [{ from: '2030-01', monthly: 50_000 }] }],
    })
    plan.settings.cash = 2_000_000
    const { rows } = simulate(plan)
    const last = rows.at(-1)!
    expect(last.accounts.n.balance).toBeCloseTo(24 * 50_000, 6)
    expect(last.cash).toBeCloseTo(2_000_000 - 24 * 50_000, 6)
    expect(last.totalAssets).toBeCloseTo(2_000_000, 6)
  })
  it('saving pauses while cash would drop below the emergency fund', () => {
    const plan = bare({
      accounts: [{ id: 'n', kind: 'nisa', ownerId: 'self', label: 'NISA', balance: 0, annualReturn: 0, contributions: [{ from: '2030-01', monthly: 300_000 }] }],
    })
    plan.settings.cashFloor = 500_000
    const { rows } = simulate(plan)
    expect(rows[0].accounts.n.contribution).toBe(300_000)
    expect(rows[1].accounts.n.contribution).toBe(0) // 700,000 - 300,000 < 500,000
  })
  it('a person without a job pays national pension and health insurance', () => {
    const plan = bare({ work: [] })
    const r = simulate(plan).rows[0]
    expect(r.deductions.socialInsurance).toBeCloseTo(17_920 + 50_000 / 12, 6)
  })
  it('compound monthly growth matches the annual return', () => {
    const plan = bare({ accounts: [{ id: 'n', kind: 'nisa', ownerId: 'self', label: 'NISA', balance: 1_000_000, annualReturn: 0.05, contributions: [] }] })
    const { rows } = simulate(plan)
    expect(rows[11].accounts.n.balance).toBeCloseTo(1_050_000, 3)
  })
})

describe('simulate: NISA limits', () => {
  it('annual limit of 3.6M; the excess goes to a taxable account', () => {
    const plan = bare({
      accounts: [{ id: 'n', kind: 'nisa', ownerId: 'self', label: 'NISA', balance: 0, annualReturn: 0, contributions: [{ from: '2030-01', monthly: 400_000 }] }],
    })
    plan.settings.cash = 100_000_000
    const res = simulate(plan)
    const dec = res.rows[11]
    expect(dec.accounts.n.balance).toBe(NISA_ANNUAL_LIMIT)
    expect(dec.accounts['self-taxable-auto'].balance).toBe(12 * 400_000 - NISA_ANNUAL_LIMIT)
    expect(res.warnings.some((w) => w.includes('NISA'))).toBe(true)
  })
  it('lifetime limit counts the starting cost basis', () => {
    const plan = bare({
      accounts: [
        { id: 'n', kind: 'nisa', ownerId: 'self', label: 'NISA', balance: 20_000_000, costBasis: 17_000_000, annualReturn: 0, contributions: [{ from: '2030-01', monthly: 300_000 }] },
      ],
    })
    plan.settings.cash = 100_000_000
    const dec = simulate(plan).rows[11]
    expect(dec.accounts.n.balance).toBe(21_000_000)
  })
})

describe('simulate: refill cash from accounts', () => {
  it('sells the taxable account and pays tax on the gain part', () => {
    const plan = bare({
      expenses: [{ id: 'e', label: 'x', category: 'living', frequency: 'monthly', amount: 100_000, inflate: false }],
      accounts: [{ id: 'tx', kind: 'taxable', ownerId: 'self', label: '特定', balance: 2_000_000, costBasis: 1_000_000, annualReturn: 0, contributions: [] }],
    })
    plan.settings.cash = 0
    plan.settings.cashFloor = 0
    const r0 = simulate(plan).rows[0]
    expect(r0.cash).toBeCloseTo(0, 6)
    // gain ratio 50% → gross = 100,000 / (1 - 0.5 × 20.315%)
    expect(r0.accounts.tx.withdrawal).toBeCloseTo(100_000 / (1 - 0.5 * 0.20315), 3)
    expect(r0.shortfall).toBe(false)
  })
  it('flags a shortfall when nothing is left', () => {
    const plan = bare({ expenses: [{ id: 'e', label: 'x', category: 'living', frequency: 'monthly', amount: 600_000, inflate: false }] })
    const res = simulate(plan)
    expect(res.rows[1].shortfall).toBe(true)
    expect(res.warnings[0]).toContain('2030-02')
  })
})

describe('simulate: iDeCo lump sum', () => {
  it('receives the whole balance once, taxed as retirement income, and leaves nothing behind', () => {
    const plan = bare({
      accounts: [{ id: 'i', kind: 'ideco', ownerId: 'self', label: 'iDeCo', balance: 10_000_000, annualReturn: 0, joined: '2020-01', receiveAge: 41, contributions: [] }],
    })
    const rows = simulate(plan).rows
    const at = rows.find((r) => r.ym === '2031-01')!
    // 11 years: deduction 4.4M → (10M - 4.4M)/2 = 2.8M → (280,000 - 97,500) × 1.021 = 186,332; resident 280,000
    expect(at.income.accountPayout).toBeCloseTo(10_000_000 - 186_332 - 280_000, 0)
    expect(at.accounts.i.balance).toBe(0)
    expect(rows.at(-1)!.accounts.i.balance).toBe(0)
  })
})

describe('simulate: sample plan', () => {
  const res = simulate(samplePlan())
  it('runs to December of the year self turns 100', () => {
    expect(res.rows.at(-1)!.ym).toBe('2090-12')
  })
  it('take-home pay is below gross salary (taxes and social insurance)', () => {
    const r = res.rows.find((x) => x.ym === '2030-07')!
    expect(r.deductions.total).toBeGreaterThan(r.income.salary * 0.15)
    expect(r.deductions.total).toBeLessThan(r.income.salary * 0.35)
  })
  it('housing loan deduction shows up as a refund', () => {
    const marchAfterPurchase = res.rows.find((x) => x.ym === '2029-03')!
    expect(marchAfterPurchase.income.taxRefund).toBeGreaterThan(0)
  })
  it('all numbers are finite', () => {
    for (const r of res.rows) {
      expect(Number.isFinite(r.cash)).toBe(true)
      expect(Number.isFinite(r.totalAssets)).toBe(true)
    }
  })
})

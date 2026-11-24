import { describe, expect, it } from 'vitest'
import { DEFAULT_EDUCATION, defaultSettings } from './defaults'
import { loanSchedule } from './housing'
import { BASIC_PENSION_FULL, CHILD_ADDITION, EARNINGS_RATE, SPOUSE_ADDITION } from './pension'
import { analyzeDeath } from './risk'
import { simulate } from './simulate'
import { retirementIncomeTaxWithDeduction } from './tax'
import type { Plan } from './types'

/** Base plan without inflation or growth, so amounts can be checked by hand. */
function base(over: Partial<Plan> = {}): Plan {
  return {
    id: 'p',
    name: 'test',
    settings: { ...defaultSettings('2030-01'), inflationRate: 0, pensionGrowthRate: 0, cash: 100_000_000, cashFloor: 0, endAge: 90 },
    members: [{ id: 'self', name: '本人', role: 'self', birth: '1990-01' }],
    work: [],
    pensions: [],
    retirementAllowances: [],
    expenses: [],
    oneOffs: [],
    housing: { rents: [] },
    accounts: [],
    ...over,
  }
}

const row = (plan: Plan, ym: string) => simulate(plan).rows.find((r) => r.ym === ym)!

describe('public pension: automatic estimate', () => {
  const plan = base({
    work: [{ id: 'w', memberId: 'self', label: '会社員', kind: 'employed', from: '2030-01', to: '2049-12', monthlySalary: 500_000, annualBonus: 0, raiseRate: 0 }],
    pensions: [{ memberId: 'self', startAge: 65, mode: 'auto', annualAmountAt65: 0, careerStartAge: 22, pastAverageIncome: 6_000_000 }],
  })
  it('basic pension + earnings-related part from past and future salaries', () => {
    const res = simulate(plan)
    // past: 2012-01 to 2029-12 = 216 months × 500,000; future: 240 months × 500,000
    const expected = (216 + 240) * 500_000 * EARNINGS_RATE
    expect(res.pensions.self.earnings).toBeCloseTo(expected, 0)
    expect(res.pensions.self.basic).toBe(BASIC_PENSION_FULL)
    expect(res.pensions.self.koseiMonths).toBe(456)
  })
  it('is paid monthly from 65', () => {
    const r = row(plan, '2055-01')
    expect(r.income.pension).toBeCloseTo((BASIC_PENSION_FULL + (456 * 500_000 * EARNINGS_RATE)) / 12, 0)
    expect(row(plan, '2054-12').income.pension).toBe(0)
  })
})

describe('在職老齢年金', () => {
  it('suspends half of the excess over 620,000 a month', () => {
    const plan = base({
      work: [{ id: 'w', memberId: 'self', label: '会社員', kind: 'employed', from: '2030-01', monthlySalary: 600_000, annualBonus: 0, raiseRate: 0 }],
      pensions: [{ memberId: 'self', startAge: 65, mode: 'manual', annualAmountAt65: BASIC_PENSION_FULL + 1_200_000 }],
    })
    const r = row(plan, '2056-01')
    // earnings part 100,000/month; 600,000 + 100,000 − 620,000 = 80,000 → 40,000 suspended
    expect(r.income.pension).toBeCloseTo(BASIC_PENSION_FULL / 12 + 100_000 - 40_000, 0)
  })
})

describe('加給年金', () => {
  it('is paid from 65 while the younger spouse is under 65', () => {
    const plan = base({
      members: [
        { id: 'self', name: '本人', role: 'self', birth: '1990-01' },
        { id: 'spouse', name: '配偶者', role: 'spouse', birth: '1993-01' },
      ],
      pensions: [
        { memberId: 'self', startAge: 65, mode: 'manual', annualAmountAt65: 2_000_000 },
        { memberId: 'spouse', startAge: 65, mode: 'manual', annualAmountAt65: BASIC_PENSION_FULL },
      ],
    })
    const at66 = row(plan, '2056-01')
    expect(at66.income.pension).toBeCloseTo((2_000_000 + SPOUSE_ADDITION) / 12, 0)
    // spouse turns 65 in 2058-01: the addition stops and the spouse's own pension starts
    const at68 = row(plan, '2058-01')
    expect(at68.income.pension).toBeCloseTo((2_000_000 + BASIC_PENSION_FULL) / 12, 0)
  })
})

describe('death scenario: survivor pensions and 団信', () => {
  const plan = base({
    members: [
      { id: 'self', name: '本人', role: 'self', birth: '1990-01' },
      { id: 'spouse', name: '配偶者', role: 'spouse', birth: '1992-01' },
      { id: 'c1', name: '子1', role: 'child', birth: '2025-05', education: { ...DEFAULT_EDUCATION } },
      { id: 'c2', name: '子2', role: 'child', birth: '2028-05', education: { ...DEFAULT_EDUCATION } },
    ],
    work: [{ id: 'w', memberId: 'self', label: '会社員', kind: 'employed', from: '2030-01', to: '2049-12', monthlySalary: 400_000, annualBonus: 0, raiseRate: 0 }],
    pensions: [{ memberId: 'self', startAge: 65, mode: 'auto', annualAmountAt65: 0, careerStartAge: 22, pastAverageIncome: 4_800_000 }],
    housing: {
      rents: [],
      purchase: {
        ym: '2030-01', price: 40_000_000, landShare: 0.5, homeType: 'house', isNew: true, longLife: false, wooden: true, smallLand: true, closingCostRate: 0,
        loan: { amount: 30_000_000, years: 35, rates: [{ fromYear: 1, rate: 0.01 }], prepayments: [], borrowerId: 'self' },
        loanDeductionLimit: 0, loanDeductionYears: 0, managementFee: 0, repairReserve: 0, repairReserveRaiseYears: 5, repairReserveRaiseRate: 0,
        fireInsuranceAnnual: 0, earthquakeInsuranceAnnual: 0, repairs: [], propertyTaxOverride: 0, propertyTaxRate: 0.014, cityPlanningTaxRate: 0.003,
      },
    },
  })
  const a = analyzeDeath(plan, { memberId: 'self', ym: '2032-01', lifeInsurance: 10_000_000, livingRatio: 0.7, survivorIsWife: true })
  const r = a.result.rows.find((x) => x.ym === '2032-06')!

  it('pays 遺族基礎年金 with child additions and 遺族厚生年金 with 300-month minimum', () => {
    // covered months at death: past 2012-01..2029-12 (216) + 2030-01..2031-12 (24) = 240 → treated as 300
    const earnings = 240 * 400_000 * EARNINGS_RATE
    const survivorKosei = earnings * (300 / 240) * 0.75
    const expected = BASIC_PENSION_FULL + 2 * CHILD_ADDITION + survivorKosei
    expect(r.income.pension).toBeCloseTo(expected / 12, 0)
  })
  it('stops the salary, pays the life insurance and clears the loan with 団信', () => {
    expect(r.income.salary).toBe(0)
    const atDeath = a.result.rows.find((x) => x.ym === '2032-01')!
    expect(atDeath.income.other).toBe(10_000_000)
    expect(atDeath.loanBalance).toBe(0)
    expect(atDeath.events).toContain('団信で住宅ローンが完済')
    expect(r.expenses.housing).toBe(0)
  })
  it('cancels a home purchase planned after the death and keeps renting', () => {
    const later = {
      ...plan,
      housing: {
        rents: [{ id: 'r', label: '賃貸', from: '2030-01', to: '2034-12', monthlyRent: 100_000, renewalMonths: 0 }],
        purchase: { ...plan.housing.purchase!, ym: '2035-01' },
      },
    }
    const res = analyzeDeath(later, { memberId: 'self', ym: '2032-01', lifeInsurance: 0, livingRatio: 0.7, survivorIsWife: true }).result
    const r = res.rows.find((x) => x.ym === '2036-06')!
    expect(r.expenses.housing).toBe(100_000)
    expect(r.loanBalance).toBe(0)
    expect(res.rows.find((x) => x.ym === '2035-01')!.events).toContain('住宅購入は取りやめ（賃貸を続ける）')
  })
  it('a death at the start month still counts as covered by employees pension', () => {
    const atStart = analyzeDeath(plan, { memberId: 'self', ym: '2030-01', lifeInsurance: 0, livingRatio: 0.7, survivorIsWife: true }).result
    const r = atStart.rows.find((x) => x.ym === '2030-06')!
    const earnings = 216 * 400_000 * EARNINGS_RATE
    expect(r.income.pension).toBeCloseTo((BASIC_PENSION_FULL + 2 * CHILD_ADDITION + earnings * (300 / 216) * 0.75) / 12, 0)
  })
  it('estimates the coverage needed (0 when the assets are enough)', () => {
    expect(a.requiredCoverage).toBe(0)
    const poor = analyzeDeath(
      { ...plan, settings: { ...plan.settings, cash: 0 }, expenses: [{ id: 'e', label: '生活費', category: 'living', frequency: 'monthly', amount: 400_000, inflate: false }] },
      { memberId: 'self', ym: '2032-01', lifeInsurance: 0, livingRatio: 1, survivorIsWife: true },
    )
    expect(poor.requiredCoverage).toBeGreaterThan(10_000_000)
  })
})

describe('maternity, childcare leave and short-time work', () => {
  const plan = base({
    work: [
      { id: 'w1', memberId: 'self', label: '会社員', kind: 'employed', from: '2030-01', to: '2030-03', monthlySalary: 300_000, annualBonus: 0, raiseRate: 0 },
      { id: 'w2', memberId: 'self', label: '産休・育休', kind: 'parentalLeave', from: '2030-04', to: '2031-03', monthlySalary: 0, annualBonus: 0, raiseRate: 0, maternity: true },
      { id: 'w3', memberId: 'self', label: '時短', kind: 'employed', from: '2031-04', monthlySalary: 240_000, annualBonus: 0, raiseRate: 0, shortTimeBenefitTo: '2032-03' },
    ],
  })
  it('出産手当金 (2/3) for the first 3 months, then 育児休業給付 (67%)', () => {
    expect(row(plan, '2030-04').income.leaveBenefit).toBe(200_000)
    expect(row(plan, '2030-06').income.leaveBenefit).toBe(200_000)
    expect(row(plan, '2030-07').income.leaveBenefit).toBe(201_000)
    expect(row(plan, '2030-07').deductions.socialInsurance).toBe(0)
  })
  it('育児時短就業給付: 10% of the reduced wage until the child turns 2', () => {
    expect(row(plan, '2031-04').income.leaveBenefit).toBe(24_000)
    expect(row(plan, '2032-04').income.leaveBenefit).toBe(0)
  })
})

describe('part-time work and dependents (年収の壁)', () => {
  const plan = (annual: number) =>
    base({
      members: [
        { id: 'self', name: '本人', role: 'self', birth: '1990-01' },
        { id: 'spouse', name: '配偶者', role: 'spouse', birth: '1990-01' },
      ],
      work: [
        { id: 'w1', memberId: 'self', label: '会社員', kind: 'employed', from: '2030-01', monthlySalary: 400_000, annualBonus: 0, raiseRate: 0 },
        { id: 'w2', memberId: 'spouse', label: 'パート', kind: 'employed', from: '2030-01', monthlySalary: annual / 12, annualBonus: 0, raiseRate: 0, socialInsurance: false },
      ],
    })
  it('under 1.3M: a dependent with no social insurance of their own', () => {
    const r = row(plan(1_000_000), '2031-06')
    const selfOnly = row(base({ work: [{ id: 'w1', memberId: 'self', label: '会社員', kind: 'employed', from: '2030-01', monthlySalary: 400_000, annualBonus: 0, raiseRate: 0 }] }), '2031-06')
    expect(r.deductions.socialInsurance).toBeCloseTo(selfOnly.deductions.socialInsurance, 6)
  })
  it('1.3M or more without employer insurance: national pension and health insurance', () => {
    const r = row(plan(1_500_000), '2031-06')
    const r2 = row(plan(1_000_000), '2031-06')
    expect(r.deductions.socialInsurance - r2.deductions.socialInsurance).toBeGreaterThan(17_920)
  })
})

describe('retirement lump sums: overlap adjustment', () => {
  it('reduces the iDeCo deduction by the years already used for the retirement allowance', () => {
    const plan = base({
      retirementAllowances: [{ id: 'r', memberId: 'self', ym: '2050-01', amount: 20_000_000, yearsOfService: 30 }],
      accounts: [{ id: 'i', kind: 'ideco', ownerId: 'self', label: 'iDeCo', balance: 10_000_000, annualReturn: 0, joined: '2025-01', receiveAge: 65, contributions: [] }],
    })
    const r = row(plan, '2055-01')
    // iDeCo 2025-01..2055-01 (30 years → 15M); overlap with service 2020-01..2050-01 is 25 years (8M + 0.7M × 5 = 11.5M)
    const tax = retirementIncomeTaxWithDeduction(10_000_000, 15_000_000 - 11_500_000)
    expect(r.income.accountPayout).toBeCloseTo(10_000_000 - tax.incomeTax - tax.residentTax, 0)
  })
})

describe('education: multi-child rules', () => {
  const kid = (id: string, birth: string) => ({ id, name: id, role: 'child' as const, birth, education: { ...DEFAULT_EDUCATION, university: 'privateArts' as const } })
  it('2nd child in daycare at the same time pays half', () => {
    const plan = base({ members: [{ id: 'self', name: '本人', role: 'self', birth: '1990-01' }, kid('a', '2029-06'), kid('b', '2030-06')] })
    const r = row(plan, '2030-08')
    expect(r.expenses.education).toBeCloseTo(30_000 * 1.5, 6)
  })
  it('university tuition is reduced while three or more children are dependents', () => {
    const three = base({ members: [{ id: 'self', name: '本人', role: 'self', birth: '1990-01' }, kid('a', '2012-06'), kid('b', '2015-06'), kid('c', '2018-06')] })
    const two = base({ members: [{ id: 'self', name: '本人', role: 'self', birth: '1990-01' }, kid('a', '2012-06'), kid('b', '2015-06')] })
    // 2031-06: a is at university (school age 18); compare the cost of child a with and without the waiver
    const uniTwo = row(two, '2031-06').expenses.education - row(base({ members: [{ id: 'self', name: '本人', role: 'self', birth: '1990-01' }, kid('b', '2015-06')] }), '2031-06').expenses.education
    expect(uniTwo).toBeCloseTo(965_000 / 12, 0)
    const uniThree = row(three, '2031-06').expenses.education - row(base({ members: [{ id: 'self', name: '本人', role: 'self', birth: '1990-01' }, kid('b', '2015-06'), kid('c', '2018-06')] }), '2031-06').expenses.education
    expect(uniThree).toBeCloseTo((965_000 - 700_000) / 12, 0)
  })
})

describe('housing loan: 5-year rule and 125% rule', () => {
  it('caps the payment increase at 25% and still repays everything', () => {
    const rows = loanSchedule(
      { amount: 30_000_000, years: 35, rates: [{ fromYear: 1, rate: 0.005 }, { fromYear: 2, rate: 0.04 }], prepayments: [], borrowerId: 'self', fiveYearRule: true },
      0,
    )
    expect(rows[12].payment).toBeCloseTo(rows[0].payment, 6) // rate changed in year 2, payment unchanged
    expect(rows[60].payment).toBeCloseTo(rows[0].payment * 1.25, 6)
    expect(rows.at(-1)!.balance).toBeCloseTo(0, 3)
  })
})

describe('cash ceiling sweep', () => {
  it('moves cash above the ceiling into the chosen account', () => {
    const plan = base({
      accounts: [{ id: 'tx', kind: 'taxable', ownerId: 'self', label: '特定口座', balance: 0, annualReturn: 0, contributions: [] }],
    })
    plan.settings.cash = 5_000_000
    plan.settings.cashCeiling = 3_000_000
    plan.settings.sweepAccountId = 'tx'
    const r = simulate(plan).rows[0]
    expect(r.cash).toBeCloseTo(3_000_000, 6)
    // the person has no job, so national health insurance and pension are paid first
    expect(r.accounts.tx.balance).toBeCloseTo(2_000_000 - r.deductions.total, 6)
  })
})

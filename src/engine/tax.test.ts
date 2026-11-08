import { describe, expect, it } from 'vitest'
import {
  annualTax,
  basicDeductionIncomeTax,
  housingLoanCredit,
  incomeTaxBase,
  insuranceDeductions,
  pensionIncomeDeduction,
  retirementIncomeDeduction,
  retirementIncomeTax,
  salaryIncomeDeduction,
  spouseDeductionIncomeTax,
} from './tax'

describe('salary income deduction (2025-)', () => {
  it.each([
    [1_000_000, 650_000],
    [1_900_000, 650_000],
    [3_000_000, 980_000],
    [5_000_000, 1_440_000],
    [8_000_000, 1_900_000],
    [10_000_000, 1_950_000],
  ])('gross %i → %i', (gross, ded) => expect(salaryIncomeDeduction(gross)).toBe(ded))
})

describe('basic deduction (2025-2026)', () => {
  it.each([
    [1_000_000, 950_000],
    [3_000_000, 880_000],
    [4_000_000, 680_000],
    [6_000_000, 630_000],
    [8_000_000, 580_000],
  ])('income %i → %i', (inc, ded) => expect(basicDeductionIncomeTax(inc)).toBe(ded))
})

describe('income tax brackets (quick calculation table)', () => {
  it.each([
    [1_000_000, 50_000],
    [3_000_000, 202_500],
    [5_000_000, 572_500],
    [8_000_000, 1_204_000],
    [10_000_000, 1_764_000],
  ])('taxable %i → %i', (taxable, tax) => expect(incomeTaxBase(taxable)).toBe(tax))
})

describe('retirement income', () => {
  it('deduction: 40万/年 up to 20 years, then 70万/年', () => {
    expect(retirementIncomeDeduction(1)).toBe(800_000)
    expect(retirementIncomeDeduction(10)).toBe(4_000_000)
    expect(retirementIncomeDeduction(20)).toBe(8_000_000)
    expect(retirementIncomeDeduction(30)).toBe(15_000_000)
    expect(retirementIncomeDeduction(29.2)).toBe(15_000_000) // partial years round up
  })
  it('20M after 30 years', () => {
    // (20,000,000 - 15,000,000) / 2 = 2,500,000 → 2,500,000 × 10% - 97,500 = 152,500 × 1.021
    const r = retirementIncomeTax(20_000_000, 30)
    expect(r.taxable).toBe(2_500_000)
    expect(r.incomeTax).toBe(155_702)
    expect(r.residentTax).toBe(250_000)
  })
  it('no tax within the deduction', () => {
    expect(retirementIncomeTax(5_000_000, 20)).toEqual({ incomeTax: 0, residentTax: 0, taxable: 0 })
  })
})

describe('pension income deduction', () => {
  it('65+ with up to 3.3M: 1.1M', () => expect(pensionIncomeDeduction(2_000_000, 66)).toBe(1_100_000))
  it('under 65 with 2M: 25% + 275k', () => expect(pensionIncomeDeduction(2_000_000, 62)).toBe(775_000))
})

describe('spouse deduction', () => {
  it('spouse income ≤ 580k: 380k', () => expect(spouseDeductionIncomeTax(5_000_000, 0)).toBe(380_000))
  it('spouse special: 1.0M → 360k', () => expect(spouseDeductionIncomeTax(5_000_000, 1_000_000)).toBe(360_000))
  it('taxpayer over 10M: 0', () => expect(spouseDeductionIncomeTax(11_000_000, 0)).toBe(0))
})

describe('insurance deductions', () => {
  it('new life insurance: 3 categories capped at 120k / 70k', () => {
    const d = insuranceDeductions({ general: 100_000, medical: 100_000, privatePension: 100_000, earthquake: 0 })
    expect(d.incomeTax).toBe(120_000)
    expect(d.residentTax).toBe(70_000)
  })
  it('earthquake: up to 50k / 25k', () => {
    const d = insuranceDeductions({ general: 0, medical: 0, privatePension: 0, earthquake: 30_000 })
    expect(d.incomeTax).toBe(30_000)
    expect(d.residentTax).toBe(15_000)
  })
})

describe('housing loan credit', () => {
  it('0.7% of the lower of balance and limit', () => {
    expect(housingLoanCredit(40_000_000, 30_000_000, 500_000, 3_000_000)).toEqual({ incomeTax: 210_000, residentTax: 0 })
  })
  it('remaining credit goes to resident tax up to 5% / 97,500', () => {
    expect(housingLoanCredit(40_000_000, 45_000_000, 100_000, 1_000_000)).toEqual({ incomeTax: 100_000, residentTax: 50_000 })
  })
})

describe('annual tax for an employee', () => {
  const base = {
    age: 40,
    salaryGross: 6_000_000,
    pensionGross: 0,
    otherIncome: 0,
    socialInsurancePaid: 900_000,
    smallBusinessMutualAid: 0,
    premiums: { general: 0, medical: 0, privatePension: 0, earthquake: 0 },
    dependentAges: [],
  }
  it('6M salary, single', () => {
    // salary income 6,000,000 - 1,640,000 = 4,360,000; basic 680,000
    // taxable 4,360,000 - 900,000 - 680,000 = 2,780,000 → 278,000 - 97,500 = 180,500 × 1.021 = 184,290
    const r = annualTax(base)
    expect(r.totalIncome).toBe(4_360_000)
    expect(r.incomeTax).toBe(184_290)
    expect(r.incomeTaxWithheld).toBe(184_290)
    // resident: 4,360,000 - 900,000 - 430,000 = 3,030,000 × 10% - 2,500 + 5,000
    expect(r.residentTax).toBe(305_500)
  })
  it('iDeCo and life insurance reduce the final tax but not the withholding (refund at year end)', () => {
    const r = annualTax({ ...base, smallBusinessMutualAid: 240_000, premiums: { general: 80_000, medical: 0, privatePension: 0, earthquake: 0 } })
    expect(r.incomeTaxWithheld).toBe(184_290)
    // taxable 2,780,000 - 40,000 - 240,000 = 2,500,000 → 152,500 × 1.021
    expect(r.incomeTax).toBe(155_702)
  })
  it('housing loan credit reduces income tax', () => {
    const r = annualTax({ ...base, loan: { yearEndBalance: 30_000_000, limit: 30_000_000 } })
    // credit 210,000 > base tax 180,500 → income tax 0, the rest (29,500) against resident tax
    expect(r.incomeTax).toBe(0)
    expect(r.residentTax).toBe(305_500 - 29_500)
  })
})

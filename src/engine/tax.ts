/**
 * Japanese tax and social insurance rules (as of tax year 2025-2026).
 * All amounts are yen per year unless stated otherwise.
 */

export const RECONSTRUCTION_SURTAX = 0.021
export const RESIDENT_TAX_RATE = 0.1
/** Per-capita resident tax (均等割 5,000 incl. forest environment tax 1,000). */
export const RESIDENT_PER_CAPITA = 5000
export const CAPITAL_GAINS_TAX_RATE = 0.20315

const floor1000 = (x: number) => Math.floor(Math.max(0, x) / 1000) * 1000

/** 給与所得控除 (2025-). */
export function salaryIncomeDeduction(gross: number): number {
  if (gross <= 1_900_000) return Math.min(gross, 650_000)
  if (gross <= 3_600_000) return gross * 0.3 + 80_000
  if (gross <= 6_600_000) return gross * 0.2 + 440_000
  if (gross <= 8_500_000) return gross * 0.1 + 1_100_000
  return 1_950_000
}

export function salaryIncome(gross: number): number {
  return Math.max(0, gross - salaryIncomeDeduction(gross))
}

/** 公的年金等控除 (other income ≤ 10M yen). Age is as of December 31. */
export function pensionIncomeDeduction(gross: number, age: number): number {
  if (age >= 65) {
    if (gross <= 3_300_000) return Math.min(gross, 1_100_000)
  } else if (gross <= 1_300_000) {
    return Math.min(gross, 600_000)
  }
  if (gross <= 4_100_000) return gross * 0.25 + 275_000
  if (gross <= 7_700_000) return gross * 0.15 + 685_000
  if (gross <= 10_000_000) return gross * 0.05 + 1_455_000
  return 1_955_000
}

export function pensionIncome(gross: number, age: number): number {
  return Math.max(0, gross - pensionIncomeDeduction(gross, age))
}

/** 基礎控除 for income tax (2025-2026 temporary schedule). */
export function basicDeductionIncomeTax(totalIncome: number): number {
  if (totalIncome <= 1_320_000) return 950_000
  if (totalIncome <= 3_360_000) return 880_000
  if (totalIncome <= 4_890_000) return 680_000
  if (totalIncome <= 6_550_000) return 630_000
  if (totalIncome <= 23_500_000) return 580_000
  if (totalIncome <= 24_000_000) return 480_000
  if (totalIncome <= 24_500_000) return 320_000
  if (totalIncome <= 25_000_000) return 160_000
  return 0
}

/** 基礎控除 for resident tax. */
export function basicDeductionResidentTax(totalIncome: number): number {
  if (totalIncome <= 24_000_000) return 430_000
  if (totalIncome <= 24_500_000) return 290_000
  if (totalIncome <= 25_000_000) return 150_000
  return 0
}

const SPOUSE_LIMIT = 580_000

const SPOUSE_SPECIAL_TABLE: [number, number, number, number][] = [
  // spouse income upper bound, deduction when taxpayer income ≤9M / ≤9.5M / ≤10M
  [950_000, 380_000, 260_000, 130_000],
  [1_000_000, 360_000, 240_000, 120_000],
  [1_050_000, 310_000, 210_000, 110_000],
  [1_100_000, 260_000, 180_000, 90_000],
  [1_150_000, 210_000, 140_000, 70_000],
  [1_200_000, 160_000, 110_000, 60_000],
  [1_250_000, 110_000, 80_000, 40_000],
  [1_300_000, 60_000, 40_000, 20_000],
  [1_330_000, 30_000, 20_000, 10_000],
]

/** 配偶者控除 / 配偶者特別控除 for income tax. */
export function spouseDeductionIncomeTax(taxpayerIncome: number, spouseIncome: number): number {
  if (taxpayerIncome > 10_000_000) return 0
  const col = taxpayerIncome <= 9_000_000 ? 0 : taxpayerIncome <= 9_500_000 ? 1 : 2
  if (spouseIncome <= SPOUSE_LIMIT) return [380_000, 260_000, 130_000][col]
  for (const row of SPOUSE_SPECIAL_TABLE) {
    if (spouseIncome <= row[0]) return row[col + 1]
  }
  return 0
}

/** 配偶者控除 / 配偶者特別控除 for resident tax (max 330,000). */
export function spouseDeductionResidentTax(taxpayerIncome: number, spouseIncome: number): number {
  const it = spouseDeductionIncomeTax(taxpayerIncome, spouseIncome)
  const cap = taxpayerIncome <= 9_000_000 ? 330_000 : taxpayerIncome <= 9_500_000 ? 220_000 : 110_000
  return Math.min(it, cap)
}

/** 扶養控除 by the dependent's age at December 31. */
export function dependentDeduction(age: number): { incomeTax: number; residentTax: number } {
  if (age >= 19 && age <= 22) return { incomeTax: 630_000, residentTax: 450_000 }
  if (age >= 16) return { incomeTax: 380_000, residentTax: 330_000 }
  return { incomeTax: 0, residentTax: 0 }
}

/** 生命保険料控除 (new contracts) for one category, income tax. */
export function lifeInsuranceDeductionIT(premium: number): number {
  if (premium <= 20_000) return premium
  if (premium <= 40_000) return premium / 2 + 10_000
  if (premium <= 80_000) return premium / 4 + 20_000
  return 40_000
}

/** 生命保険料控除 (new contracts) for one category, resident tax. */
export function lifeInsuranceDeductionRT(premium: number): number {
  if (premium <= 12_000) return premium
  if (premium <= 32_000) return premium / 2 + 6_000
  if (premium <= 56_000) return premium / 4 + 14_000
  return 28_000
}

export interface InsurancePremiums {
  general: number
  medical: number
  privatePension: number
  earthquake: number
}

export function insuranceDeductions(p: InsurancePremiums): { incomeTax: number; residentTax: number } {
  const lifeIT = Math.min(
    120_000,
    lifeInsuranceDeductionIT(p.general) + lifeInsuranceDeductionIT(p.medical) + lifeInsuranceDeductionIT(p.privatePension),
  )
  const lifeRT = Math.min(
    70_000,
    lifeInsuranceDeductionRT(p.general) + lifeInsuranceDeductionRT(p.medical) + lifeInsuranceDeductionRT(p.privatePension),
  )
  return {
    incomeTax: lifeIT + Math.min(p.earthquake, 50_000),
    residentTax: lifeRT + Math.min(p.earthquake / 2, 25_000),
  }
}

/** Income tax on taxable income, before the reconstruction surtax. */
export function incomeTaxBase(taxable: number): number {
  const x = floor1000(taxable)
  if (x <= 1_950_000) return x * 0.05
  if (x <= 3_300_000) return x * 0.1 - 97_500
  if (x <= 6_950_000) return x * 0.2 - 427_500
  if (x <= 9_000_000) return x * 0.23 - 636_000
  if (x <= 18_000_000) return x * 0.33 - 1_536_000
  if (x <= 40_000_000) return x * 0.4 - 2_796_000
  return x * 0.45 - 4_796_000
}

/** 退職所得控除. */
export function retirementIncomeDeduction(years: number): number {
  const y = Math.max(1, Math.ceil(years))
  return y <= 20 ? Math.max(800_000, 400_000 * y) : 8_000_000 + 700_000 * (y - 20)
}

/** 退職所得控除 without the 800,000 minimum (used for the overlap adjustment between lump sums). */
export function retirementIncomeDeductionRaw(years: number): number {
  const y = Math.max(0, Math.ceil(years))
  return y <= 20 ? 400_000 * y : 8_000_000 + 700_000 * (y - 20)
}

/** Tax on a retirement lump sum with a given deduction. */
export function retirementIncomeTaxWithDeduction(amount: number, deduction: number): { incomeTax: number; residentTax: number; taxable: number } {
  const taxable = floor1000((amount - Math.max(0, deduction)) / 2)
  const incomeTax = Math.floor(incomeTaxBase(taxable) * (1 + RECONSTRUCTION_SURTAX))
  const residentTax = Math.floor(taxable * RESIDENT_TAX_RATE)
  return { incomeTax, residentTax, taxable }
}

/** Tax on a retirement lump sum (退職金, iDeCo/DC lump sum). Taxed separately from other income. */
export function retirementIncomeTax(amount: number, years: number): { incomeTax: number; residentTax: number; taxable: number } {
  return retirementIncomeTaxWithDeduction(amount, retirementIncomeDeduction(years))
}

/**
 * How many years back an earlier lump sum makes the deductions overlap (重複期間の調整).
 * - retirement allowance first, then iDeCo/DC lump sum: 19 years
 * - iDeCo/DC lump sum first, then retirement allowance: 9 years (from 2026; previously 4)
 * - otherwise: 4 years
 */
export function retirementOverlapWindowYears(earlier: 'allowance' | 'dc', later: 'allowance' | 'dc'): number {
  if (earlier === 'allowance' && later === 'dc') return 19
  if (earlier === 'dc' && later === 'allowance') return 9
  return 4
}

/**
 * Housing loan deduction credit for one year.
 * The part that cannot be used against income tax reduces the next year's resident tax
 * (up to 5% of taxable income, max 97,500).
 */
export function housingLoanCredit(
  yearEndBalance: number,
  limit: number,
  incomeTaxBeforeCredit: number,
  taxableIncome: number,
): { incomeTax: number; residentTax: number } {
  const credit = Math.floor(Math.min(yearEndBalance, limit) * 0.007)
  const it = Math.min(credit, incomeTaxBeforeCredit)
  const rt = Math.min(credit - it, Math.floor(Math.min(taxableIncome * 0.05, 97_500)))
  return { incomeTax: it, residentTax: rt }
}

// ---------- annual tax for one person ----------

export interface AnnualTaxInput {
  age: number
  salaryGross: number
  pensionGross: number
  /** Other miscellaneous income (e.g. gain part of private annuity payouts). */
  otherIncome: number
  socialInsurancePaid: number
  /** iDeCo and other 小規模企業共済等掛金. */
  smallBusinessMutualAid: number
  premiums: InsurancePremiums
  /** Spouse's total income if this person can claim the spouse deduction. */
  spouseIncome?: number
  dependentAges: number[]
  /** Housing loan: year-end balance and eligible limit (if the credit applies this year). */
  loan?: { yearEndBalance: number; limit: number }
}

export interface AnnualTaxResult {
  totalIncome: number
  incomeTax: number
  /** Resident tax for this year's income (collected the following June-May). */
  residentTax: number
  loanCreditIncomeTax: number
  /** Income tax computed with only payroll deductions (what is withheld during the year). */
  incomeTaxWithheld: number
}

export function annualTax(input: AnnualTaxInput): AnnualTaxResult {
  const sal = salaryIncome(input.salaryGross)
  const pen = pensionIncome(input.pensionGross, input.age)
  const totalIncome = sal + pen + Math.max(0, input.otherIncome)

  const dep = input.dependentAges.map(dependentDeduction)
  const depIT = dep.reduce((s, d) => s + d.incomeTax, 0)
  const depRT = dep.reduce((s, d) => s + d.residentTax, 0)
  const spouseIT = input.spouseIncome !== undefined ? spouseDeductionIncomeTax(totalIncome, input.spouseIncome) : 0
  const spouseRT = input.spouseIncome !== undefined ? spouseDeductionResidentTax(totalIncome, input.spouseIncome) : 0
  const ins = insuranceDeductions(input.premiums)

  // Withheld during the year: social insurance, basic, spouse, dependents only.
  const payrollIT = input.socialInsurancePaid + basicDeductionIncomeTax(totalIncome) + spouseIT + depIT
  const withheldTaxable = Math.max(0, totalIncome - payrollIT)
  const incomeTaxWithheld = Math.floor(incomeTaxBase(withheldTaxable) * (1 + RECONSTRUCTION_SURTAX))

  // Final: plus year-end adjustment deductions.
  const taxableIT = Math.max(0, totalIncome - payrollIT - ins.incomeTax - input.smallBusinessMutualAid)
  const baseIT = incomeTaxBase(taxableIT)
  let loanIT = 0
  let loanRT = 0
  if (input.loan) {
    const c = housingLoanCredit(input.loan.yearEndBalance, input.loan.limit, baseIT, taxableIT)
    loanIT = c.incomeTax
    loanRT = c.residentTax
  }
  const incomeTax = Math.floor((baseIT - loanIT) * (1 + RECONSTRUCTION_SURTAX))

  const dedRT =
    input.socialInsurancePaid +
    basicDeductionResidentTax(totalIncome) +
    spouseRT +
    depRT +
    ins.residentTax +
    input.smallBusinessMutualAid
  const taxableRT = floor1000(totalIncome - dedRT)
  // Non-taxable threshold (simplified): total income ≤ 450,000 + 350,000 per dependent family member.
  const familyCount = (input.spouseIncome !== undefined ? 1 : 0) + input.dependentAges.length
  const exemptLimit = familyCount > 0 ? 350_000 * (1 + familyCount) + 310_000 : 450_000
  const residentTax =
    totalIncome <= exemptLimit
      ? 0
      : Math.max(0, Math.floor(taxableRT * RESIDENT_TAX_RATE) - 2_500 - loanRT) + RESIDENT_PER_CAPITA

  return {
    totalIncome,
    incomeTax: Math.max(0, incomeTax),
    residentTax,
    loanCreditIncomeTax: Math.floor(loanIT * (1 + RECONSTRUCTION_SURTAX)),
    incomeTaxWithheld,
  }
}

// ---------- social insurance ----------

export interface SocialInsuranceRates {
  health: number
  care: number
  pension: number
  employment: number
  /** 子ども・子育て支援金 (employee share), charged on the health insurance base. */
  childSupport?: number
}

const HEALTH_MONTHLY_CAP = 1_390_000
const PENSION_MONTHLY_CAP = 650_000
const PENSION_BONUS_CAP = 1_500_000
const HEALTH_BONUS_ANNUAL_CAP = 5_730_000

/** Employee share of social insurance on a monthly salary. */
export function employeeSocialInsuranceMonthly(salary: number, age: number, r: SocialInsuranceRates): number {
  const health = Math.min(salary, HEALTH_MONTHLY_CAP) * (r.health + (r.childSupport ?? 0) + (age >= 40 && age < 65 ? r.care : 0))
  const pension = age < 70 ? Math.min(salary, PENSION_MONTHLY_CAP) * r.pension : 0
  return health + pension + salary * r.employment
}

/** Employee share of social insurance on one bonus payment. */
export function employeeSocialInsuranceBonus(bonus: number, age: number, r: SocialInsuranceRates): number {
  const health = Math.min(bonus, HEALTH_BONUS_ANNUAL_CAP) * (r.health + (r.childSupport ?? 0) + (age >= 40 && age < 65 ? r.care : 0))
  const pension = age < 70 ? Math.min(bonus, PENSION_BONUS_CAP) * r.pension : 0
  return health + pension + bonus * r.employment
}

/** National pension contribution per month (FY2026). */
export const NATIONAL_PENSION_MONTHLY = 17_920

/** Long-term care insurance premium for people aged 65+ (第1号被保険者), national average ≈ 6,225 yen/month. */
export const CARE_PREMIUM_65_ANNUAL = 75_000

/**
 * National health insurance (国民健康保険) or, from 75, 後期高齢者医療, per person per year (rough national averages).
 * Income-based part on (prior-year total income − 430,000) plus a flat per-person part.
 * The flat part is reduced by 70% for low incomes (total income ≤ 430,000).
 * Care insurance for ages 40-64 is included; from 65 it is charged separately (CARE_PREMIUM_65_ANNUAL).
 */
export function nationalHealthInsuranceAnnual(priorYearIncome: number, age = 50): number {
  const base = Math.max(0, priorYearIncome - 430_000)
  const [rate, flat] = age >= 75 ? [0.097, 50_000] : age >= 40 && age < 65 ? [0.1, 60_000] : [0.08, 45_000]
  return base * rate + (priorYearIncome <= 430_000 ? flat * 0.3 : flat)
}

/**
 * 子ども・子育て支援金 (from April 2026), employee share of the levy on the health insurance base.
 * FY2026: 0.23% in total (split between employer and employee). It is planned to rise to about 0.4% by FY2028.
 */
export function childSupportLevyEmployeeRate(year: number, month: number): number {
  const fy = month >= 4 ? year : year - 1
  if (fy < 2026) return 0
  if (fy === 2026) return 0.00115
  if (fy === 2027) return 0.0015
  return 0.002
}

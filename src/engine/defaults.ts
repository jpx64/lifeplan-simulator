import type { EducationPlan, Plan, Purchase, Settings } from './types'

export const DEFAULT_EDUCATION: EducationPlan = {
  daycare: true,
  kindergarten: 'public',
  elementary: 'public',
  juniorHigh: 'public',
  high: 'public',
  university: 'privateArts',
  livingAway: false,
}

export function defaultSettings(start: string): Settings {
  return {
    start,
    endAge: 100,
    inflationRate: 0.0125,
    pensionGrowthRate: 0.005,
    annualUpdateMonth: 1,
    cash: 3_000_000,
    cashFloor: 2_000_000,
    withdrawalOrder: [],
    // employee share: 協会けんぽ (national average) / care / welfare pension / employment insurance
    healthInsuranceRate: 0.05,
    careInsuranceRate: 0.008,
    pensionInsuranceRate: 0.0915,
    employmentInsuranceRate: 0.0055,
    childLivingCost: { preschool: 20_000, elementary: 30_000, juniorHigh: 40_000, high: 45_000, university: 40_000 },
    daycareFee: 30_000,
  }
}

export function defaultPurchase(ym: string, borrowerId: string): Purchase {
  return {
    ym,
    price: 50_000_000,
    landShare: 0.5,
    homeType: 'house',
    isNew: true,
    longLife: false,
    wooden: true,
    smallLand: true,
    closingCostRate: 0.07,
    loan: {
      amount: 45_000_000,
      years: 35,
      rates: [
        { fromYear: 1, rate: 0.01 },
        { fromYear: 6, rate: 0.015 },
        { fromYear: 11, rate: 0.02 },
      ],
      prepayments: [],
      borrowerId,
    },
    loanDeductionLimit: 30_000_000,
    loanDeductionYears: 13,
    managementFee: 0,
    repairReserve: 0,
    repairReserveRaiseYears: 5,
    repairReserveRaiseRate: 0.15,
    fireInsuranceAnnual: 40_000,
    earthquakeInsuranceAnnual: 20_000,
    repairs: [
      { label: '外壁・屋根', everyYears: 15, amount: 1_500_000 },
      { label: '水回り', everyYears: 20, amount: 2_000_000 },
    ],
    propertyTaxRate: 0.014,
    cityPlanningTaxRate: 0.003,
  }
}

/** A fictional sample household used for the first visit. */
export function samplePlan(): Plan {
  const start = '2026-01'
  return {
    id: 'sample',
    name: 'サンプル世帯（共働き・子1人）',
    retirementAge: 64,
    settings: { ...defaultSettings(start), cash: 4_000_000, cashFloor: 3_000_000, withdrawalOrder: ['self-taxable', 'self-nisa', 'spouse-nisa'] },
    members: [
      { id: 'self', name: '本人', role: 'self', birth: '1990-05' },
      { id: 'spouse', name: '配偶者', role: 'spouse', birth: '1992-09' },
      { id: 'child1', name: '子1', role: 'child', birth: '2026-06', education: { ...DEFAULT_EDUCATION } },
    ],
    work: [
      { id: 'w1', memberId: 'self', label: '会社員', kind: 'employed', from: start, to: '2054-04', monthlySalary: 420_000, annualBonus: 1_400_000, raiseRate: 0.015 },
      { id: 'w2', memberId: 'self', label: '再雇用', kind: 'employed', from: '2054-05', to: '2059-04', monthlySalary: 300_000, annualBonus: 0, raiseRate: 0 },
      { id: 'w3', memberId: 'spouse', label: '会社員', kind: 'employed', from: start, to: '2026-04', monthlySalary: 300_000, annualBonus: 900_000, raiseRate: 0.01 },
      { id: 'w4', memberId: 'spouse', label: '育休', kind: 'parentalLeave', from: '2026-05', to: '2027-03', monthlySalary: 0, annualBonus: 0, raiseRate: 0, postBirthSupplement: true },
      { id: 'w5', memberId: 'spouse', label: '時短勤務で復職', kind: 'employed', from: '2027-04', to: '2033-03', monthlySalary: 240_000, annualBonus: 600_000, raiseRate: 0.01 },
      { id: 'w6', memberId: 'spouse', label: 'フルタイムに戻る', kind: 'employed', from: '2033-04', to: '2057-08', monthlySalary: 340_000, annualBonus: 1_000_000, raiseRate: 0.01 },
    ],
    pensions: [
      { memberId: 'self', startAge: 65, mode: 'auto', annualAmountAt65: 1_900_000, careerStartAge: 22, pastAverageIncome: 5_500_000 },
      { memberId: 'spouse', startAge: 65, mode: 'auto', annualAmountAt65: 1_500_000, careerStartAge: 22, pastAverageIncome: 4_000_000 },
    ],
    retirementAllowances: [{ id: 'r1', memberId: 'self', ym: '2054-04', amount: 15_000_000, yearsOfService: 38 }],
    expenses: [
      { id: 'e1', label: '食費・日用品', category: 'living', frequency: 'monthly', amount: 70_000, inflate: true },
      { id: 'e2', label: '光熱・通信', category: 'living', frequency: 'monthly', amount: 25_000, inflate: true },
      { id: 'e3', label: '交通・医療・美容・交際', category: 'living', frequency: 'monthly', amount: 35_000, inflate: true },
      { id: 'e4', label: '本人 小遣い', category: 'allowance', frequency: 'monthly', amount: 40_000, inflate: true },
      { id: 'e5', label: '配偶者 小遣い', category: 'allowance', frequency: 'monthly', amount: 40_000, inflate: true },
      { id: 'e6', label: '医療保険', category: 'insurance', frequency: 'monthly', amount: 6_000, inflate: false, insuranceDeduction: 'medical' },
      { id: 'e7', label: '定期保険', category: 'insurance', frequency: 'monthly', amount: 4_000, inflate: false, insuranceDeduction: 'general', to: '2056-12' },
      { id: 'e8', label: '旅行・家電など', category: 'special', frequency: 'annual', month: 8, amount: 500_000, inflate: true },
      { id: 'e9', label: '車の維持費', category: 'car', frequency: 'monthly', amount: 20_000, inflate: true, to: '2065-12' },
    ],
    oneOffs: [
      { id: 'o1', label: '出産費用（一時金との差額）', ym: '2026-06', amount: -100_000, inflate: false },
      { id: 'o2', label: '車の買い替え', ym: '2030-03', amount: -3_000_000, inflate: true },
      { id: 'o3', label: '車の買い替え', ym: '2040-03', amount: -3_000_000, inflate: true },
      { id: 'o4', label: '車の買い替え', ym: '2050-03', amount: -3_000_000, inflate: true },
    ],
    housing: {
      rents: [{ id: 'h1', label: '賃貸', from: start, to: '2028-03', monthlyRent: 120_000, renewalMonths: 1 }],
      purchase: { ...defaultPurchase('2028-03', 'self') },
    },
    accounts: [
      { id: 'self-nisa', kind: 'nisa', ownerId: 'self', label: '本人 NISA', balance: 5_000_000, costBasis: 4_000_000, annualReturn: 0.05,
        contributions: [{ from: start, to: '2054-12', monthly: 50_000 }], withdrawal: { startAge: 65, mode: 'rate', value: 0.04 } },
      { id: 'spouse-nisa', kind: 'nisa', ownerId: 'spouse', label: '配偶者 NISA', balance: 2_000_000, costBasis: 1_800_000, annualReturn: 0.05,
        contributions: [{ from: start, to: '2056-12', monthly: 30_000 }] },
      { id: 'self-taxable', kind: 'taxable', ownerId: 'self', label: '本人 特定口座', balance: 1_000_000, costBasis: 800_000, annualReturn: 0.04, contributions: [] },
      { id: 'self-ideco', kind: 'ideco', ownerId: 'self', label: '本人 iDeCo', balance: 1_500_000, annualReturn: 0.05, joined: '2019-04', receiveAge: 65,
        contributions: [{ from: start, monthly: 20_000 }] },
      { id: 'spouse-dc', kind: 'dc', ownerId: 'spouse', label: '配偶者 企業型DC', balance: 800_000, annualReturn: 0.03, joined: '2015-04', receiveAge: 65,
        contributions: [{ from: start, to: '2057-08', monthly: 15_000 }] },
    ],
  }
}

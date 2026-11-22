import type { EducationPlan, Purchase, Settings } from './types'

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

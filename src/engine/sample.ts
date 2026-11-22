import { DEFAULT_EDUCATION } from './defaults'
import type { Plan } from './types'
import { buildPlan, defaultWizard, type WizardInput } from './wizard'

/** Answers of the fictional sample household (dual income, one child, buys a house). */
export function sampleWizard(): WizardInput {
  const start = '2026-01'
  const d = defaultWizard(start)
  return {
    ...d,
    self: {
      ...d.self,
      name: '本人',
      birth: '1990-05',
      annualIncome: 6_440_000,
      bonusShare: 0.22,
      raiseRate: 0.015,
      retireAge: 64,
      reemploy: true,
      reemployIncome: 3_600_000,
      reemployUntilAge: 69,
      retirementAllowance: 15_000_000,
      pastAverageIncome: 5_500_000,
      nisaBalance: 5_000_000,
      nisaCostBasis: 4_000_000,
      nisaMonthly: 50_000,
      idecoBalance: 1_500_000,
      idecoMonthly: 20_000,
      idecoJoined: '2019-04',
    },
    spouse: {
      ...d.spouse,
      name: '配偶者',
      birth: '1992-09',
      annualIncome: 4_500_000,
      bonusShare: 0.2,
      raiseRate: 0.01,
      givesBirth: true,
      leaveMonths: 11,
      shortTimeRatio: 0.8,
      shortTimeUntilChildAge: 6,
      retireAge: 65,
      reemploy: false,
      retirementAllowance: 0,
      pastAverageIncome: 4_000_000,
      nisaBalance: 2_000_000,
      nisaCostBasis: 1_800_000,
      nisaMonthly: 30_000,
      dcBalance: 800_000,
      dcMonthly: 15_000,
      dcJoined: '2015-04',
    },
    children: [{ name: '子1', birth: '2026-06', education: { ...DEFAULT_EDUCATION } }],
    housing: {
      ...d.housing,
      mode: 'buy',
      rent: 120_000,
      buyYM: '2028-04',
      price: 50_000_000,
      downPayment: 5_000_000,
      initialRate: 0.01,
      rateRiseEvery5y: 0.005,
    },
    cash: 4_000_000,
    taxableBalance: 1_000_000,
    taxableCostBasis: 800_000,
    living: 130_000,
    allowanceSelf: 40_000,
    allowanceSpouse: 40_000,
    lifeInsurance: 4_000,
    medicalInsurance: 6_000,
    specialAnnual: 500_000,
    retirementLivingRatio: 0.9,
    cashFloor: 3_000_000,
    withdrawMode: 'rate',
  }
}

/** A fictional sample household used for the first visit. */
export function samplePlan(): Plan {
  return buildPlan(sampleWizard(), 'sample', 'サンプル世帯（共働き・子1人）')
}

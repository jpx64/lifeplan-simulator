import type { EducationPlan, Settings } from './types'

/**
 * Default education costs (today's money, yen per year).
 * Source: 文部科学省「子供の学習費調査」(令和5年度) for K-12 (学習費総額),
 * typical tuition for universities. These are rough defaults; users can adjust via expenses.
 */
export const EDUCATION_ANNUAL = {
  kindergarten: { public: 184_646, private: 347_338 },
  elementary: { public: 336_265, private: 1_828_112 },
  juniorHigh: { public: 542_475, private: 1_560_359 },
  high: { public: 597_752, private: 1_030_283 },
} as const

export const UNIVERSITY = {
  national: { annual: 535_800, entrance: 282_000 },
  privateArts: { annual: 965_000, entrance: 225_000 },
  privateScience: { annual: 1_300_000, entrance: 250_000 },
} as const

/** Living away from home during university: monthly allowance and one-time setup cost. */
export const LIVING_AWAY = { monthly: 80_000, setup: 400_000 }

export type Stage = 'infant' | 'preschool' | 'elementary' | 'juniorHigh' | 'high' | 'university' | 'independent'

export function stageOf(schoolAge: number, plan: EducationPlan): Stage {
  if (schoolAge < 3) return 'infant'
  if (schoolAge < 6) return 'preschool'
  if (schoolAge < 12) return 'elementary'
  if (schoolAge < 15) return 'juniorHigh'
  if (schoolAge < 18) return 'high'
  if (schoolAge < 22 && plan.university !== 'none') return 'university'
  return 'independent'
}

/** Education cost for one month in today's money (before inflation). */
export function educationMonthly(schoolAge: number, month: number, plan: EducationPlan, settings: Settings): number {
  const stage = stageOf(schoolAge, plan)
  switch (stage) {
    case 'infant':
      return plan.daycare ? settings.daycareFee : 0
    case 'preschool':
      return EDUCATION_ANNUAL.kindergarten[plan.kindergarten] / 12
    case 'elementary':
      return EDUCATION_ANNUAL.elementary[plan.elementary] / 12
    case 'juniorHigh':
      return EDUCATION_ANNUAL.juniorHigh[plan.juniorHigh] / 12
    case 'high': {
      // Entrance fee for university is paid in the last February of high school.
      let cost = EDUCATION_ANNUAL.high[plan.high] / 12
      if (schoolAge === 17 && month === 2 && plan.university !== 'none') {
        cost += UNIVERSITY[plan.university].entrance
        if (plan.livingAway) cost += LIVING_AWAY.setup
      }
      return cost
    }
    case 'university': {
      const u = UNIVERSITY[plan.university as Exclude<typeof plan.university, 'none'>]
      return u.annual / 12 + (plan.livingAway ? LIVING_AWAY.monthly : 0)
    }
    default:
      return 0
  }
}

/** Extra household living cost for one child (today's money). Zero once independent or living away. */
export function childLivingMonthly(schoolAge: number, plan: EducationPlan, settings: Settings): number {
  const stage = stageOf(schoolAge, plan)
  const c = settings.childLivingCost
  switch (stage) {
    case 'infant':
    case 'preschool':
      return c.preschool
    case 'elementary':
      return c.elementary
    case 'juniorHigh':
      return c.juniorHigh
    case 'high':
      return c.high
    case 'university':
      return plan.livingAway ? 0 : c.university
    default:
      return 0
  }
}

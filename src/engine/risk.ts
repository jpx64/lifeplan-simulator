import { simulate } from './simulate'
import { indexToYm, monthAtAge, ymToIndex } from './time'
import type { DeathScenario, Plan, SimulationResult } from './types'

export interface DeathAnalysis {
  scenario: DeathScenario
  result: SimulationResult
  /** Same scenario without any life insurance (for the coverage estimate). */
  withoutInsurance: SimulationResult
  /**
   * Rough amount of life insurance needed so that liquid assets never go below zero:
   * the deepest point of liquid assets (cash + NISA + taxable) without insurance, in yen at the time of death.
   */
  requiredCoverage: number
  /** Survivor's pension received in the first full year after the death (annual). */
  survivorPensionFirstYear: number
}

export function deathScenarioAtAge(plan: Plan, memberId: string, age: number, rest: Omit<DeathScenario, 'memberId' | 'ym'>): DeathScenario {
  const m = plan.members.find((x) => x.id === memberId)!
  const t = Math.max(ymToIndex(plan.settings.start), monthAtAge(ymToIndex(m.birth), age))
  return { memberId, ym: indexToYm(t), ...rest }
}

export function analyzeDeath(plan: Plan, scenario: DeathScenario): DeathAnalysis {
  const result = simulate({ ...plan, death: scenario })
  const withoutInsurance = scenario.lifeInsurance > 0 ? simulate({ ...plan, death: { ...scenario, lifeInsurance: 0 } }) : result
  const deathT = Math.max(ymToIndex(plan.settings.start), ymToIndex(scenario.ym))
  let minLiquid = Infinity
  let infAtDeath = 1
  for (const r of withoutInsurance.rows) {
    if (r.t === deathT) infAtDeath = r.inflationIndex
    if (r.t < deathT) continue
    // compare in money at the time of death so later deficits are not overstated by inflation
    minLiquid = Math.min(minLiquid, (r.liquidAssets / r.inflationIndex) * infAtDeath)
  }
  const firstYear = result.rows.filter((r) => r.t > deathT && r.t <= deathT + 12)
  const survivorId = plan.members.find((m) => m.role !== 'child' && m.id !== scenario.memberId)?.id
  return {
    scenario,
    result,
    withoutInsurance,
    requiredCoverage: Math.max(0, -minLiquid),
    survivorPensionFirstYear: survivorId ? firstYear.reduce((s, r) => s + r.income.pension, 0) : 0,
  }
}

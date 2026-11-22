import { DEFAULT_EDUCATION } from './defaults'
import { indexToYm, ymToIndex } from './time'
import type { Member, Plan } from './types'
import { buildHousing, buildPlan, defaultWizard, normalizeWizard, type WizardInput } from './wizard'

/**
 * "What if" variants of one plan: a different number of children and
 * renting vs buying, keeping everything else as it is.
 */

export type HousingChoice = 'rent' | 'buy'
export type HousingInput = WizardInput['housing']

export interface ScenarioAssumptions {
  /** Children added beyond the plan's own are born this many years after the youngest. */
  childSpacingYears: number
  /** Rent (for renting) and purchase conditions (for buying). */
  housing: HousingInput
}

export interface Scenario {
  children: number
  housing: HousingChoice
  plan: Plan
  /** The plan itself (same children and housing, unchanged conditions). */
  isCurrent: boolean
}

export const childrenOf = (plan: Plan) =>
  plan.members.filter((m) => m.role === 'child').sort((a, b) => ymToIndex(a.birth) - ymToIndex(b.birth))

export const housingOf = (plan: Plan): HousingChoice => (plan.housing.purchase ? 'buy' : 'rent')

/** Housing conditions read back from a plan made in 詳細設定 (no かんたん入力 answers). */
function housingFromPlan(plan: Plan): HousingInput {
  const d = defaultWizard(plan.settings.start).housing
  const rent = plan.housing.rents[0]?.monthlyRent ?? d.rent
  const p = plan.housing.purchase
  if (!p) return { ...d, mode: 'rent', rent }
  const rates = p.loan?.rates ?? []
  return {
    ...d,
    mode: 'buy',
    rent,
    buyYM: p.ym,
    price: p.price,
    homeType: p.homeType,
    isNew: p.isNew,
    downPayment: Math.max(0, p.price - (p.loan?.amount ?? 0)),
    loanYears: p.loan?.years ?? d.loanYears,
    initialRate: rates[0]?.rate ?? d.initialRate,
    rateRiseEvery5y: rates.length > 1 ? Math.max(0, Math.round((rates[1].rate - rates[0].rate) * 1e6) / 1e6) : 0,
    condoFees: p.managementFee + p.repairReserve,
  }
}

export function defaultAssumptions(plan: Plan): ScenarioAssumptions {
  return {
    childSpacingYears: 2,
    housing: plan.wizard ? normalizeWizard(plan.wizard).housing : housingFromPlan(plan),
  }
}

/** Whether two sets of conditions give the same housing for `mode` (renting only depends on the rent). */
const sameHousingInput = (a: HousingInput, b: HousingInput, mode: HousingChoice) => {
  const relevant = (h: HousingInput) => (mode === 'rent' ? { rent: h.rent } : { ...h, mode: undefined })
  return JSON.stringify(relevant(a)) === JSON.stringify(relevant(b))
}

/** The plan's children, the youngest removed first or more added after the youngest. */
export function childrenFor(plan: Plan, count: number, spacingYears: number): Member[] {
  const kids = childrenOf(plan)
  const out = kids.slice(0, count)
  const startT = ymToIndex(plan.settings.start)
  for (let k = kids.length; k < count; k++) {
    const last = out.at(-1)
    // a child added to a family whose youngest is already born comes a year from now at the earliest
    const t = Math.max(last ? ymToIndex(last.birth) + spacingYears * 12 : startT, startT + 12)
    out.push({ id: `extra-child${k + 1}`, name: `子${k + 1}`, role: 'child', birth: indexToYm(t), education: { ...(last?.education ?? DEFAULT_EDUCATION) } })
  }
  return out
}

/**
 * The plan with `count` children and the given housing.
 * Work (childcare leave, shorter hours, quitting) follows the children only for plans made with かんたん入力.
 */
export function variantPlan(plan: Plan, count: number, housing: HousingChoice, a: ScenarioAssumptions = defaultAssumptions(plan)): Plan {
  const sameKids = count === childrenOf(plan).length
  const sameHousing = housing === housingOf(plan) && sameHousingInput(a.housing, defaultAssumptions(plan).housing, housing)
  if (sameKids && sameHousing) return plan

  const h: HousingInput = { ...a.housing, mode: housing }
  const kids = sameKids ? childrenOf(plan) : childrenFor(plan, count, a.childSpacingYears)
  const out: Plan = {
    ...plan,
    name: scenarioLabel(count, housing),
    members: [...plan.members.filter((m) => m.role !== 'child'), ...kids],
    housing: sameHousing ? plan.housing : buildHousing(h, plan.settings.start),
  }
  if (plan.wizard) {
    const w: WizardInput = {
      ...normalizeWizard(plan.wizard),
      children: kids.map((c) => ({ name: c.name, birth: c.birth, education: c.education ?? { ...DEFAULT_EDUCATION } })),
      housing: sameHousing ? plan.wizard.housing : h,
    }
    out.wizard = w
    if (!sameKids) {
      const rebuilt = buildPlan(w, plan.id, plan.name)
      out.work = rebuilt.work
      out.retirementAllowances = rebuilt.retirementAllowances
    }
  }
  return out
}

export function scenarioLabel(children: number, housing: HousingChoice) {
  return `子ども${children}人・${housing === 'buy' ? '家を買う' : '賃貸'}`
}

export function buildScenarios(plan: Plan, counts: number[], housings: HousingChoice[], a: ScenarioAssumptions): Scenario[] {
  return [...counts]
    .sort((x, y) => x - y)
    .flatMap((n) =>
      (['rent', 'buy'] as const)
        .filter((h) => housings.includes(h))
        .map((h) => {
          const v = variantPlan(plan, n, h, a)
          // with changed purchase conditions, the plan's own children and housing are no longer the plan itself
          return { children: n, housing: h, plan: v, isCurrent: v === plan }
        }),
    )
}

/** Notes on what the variants of this plan can and cannot reflect. */
export function scenarioNotes(plan: Plan): string[] {
  if (!plan.wizard) {
    return ['このプランは詳細設定で作られているため、子どもの人数を変えても育休・時短などの働き方は変わりません（教育費・子どもの生活費・児童手当は変わります）。']
  }
  const rebuilt = buildPlan(plan.wizard, plan.id, plan.name)
  if (JSON.stringify(rebuilt.work) !== JSON.stringify(plan.work)) {
    return ['詳細設定で変えた働き方は、子どもの人数を変えたパターンには反映されません（かんたん入力の回答から作り直します）。']
  }
  return []
}

/**
 * Rough value of the home owned at `ym` (not part of the assets in the simulation):
 * land keeps the purchase price, the building loses its value in a straight line
 * over 22 years (wooden) or 47 years (reinforced concrete).
 */
export function homeValueAt(plan: Plan, ym: string): number {
  const p = plan.housing.purchase
  if (!p) return 0
  const years = (ymToIndex(ym) - ymToIndex(p.ym)) / 12
  if (years < 0) return 0
  const life = p.wooden ? 22 : 47
  return p.price * p.landShare + p.price * (1 - p.landShare) * Math.max(0, 1 - years / life)
}

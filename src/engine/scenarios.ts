import { DEFAULT_EDUCATION } from './defaults'
import { ageAt, indexToYm, ymToIndex } from './time'
import type { Member, Plan } from './types'
import { buildHousing, buildPlan, defaultWizard, normalizeWizard, type WizardAdult, type WizardInput } from './wizard'

/**
 * "What if" variants of one plan: a different number of children, renting vs buying,
 * and how one parent works, keeping everything else as it is.
 */

export type HousingChoice = 'rent' | 'buy'
export type HousingInput = WizardInput['housing']
/** dual: keeps working as an employee (leave, shorter hours, then full time). quit: quits at the next birth, later part-time. */
export type WorkChoice = 'dual' | 'quit' | 'parttime' | 'none'

export const WORK_CHOICES: WorkChoice[] = ['dual', 'quit', 'parttime', 'none']

export interface WorkInput {
  /** Gross annual income when working as an employee. */
  income: number
  /** Gross annual income of part-time work (also after quitting). */
  partTimeIncome: number
  /** quit: child age at which part-time work starts (0 = does not work again). */
  returnChildAge: number
}

export interface ScenarioAssumptions {
  /** Children added beyond the plan's own are born this many years after the youngest. */
  childSpacingYears: number
  /** Rent (for renting) and purchase conditions (for buying). */
  housing: HousingInput
  /** Incomes used when the work of `workPerson` is changed. */
  work: WorkInput
}

export interface Scenario {
  children: number
  housing: HousingChoice
  /** How `workPerson` works (undefined: plans whose work cannot be changed). */
  work?: WorkChoice
  plan: Plan
  /** The plan itself (same children, housing and work, unchanged conditions). */
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

/**
 * The parent whose work is compared: the one who gives birth, otherwise the spouse.
 * Only plans made with かんたん入力 (work is rebuilt from the answers) and with two adults.
 */
export function workPerson(plan: Plan): 'self' | 'spouse' | undefined {
  if (!plan.wizard) return undefined
  const w = normalizeWizard(plan.wizard)
  if (!w.hasSpouse) return undefined
  return w.self.givesBirth && !w.spouse.givesBirth ? 'self' : 'spouse'
}

export function workOf(a: WizardAdult): WorkChoice {
  const style = a.workStyle ?? (a.working ? 'employee' : 'none')
  if (style === 'none') return 'none'
  if (style === 'parttime') return 'parttime'
  return a.afterLeave === 'quit' ? 'quit' : 'dual'
}

/** How the compared parent works in the plan. */
export function currentWork(plan: Plan): WorkChoice | undefined {
  const who = workPerson(plan)
  return who ? workOf(normalizeWizard(plan.wizard!)[who]) : undefined
}

export function defaultAssumptions(plan: Plan): ScenarioAssumptions {
  const who = workPerson(plan)
  const a = who ? normalizeWizard(plan.wizard!)[who] : undefined
  return {
    childSpacingYears: 2,
    housing: plan.wizard ? normalizeWizard(plan.wizard).housing : housingFromPlan(plan),
    work: {
      income: a?.annualIncome ?? 4_000_000,
      partTimeIncome: a?.workStyle === 'parttime' ? (a.partTimeIncome ?? 1_000_000) : (a?.returnIncome ?? a?.partTimeIncome ?? 1_000_000),
      returnChildAge: a?.returnChildAge ?? 6,
    },
  }
}

/** Whether two sets of incomes give the same work for `work` (only the fields that work uses). */
const sameWorkInput = (a: WorkInput, b: WorkInput, work: WorkChoice) => {
  const relevant = (x: WorkInput) =>
    work === 'dual' ? { income: x.income } : work === 'parttime' ? { partTimeIncome: x.partTimeIncome } : work === 'quit' ? { ...x } : {}
  return JSON.stringify(relevant(a)) === JSON.stringify(relevant(b))
}

/** The parent's answers changed to work as `work`. */
function withWork(a: WizardAdult, work: WorkChoice, input: WorkInput, start: string): WizardAdult {
  const wasEmployee = (a.workStyle ?? (a.working ? 'employee' : 'none')) === 'employee'
  // years as an employee so far: someone who is an employee now keeps that record when they stop
  const pastKoseiYears = wasEmployee ? Math.max(0, ageAt(ymToIndex(a.birth), ymToIndex(start)) - (a.careerStartAge ?? 22)) : a.pastKoseiYears
  switch (work) {
    case 'dual':
      return { ...a, working: true, workStyle: 'employee', afterLeave: 'return', annualIncome: input.income }
    case 'quit':
      return {
        ...a,
        working: true,
        workStyle: 'employee',
        afterLeave: 'quit',
        annualIncome: input.income,
        returnIncome: input.partTimeIncome,
        returnChildAge: input.returnChildAge,
      }
    case 'parttime':
      return { ...a, working: true, workStyle: 'parttime', partTimeIncome: input.partTimeIncome, pastKoseiYears }
    case 'none':
      return { ...a, working: false, workStyle: 'none', pastKoseiYears }
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
 * The plan with `count` children, the given housing and (for plans made with かんたん入力) the compared
 * parent working as `work`. Work (childcare leave, shorter hours, quitting) follows the children only
 * for plans made with かんたん入力.
 */
export function variantPlan(
  plan: Plan,
  count: number,
  housing: HousingChoice,
  a: ScenarioAssumptions = defaultAssumptions(plan),
  work: WorkChoice | undefined = currentWork(plan),
): Plan {
  const base = defaultAssumptions(plan)
  const who = workPerson(plan)
  const sameKids = count === childrenOf(plan).length
  const sameHousing = housing === housingOf(plan) && sameHousingInput(a.housing, base.housing, housing)
  const sameWork = !who || work === undefined || (work === currentWork(plan) && sameWorkInput(a.work, base.work, work))
  if (sameKids && sameHousing && sameWork) return plan

  const h: HousingInput = { ...a.housing, mode: housing }
  const kids = sameKids ? childrenOf(plan) : childrenFor(plan, count, a.childSpacingYears)
  const out: Plan = {
    ...plan,
    name: scenarioLabel(count, housing, who && !sameWork ? { work: work!, name: normalizeWizard(plan.wizard!)[who].name } : undefined),
    members: [...plan.members.filter((m) => m.role !== 'child'), ...kids],
    housing: sameHousing ? plan.housing : buildHousing(h, plan.settings.start),
  }
  if (plan.wizard) {
    const nw = normalizeWizard(plan.wizard)
    const w: WizardInput = {
      ...nw,
      children: kids.map((c) => ({ name: c.name, birth: c.birth, education: c.education ?? { ...DEFAULT_EDUCATION } })),
      housing: sameHousing ? plan.wizard.housing : h,
    }
    if (who && !sameWork) w[who] = withWork(nw[who], work!, a.work, nw.start)
    out.wizard = w
    if (!sameKids || !sameWork) {
      const rebuilt = buildPlan(w, plan.id, plan.name)
      const generated = buildPlan(plan.wizard, plan.id, plan.name)
      out.work = rebuilt.work
      out.retirementAllowances = rebuilt.retirementAllowances
      // pensions and accounts follow the new work too, unless they were edited in 詳細設定
      const same = (x: unknown, y: unknown) => JSON.stringify(x) === JSON.stringify(y)
      if (same(plan.pensions, generated.pensions)) out.pensions = rebuilt.pensions
      if (same(plan.accounts, generated.accounts)) out.accounts = rebuilt.accounts
    }
  }
  return out
}

export const WORK_LABEL: Record<WorkChoice, string> = {
  dual: '会社員を続ける',
  quit: '出産を機に退職',
  parttime: 'パート',
  none: '働かない',
}

const WORK_PHRASE: Record<WorkChoice, string> = {
  dual: 'は会社員を続ける',
  quit: 'が出産で退職',
  parttime: 'はパート',
  none: 'は働かない',
}

export function scenarioLabel(children: number, housing: HousingChoice, work?: { work: WorkChoice; name: string }) {
  return `子ども${children}人・${housing === 'buy' ? '家を買う' : '賃貸'}${work ? `・${work.name}${WORK_PHRASE[work.work]}` : ''}`
}

export function buildScenarios(plan: Plan, counts: number[], housings: HousingChoice[], a: ScenarioAssumptions, works?: WorkChoice[]): Scenario[] {
  const now = currentWork(plan)
  const ws: (WorkChoice | undefined)[] = now && works?.length ? WORK_CHOICES.filter((w) => works.includes(w)) : [now]
  return [...counts]
    .sort((x, y) => x - y)
    .flatMap((n) =>
      ws.flatMap((wk) =>
        (['rent', 'buy'] as const)
          .filter((h) => housings.includes(h))
          .map((h) => {
            const v = variantPlan(plan, n, h, a, wk)
            // with changed conditions, the plan's own children, housing and work are no longer the plan itself
            return { children: n, housing: h, work: wk, plan: v, isCurrent: v === plan }
          }),
      ),
    )
}

/** Whether quitting at a birth makes a difference: there are births after the start in the pattern. */
export const hasFutureBirth = (plan: Plan) => childrenOf(plan).some((c) => ymToIndex(c.birth) >= ymToIndex(plan.settings.start))

/** Notes on what the variants of this plan can and cannot reflect. */
export function scenarioNotes(plan: Plan): string[] {
  if (!plan.wizard) {
    return ['このプランは詳細設定で作られているため、子どもの人数を変えても育休・時短などの働き方は変わりません（教育費・子どもの生活費・児童手当は変わります）。']
  }
  const rebuilt = buildPlan(plan.wizard, plan.id, plan.name)
  if (JSON.stringify(rebuilt.work) !== JSON.stringify(plan.work)) {
    return ['詳細設定で変えた働き方は、子どもの人数や働き方を変えたパターンには反映されません（かんたん入力の回答から作り直します）。']
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

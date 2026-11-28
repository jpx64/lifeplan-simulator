import { childAllowanceMonthly, parentalLeaveBenefit } from './benefits'
import { childLivingMonthly, educationMonthly, stageOf } from './education'
import { isPropertyTaxMonth, loanSchedule, propertyTaxAnnual, type LoanMonth } from './housing'
import {
  BASIC_PENSION_FULL,
  EARNINGS_RATE,
  KAKYU_MIN_MONTHS,
  SPOUSE_ADDITION,
  STANDARD_BONUS_CAP,
  STANDARD_MONTHLY_CAP,
  WIDOW_MIDDLE_AGE_ADDITION,
  basicPension,
  childAdditions,
  startAgeAdjustment,
  survivorEarningsAfter65,
  survivorEarningsPension,
  workingPensionReduction,
  workingPensionThreshold,
} from './pension'
import {
  CAPITAL_GAINS_TAX_RATE,
  CARE_PREMIUM_65_ANNUAL,
  NATIONAL_PENSION_MONTHLY,
  annualTax,
  childSupportLevyEmployeeRate,
  employeeSocialInsuranceBonus,
  employeeSocialInsuranceMonthly,
  nationalHealthInsuranceAnnual,
  pensionIncome,
  retirementIncomeDeduction,
  retirementIncomeDeductionRaw,
  retirementIncomeTaxWithDeduction,
  retirementOverlapWindowYears,
  salaryIncome,
  type AnnualTaxResult,
  type InsurancePremiums,
  type SocialInsuranceRates,
} from './tax'
import { ageAt, ageAtYearEnd, indexToYm, monthAtAge, monthOf, schoolAge, yearOf, ymToIndex } from './time'
import type { Account, AccountState, Member, MonthRow, PensionEstimate, Plan, SimulationResult, WorkPeriod } from './types'

export const NISA_ANNUAL_LIMIT = 3_600_000
export const NISA_LIFETIME_LIMIT = 18_000_000

const monthlyRate = (annual: number) => Math.pow(1 + annual, 1 / 12) - 1

interface PersonMonth {
  salary: number
  bonus: number
  /** Non-taxable benefits: childcare leave, maternity allowance, short-time work benefit. */
  benefit: number
  /** Own public pension (taxable). */
  pension: number
  /** iDeCo / DC received as an annuity (taxed together with public pensions). */
  dcPension: number
  /** Survivor's pension (non-taxable). */
  survivorPension: number
  socialInsurance: number
  /** Covered by the employer's social insurance this month (including leave). */
  employee: boolean
  /** 総報酬月額相当額 (salary + bonus / 12) for 在職老齢年金. */
  totalPayMonthly: number
  /** Standard remuneration counted for employees' pension this month (nominal). */
  pensionBase: number
}

interface Context {
  plan: Plan
  startT: number
  endT: number
  /** First month of pass 1 (January of the start year, so the start year is taxed as a full year). */
  calcStartT: number
  births: Map<string, number>
  self: Member
  adults: Member[]
  children: Member[]
  /** Number of annual updates (inflation/raises) applied between `from` and `t`. */
  updates: (from: number, t: number) => number
  inflation: (t: number) => number
  deathT?: number
  deceasedId?: string
  alive: (memberId: string, t: number) => boolean
}

function buildContext(plan: Plan): Context {
  const s = plan.settings
  const startT = ymToIndex(s.start)
  const self = plan.members.find((m) => m.role === 'self')
  if (!self) throw new Error('Plan has no self member')
  const births = new Map(plan.members.map((m) => [m.id, ymToIndex(m.birth)]))
  const endT = yearOf(monthAtAge(births.get(self.id)!, s.endAge)) * 12 + 11
  const calcStartT = yearOf(startT) * 12
  const updates = (from: number, t: number) => {
    if (t <= from) return 0
    let first = from + 1
    while (monthOf(first) !== s.annualUpdateMonth) first++
    return t < first ? 0 : Math.floor((t - first) / 12) + 1
  }
  let deathT: number | undefined
  let deceasedId: string | undefined
  if (plan.death && plan.members.some((m) => m.id === plan.death!.memberId && m.role !== 'child')) {
    deathT = Math.max(startT, ymToIndex(plan.death.ym))
    deceasedId = plan.death.memberId
  }
  return {
    plan,
    startT,
    endT,
    calcStartT,
    births,
    self,
    adults: plan.members.filter((m) => m.role !== 'child'),
    children: plan.members.filter((m) => m.role === 'child'),
    updates,
    inflation: (t) => Math.pow(1 + s.inflationRate, updates(startT, t)),
    deathT,
    deceasedId,
    alive: (id, t) => !(deceasedId === id && deathT !== undefined && t >= deathT),
  }
}

const inRange = (t: number, from?: string, to?: string) =>
  (from === undefined || t >= ymToIndex(from)) && (to === undefined || t <= ymToIndex(to))

function workAt(plan: Plan, memberId: string, t: number): WorkPeriod | undefined {
  return plan.work.find((w) => w.memberId === memberId && inRange(t, w.from, w.to))
}

function salaryAt(ctx: Context, w: WorkPeriod, t: number) {
  const g = Math.pow(1 + w.raiseRate, ctx.updates(ymToIndex(w.from), t))
  return { monthly: w.monthlySalary * g, bonus: w.annualBonus * g }
}

/** Salary that the leave benefit is based on: the employed period that ends right before the leave. */
function leaveBaseSalary(ctx: Context, leave: WorkPeriod): number {
  const leaveStart = ymToIndex(leave.from)
  const prev = ctx.plan.work
    .filter((w) => w.memberId === leave.memberId && w.kind === 'employed' && ymToIndex(w.from) < leaveStart)
    .sort((a, b) => ymToIndex(b.from) - ymToIndex(a.from))[0]
  if (!prev) return leave.monthlySalary
  return salaryAt(ctx, prev, leaveStart - 1).monthly
}

interface ContractualAccountMonth {
  balance: number
  costBasis: number
  contribution: number
  /** Part of the contribution paid by the member (iDeCo, private annuity, DC matching contribution). */
  ownContribution: number
  growth: number
  /** Lump sum received at the receiving age (taxed as retirement income later). */
  lumpSum: number
  /** Private annuity insurance payout (gross). */
  annuityPayout: number
  /** iDeCo / DC received as an annuity (gross, taxed as 公的年金等). */
  pensionPayout: number
  /** Balance paid out at death (death benefit, not taxed here). */
  deathPayout: number
  /** Taxable gain part of annuity payouts (miscellaneous income). */
  taxableGain: number
  event?: string
}

/** iDeCo, corporate DC and private annuity insurance do not depend on cash, so they are simulated up front. */
function simulateContractual(ctx: Context, acc: Account): Map<number, ContractualAccountMonth> {
  const out = new Map<number, ContractualAccountMonth>()
  const birth = ctx.births.get(acc.ownerId)!
  let balance = acc.balance
  let basis = acc.costBasis ?? acc.balance
  const isDc = acc.kind === 'ideco' || acc.kind === 'dc'
  const receiveT = isDc && acc.receiveAge !== undefined ? monthAtAge(birth, acc.receiveAge) : undefined
  const receiveMode = isDc ? (acc.receiveMode ?? 'lump') : 'lump'
  const lumpShare = receiveMode === 'lump' ? 1 : receiveMode === 'annuity' ? 0 : Math.min(1, Math.max(0, acc.lumpShare ?? 0.5))
  // iDeCo / DC annuity: paid monthly from the receiving age over `annuityYears`
  const dcPayoutEnd = receiveT !== undefined && lumpShare < 1 ? receiveT + Math.min(20, Math.max(5, acc.annuityYears ?? 10)) * 12 - 1 : undefined
  const payoutStart = acc.kind === 'annuity' && acc.payoutStartAge !== undefined ? monthAtAge(birth, acc.payoutStartAge) : undefined
  const payoutEnd = payoutStart !== undefined ? payoutStart + (acc.payoutYears ?? 10) * 12 - 1 : undefined
  const deathT = ctx.deceasedId === acc.ownerId ? ctx.deathT : undefined
  let gainRatio = 0
  for (let t = ctx.startT; t <= ctx.endT; t++) {
    const rec: ContractualAccountMonth = {
      balance: 0,
      costBasis: 0,
      contribution: 0,
      ownContribution: 0,
      growth: 0,
      lumpSum: 0,
      annuityPayout: 0,
      pensionPayout: 0,
      deathPayout: 0,
      taxableGain: 0,
    }
    if (deathT !== undefined && t > deathT) {
      out.set(t, rec)
      continue
    }
    rec.growth = balance * monthlyRate(acc.annualReturn)
    balance += rec.growth
    const age = ageAt(birth, t)
    const contributing =
      (receiveT === undefined || t < receiveT) &&
      (payoutStart === undefined || t < payoutStart) &&
      (deathT === undefined || t < deathT) &&
      !(acc.kind !== 'annuity' && age >= 70)
    if (contributing) {
      for (const c of acc.contributions) {
        if (!inRange(t, c.from, c.to)) continue
        rec.contribution += c.monthly
        if (c.extraAnnual && monthOf(t) === (c.extraMonth ?? 12)) rec.contribution += c.extraAnnual
      }
      if (acc.kind !== 'dc') rec.ownContribution = rec.contribution
      // DC matching contribution: only while the employer contributes
      else if (rec.contribution > 0 && acc.matchingMonthly) {
        rec.ownContribution = acc.matchingMonthly
        rec.contribution += acc.matchingMonthly
      }
    }
    balance += rec.contribution
    basis += rec.contribution
    if (deathT !== undefined && t === deathT && balance > 0) {
      rec.deathPayout = balance
      balance = 0
      basis = 0
      rec.event = `${acc.label}の死亡一時金`
    } else if (receiveT !== undefined && t >= receiveT && (t === receiveT || (dcPayoutEnd !== undefined && t <= dcPayoutEnd)) && balance > 0) {
      if (t === receiveT && lumpShare > 0) {
        rec.lumpSum = balance * lumpShare
        balance -= rec.lumpSum
        rec.event = lumpShare < 1 ? `${acc.label}の一部を一時金で受け取り、残りは年金で受け取り開始` : `${acc.label}を一時金で受け取り`
      } else if (t === receiveT) {
        rec.event = `${acc.label}を年金で受け取り開始`
      }
      if (dcPayoutEnd !== undefined) {
        rec.pensionPayout = balance / (dcPayoutEnd - t + 1)
        balance -= rec.pensionPayout
      }
      basis = 0
    } else if (payoutStart !== undefined && payoutEnd !== undefined && t >= payoutStart && t <= payoutEnd && balance > 0) {
      if (t === payoutStart) {
        gainRatio = balance > 0 ? Math.max(0, 1 - basis / balance) : 0
        rec.event = `${acc.label}の受け取り開始`
      }
      rec.annuityPayout = balance / (payoutEnd - t + 1)
      rec.taxableGain = rec.annuityPayout * gainRatio
      balance -= rec.annuityPayout
      basis = Math.max(0, basis - rec.annuityPayout * (1 - gainRatio))
    }
    rec.balance = balance
    rec.costBasis = basis
    out.set(t, rec)
  }
  return out
}

interface Lump {
  memberId: string
  t: number
  gross: number
  kind: 'allowance' | 'dc'
  periodStart: number
  periodEnd: number
}

/**
 * Net amounts of retirement lump sums (退職金, iDeCo/DC lump sums) after retirement income tax,
 * including the adjustment of overlapping service periods between lump sums received in different years
 * (前年以前19年内 / 9年内 / 4年内の重複期間) and the combination of lump sums received in the same year.
 */
function retirementLumpNet(lumps: Lump[]): Map<Lump, number> {
  const net = new Map<Lump, number>()
  const byMember = new Map<string, Lump[]>()
  for (const l of lumps) byMember.set(l.memberId, [...(byMember.get(l.memberId) ?? []), l])
  for (const list of byMember.values()) {
    const byYear = new Map<number, Lump[]>()
    for (const l of list) byYear.set(yearOf(l.t), [...(byYear.get(yearOf(l.t)) ?? []), l])
    const years = [...byYear.keys()].sort((a, b) => a - b)
    for (const y of years) {
      const group = byYear.get(y)!
      const gross = group.reduce((s, l) => s + l.gross, 0)
      const longest = group.reduce((a, b) => (b.periodEnd - b.periodStart > a.periodEnd - a.periodStart ? b : a))
      let deduction = retirementIncomeDeduction((longest.periodEnd - longest.periodStart) / 12)
      for (const py of years) {
        if (py >= y) break
        for (const e of byYear.get(py)!) {
          for (const l of group) {
            if (y - py > retirementOverlapWindowYears(e.kind, l.kind)) continue
            const overlap = Math.min(e.periodEnd, l.periodEnd) - Math.max(e.periodStart, l.periodStart)
            if (overlap > 0) deduction -= retirementIncomeDeductionRaw(overlap / 12)
          }
        }
      }
      const tax = retirementIncomeTaxWithDeduction(gross, Math.max(0, deduction))
      const totalTax = tax.incomeTax + tax.residentTax
      for (const l of group) net.set(l, l.gross - (gross > 0 ? (totalTax * l.gross) / gross : 0))
    }
  }
  return net
}

export function simulate(plan: Plan): SimulationResult {
  const ctx = buildContext(plan)
  const s = plan.settings
  const warnings: string[] = []
  const pensionMult = s.pensionMultiplier ?? 1
  const expenseMult = s.expenseMultiplier ?? 1
  const death = ctx.deathT !== undefined ? plan.death : undefined
  const ratesAt = (t: number): SocialInsuranceRates => ({
    health: s.healthInsuranceRate,
    care: s.careInsuranceRate,
    pension: s.pensionInsuranceRate,
    employment: s.employmentInsuranceRate,
    childSupport: childSupportLevyEmployeeRate(yearOf(t), monthOf(t)),
  })
  const childBirths = ctx.children.map((c) => ctx.births.get(c.id)!)
  /** Children until the end of the school year they turn 18 (遺族基礎年金・加給年金の子). */
  const youngChildren = (t: number) => childBirths.filter((b) => b <= t && schoolAge(b, t) <= 17).length

  // ---------- housing ----------
  // a purchase planned after the death does not happen: the family keeps renting instead
  let purchase = plan.housing.purchase
  let rents = plan.housing.rents
  let purchaseCancelledAt: number | undefined
  if (death && purchase && ymToIndex(purchase.ym) > ctx.deathT!) {
    const pT = ymToIndex(purchase.ym)
    rents = rents.map((r) => (r.to !== undefined && ymToIndex(r.to) === pT - 1 ? { ...r, to: undefined } : r))
    purchase = undefined
    purchaseCancelledAt = pT
  }
  const purchaseT = purchase ? ymToIndex(purchase.ym) : undefined
  const loanRows = new Map<number, LoanMonth>()
  let dansinT: number | undefined
  if (purchase?.loan && purchaseT !== undefined) {
    for (const row of loanSchedule(purchase.loan, purchaseT, ctx.births.get(purchase.loan.borrowerId))) loanRows.set(row.t, row)
    if (death && purchase.loan.dansin !== false && purchase.loan.borrowerId === death.memberId && ctx.deathT! >= purchaseT) {
      dansinT = ctx.deathT
      for (const t of [...loanRows.keys()]) if (t >= dansinT!) loanRows.delete(t)
    }
  }
  const loanBalanceAt = (t: number): number => {
    if (!purchase?.loan || purchaseT === undefined || t < purchaseT) return 0
    if (dansinT !== undefined && t >= dansinT) return 0
    if (t === purchaseT) return purchase.loan.amount
    return loanRows.get(t)?.balance ?? 0
  }

  // ---------- contractual accounts ----------
  const contractual = new Map<string, Map<number, ContractualAccountMonth>>()
  for (const acc of plan.accounts) {
    if (acc.kind === 'ideco' || acc.kind === 'dc' || acc.kind === 'annuity') contractual.set(acc.id, simulateContractual(ctx, acc))
  }

  // ---------- retirement lump sums ----------
  const lumps: Lump[] = []
  const lumpLabel = new Map<Lump, string>()
  const deathAllowance = new Map<number, number>()
  for (const r of plan.retirementAllowances) {
    const t = ymToIndex(r.ym)
    if (t < ctx.startT || t > ctx.endT) continue
    const serviceStart = t - Math.round(r.yearsOfService * 12)
    if (!ctx.alive(r.memberId, t)) {
      // death before retirement: a death retirement allowance for the years served so far
      const served = Math.min(1, Math.max(0, (ctx.deathT! - serviceStart) / (t - serviceStart || 1)))
      deathAllowance.set(ctx.deathT!, (deathAllowance.get(ctx.deathT!) ?? 0) + r.amount * served)
      continue
    }
    const l: Lump = { memberId: r.memberId, t, gross: r.amount, kind: 'allowance', periodStart: serviceStart, periodEnd: t }
    lumps.push(l)
    lumpLabel.set(l, `${nameOf(plan, r.memberId)}: 退職金`)
  }
  const dcLumps = new Map<string, Lump>()
  for (const acc of plan.accounts) {
    const c = contractual.get(acc.id)
    if (!c || (acc.kind !== 'ideco' && acc.kind !== 'dc')) continue
    for (const [t, rec] of c) {
      if (rec.lumpSum <= 0) continue
      const l: Lump = { memberId: acc.ownerId, t, gross: rec.lumpSum, kind: 'dc', periodStart: acc.joined ? ymToIndex(acc.joined) : ctx.startT, periodEnd: t }
      lumps.push(l)
      dcLumps.set(`${acc.id}:${t}`, l)
    }
  }
  const lumpNet = retirementLumpNet(lumps)

  /** iDeCo / DC annuity payments of a member in month t. */
  const dcPensionAt = (memberId: string, t: number) => {
    let sum = 0
    for (const acc of plan.accounts) {
      if (acc.ownerId === memberId && (acc.kind === 'ideco' || acc.kind === 'dc')) sum += contractual.get(acc.id)?.get(t)?.pensionPayout ?? 0
    }
    return sum
  }
  /** Monthly contributions planned for an account in month t. */
  const plannedContribution = (acc: Account, t: number) => {
    let sum = 0
    for (const c of acc.contributions) {
      if (!inRange(t, c.from, c.to)) continue
      sum += c.monthly
      if (c.extraAnnual && monthOf(t) === (c.extraMonth ?? 12)) sum += c.extraAnnual
    }
    return sum
  }
  /** 持株会奨励金 for an employee stock account in month t (while the owner is employed with social insurance). */
  const incentiveOf = (acc: Account, t: number) => {
    if (acc.kind !== 'stock' || !acc.incentiveRate) return 0
    const w = workAt(plan, acc.ownerId, t)
    return w?.kind === 'employed' && w.socialInsurance !== false ? plannedContribution(acc, t) * acc.incentiveRate : 0
  }
  const incentiveAt = (memberId: string, t: number) => plan.accounts.reduce((sum, acc) => sum + (acc.ownerId === memberId ? incentiveOf(acc, t) : 0), 0)

  // ---------- pass 1: person income per month (from January of the start year) ----------
  const person = new Map<string, Map<number, PersonMonth>>()
  for (const m of ctx.adults) {
    const map = new Map<number, PersonMonth>()
    const birth = ctx.births.get(m.id)!
    for (let t = ctx.calcStartT; t <= ctx.endT; t++) {
      // months before the start are assumed to look like the start month (for annual tax)
      const tt = Math.max(t, ctx.startT)
      const pm: PersonMonth = {
        salary: 0,
        bonus: 0,
        benefit: 0,
        pension: 0,
        dcPension: dcPensionAt(m.id, tt),
        survivorPension: 0,
        socialInsurance: 0,
        employee: false,
        totalPayMonthly: 0,
        pensionBase: 0,
      }
      map.set(t, pm)
      if (!ctx.alive(m.id, tt)) continue
      const age = ageAt(birth, tt)
      const w = workAt(plan, m.id, tt)
      if (w?.kind === 'employed') {
        const sal = salaryAt(ctx, w, tt)
        // 持株会奨励金 is paid as part of the salary (taxed, counted for social insurance) and goes into the stock account
        pm.salary = sal.monthly + incentiveAt(m.id, tt)
        pm.bonus = monthOf(t) === 6 || monthOf(t) === 12 ? sal.bonus / 2 : 0
        pm.totalPayMonthly = sal.monthly + sal.bonus / 12
        if (w.socialInsurance !== false) {
          pm.employee = true
          const r = ratesAt(tt)
          pm.socialInsurance = employeeSocialInsuranceMonthly(pm.salary, age, r) + (pm.bonus > 0 ? employeeSocialInsuranceBonus(pm.bonus, age, r) : 0)
          pm.pensionBase = Math.min(pm.salary, STANDARD_MONTHLY_CAP) + (pm.bonus > 0 ? Math.min(pm.bonus, STANDARD_BONUS_CAP) : 0)
        }
        if (w.shortTimeBenefitTo && tt <= ymToIndex(w.shortTimeBenefitTo)) pm.benefit += Math.floor(pm.salary * 0.1)
      } else if (w?.kind === 'parentalLeave') {
        const base = leaveBaseSalary(ctx, w)
        const n = tt - ymToIndex(w.from) + 1
        // 出産手当金: 2/3 of the standard daily wage for 98 days (about 3 months)
        if (w.maternity && n <= 3) pm.benefit = Math.floor((Math.min(base, 1_390_000) * 2) / 3)
        else pm.benefit = parentalLeaveBenefit(base, w.maternity ? n - 3 : n, !!w.postBirthSupplement)
        // social insurance is exempt during leave, but the months count for the pension
        pm.employee = true
        pm.pensionBase = Math.min(base, STANDARD_MONTHLY_CAP)
      }
    }
    person.set(m.id, map)
  }

  // ---------- public pension ----------
  const pensionOf = (id: string) => plan.pensions.find((p) => p.memberId === id)
  /** Employees' pension record until `untilT` (exclusive): months and sum of standard remuneration in today's money. */
  const earningsRecord = (id: string, untilT: number) => {
    const p = pensionOf(id)
    const birth = ctx.births.get(id)!
    let months = 0
    let sum = 0
    if (p?.mode === 'auto') {
      const careerT = monthAtAge(birth, p.careerStartAge ?? 22)
      const available = Math.max(0, Math.min(ctx.startT, untilT) - careerT)
      const past = p.pastKoseiYears !== undefined ? Math.min(available, Math.round(p.pastKoseiYears * 12)) : available
      const avg = Math.min(p.pastAverageIncome ?? 0, STANDARD_MONTHLY_CAP * 12 + STANDARD_BONUS_CAP * 2) / 12
      months += past
      sum += past * avg
    }
    const map = person.get(id)!
    const end = Math.min(untilT, ctx.endT + 1, monthAtAge(birth, 70))
    for (let t = ctx.startT; t < end; t++) {
      const pm = map.get(t)
      if (!pm || pm.pensionBase <= 0) continue
      months++
      sum += pm.pensionBase / ctx.inflation(t)
    }
    return { months, sum }
  }
  /** Pension at 65 in today's money, before the sensitivity multiplier. */
  const rawPension = new Map<string, PensionEstimate>()
  for (const m of ctx.adults) {
    const p = pensionOf(m.id)
    if (!p) continue
    const basicFull = basicPension(p.basicMonths ?? 480)
    if (p.mode === 'auto') {
      const rec = earningsRecord(m.id, monthAtAge(ctx.births.get(m.id)!, 70))
      const earnings = rec.sum * EARNINGS_RATE
      rawPension.set(m.id, { basic: basicFull, earnings, koseiMonths: rec.months, total: basicFull + earnings })
    } else {
      const basic = Math.min(basicFull, p.annualAmountAt65)
      const earnings = Math.max(0, p.annualAmountAt65 - basic)
      // manual: treat an earnings-related part of 400,000+/year as 20+ years of coverage
      rawPension.set(m.id, { basic, earnings, koseiMonths: earnings >= 400_000 ? KAKYU_MIN_MONTHS : 0, total: basic + earnings })
    }
  }
  const pensions: Record<string, PensionEstimate> = {}
  for (const [id, e] of rawPension) {
    pensions[id] = { basic: e.basic * pensionMult, earnings: e.earnings * pensionMult, koseiMonths: e.koseiMonths, total: e.total * pensionMult }
  }

  // survivor's pension (death scenario)
  let survivor:
    | { id: string; deceasedEarnings: number; deceasedMonths: number; coveredAtDeath: boolean; ageAtDeath: number; kidsAtDeath: number }
    | undefined
  if (death) {
    const other = ctx.adults.find((a) => a.id !== death.memberId)
    if (other) {
      const dp = pensionOf(death.memberId)
      let deceasedEarnings = 0
      let deceasedMonths = 0
      if (dp?.mode === 'auto') {
        const rec = earningsRecord(death.memberId, ctx.deathT!)
        deceasedEarnings = rec.sum * EARNINGS_RATE
        deceasedMonths = rec.months
      } else if (dp) {
        deceasedEarnings = rawPension.get(death.memberId)?.earnings ?? 0
      }
      // covered by employees' pension right before the death (or at the start, if the death is at the start)
      const lastWork = workAt(plan, death.memberId, Math.max(ctx.deathT! - 1, ctx.startT))
      survivor = {
        id: other.id,
        deceasedEarnings,
        deceasedMonths,
        coveredAtDeath: !!lastWork && (lastWork.kind === 'parentalLeave' || lastWork.socialInsurance !== false),
        ageAtDeath: ageAt(ctx.births.get(other.id)!, ctx.deathT!),
        kidsAtDeath: youngChildren(ctx.deathT!),
      }
    }
  }

  for (const m of ctx.adults) {
    const p = pensionOf(m.id)
    const est = rawPension.get(m.id)
    const birth = ctx.births.get(m.id)!
    const startPT = p ? monthAtAge(birth, p.startAge) : Infinity
    const adj = p ? startAgeAdjustment(p.startAge) : 1
    const spouse = ctx.adults.find((a) => a.id !== m.id)
    const map = person.get(m.id)!
    for (let t = ctx.calcStartT; t <= ctx.endT; t++) {
      const tt = Math.max(t, ctx.startT)
      if (!ctx.alive(m.id, tt)) continue
      const pm = map.get(t)!
      const growth = Math.pow(1 + s.pensionGrowthRate, ctx.updates(ctx.startT, tt)) * pensionMult
      const age = ageAt(birth, tt)
      if (p && est && tt >= startPT) {
        const basicM = (est.basic * adj * growth) / 12
        const earningsM = (est.earnings * adj * growth) / 12
        const stopped = pm.employee ? workingPensionReduction(earningsM, pm.totalPayMonthly, workingPensionThreshold(yearOf(tt), monthOf(tt))) : 0
        pm.pension = basicM + earningsM - stopped
        // 加給年金: paid from 65 while the spouse is under 65 (and does not have 20+ years of employees' pension)
        if (p.spousalAddition !== false && est.koseiMonths >= KAKYU_MIN_MONTHS && age >= 65 && stopped < earningsM - 1e-6) {
          let add = childAdditions(youngChildren(tt))
          if (spouse && ctx.alive(spouse.id, tt)) {
            const spouseAge = ageAt(ctx.births.get(spouse.id)!, tt)
            const spouseKosei = rawPension.get(spouse.id)?.koseiMonths ?? 0
            if (spouseAge < 65 && spouseKosei < KAKYU_MIN_MONTHS) add += SPOUSE_ADDITION
          }
          pm.pension += (add * growth) / 12
        }
      }
      if (survivor && death && m.id === survivor.id && tt >= ctx.deathT!) {
        const kids = youngChildren(tt)
        let annual = kids > 0 ? BASIC_PENSION_FULL + childAdditions(kids) : 0
        const A = survivorEarningsPension(survivor.deceasedEarnings, survivor.deceasedMonths, survivor.coveredAtDeath)
        // husbands: only from 60 if 55+ at the death; otherwise only while there are young children
        const eligible = death.survivorIsWife || kids > 0 || (survivor.ageAtDeath >= 55 && age >= 60)
        if (eligible && A > 0) annual += age >= 65 ? survivorEarningsAfter65(A, est?.earnings ?? 0) : A
        if (death.survivorIsWife && kids === 0 && age >= 40 && age < 65 && (survivor.ageAtDeath >= 40 || survivor.kidsAtDeath > 0)) {
          annual += WIDOW_MIDDLE_AGE_ADDITION
        }
        pm.survivorPension = (annual * growth) / 12
      }
    }
  }

  const years: number[] = []
  for (let y = yearOf(ctx.calcStartT); y <= yearOf(ctx.endT); y++) years.push(y)

  const annualSum = (memberId: string, y: number, f: (p: PersonMonth) => number) => {
    const map = person.get(memberId)!
    let sum = 0
    for (let mth = 0; mth < 12; mth++) {
      const p = map.get(y * 12 + mth)
      if (p) sum += f(p)
    }
    return sum
  }

  const otherIncomeOf = (memberId: string, y: number) => {
    let sum = 0
    for (const acc of plan.accounts) {
      if (acc.ownerId !== memberId) continue
      const c = contractual.get(acc.id)
      if (!c) continue
      for (let mth = 0; mth < 12; mth++) sum += c.get(y * 12 + mth)?.taxableGain ?? 0
    }
    return sum
  }

  /** 小規模企業共済等掛金控除: iDeCo contributions and DC matching contributions. */
  const idecoContribOf = (memberId: string, y: number) => {
    let sum = 0
    for (const acc of plan.accounts) {
      if (acc.ownerId !== memberId || (acc.kind !== 'ideco' && acc.kind !== 'dc')) continue
      const c = contractual.get(acc.id)!
      for (let mth = 0; mth < 12; mth++) sum += c.get(Math.max(y * 12 + mth, ctx.startT))?.ownContribution ?? 0
    }
    return sum
  }

  const premiumsOf = (memberId: string, y: number): InsurancePremiums => {
    const p: InsurancePremiums = { general: 0, medical: 0, privatePension: 0, earthquake: 0 }
    for (let mth = 0; mth < 12; mth++) {
      const t = Math.max(y * 12 + mth, ctx.startT)
      for (const e of plan.expenses) {
        if (!e.insuranceDeduction || e.insuranceDeduction === 'none') continue
        if ((e.payerId ?? ctx.self.id) !== memberId) continue
        const amt = expenseAmount(ctx, e, t)
        if (e.insuranceDeduction === 'general') p.general += amt
        else if (e.insuranceDeduction === 'medical') p.medical += amt
        else if (e.insuranceDeduction === 'privatePension') p.privatePension += amt
        else p.earthquake += amt
      }
    }
    for (const acc of plan.accounts) {
      if (acc.kind !== 'annuity' || acc.ownerId !== memberId) continue
      const c = contractual.get(acc.id)!
      for (let mth = 0; mth < 12; mth++) p.privatePension += c.get(Math.max(y * 12 + mth, ctx.startT))?.contribution ?? 0
    }
    if (purchase && purchaseT !== undefined && memberId === (purchase.loan?.borrowerId ?? ctx.self.id) && y * 12 + 11 >= purchaseT) {
      p.earthquake += purchase.earthquakeInsuranceAnnual * ctx.inflation(y * 12 + 11)
    }
    return p
  }

  // national health insurance / pension for adults who are not employees nor dependents
  const grossIncome = (memberId: string, y: number) =>
    salaryIncome(annualSum(memberId, y, (p) => p.salary + p.bonus)) +
    pensionIncome(annualSum(memberId, y, (p) => p.pension + p.dcPension), ageAtYearEnd(ctx.births.get(memberId)!, y))

  /** Dependent under the spouse's employee insurance (年収130万円未満、60歳以上は180万円未満). */
  const isDependentOfEmployee = (memberId: string, t: number) => {
    const other = ctx.adults.find((a) => a.id !== memberId)
    if (!other || !ctx.alive(other.id, t)) return false
    const op = person.get(other.id)!.get(t)
    if (!op?.employee) return false
    const age = ageAt(ctx.births.get(memberId)!, t)
    const income = annualSum(memberId, yearOf(t), (p) => p.salary + p.bonus + p.pension + p.dcPension)
    return age < 75 && income < (age >= 60 ? 1_800_000 : 1_300_000)
  }

  for (const m of ctx.adults) {
    const map = person.get(m.id)!
    const birth = ctx.births.get(m.id)!
    for (let t = ctx.calcStartT; t <= ctx.endT; t++) {
      const tt = Math.max(t, ctx.startT)
      if (!ctx.alive(m.id, tt)) continue
      const pm = map.get(t)!
      const age = ageAt(birth, tt)
      if (age >= 65) pm.socialInsurance += CARE_PREMIUM_65_ANNUAL / 12
      if (pm.employee) continue
      if (age < 20 || isDependentOfEmployee(m.id, tt)) continue
      const prior = yearOf(t) - 1 >= yearOf(ctx.calcStartT) ? grossIncome(m.id, yearOf(t) - 1) : grossIncome(m.id, yearOf(t))
      pm.socialInsurance += nationalHealthInsuranceAnnual(prior, age) / 12 + (age < 60 ? NATIONAL_PENSION_MONTHLY : 0)
    }
  }

  // ---------- annual taxes ----------
  const taxes = new Map<string, Map<number, AnnualTaxResult>>()
  const totalIncome = (memberId: string, y: number) => grossIncome(memberId, y) + otherIncomeOf(memberId, y)
  const loanCreditFirstYear = purchaseT !== undefined ? yearOf(purchaseT) : undefined

  for (const y of years) {
    const incomes = new Map(ctx.adults.map((a) => [a.id, totalIncome(a.id, y)]))
    // the higher earner claims the spouse (if eligible) and the children
    const claimant = [...ctx.adults].sort((a, b) => incomes.get(b.id)! - incomes.get(a.id)!)[0]
    for (const m of ctx.adults) {
      const age = ageAtYearEnd(ctx.births.get(m.id)!, y)
      const other = ctx.adults.find((a) => a.id !== m.id)
      const isClaimant = m.id === claimant.id
      const dependentAges = isClaimant
        ? ctx.children
            .filter((c) => {
              const b = ctx.births.get(c.id)!
              return b <= y * 12 + 11 && stageOf(schoolAge(b, y * 12 + 11), c.education!) !== 'independent'
            })
            .map((c) => ageAtYearEnd(ctx.births.get(c.id)!, y))
        : []
      let loan: { yearEndBalance: number; limit: number } | undefined
      if (
        purchase?.loan &&
        purchase.loan.borrowerId === m.id &&
        loanCreditFirstYear !== undefined &&
        y >= loanCreditFirstYear &&
        y < loanCreditFirstYear + purchase.loanDeductionYears
      ) {
        loan = { yearEndBalance: loanBalanceAt(y * 12 + 11), limit: purchase.loanDeductionLimit }
      }
      const res = annualTax({
        age,
        salaryGross: annualSum(m.id, y, (p) => p.salary + p.bonus),
        pensionGross: annualSum(m.id, y, (p) => p.pension + p.dcPension),
        otherIncome: otherIncomeOf(m.id, y),
        socialInsurancePaid: annualSum(m.id, y, (p) => p.socialInsurance),
        smallBusinessMutualAid: idecoContribOf(m.id, y),
        premiums: premiumsOf(m.id, y),
        spouseIncome: isClaimant && other && ctx.alive(other.id, y * 12) ? incomes.get(other.id) : undefined,
        dependentAges,
        loan,
      })
      if (!taxes.has(m.id)) taxes.set(m.id, new Map())
      taxes.get(m.id)!.set(y, res)
    }
  }

  // ---------- pass 2: cash flow ----------
  const voluntary = plan.accounts.filter((a) => a.kind === 'nisa' || a.kind === 'taxable' || a.kind === 'stock')
  // NISA overflow goes to the owner's taxable account (created if missing)
  const overflowAccounts: Account[] = []
  for (const n of voluntary.filter((a) => a.kind === 'nisa')) {
    if (!voluntary.some((a) => a.kind === 'taxable' && a.ownerId === n.ownerId) && !overflowAccounts.some((a) => a.ownerId === n.ownerId)) {
      overflowAccounts.push({
        id: `${n.ownerId}-taxable-auto`,
        kind: 'taxable',
        ownerId: n.ownerId,
        label: `課税口座（NISA枠超過分・${plan.members.find((m) => m.id === n.ownerId)?.name ?? ''}）`,
        balance: 0,
        annualReturn: n.annualReturn,
        contributions: [],
        withdrawal: n.withdrawal,
      })
    }
  }
  const liquidAccounts = [...voluntary, ...overflowAccounts]
  const state = new Map(liquidAccounts.map((a) => [a.id, { balance: a.balance, costBasis: a.costBasis ?? a.balance }]))
  const nisaUsage = new Map<string, { year: number; yearUsed: number; lifetime: number; releasedNextYear: number }>()
  for (const a of liquidAccounts.filter((x) => x.kind === 'nisa')) {
    const u = nisaUsage.get(a.ownerId) ?? { year: yearOf(ctx.startT), yearUsed: 0, lifetime: 0, releasedNextYear: 0 }
    u.lifetime += a.costBasis ?? a.balance
    nisaUsage.set(a.ownerId, u)
  }
  const taxableFor = (ownerId: string) => liquidAccounts.find((a) => a.kind === 'taxable' && a.ownerId === ownerId)

  const sell = (acc: Account, gross: number): number => {
    const st = state.get(acc.id)!
    const amt = Math.min(gross, st.balance)
    if (amt <= 0) return 0
    const basisPart = st.balance > 0 ? (st.costBasis * amt) / st.balance : 0
    const gain = Math.max(0, amt - basisPart)
    const tax = acc.kind === 'nisa' ? 0 : gain * CAPITAL_GAINS_TAX_RATE
    st.balance -= amt
    st.costBasis -= basisPart
    if (acc.kind === 'nisa') nisaUsage.get(acc.ownerId)!.releasedNextYear += basisPart
    return amt - tax
  }
  /** Gross amount to sell so that `net` arrives after tax. */
  const grossForNet = (acc: Account, net: number) => {
    const st = state.get(acc.id)!
    if (acc.kind === 'nisa' || st.balance <= 0) return net
    const gainRatio = Math.max(0, 1 - st.costBasis / st.balance)
    return net / (1 - gainRatio * CAPITAL_GAINS_TAX_RATE)
  }

  // withholding and resident tax schedules
  const residentTaxFor = (memberId: string, incomeYear: number) => {
    const map = taxes.get(memberId)!
    const firstFull = yearOf(ctx.calcStartT)
    return map.get(Math.max(incomeYear, firstFull))?.residentTax ?? 0
  }
  const withheldFor = (memberId: string, t: number) => {
    const y = yearOf(t)
    const res = taxes.get(memberId)!.get(y)!
    const yearGross = annualSum(memberId, y, (p) => p.salary + p.bonus + p.pension + p.dcPension)
    if (yearGross <= 0) return 0
    const p = person.get(memberId)!.get(t)!
    return (res.incomeTaxWithheld * (p.salary + p.bonus + p.pension + p.dcPension)) / yearGross
  }
  /** Year-end adjustment (December, if employed) or tax return refund (next March). */
  const refundFor = (memberId: string, t: number) => {
    const y = yearOf(t)
    const map = taxes.get(memberId)!
    const employedInDec = (yy: number) => (person.get(memberId)!.get(yy * 12 + 11)?.salary ?? 0) > 0
    let refund = 0
    if (monthOf(t) === 12 && employedInDec(y)) {
      const r = map.get(y)!
      const firstLoanYear = y === loanCreditFirstYear
      refund += r.incomeTaxWithheld - r.incomeTax - (firstLoanYear ? r.loanCreditIncomeTax : 0)
    }
    if (monthOf(t) === 3 && map.has(y - 1)) {
      const r = map.get(y - 1)!
      if (!employedInDec(y - 1)) refund += r.incomeTaxWithheld - r.incomeTax
      else if (y - 1 === loanCreditFirstYear) refund += r.loanCreditIncomeTax
    }
    return refund
  }

  const rows: MonthRow[] = []
  let cash = s.cash
  const purchaseCash = purchase ? purchase.price - (purchase.loan?.amount ?? 0) + purchase.price * purchase.closingCostRate : 0
  const sweepAccount = s.cashCeiling && s.cashCeiling > 0 ? liquidAccounts.find((a) => a.id === s.sweepAccountId) : undefined

  for (let t = ctx.startT; t <= ctx.endT; t++) {
    const events: string[] = []
    const infl = ctx.inflation(t)
    const ages: Record<string, number> = {}
    for (const m of plan.members) ages[m.id] = ageAt(ctx.births.get(m.id)!, t)
    const afterDeath = ctx.deathT !== undefined && t >= ctx.deathT

    // NISA usage resets each January
    for (const u of nisaUsage.values()) {
      if (u.year !== yearOf(t)) {
        u.year = yearOf(t)
        u.yearUsed = 0
        u.lifetime -= u.releasedNextYear
        u.releasedNextYear = 0
      }
    }

    // ---- events ----
    for (const m of ctx.children) if (ctx.births.get(m.id) === t) events.push(`${m.name}誕生`)
    for (const w of plan.work) {
      if (ymToIndex(w.from) === t && t !== ctx.startT && ctx.alive(w.memberId, t)) events.push(`${nameOf(plan, w.memberId)}: ${w.label}`)
    }
    for (const p of plan.pensions) {
      if (monthAtAge(ctx.births.get(p.memberId)!, p.startAge) === t && ctx.alive(p.memberId, t)) events.push(`${nameOf(plan, p.memberId)}: 公的年金の受給開始`)
    }
    if (purchaseT === t) events.push('住宅購入')
    if (purchaseCancelledAt === t) events.push('住宅購入は取りやめ（賃貸を続ける）')
    if (ctx.deathT === t) events.push(`${nameOf(plan, ctx.deceasedId!)}が亡くなった場合`)
    if (dansinT === t) events.push('団信で住宅ローンが完済')
    for (const c of ctx.children) {
      const b = ctx.births.get(c.id)!
      if (b > t || monthOf(t) !== 4) continue
      const sa = schoolAge(b, t)
      const label = { 6: '小学校入学', 12: '中学校入学', 15: '高校入学', 18: '大学入学' }[sa]
      if (label && (sa !== 18 || c.education?.university !== 'none')) events.push(`${c.name}: ${label}`)
    }

    // ---- income ----
    const inc = { salary: 0, leaveBenefit: 0, pension: 0, childAllowance: 0, taxRefund: 0, retirement: 0, accountPayout: 0, other: 0, total: 0 }
    const ded = { socialInsurance: 0, incomeTax: 0, residentTax: 0, total: 0 }
    for (const m of ctx.adults) {
      const p = person.get(m.id)!.get(t)!
      inc.salary += p.salary + p.bonus
      inc.leaveBenefit += p.benefit
      inc.pension += p.pension + p.survivorPension
      inc.taxRefund += refundFor(m.id, t)
      ded.socialInsurance += p.socialInsurance
      ded.incomeTax += withheldFor(m.id, t)
      // resident tax for income of year Y is paid June Y+1 to May Y+2
      const incomeYear = monthOf(t) >= 6 ? yearOf(t) - 1 : yearOf(t) - 2
      ded.residentTax += residentTaxFor(m.id, incomeYear) / 12
    }
    inc.childAllowance = childAllowanceMonthly(childBirths, t)
    for (const l of lumps) {
      if (l.t !== t || l.kind !== 'allowance') continue
      inc.retirement += lumpNet.get(l) ?? 0
      events.push(lumpLabel.get(l)!)
    }
    if (deathAllowance.has(t)) {
      inc.retirement += deathAllowance.get(t)!
      events.push('死亡退職金')
    }
    if (death && t === ctx.deathT && death.lifeInsurance > 0) {
      inc.other += death.lifeInsurance
      events.push('死亡保険金')
    }
    for (const o of plan.oneOffs) {
      if (ymToIndex(o.ym) !== t) continue
      events.push(o.label)
      if (o.amount > 0) inc.other += o.amount * (o.inflate ? infl : 1)
    }

    // contractual accounts (iDeCo / DC / annuity)
    const accountStates: Record<string, AccountState> = {}
    let contractualContrib = 0
    for (const acc of plan.accounts) {
      const c = contractual.get(acc.id)?.get(t)
      if (!c) continue
      const lump = c.lumpSum > 0 ? dcLumps.get(`${acc.id}:${t}`) : undefined
      inc.accountPayout += c.annuityPayout + c.pensionPayout + c.deathPayout + (lump ? (lumpNet.get(lump) ?? 0) : 0)
      if (c.event) events.push(c.event)
      // corporate DC contributions are paid by the employer (only the matching contribution comes from the salary)
      contractualContrib += c.ownContribution
      accountStates[acc.id] = {
        balance: c.balance,
        costBasis: c.costBasis,
        contribution: c.contribution,
        growth: c.growth,
        withdrawal: c.lumpSum + c.annuityPayout + c.pensionPayout + c.deathPayout,
      }
    }

    inc.total = inc.salary + inc.leaveBenefit + inc.pension + inc.childAllowance + inc.taxRefund + inc.retirement + inc.accountPayout + inc.other
    ded.total = ded.socialInsurance + ded.incomeTax + ded.residentTax

    // ---- expenses ----
    const ex = { living: 0, allowance: 0, insurance: 0, special: 0, car: 0, care: 0, education: 0, childLiving: 0, housing: 0, other: 0, total: 0 }
    const livingFactor = expenseMult * (afterDeath ? death!.livingRatio : 1)
    for (const e of plan.expenses) {
      // insurance premiums paid by the deceased stop at the death
      if (afterDeath && e.category === 'insurance' && (e.payerId ?? ctx.self.id) === ctx.deceasedId) continue
      const amt = expenseAmount(ctx, e, t)
      if (amt) ex[e.category] += amt * (e.category === 'insurance' ? 1 : livingFactor)
    }
    for (const o of plan.oneOffs) if (ymToIndex(o.ym) === t && o.amount < 0) ex.other += -o.amount * (o.inflate ? infl : 1)
    const inChildcare = ctx.children
      .filter((c) => {
        const b = ctx.births.get(c.id)!
        if (b > t || !c.education) return false
        const sa = schoolAge(b, t)
        return sa >= 3 ? sa < 6 : c.education.daycare
      })
      .sort((a, b) => ctx.births.get(a.id)! - ctx.births.get(b.id)!)
    const dependents = ctx.children.filter((c) => {
      const b = ctx.births.get(c.id)!
      return b <= t && c.education && stageOf(schoolAge(b, t), c.education) !== 'independent'
    }).length
    for (const c of ctx.children) {
      const b = ctx.births.get(c.id)!
      if (b > t || !c.education) continue
      const sa = schoolAge(b, t)
      const eduCtx = { daycareOrder: inChildcare.indexOf(c) + 1 || 1, multiChild: dependents >= 3 }
      ex.education += educationMonthly(sa, monthOf(t), c.education, s, eduCtx) * infl
      ex.childLiving += childLivingMonthly(sa, c.education, s) * infl
    }
    // housing
    for (const r of rents) {
      if (!inRange(t, r.from, r.to)) continue
      ex.housing += r.monthlyRent
      const n = t - ymToIndex(r.from)
      if (n > 0 && n % 24 === 0) ex.housing += r.monthlyRent * r.renewalMonths
    }
    let loanBalance = 0
    if (purchase && purchaseT !== undefined && t >= purchaseT) {
      if (t === purchaseT) ex.housing += purchaseCash
      const lr = loanRows.get(t)
      if (lr) ex.housing += lr.payment + lr.prepayment
      loanBalance = loanBalanceAt(t)
      const yearsOwned = Math.floor((t - purchaseT) / 12)
      if (purchase.homeType === 'condo') {
        const raises = purchase.repairReserveRaiseYears > 0 ? Math.floor(yearsOwned / purchase.repairReserveRaiseYears) : 0
        ex.housing += purchase.managementFee * infl + purchase.repairReserve * Math.pow(1 + purchase.repairReserveRaiseRate, raises)
      }
      if ((t - purchaseT) % 12 === 0) {
        ex.housing += (purchase.fireInsuranceAnnual + purchase.earthquakeInsuranceAnnual) * infl
        if (t > purchaseT) {
          for (const r of purchase.repairs) if (r.everyYears > 0 && yearsOwned % r.everyYears === 0) ex.housing += r.amount * infl
        }
      }
      if (isPropertyTaxMonth(t)) {
        const fy = monthOf(t) >= 4 ? yearOf(t) : yearOf(t) - 1
        const yearSince = fy - yearOf(purchaseT)
        if (yearSince >= 1) ex.housing += propertyTaxAnnual(purchase, yearSince) / 4
      }
    }
    ex.total = ex.living + ex.allowance + ex.insurance + ex.special + ex.car + ex.care + ex.education + ex.childLiving + ex.housing + ex.other

    const net = inc.total - ded.total - ex.total
    cash += net - contractualContrib

    // ---- liquid accounts: growth, contributions, planned withdrawals ----
    for (const acc of liquidAccounts) {
      const st = state.get(acc.id)!
      const growth = st.balance * monthlyRate(acc.annualReturn)
      st.balance += growth
      accountStates[acc.id] = { balance: 0, costBasis: 0, contribution: 0, growth, withdrawal: 0 }
    }
    /** Invest into an account, respecting the NISA limits (excess goes to a taxable account). */
    const invest = (acc: Account, amount: number) => {
      let toAcc = amount
      if (acc.kind === 'nisa') {
        const u = nisaUsage.get(acc.ownerId)!
        toAcc = Math.max(0, Math.min(amount, NISA_ANNUAL_LIMIT - u.yearUsed, NISA_LIFETIME_LIMIT - u.lifetime))
        u.yearUsed += toAcc
        u.lifetime += toAcc
        const over = amount - toAcc
        const tx = taxableFor(acc.ownerId)
        if (over > 0 && tx) {
          const ts = state.get(tx.id)!
          ts.balance += over
          ts.costBasis += over
          accountStates[tx.id].contribution += over
        }
      }
      const st = state.get(acc.id)!
      st.balance += toAcc
      st.costBasis += toAcc
      accountStates[acc.id].contribution += toAcc
    }
    for (const acc of voluntary) {
      if (!ctx.alive(acc.ownerId, t)) continue
      // the 持株会奨励金 (paid with the salary) is invested together with the member's own contribution
      const want = plannedContribution(acc, t) + incentiveOf(acc, t)
      if (want <= 0 || cash - want < s.cashFloor) continue // pause saving while below the emergency fund
      invest(acc, want)
      cash -= want
    }
    for (const acc of liquidAccounts) {
      const wd = acc.withdrawal
      if (!wd || ageAt(ctx.births.get(acc.ownerId)!, t) < wd.startAge) continue
      const st = state.get(acc.id)!
      const gross = wd.mode === 'rate' ? (st.balance * wd.value) / 12 : wd.value * infl
      const before = st.balance
      cash += sell(acc, gross)
      accountStates[acc.id].withdrawal += before - st.balance
    }

    // ---- refill cash up to the floor ----
    let shortfall = false
    if (cash < s.cashFloor) {
      const order = [
        ...s.withdrawalOrder.map((id) => liquidAccounts.find((a) => a.id === id)).filter((a): a is Account => !!a),
        ...liquidAccounts.filter((a) => !s.withdrawalOrder.includes(a.id)),
      ]
      for (const acc of order) {
        if (cash >= s.cashFloor) break
        const st = state.get(acc.id)!
        if (st.balance <= 0) continue
        const before = st.balance
        cash += sell(acc, grossForNet(acc, s.cashFloor - cash))
        accountStates[acc.id].withdrawal += before - st.balance
      }
      if (cash < 0) shortfall = true
    }

    // ---- move surplus cash above the ceiling into the chosen account ----
    if (sweepAccount && cash > s.cashCeiling! && ctx.alive(sweepAccount.ownerId, t)) {
      const amount = cash - s.cashCeiling!
      invest(sweepAccount, amount)
      cash -= amount
    }

    for (const acc of liquidAccounts) {
      const st = state.get(acc.id)!
      accountStates[acc.id].balance = st.balance
      accountStates[acc.id].costBasis = st.costBasis
    }

    let liquid = cash
    let total = cash
    for (const acc of [...liquidAccounts, ...plan.accounts.filter((a) => contractual.has(a.id))]) {
      const b = accountStates[acc.id]?.balance ?? 0
      total += b
      if (state.has(acc.id)) liquid += b
    }

    rows.push({
      t,
      ym: indexToYm(t),
      ages,
      income: inc,
      deductions: ded,
      expenses: ex,
      net,
      accounts: accountStates,
      cash,
      loanBalance,
      liquidAssets: liquid,
      totalAssets: total,
      events,
      shortfall,
      inflationIndex: infl,
    })
  }

  if (purchaseT !== undefined && rents.some((r) => inRange(purchaseT + 1, r.from, r.to))) {
    warnings.push('住宅の購入後も家賃がかかる設定になっています。賃貸の終了月を確認してください。')
  }
  for (const a of overflowAccounts) {
    if (rows.some((r) => (r.accounts[a.id]?.contribution ?? 0) > 0)) warnings.push(`NISAの非課税枠を超えた積立を「${a.label}」に回しました。`)
  }
  return { rows, warnings, pensions }
}

function nameOf(plan: Plan, id: string) {
  return plan.members.find((m) => m.id === id)?.name ?? id
}

function expenseAmount(ctx: Context, e: Plan['expenses'][number], t: number): number {
  if (!inRange(t, e.from, e.to)) return 0
  if (e.frequency === 'annual' && monthOf(t) !== (e.month ?? 12)) return 0
  return e.amount * (e.inflate ? ctx.inflation(t) : 1)
}

/** All accounts including auto-created ones, for labeling results. */
export function accountLabels(plan: Plan, result: SimulationResult): Record<string, string> {
  const labels: Record<string, string> = {}
  for (const a of plan.accounts) labels[a.id] = a.label
  const first = result.rows[0]
  if (first) {
    for (const id of Object.keys(first.accounts)) {
      if (!labels[id]) {
        const owner = id.replace(/-taxable-auto$/, '')
        labels[id] = `課税口座（NISA枠超過分・${plan.members.find((m) => m.id === owner)?.name ?? ''}）`
      }
    }
  }
  return labels
}

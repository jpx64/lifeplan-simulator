import { childAllowanceMonthly, parentalLeaveBenefit } from './benefits'
import { childLivingMonthly, educationMonthly, stageOf } from './education'
import { isPropertyTaxMonth, loanSchedule, propertyTaxAnnual, type LoanMonth } from './housing'
import {
  CAPITAL_GAINS_TAX_RATE,
  NATIONAL_PENSION_MONTHLY,
  annualTax,
  employeeSocialInsuranceBonus,
  employeeSocialInsuranceMonthly,
  nationalHealthInsuranceAnnual,
  pensionIncome,
  retirementIncomeTax,
  salaryIncome,
  type AnnualTaxResult,
  type InsurancePremiums,
  type SocialInsuranceRates,
} from './tax'
import { ageAt, ageAtYearEnd, indexToYm, monthAtAge, monthOf, schoolAge, yearOf, ymToIndex } from './time'
import type { Account, AccountState, Member, MonthRow, Plan, SimulationResult, WorkPeriod } from './types'

export const NISA_ANNUAL_LIMIT = 3_600_000
export const NISA_LIFETIME_LIMIT = 18_000_000

const monthlyRate = (annual: number) => Math.pow(1 + annual, 1 / 12) - 1

interface PersonMonth {
  salary: number
  bonus: number
  leaveBenefit: number
  pension: number
  socialInsurance: number
  employed: boolean
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
    // count months m in (from, t] whose month is the update month
    let first = from + 1
    while (monthOf(first) !== s.annualUpdateMonth) first++
    return t < first ? 0 : Math.floor((t - first) / 12) + 1
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

function pensionMonthly(ctx: Context, memberId: string, t: number): number {
  const p = ctx.plan.pensions.find((x) => x.memberId === memberId)
  if (!p) return 0
  const birth = ctx.births.get(memberId)!
  const start = monthAtAge(birth, p.startAge)
  if (t < start) return 0
  const monthsShift = (p.startAge - 65) * 12
  const adj = monthsShift < 0 ? 1 + 0.004 * monthsShift : 1 + 0.007 * monthsShift
  const growth = Math.pow(1 + ctx.plan.settings.pensionGrowthRate, ctx.updates(ctx.startT, t))
  return (p.annualAmountAt65 * adj * growth) / 12
}

interface ContractualAccountMonth {
  balance: number
  costBasis: number
  contribution: number
  growth: number
  /** Gross amount paid out this month (lump sum or annuity payout). */
  payout: number
  /** Net amount after tax paid into cash. */
  payoutNet: number
  /** Taxable gain part of annuity payouts (miscellaneous income). */
  taxableGain: number
  event?: string
}

/** iDeCo, corporate DC and private annuity insurance do not depend on cash, so they are simulated up front. */
function simulateContractual(ctx: Context, acc: Account): Map<number, ContractualAccountMonth> {
  const out = new Map<number, ContractualAccountMonth>()
  const birth = ctx.births.get(acc.ownerId)!
  const r = monthlyRate(acc.annualReturn)
  let balance = acc.balance
  let basis = acc.costBasis ?? acc.balance
  const receiveT = acc.receiveAge !== undefined ? monthAtAge(birth, acc.receiveAge) : undefined
  const payoutStart = acc.payoutStartAge !== undefined ? monthAtAge(birth, acc.payoutStartAge) : undefined
  const payoutEnd = payoutStart !== undefined ? payoutStart + (acc.payoutYears ?? 10) * 12 - 1 : undefined
  let gainRatio = 0
  for (let t = ctx.startT; t <= ctx.endT; t++) {
    const growth = balance * r
    balance += growth
    let contribution = 0
    const age = ageAt(birth, t)
    const contributing =
      (receiveT === undefined || t < receiveT) &&
      (payoutStart === undefined || t < payoutStart) &&
      !(acc.kind !== 'annuity' && age >= 65)
    if (contributing) {
      for (const c of acc.contributions) {
        if (!inRange(t, c.from, c.to)) continue
        contribution += c.monthly
        if (c.extraAnnual && monthOf(t) === (c.extraMonth ?? 12)) contribution += c.extraAnnual
      }
    }
    balance += contribution
    basis += contribution
    let payout = 0
    let payoutNet = 0
    let taxableGain = 0
    let event: string | undefined
    if (receiveT !== undefined && t === receiveT && balance > 0) {
      payout = balance
      const joined = acc.joined ? ymToIndex(acc.joined) : ctx.startT
      const years = (t - joined) / 12
      const tax = retirementIncomeTax(payout, years)
      payoutNet = payout - tax.incomeTax - tax.residentTax
      balance = 0
      basis = 0
      event = `${acc.label}を一時金で受け取り`
    } else if (payoutStart !== undefined && payoutEnd !== undefined && t >= payoutStart && t <= payoutEnd && balance > 0) {
      if (t === payoutStart) {
        gainRatio = balance > 0 ? Math.max(0, 1 - basis / balance) : 0
        event = `${acc.label}の受け取り開始`
      }
      payout = balance / (payoutEnd - t + 1)
      taxableGain = payout * gainRatio
      payoutNet = payout
      balance -= payout
      basis = Math.max(0, basis - payout * (1 - gainRatio))
    }
    out.set(t, { balance, costBasis: basis, contribution, growth, payout, payoutNet, taxableGain, event })
  }
  return out
}

export function simulate(plan: Plan): SimulationResult {
  const ctx = buildContext(plan)
  const s = plan.settings
  const warnings: string[] = []
  const rates: SocialInsuranceRates = {
    health: s.healthInsuranceRate,
    care: s.careInsuranceRate,
    pension: s.pensionInsuranceRate,
    employment: s.employmentInsuranceRate,
  }

  // ---------- housing loan ----------
  const purchase = plan.housing.purchase
  const purchaseT = purchase ? ymToIndex(purchase.ym) : undefined
  const loanRows = new Map<number, LoanMonth>()
  if (purchase?.loan && purchaseT !== undefined) {
    for (const row of loanSchedule(purchase.loan, purchaseT, ctx.births.get(purchase.loan.borrowerId))) loanRows.set(row.t, row)
  }
  const loanBalanceAt = (t: number): number => {
    if (!purchase?.loan || purchaseT === undefined || t < purchaseT) return 0
    if (t === purchaseT) return purchase.loan.amount
    const row = loanRows.get(t)
    if (row) return row.balance
    return 0
  }

  // ---------- contractual accounts ----------
  const contractual = new Map<string, Map<number, ContractualAccountMonth>>()
  for (const acc of plan.accounts) {
    if (acc.kind === 'ideco' || acc.kind === 'dc' || acc.kind === 'annuity') contractual.set(acc.id, simulateContractual(ctx, acc))
  }

  // ---------- pass 1: person income per month (from January of the start year) ----------
  const person = new Map<string, Map<number, PersonMonth>>()
  for (const m of ctx.adults) {
    const map = new Map<number, PersonMonth>()
    const birth = ctx.births.get(m.id)!
    for (let t = ctx.calcStartT; t <= ctx.endT; t++) {
      // months before the start are assumed to look like the start month (for annual tax)
      const tt = Math.max(t, ctx.startT)
      const age = ageAt(birth, tt)
      const w = workAt(plan, m.id, tt)
      const pm: PersonMonth = { salary: 0, bonus: 0, leaveBenefit: 0, pension: 0, socialInsurance: 0, employed: false }
      if (w?.kind === 'employed') {
        const sal = salaryAt(ctx, w, tt)
        pm.salary = sal.monthly
        pm.bonus = monthOf(t) === 6 || monthOf(t) === 12 ? sal.bonus / 2 : 0
        pm.employed = true
        pm.socialInsurance =
          employeeSocialInsuranceMonthly(pm.salary, age, rates) + (pm.bonus > 0 ? employeeSocialInsuranceBonus(pm.bonus, age, rates) : 0)
      } else if (w?.kind === 'parentalLeave') {
        const n = tt - ymToIndex(w.from) + 1
        pm.leaveBenefit = parentalLeaveBenefit(leaveBaseSalary(ctx, w), n, !!w.postBirthSupplement)
        pm.employed = true // still employed; social insurance exempt
      }
      pm.pension = pensionMonthly(ctx, m.id, tt)
      map.set(t, pm)
    }
    person.set(m.id, map)
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

  const idecoContribOf = (memberId: string, y: number) => {
    let sum = 0
    for (const acc of plan.accounts) {
      if (acc.ownerId !== memberId || acc.kind !== 'ideco') continue
      const c = contractual.get(acc.id)!
      for (let mth = 0; mth < 12; mth++) {
        const t = y * 12 + mth
        // months before the start: assume the same contribution as the start month
        sum += c.get(Math.max(t, ctx.startT))?.contribution ?? 0
      }
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
    pensionIncome(annualSum(memberId, y, (p) => p.pension), ageAtYearEnd(ctx.births.get(memberId)!, y))

  const isDependentOfEmployee = (memberId: string, t: number) => {
    const other = ctx.adults.find((a) => a.id !== memberId)
    if (!other) return false
    const op = person.get(other.id)!.get(t)
    if (!op?.employed) return false
    const y = yearOf(t)
    const age = ageAt(ctx.births.get(memberId)!, t)
    const income = annualSum(memberId, y, (p) => p.salary + p.bonus + p.pension)
    return age < 75 && income < (age >= 60 ? 1_800_000 : 1_300_000)
  }

  for (const m of ctx.adults) {
    const map = person.get(m.id)!
    const birth = ctx.births.get(m.id)!
    for (let t = ctx.calcStartT; t <= ctx.endT; t++) {
      const pm = map.get(t)!
      if (pm.employed) continue
      const age = ageAt(birth, Math.max(t, ctx.startT))
      if (age < 20 || isDependentOfEmployee(m.id, Math.max(t, ctx.startT))) continue
      const prior = yearOf(t) - 1 >= yearOf(ctx.calcStartT) ? grossIncome(m.id, yearOf(t) - 1) : grossIncome(m.id, yearOf(t))
      pm.socialInsurance = nationalHealthInsuranceAnnual(prior) / 12 + (age < 60 ? NATIONAL_PENSION_MONTHLY : 0)
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
        pensionGross: annualSum(m.id, y, (p) => p.pension),
        otherIncome: otherIncomeOf(m.id, y),
        socialInsurancePaid: annualSum(m.id, y, (p) => p.socialInsurance),
        smallBusinessMutualAid: idecoContribOf(m.id, y),
        premiums: premiumsOf(m.id, y),
        spouseIncome: isClaimant && other ? incomes.get(other.id) : undefined,
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
  const taxableFor = (ownerId: string) =>
    liquidAccounts.find((a) => a.kind === 'taxable' && a.ownerId === ownerId)!

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
    const yearGross = annualSum(memberId, y, (p) => p.salary + p.bonus + p.pension)
    if (yearGross <= 0) return 0
    const p = person.get(memberId)!.get(t)!
    return (res.incomeTaxWithheld * (p.salary + p.bonus + p.pension)) / yearGross
  }
  /** Year-end adjustment (December, if employed) or tax return refund (next March). */
  const refundFor = (memberId: string, t: number) => {
    const y = yearOf(t)
    const map = taxes.get(memberId)!
    const employedInDec = (yy: number) => person.get(memberId)!.get(yy * 12 + 11)?.employed ?? false
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
  const childBirths = ctx.children.map((c) => ctx.births.get(c.id)!)
  const purchaseCash = purchase ? purchase.price - (purchase.loan?.amount ?? 0) + purchase.price * purchase.closingCostRate : 0

  for (let t = ctx.startT; t <= ctx.endT; t++) {
    const events: string[] = []
    const infl = ctx.inflation(t)
    const ages: Record<string, number> = {}
    for (const m of plan.members) ages[m.id] = ageAt(ctx.births.get(m.id)!, t)

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
    for (const w of plan.work) if (ymToIndex(w.from) === t && t !== ctx.startT) events.push(`${nameOf(plan, w.memberId)}: ${w.label}`)
    for (const p of plan.pensions) {
      if (monthAtAge(ctx.births.get(p.memberId)!, p.startAge) === t) events.push(`${nameOf(plan, p.memberId)}: 公的年金の受給開始`)
    }
    if (purchaseT === t) events.push('住宅購入')
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
      inc.leaveBenefit += p.leaveBenefit
      inc.pension += p.pension
      inc.taxRefund += refundFor(m.id, t)
      ded.socialInsurance += p.socialInsurance
      ded.incomeTax += withheldFor(m.id, t)
      // resident tax for income of year Y is paid June Y+1 to May Y+2
      const incomeYear = monthOf(t) >= 6 ? yearOf(t) - 1 : yearOf(t) - 2
      ded.residentTax += residentTaxFor(m.id, incomeYear) / 12
    }
    inc.childAllowance = childAllowanceMonthly(childBirths, t)
    for (const r of plan.retirementAllowances) {
      if (ymToIndex(r.ym) !== t) continue
      const tax = retirementIncomeTax(r.amount, r.yearsOfService)
      inc.retirement += r.amount - tax.incomeTax - tax.residentTax
      events.push(`${nameOf(plan, r.memberId)}: 退職金`)
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
      inc.accountPayout += c.payoutNet
      if (c.event) events.push(c.event)
      // corporate DC contributions are paid by the employer
      if (acc.kind !== 'dc') contractualContrib += c.contribution
      accountStates[acc.id] = { balance: c.balance, costBasis: c.costBasis, contribution: c.contribution, growth: c.growth, withdrawal: c.payout }
    }

    inc.total = inc.salary + inc.leaveBenefit + inc.pension + inc.childAllowance + inc.taxRefund + inc.retirement + inc.accountPayout + inc.other
    ded.total = ded.socialInsurance + ded.incomeTax + ded.residentTax

    // ---- expenses ----
    const ex = { living: 0, allowance: 0, insurance: 0, special: 0, car: 0, education: 0, childLiving: 0, housing: 0, other: 0, total: 0 }
    for (const e of plan.expenses) {
      const amt = expenseAmount(ctx, e, t)
      if (amt) ex[e.category] += amt
    }
    for (const o of plan.oneOffs) if (ymToIndex(o.ym) === t && o.amount < 0) ex.other += -o.amount * (o.inflate ? infl : 1)
    for (const c of ctx.children) {
      const b = ctx.births.get(c.id)!
      if (b > t || !c.education) continue
      const sa = schoolAge(b, t)
      ex.education += educationMonthly(sa, monthOf(t), c.education, s) * infl
      ex.childLiving += childLivingMonthly(sa, c.education, s) * infl
    }
    // housing
    for (const r of plan.housing.rents) {
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
    ex.total = ex.living + ex.allowance + ex.insurance + ex.special + ex.car + ex.education + ex.childLiving + ex.housing + ex.other

    const net = inc.total - ded.total - ex.total
    cash += net - contractualContrib

    // ---- liquid accounts: growth, contributions, planned withdrawals ----
    for (const acc of liquidAccounts) {
      const st = state.get(acc.id)!
      const growth = st.balance * monthlyRate(acc.annualReturn)
      st.balance += growth
      accountStates[acc.id] = { balance: 0, costBasis: 0, contribution: 0, growth, withdrawal: 0 }
    }
    for (const acc of voluntary) {
      let want = 0
      for (const c of acc.contributions) {
        if (!inRange(t, c.from, c.to)) continue
        want += c.monthly
        if (c.extraAnnual && monthOf(t) === (c.extraMonth ?? 12)) want += c.extraAnnual
      }
      if (want <= 0 || cash - want < s.cashFloor) continue // pause saving while below the emergency fund
      let toNisa = want
      if (acc.kind === 'nisa') {
        const u = nisaUsage.get(acc.ownerId)!
        toNisa = Math.max(0, Math.min(want, NISA_ANNUAL_LIMIT - u.yearUsed, NISA_LIFETIME_LIMIT - u.lifetime))
        u.yearUsed += toNisa
        u.lifetime += toNisa
        const over = want - toNisa
        if (over > 0) {
          const tx = taxableFor(acc.ownerId)
          const ts = state.get(tx.id)!
          ts.balance += over
          ts.costBasis += over
          accountStates[tx.id].contribution += over
        }
      }
      const st = state.get(acc.id)!
      st.balance += toNisa
      st.costBasis += toNisa
      accountStates[acc.id].contribution += toNisa
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
    })
  }

  if (purchaseT !== undefined && plan.housing.rents.some((r) => inRange(purchaseT, r.from, r.to))) {
    warnings.push('住宅の購入後も家賃がかかる設定になっています。賃貸の終了月を確認してください。')
  }
  const firstShort = rows.find((r) => r.shortfall)
  if (firstShort) warnings.push(`${firstShort.ym} に資金が不足します（預金がマイナスになり、取り崩せる資産も残っていません）。`)
  for (const a of overflowAccounts) {
    if (rows.some((r) => (r.accounts[a.id]?.contribution ?? 0) > 0)) warnings.push(`NISAの非課税枠を超えた積立を「${a.label}」に回しました。`)
  }
  return { rows, warnings }
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

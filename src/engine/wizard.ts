import { DEFAULT_EDUCATION, defaultPurchase, defaultSettings } from './defaults'
import { ageAt, indexToYm, monthAtAge, monthOf, ymToIndex, type YM } from './time'
import type { Account, EducationPlan, Expense, OneOff, Plan, WorkPeriod } from './types'

export type WorkStyle = 'employee' | 'parttime' | 'none'

export interface WizardAdult {
  name: string
  birth: YM
  /** Kept for plans saved before `workStyle` existed. */
  working: boolean
  /** 会社員 (employee) / パート・アルバイト / 働いていない. */
  workStyle?: WorkStyle
  /** Part-time: gross annual income and whether the employer's social insurance applies. */
  partTimeIncome?: number
  partTimeSocialInsurance?: boolean
  /** Gives birth to the children born after the start: maternity leave and 出産手当金. */
  givesBirth?: boolean
  /** After childcare leave: return to work (時短 → full time) or quit and later work part-time. */
  afterLeave?: 'return' | 'quit'
  /** quit: child age at which part-time work starts (0 = do not work again). */
  returnChildAge?: number
  /** quit: part-time gross annual income after returning. */
  returnIncome?: number
  /** Public pension: estimate automatically from the salary history, or use the ねんきん定期便 amount. */
  pensionMode?: 'auto' | 'manual'
  careerStartAge?: number
  /** Average gross annual income so far (today's money). */
  pastAverageIncome?: number
  /** Not an employee now: years worked as an employee (厚生年金) so far. */
  pastKoseiYears?: number
  /** Gross annual income (額面年収) including bonus. */
  annualIncome: number
  /** Share of the annual income paid as bonus. */
  bonusShare: number
  raiseRate: number
  retireAge: number
  reemploy: boolean
  /** Gross annual income after retirement age (nominal). */
  reemployIncome: number
  reemployUntilAge: number
  retirementAllowance: number
  pensionAt65: number
  pensionStartAge: number
  /** Months of childcare leave for each child born after the start. */
  leaveMonths: number
  /** Short working hours after leave: salary ratio (1 = none) and until which child age. */
  shortTimeRatio: number
  shortTimeUntilChildAge: number
  nisaBalance: number
  nisaCostBasis: number
  nisaMonthly: number
  idecoBalance: number
  idecoMonthly: number
  idecoJoined: YM
  dcBalance: number
  dcMonthly: number
  dcJoined: YM
}

export interface WizardChild {
  name: string
  birth: YM
  education: EducationPlan
}

export type LoanDeductionPerformance = 'longLife' | 'zeh' | 'energy' | 'other'

export interface WizardInput {
  start: YM
  endAge: number
  self: WizardAdult
  hasSpouse: boolean
  spouse: WizardAdult
  children: WizardChild[]
  housing: {
    mode: 'rent' | 'buy'
    rent: number
    buyYM: YM
    price: number
    homeType: 'house' | 'condo'
    isNew: boolean
    performance: LoanDeductionPerformance
    childRearing: boolean
    downPayment: number
    loanYears: number
    initialRate: number
    /** Rate increase every 5 years (variable rate scenario). */
    rateRiseEvery5y: number
    /** Pay off the remaining loan at this self age (0 = no). */
    payoffAge: number
    condoFees: number
    /** Variable rate: 5-year rule and 125% rule. */
    fiveYearRule?: boolean
  }
  cash: number
  taxableBalance: number
  taxableCostBasis: number
  /** Monthly living costs (food, utilities, transport, medical, etc.). */
  living: number
  allowanceSelf: number
  allowanceSpouse: number
  lifeInsurance: number
  medicalInsurance: number
  specialAnnual: number
  carMonthly: number
  carReplaceYears: number
  carPrice: number
  carUntilAge: number
  /** Living costs after the self retirement age, as a share of before. */
  retirementLivingRatio: number
  cashFloor: number
  /** needed: sell investments only when cash drops below the floor. rate: withdraw a fixed share every year. */
  withdrawMode?: 'needed' | 'rate'
  withdrawStartAge: number
  withdrawRate: number
  /** Move cash above `cashCeiling` into NISA every month. */
  sweep?: boolean
  cashCeiling?: number
  investReturn: number
  inflationRate: number
}

function adult(name: string, birth: YM, start: YM): WizardAdult {
  return {
    name,
    birth,
    working: true,
    workStyle: 'employee',
    partTimeIncome: 1_000_000,
    partTimeSocialInsurance: false,
    givesBirth: false,
    afterLeave: 'return',
    returnChildAge: 6,
    returnIncome: 1_000_000,
    pensionMode: 'auto',
    careerStartAge: 22,
    pastAverageIncome: 4_000_000,
    pastKoseiYears: 8,
    annualIncome: 5_000_000,
    bonusShare: 0.2,
    raiseRate: 0.01,
    retireAge: 60,
    reemploy: true,
    reemployIncome: 3_500_000,
    reemployUntilAge: 65,
    retirementAllowance: 10_000_000,
    pensionAt65: 1_500_000,
    pensionStartAge: 65,
    leaveMonths: 0,
    shortTimeRatio: 1,
    shortTimeUntilChildAge: 3,
    nisaBalance: 0,
    nisaCostBasis: 0,
    nisaMonthly: 30_000,
    idecoBalance: 0,
    idecoMonthly: 0,
    idecoJoined: start,
    dcBalance: 0,
    dcMonthly: 0,
    dcJoined: start,
  }
}

export function defaultWizard(start: YM): WizardInput {
  const y = Number(start.slice(0, 4))
  return {
    start,
    endAge: 100,
    self: adult('本人', `${y - 35}-04`, start),
    hasSpouse: true,
    spouse: {
      ...adult('配偶者', `${y - 33}-07`, start),
      annualIncome: 4_000_000,
      pastAverageIncome: 3_500_000,
      givesBirth: true,
      leaveMonths: 12,
      shortTimeRatio: 0.8,
      shortTimeUntilChildAge: 3,
    },
    children: [{ name: '子1', birth: indexToYm(ymToIndex(start) + 6), education: { ...DEFAULT_EDUCATION } }],
    housing: {
      mode: 'rent',
      rent: 120_000,
      buyYM: `${y + 2}-04`,
      price: 50_000_000,
      homeType: 'house',
      isNew: true,
      performance: 'zeh',
      childRearing: true,
      downPayment: 5_000_000,
      loanYears: 35,
      initialRate: 0.01,
      rateRiseEvery5y: 0.0025,
      payoffAge: 0,
      condoFees: 30_000,
      fiveYearRule: false,
    },
    cash: 3_000_000,
    taxableBalance: 0,
    taxableCostBasis: 0,
    living: 150_000,
    allowanceSelf: 30_000,
    allowanceSpouse: 30_000,
    lifeInsurance: 5_000,
    medicalInsurance: 5_000,
    specialAnnual: 400_000,
    carMonthly: 20_000,
    carReplaceYears: 10,
    carPrice: 3_000_000,
    carUntilAge: 75,
    retirementLivingRatio: 0.8,
    cashFloor: 2_000_000,
    withdrawMode: 'needed',
    withdrawStartAge: 65,
    withdrawRate: 0.04,
    sweep: false,
    cashCeiling: 10_000_000,
    investReturn: 0.04,
    inflationRate: 0.0125,
  }
}

/** Fill in fields added after a plan was saved, so older wizard answers keep working. */
export function normalizeWizard(w: WizardInput): WizardInput {
  const d = defaultWizard(w.start)
  const fix = (a: WizardAdult, da: WizardAdult): WizardAdult => ({
    ...da,
    ...a,
    workStyle: a.workStyle ?? (a.working ? 'employee' : 'none'),
    // plans saved before pensions were estimated automatically used the manual amount
    pensionMode: a.pensionMode ?? 'manual',
  })
  return { ...d, ...w, self: fix(w.self, d.self), spouse: fix(w.spouse, d.spouse), housing: { ...d.housing, ...w.housing } }
}

/** Limits of the housing loan deduction (move-in 2024-2025, new homes). */
export function loanDeductionLimit(perf: LoanDeductionPerformance, isNew: boolean, childRearing: boolean): number {
  if (!isNew) return perf === 'other' ? 20_000_000 : 30_000_000
  const table = childRearing
    ? { longLife: 50_000_000, zeh: 45_000_000, energy: 40_000_000, other: 0 }
    : { longLife: 45_000_000, zeh: 35_000_000, energy: 30_000_000, other: 0 }
  return table[perf]
}

/** Number of January updates in (startT, t]. */
function updatesBetween(startT: number, t: number) {
  let n = 0
  for (let m = startT + 1; m <= t; m++) if (monthOf(m) === 1) n++
  return n
}

type WorkState = { kind: 'employed' | 'parentalLeave' | 'none' | 'parttime'; ratio: number; label: string; maternity?: boolean }

function workPeriods(id: string, a: WizardAdult, startT: number, childBirths: number[]): WorkPeriod[] {
  const style = a.workStyle ?? (a.working ? 'employee' : 'none')
  if (style === 'none') return []
  const birth = ymToIndex(a.birth)
  const retireT = monthAtAge(birth, a.retireAge)
  const partTime = (from: number, to: number, income: number, insured: boolean, label: string): WorkPeriod => ({
    id: `${id}-p${from}`,
    memberId: id,
    label,
    kind: 'employed',
    from: indexToYm(from),
    to: indexToYm(to),
    monthlySalary: income / 12,
    annualBonus: 0,
    raiseRate: 0,
    socialInsurance: insured,
  })
  if (style === 'parttime') {
    return retireT > startT ? [partTime(startT, retireT - 1, a.partTimeIncome ?? 1_000_000, !!a.partTimeSocialInsurance, 'パート・アルバイト')] : []
  }

  const futureBirths = childBirths.filter((b) => b >= startT).sort((x, y) => x - y)
  const quitBirth = a.afterLeave === 'quit' ? futureBirths[0] : undefined
  const leaveStart = (b: number) => (a.givesBirth ? b - 1 : b)
  // with a birth, the leave covers at least the postnatal 8 weeks
  const leaveEnd = (b: number) => b + Math.max(a.leaveMonths, a.givesBirth ? 2 : 0) - 1
  const stateAt = (t: number): WorkState => {
    if (quitBirth !== undefined && t >= leaveStart(quitBirth)) {
      // maternity leave (出産手当金) only, then out of work
      if (a.givesBirth && t <= quitBirth + 1) return { kind: 'parentalLeave', ratio: 0, label: '産休', maternity: true }
      return { kind: 'none', ratio: 0, label: '退職' }
    }
    for (const b of futureBirths) {
      if ((a.leaveMonths > 0 || a.givesBirth) && t >= leaveStart(b) && t <= leaveEnd(b)) {
        return { kind: 'parentalLeave', ratio: 0, label: a.givesBirth ? '産休・育休' : '育休', maternity: !!a.givesBirth }
      }
    }
    for (const b of futureBirths) {
      if (a.shortTimeRatio < 1 && t > leaveEnd(b) && ageAt(b, t) < a.shortTimeUntilChildAge) return { kind: 'employed', ratio: a.shortTimeRatio, label: '時短勤務' }
    }
    return { kind: 'employed', ratio: 1, label: '会社員' }
  }
  const out: WorkPeriod[] = []
  let segStart = startT
  let cur = stateAt(startT)
  const push = (from: number, to: number, st: WorkState) => {
    if (st.kind === 'none') return
    const g = Math.pow(1 + a.raiseRate, updatesBetween(startT, from))
    // 育児時短就業給付: while the child is under 2
    const child = futureBirths.filter((b) => b <= from).at(-1)
    const benefitTo = st.label === '時短勤務' && child !== undefined && child + 23 >= from ? indexToYm(Math.min(to, child + 23)) : undefined
    out.push({
      id: `${id}-w${out.length}`,
      memberId: id,
      label: out.length > 0 && st.label === '会社員' ? '通常勤務に戻る' : st.label,
      kind: st.kind === 'parttime' ? 'employed' : st.kind,
      from: indexToYm(from),
      to: indexToYm(to),
      monthlySalary: ((a.annualIncome * (1 - a.bonusShare)) / 12) * g * st.ratio,
      annualBonus: a.annualIncome * a.bonusShare * g * st.ratio,
      raiseRate: a.raiseRate,
      postBirthSupplement: st.kind === 'parentalLeave',
      maternity: st.maternity,
      shortTimeBenefitTo: benefitTo,
    })
  }
  for (let t = startT + 1; t < retireT; t++) {
    const st = stateAt(t)
    if (st.kind !== cur.kind || st.ratio !== cur.ratio || st.label !== cur.label) {
      push(segStart, t - 1, cur)
      segStart = t
      cur = st
    }
  }
  if (retireT > startT) push(segStart, retireT - 1, cur)

  if (quitBirth !== undefined) {
    // part-time work after quitting
    if ((a.returnChildAge ?? 0) > 0) {
      const from = Math.max(startT, quitBirth + (a.returnChildAge ?? 6) * 12)
      if (from < retireT) out.push(partTime(from, retireT - 1, a.returnIncome ?? 1_000_000, false, 'パートで再就職'))
    }
    return out
  }
  if (a.reemploy && a.reemployUntilAge > a.retireAge) {
    out.push({
      id: `${id}-re`,
      memberId: id,
      label: '再雇用',
      kind: 'employed',
      from: indexToYm(Math.max(retireT, startT)),
      to: indexToYm(monthAtAge(birth, a.reemployUntilAge) - 1),
      monthlySalary: a.reemployIncome / 12,
      annualBonus: 0,
      raiseRate: 0,
    })
  }
  return out
}

function accountsFor(id: string, a: WizardAdult, w: WizardInput): Account[] {
  const start = w.start
  const birth = ymToIndex(a.birth)
  const until = indexToYm(monthAtAge(birth, Math.min(65, a.reemploy ? a.reemployUntilAge : a.retireAge)) - 1)
  const accs: Account[] = [
    {
      id: `${id}-nisa`,
      kind: 'nisa',
      ownerId: id,
      label: `${a.name} NISA`,
      balance: a.nisaBalance,
      costBasis: a.nisaCostBasis || a.nisaBalance,
      annualReturn: w.investReturn,
      contributions: a.nisaMonthly > 0 ? [{ from: start, to: until, monthly: a.nisaMonthly }] : [],
      withdrawal: w.withdrawMode === 'rate' ? { startAge: w.withdrawStartAge, mode: 'rate', value: w.withdrawRate } : undefined,
    },
  ]
  if (a.idecoBalance > 0 || a.idecoMonthly > 0) {
    accs.push({
      id: `${id}-ideco`,
      kind: 'ideco',
      ownerId: id,
      label: `${a.name} iDeCo`,
      balance: a.idecoBalance,
      annualReturn: w.investReturn,
      joined: a.idecoJoined,
      receiveAge: 65,
      contributions: a.idecoMonthly > 0 ? [{ from: start, to: until, monthly: a.idecoMonthly }] : [],
    })
  }
  if (a.dcBalance > 0 || a.dcMonthly > 0) {
    accs.push({
      id: `${id}-dc`,
      kind: 'dc',
      ownerId: id,
      label: `${a.name} 企業型DC`,
      balance: a.dcBalance,
      annualReturn: w.investReturn,
      joined: a.dcJoined,
      receiveAge: Math.max(60, a.retireAge),
      contributions: a.dcMonthly > 0 && a.working ? [{ from: start, to: indexToYm(monthAtAge(birth, a.retireAge) - 1), monthly: a.dcMonthly }] : [],
    })
  }
  return accs
}

/** Rent and purchase from the housing answers (rent until the purchase, or for good). */
export function buildHousing(h: WizardInput['housing'], start: YM): Plan['housing'] {
  const startT = ymToIndex(start)
  const buyT = ymToIndex(h.buyYM)
  const housing: Plan['housing'] = { rents: [] }
  if (h.mode === 'rent' || buyT > startT) {
    housing.rents.push({ id: 'rent', label: '賃貸', from: start, to: h.mode === 'buy' ? indexToYm(buyT - 1) : undefined, monthlyRent: h.rent, renewalMonths: 1 })
  }
  if (h.mode === 'buy') {
    const p = defaultPurchase(h.buyYM, 'self')
    const loanAmount = Math.max(0, h.price - h.downPayment)
    housing.purchase = {
      ...p,
      price: h.price,
      homeType: h.homeType,
      landShare: h.homeType === 'condo' ? 0.2 : 0.5,
      wooden: h.homeType === 'house',
      isNew: h.isNew,
      longLife: h.performance === 'longLife',
      managementFee: h.homeType === 'condo' ? h.condoFees * 0.45 : 0,
      repairReserve: h.homeType === 'condo' ? h.condoFees * 0.55 : 0,
      repairs: h.homeType === 'condo' ? [{ label: '室内リフォーム', everyYears: 20, amount: 2_000_000 }] : p.repairs,
      loanDeductionLimit: loanDeductionLimit(h.performance, h.isNew, h.childRearing),
      loanDeductionYears: h.isNew ? 13 : 10,
      loan:
        loanAmount > 0
          ? {
              amount: loanAmount,
              years: h.loanYears,
              rates: [0, 1, 2, 3].map((k) => ({ fromYear: 1 + k * 5, rate: h.initialRate + k * h.rateRiseEvery5y })),
              prepayments: [],
              payoffAge: h.payoffAge > 0 ? h.payoffAge : undefined,
              fiveYearRule: !!h.fiveYearRule && h.rateRiseEvery5y > 0,
              borrowerId: 'self',
            }
          : undefined,
    }
  }
  return housing
}

export function buildPlan(input: WizardInput, id = 'plan', name = 'わが家のプラン'): Plan {
  const w = normalizeWizard(input)
  const startT = ymToIndex(w.start)
  const selfBirth = ymToIndex(w.self.birth)
  const childBirths = w.children.map((c) => ymToIndex(c.birth))
  const adults: [string, WizardAdult][] = [['self', w.self]]
  if (w.hasSpouse) adults.push(['spouse', w.spouse])
  /** Quits work at the first child born after the start. */
  const quits = (a: WizardAdult) => a.workStyle === 'employee' && a.afterLeave === 'quit' && childBirths.some((b) => b >= startT)

  const members: Plan['members'] = [
    { id: 'self', name: w.self.name, role: 'self', birth: w.self.birth },
    ...(w.hasSpouse ? [{ id: 'spouse', name: w.spouse.name, role: 'spouse' as const, birth: w.spouse.birth }] : []),
    ...w.children.map((c, i) => ({ id: `child${i + 1}`, name: c.name, role: 'child' as const, birth: c.birth, education: c.education })),
  ]

  const work = adults.flatMap(([id, a]) => workPeriods(id, a, startT, childBirths))
  const retireT = monthAtAge(selfBirth, w.self.retireAge)
  const retireYM = indexToYm(retireT)
  const beforeRetire = indexToYm(retireT - 1)

  const expenses: Expense[] = []
  const add = (e: Omit<Expense, 'id'>) => expenses.push({ ...e, id: `e${expenses.length + 1}` })
  if (w.retirementLivingRatio !== 1 && retireT > startT) {
    add({ label: '生活費', category: 'living', frequency: 'monthly', amount: w.living, inflate: true, to: beforeRetire })
    add({ label: '生活費（退職後）', category: 'living', frequency: 'monthly', amount: w.living * w.retirementLivingRatio, inflate: true, from: retireYM })
  } else {
    add({ label: '生活費', category: 'living', frequency: 'monthly', amount: w.living, inflate: true })
  }
  if (w.allowanceSelf) add({ label: `${w.self.name} 小遣い`, category: 'allowance', frequency: 'monthly', amount: w.allowanceSelf, inflate: true })
  if (w.hasSpouse && w.allowanceSpouse)
    add({ label: `${w.spouse.name} 小遣い`, category: 'allowance', frequency: 'monthly', amount: w.allowanceSpouse, inflate: true })
  if (w.lifeInsurance)
    add({
      label: '生命保険（死亡保障）',
      category: 'insurance',
      frequency: 'monthly',
      amount: w.lifeInsurance,
      inflate: false,
      insuranceDeduction: 'general',
      to: indexToYm(monthAtAge(selfBirth, 65) - 1),
    })
  if (w.medicalInsurance)
    add({ label: '医療保険', category: 'insurance', frequency: 'monthly', amount: w.medicalInsurance, inflate: false, insuranceDeduction: 'medical' })
  if (w.specialAnnual) add({ label: '特別費（旅行・家電など）', category: 'special', frequency: 'annual', month: 8, amount: w.specialAnnual, inflate: true })
  const carEnd = monthAtAge(selfBirth, w.carUntilAge) - 1
  if (w.carMonthly) add({ label: '車の維持費', category: 'car', frequency: 'monthly', amount: w.carMonthly, inflate: true, to: indexToYm(carEnd) })

  const oneOffs: OneOff[] = []
  if (w.carPrice > 0 && w.carReplaceYears > 0) {
    for (let t = startT + w.carReplaceYears * 12; t <= carEnd; t += w.carReplaceYears * 12) {
      oneOffs.push({ id: `car${oneOffs.length}`, label: '車の買い替え', ym: indexToYm(t), amount: -w.carPrice, inflate: true })
    }
  }

  const housing = buildHousing(w.housing, w.start)

  const accounts: Account[] = adults.flatMap(([id, a]) => accountsFor(id, a, w))
  if (w.taxableBalance > 0) {
    accounts.unshift({
      id: 'self-taxable',
      kind: 'taxable',
      ownerId: 'self',
      label: `${w.self.name} 特定口座`,
      balance: w.taxableBalance,
      costBasis: w.taxableCostBasis || w.taxableBalance,
      annualReturn: w.investReturn,
      contributions: [],
      withdrawal: w.withdrawMode === 'rate' ? { startAge: w.withdrawStartAge, mode: 'rate', value: w.withdrawRate } : undefined,
    })
  }

  const settings = {
    ...defaultSettings(w.start),
    endAge: w.endAge,
    cash: w.cash,
    cashFloor: w.cashFloor,
    inflationRate: w.inflationRate,
    cashCeiling: w.sweep ? w.cashCeiling : undefined,
    sweepAccountId: w.sweep ? 'self-nisa' : undefined,
    withdrawalOrder: accounts.filter((a) => a.kind === 'taxable').map((a) => a.id).concat(accounts.filter((a) => a.kind === 'nisa').map((a) => a.id)),
  }

  return {
    id,
    name,
    settings,
    members,
    work,
    pensions: adults.map(([mid, a]) => ({
      memberId: mid,
      startAge: a.pensionStartAge,
      mode: a.pensionMode ?? 'auto',
      annualAmountAt65: a.pensionAt65,
      careerStartAge: a.careerStartAge ?? 22,
      pastAverageIncome: a.pastAverageIncome ?? 0,
      pastKoseiYears: a.workStyle === 'employee' ? undefined : (a.pastKoseiYears ?? 0),
    })),
    retirementAllowances: adults
      .filter(([, a]) => a.workStyle === 'employee' && !quits(a) && a.retirementAllowance > 0)
      .map(([mid, a]) => ({
        id: `ra-${mid}`,
        memberId: mid,
        ym: indexToYm(monthAtAge(ymToIndex(a.birth), a.retireAge) - 1),
        amount: a.retirementAllowance,
        yearsOfService: Math.max(1, a.retireAge - 22),
      })),
    expenses,
    oneOffs,
    housing,
    accounts,
    wizard: w,
    retirementAge: w.self.retireAge,
  }
}

import type { YM } from './time'

export type MemberRole = 'self' | 'spouse' | 'child'

export interface Member {
  id: string
  name: string
  role: MemberRole
  birth: YM
  /** Children only: education path used for default costs. */
  education?: EducationPlan
}

export type SchoolType = 'public' | 'private'
export type UniversityType = 'none' | 'national' | 'privateArts' | 'privateScience'

export interface EducationPlan {
  /** Uses daycare from age 0-2 (otherwise cared for at home). */
  daycare: boolean
  kindergarten: SchoolType
  elementary: SchoolType
  juniorHigh: SchoolType
  high: SchoolType
  university: UniversityType
  /** Lives away from home while at university. */
  livingAway: boolean
}

/**
 * A period of work (or leave) for one member.
 * - employed: salaried employee (social insurance and income tax are computed)
 * - parentalLeave: childcare leave benefit is paid based on the salary of the
 *   employed period that ends right before it
 */
export interface WorkPeriod {
  id: string
  memberId: string
  label: string
  kind: 'employed' | 'parentalLeave'
  from: YM
  /** Last month of the period (inclusive). Omit for "until further notice". */
  to?: YM
  /** Gross monthly salary (額面月給) at the start of the period. */
  monthlySalary: number
  /** Gross annual bonus at the start of the period, paid half in June and half in December. */
  annualBonus: number
  /** Annual raise rate applied every year from the start of the period. */
  raiseRate: number
  /** Parental leave: also receive the post-birth leave supplement (出生後休業支援給付, +13% for 28 days). */
  postBirthSupplement?: boolean
  /**
   * Covered by the employer's social insurance (健康保険・厚生年金). Default true.
   * Part-time work below the threshold is not covered: the person may be a dependent of the spouse.
   */
  socialInsurance?: boolean
  /** Parental leave that starts with maternity leave (産前産後休業): 出産手当金 for the first 3 months. */
  maternity?: boolean
  /** Short working hours for a child under 2: 育児時短就業給付 (10% of the wage) is paid until this month. */
  shortTimeBenefitTo?: YM
}

export interface PublicPension {
  memberId: string
  /** Age at which the pension starts (60-75). */
  startAge: number
  /**
   * auto: estimated from the salary history (past average + simulated salaries).
   * manual: the amount from ねんきん定期便. Default manual.
   */
  mode?: 'auto' | 'manual'
  /** manual: estimated annual amount at age 65 in today's money (from ねんきん定期便). */
  annualAmountAt65: number
  /** auto: age at which the member joined employees' pension insurance (厚生年金). */
  careerStartAge?: number
  /** auto: average gross annual income (incl. bonus) before the simulation start, in today's money. */
  pastAverageIncome?: number
  /**
   * auto: years covered by employees' pension before the start. When omitted, coverage is assumed
   * from `careerStartAge` until the start (for people who are employees now).
   */
  pastKoseiYears?: number
  /** Months covered by the basic pension between ages 20 and 60 (max 480). Default 480. */
  basicMonths?: number
  /** Receive 加給年金 for a younger spouse and young children when eligible. Default true. */
  spousalAddition?: boolean
}

/** "What if" scenario: a member dies at `ym`. */
export interface DeathScenario {
  memberId: string
  ym: YM
  /** Life insurance paid at death. */
  lifeInsurance: number
  /** Household spending (expenses other than housing and education) after the death, as a share of before. */
  livingRatio: number
  /** The surviving spouse is the wife (affects survivor's pension rules such as 中高齢寡婦加算). */
  survivorIsWife: boolean
}

export interface PensionEstimate {
  /** 老齢基礎年金, annual at 65 in today's money. */
  basic: number
  /** 老齢厚生年金 (報酬比例部分), annual at 65 in today's money. */
  earnings: number
  /** Months covered by employees' pension (estimated). */
  koseiMonths: number
  total: number
}

export interface RetirementAllowance {
  id: string
  memberId: string
  ym: YM
  amount: number
  /** Years of service used for the retirement income deduction. */
  yearsOfService: number
}

export type ExpenseCategory =
  | 'living'
  | 'allowance'
  | 'insurance'
  | 'special'
  | 'car'
  | 'other'

export type InsuranceDeductionType = 'none' | 'general' | 'medical' | 'privatePension' | 'earthquake'

export interface Expense {
  id: string
  label: string
  category: ExpenseCategory
  /** monthly: amount every month. annual: amount once a year in `month`. */
  frequency: 'monthly' | 'annual'
  amount: number
  /** For annual expenses: the month it is paid (1-12). */
  month?: number
  from?: YM
  to?: YM
  /** Grows with the inflation rate. */
  inflate: boolean
  /** Insurance premiums: which deduction they count toward at year-end adjustment. */
  insuranceDeduction?: InsuranceDeductionType
  /** Member whose taxes the insurance deduction applies to (defaults to self). */
  payerId?: string
}

export interface OneOff {
  id: string
  label: string
  ym: YM
  /** Positive = income, negative = expense. */
  amount: number
  inflate: boolean
}

export interface RentPeriod {
  id: string
  label: string
  from: YM
  to?: YM
  monthlyRent: number
  /** Renewal fee every 2 years, in months of rent. */
  renewalMonths: number
}

export interface RatePeriod {
  /** Loan year (1-based) from which this rate applies. */
  fromYear: number
  rate: number
}

export interface Prepayment {
  ym: YM
  amount: number
  type: 'shorten' | 'reduce'
}

export interface Loan {
  amount: number
  years: number
  rates: RatePeriod[]
  prepayments: Prepayment[]
  /** Pay off the remaining balance when the borrower reaches this age. */
  payoffAge?: number
  borrowerId: string
  /**
   * Variable-rate loans: the payment is reviewed only every 5 years and can rise
   * by at most 25% (5年ルール・125%ルール).
   */
  fiveYearRule?: boolean
  /** Group credit life insurance (団信): the loan is paid off if the borrower dies. Default true. */
  dansin?: boolean
}

export type HomeType = 'house' | 'condo'

export interface Purchase {
  ym: YM
  price: number
  /** Share of the price that is land (0-1). */
  landShare: number
  homeType: HomeType
  isNew: boolean
  /** Certified long-life quality housing (長期優良住宅). */
  longLife: boolean
  /** Wooden structure (affects depreciation of the building assessment). */
  wooden: boolean
  /** Land area is 200 m² or less (small residential land special rule). */
  smallLand: boolean
  /** Closing costs as a share of the price. */
  closingCostRate: number
  loan?: Loan
  /** Housing loan deduction: maximum balance eligible (depends on performance and move-in year). */
  loanDeductionLimit: number
  loanDeductionYears: number
  /** Condo: management fee per month. */
  managementFee: number
  /** Condo: repair reserve per month, raised by `repairReserveRaiseRate` every `repairReserveRaiseYears`. */
  repairReserve: number
  repairReserveRaiseYears: number
  repairReserveRaiseRate: number
  /** Fire and earthquake insurance, per year. */
  fireInsuranceAnnual: number
  earthquakeInsuranceAnnual: number
  /** Periodic repairs (mainly for houses). */
  repairs: { label: string; everyYears: number; amount: number }[]
  /** Overrides the estimated annual property + city planning tax. */
  propertyTaxOverride?: number
  /** Municipal tax rates. */
  propertyTaxRate: number
  cityPlanningTaxRate: number
}

export interface Housing {
  rents: RentPeriod[]
  purchase?: Purchase
}

export type AccountKind = 'nisa' | 'taxable' | 'ideco' | 'dc' | 'stock' | 'annuity'

export interface Contribution {
  from: YM
  to?: YM
  monthly: number
  /** Extra amount paid once a year in `extraMonth`. */
  extraAnnual?: number
  extraMonth?: number
}

export interface PlannedWithdrawal {
  /** Owner age at which withdrawals start. */
  startAge: number
  mode: 'rate' | 'amount'
  /** rate: annual share of the balance. amount: yen per month. */
  value: number
}

export interface Account {
  id: string
  kind: AccountKind
  ownerId: string
  label: string
  /** Market value at the start of the simulation. */
  balance: number
  /** Acquisition cost of the starting balance. Defaults to `balance` when omitted. */
  costBasis?: number
  /** Expected annual return. */
  annualReturn: number
  /** Annual volatility used for Monte Carlo runs. Defaults by kind (e.g. 15% for NISA). */
  volatility?: number
  contributions: Contribution[]
  /** nisa / taxable / stock: planned withdrawals. */
  withdrawal?: PlannedWithdrawal
  /** ideco / dc: age at which the whole balance is received as a lump sum. */
  receiveAge?: number
  /** ideco / dc: month the owner joined (years of membership for the retirement deduction). */
  joined?: YM
  /** annuity: owner age at which payouts start and number of years they last. */
  payoutStartAge?: number
  payoutYears?: number
}

export interface Settings {
  start: YM
  /** Simulate until December of the year the self member reaches this age. */
  endAge: number
  inflationRate: number
  /** Growth of public pension amounts per year (macro-economic slide included). */
  pensionGrowthRate: number
  /** Month (1-12) in which inflation and raises are applied each year. */
  annualUpdateMonth: number
  /** Cash at the start. */
  cash: number
  /** Emergency fund: cash is refilled to this level from accounts when it drops below. */
  cashFloor: number
  /** Accounts sold (in this order) to refill cash. */
  withdrawalOrder: string[]
  /** Cash above this level is moved to `sweepAccountId` every month (0 or omitted = off). */
  cashCeiling?: number
  sweepAccountId?: string
  /** Multiplier on public pension amounts (for sensitivity checks). Default 1. */
  pensionMultiplier?: number
  /** Multiplier on expenses other than housing and education (for sensitivity checks). Default 1. */
  expenseMultiplier?: number
  /** Social insurance rates for employees (employee share). */
  healthInsuranceRate: number
  careInsuranceRate: number
  pensionInsuranceRate: number
  employmentInsuranceRate: number
  /** Monthly child living cost added per child by stage (today's money). */
  childLivingCost: { preschool: number; elementary: number; juniorHigh: number; high: number; university: number }
  /** Daycare fee per month for ages 0-2 (today's money). */
  daycareFee: number
}

export interface Plan {
  id: string
  name: string
  settings: Settings
  members: Member[]
  work: WorkPeriod[]
  pensions: PublicPension[]
  retirementAllowances: RetirementAllowance[]
  expenses: Expense[]
  oneOffs: OneOff[]
  housing: Housing
  accounts: Account[]
  /** Answers of the quick-start wizard the plan was generated from (if any). */
  wizard?: import('./wizard').WizardInput
  /** Self retirement age (for the "assets at retirement" indicator). */
  retirementAge?: number
  /** "What if" death scenario (used by the risk analysis). */
  death?: DeathScenario
}

// ---------- results ----------

export interface AccountState {
  balance: number
  costBasis: number
  contribution: number
  growth: number
  withdrawal: number
}

export interface MonthRow {
  t: number
  ym: YM
  ages: Record<string, number>
  income: {
    salary: number
    leaveBenefit: number
    pension: number
    childAllowance: number
    taxRefund: number
    retirement: number
    accountPayout: number
    other: number
    total: number
  }
  deductions: {
    socialInsurance: number
    incomeTax: number
    residentTax: number
    total: number
  }
  expenses: {
    living: number
    allowance: number
    insurance: number
    special: number
    car: number
    education: number
    childLiving: number
    housing: number
    other: number
    total: number
  }
  /** Take-home income minus expenses. */
  net: number
  accounts: Record<string, AccountState>
  cash: number
  loanBalance: number
  liquidAssets: number
  totalAssets: number
  events: string[]
  /** Cash fell below zero even after selling all accounts. */
  shortfall: boolean
  /** Price level relative to the start (for showing amounts in today's money). */
  inflationIndex: number
}

export interface SimulationResult {
  rows: MonthRow[]
  warnings: string[]
  /** Public pension estimates per member (today's money, at 65). */
  pensions: Record<string, PensionEstimate>
}

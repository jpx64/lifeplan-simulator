import { ageAt, monthOf, ymToIndex } from './time'
import type { Loan, Purchase } from './types'

export interface LoanMonth {
  t: number
  payment: number
  principal: number
  interest: number
  prepayment: number
  /** Balance after this month's payment. */
  balance: number
  rate: number
}

/** Monthly payment of an amortizing loan (元利均等). */
export function pmt(annualRate: number, months: number, principal: number): number {
  if (months <= 0) return principal
  const r = annualRate / 12
  if (r === 0) return principal / months
  return (principal * r) / (1 - Math.pow(1 + r, -months))
}

function rateForYear(loan: Loan, year: number): number {
  let rate = loan.rates[0]?.rate ?? 0
  for (const p of [...loan.rates].sort((a, b) => a.fromYear - b.fromYear)) {
    if (year >= p.fromYear) rate = p.rate
  }
  return rate
}

/**
 * Repayment schedule. Repayment starts the month after `startT`.
 * By default the monthly payment is recalculated when the rate changes. With `fiveYearRule`,
 * it is reviewed only every 5 years and rises by at most 25%; interest that the payment does not
 * cover is added to the balance and settled at the end (未払利息).
 */
export function loanSchedule(loan: Loan, startT: number, borrowerBirth?: number): LoanMonth[] {
  const rows: LoanMonth[] = []
  const totalMonths = loan.years * 12
  const prepayments = new Map<number, Loan['prepayments']>()
  for (const p of loan.prepayments) {
    const t = ymToIndex(p.ym)
    prepayments.set(t, [...(prepayments.get(t) ?? []), p])
  }
  let balance = loan.amount
  let remaining = totalMonths
  let rate = rateForYear(loan, 1)
  let payment = pmt(rate, remaining, balance)
  for (let n = 1; n <= totalMonths && balance > 0.5; n++) {
    const t = startT + n
    const year = Math.floor((n - 1) / 12) + 1
    const r = rateForYear(loan, year)
    if (loan.fiveYearRule) {
      rate = r
      if (n > 1 && (n - 1) % 60 === 0) payment = Math.min(pmt(rate, remaining, balance), payment * 1.25)
    } else if (r !== rate) {
      rate = r
      payment = pmt(rate, remaining, balance)
    }
    const interest = balance * (rate / 12)
    // with the 5-year rule the payment may not cover the interest: the shortfall stays in the balance
    let principal = Math.min(balance, payment - interest)
    if (remaining === 1) principal = balance
    balance -= principal
    remaining -= 1
    let prepayment = 0
    for (const p of prepayments.get(t) ?? []) {
      const amt = Math.min(balance, p.amount)
      balance -= amt
      prepayment += amt
      if (balance <= 0.5) break
      if (p.type === 'reduce') {
        payment = pmt(rate, remaining, balance)
      } else {
        // shorten: keep the payment, recompute how many months remain
        const rr = rate / 12
        remaining = rr === 0 ? Math.ceil(balance / payment) : Math.ceil(-Math.log(1 - (balance * rr) / payment) / Math.log(1 + rr))
      }
    }
    if (loan.payoffAge !== undefined && borrowerBirth !== undefined && ageAt(borrowerBirth, t) >= loan.payoffAge && balance > 0) {
      prepayment += balance
      balance = 0
    }
    rows.push({ t, payment: principal + interest, principal, interest, prepayment, balance: Math.max(0, balance), rate })
    if (balance <= 0.5) break
  }
  return rows
}

/**
 * Estimated annual property tax + city planning tax for the given year since purchase (1-based).
 * - Assessed value: land 70% of land price, building 60% of building price,
 *   depreciated every 3 years (re-assessment) to a floor of 20% over ~25 years (wooden) or ~45 years.
 * - Small residential land (≤200m²): 1/6 for property tax, 1/3 for city planning tax.
 * - New homes: building property tax halved for 3 years (house) / 5 years (condo), +2 years if long-life certified.
 */
export function propertyTaxAnnual(p: Purchase, yearSincePurchase: number): number {
  if (p.propertyTaxOverride !== undefined) return p.propertyTaxOverride
  const land = p.price * p.landShare * 0.7
  const life = p.wooden ? 25 : 45
  // re-assessment every 3 years
  const assessedYears = Math.floor((yearSincePurchase - 1) / 3) * 3 + (p.isNew ? 0 : 10)
  const depreciation = Math.max(0.2, 1 - (0.8 * assessedYears) / life)
  const building = p.price * (1 - p.landShare) * 0.6 * depreciation
  const landPT = p.smallLand ? land / 6 : land / 3
  const landCP = p.smallLand ? land / 3 : (land * 2) / 3
  let buildingPT = building * p.propertyTaxRate
  const reliefYears = (p.homeType === 'condo' ? 5 : 3) + (p.longLife ? 2 : 0)
  if (p.isNew && yearSincePurchase <= reliefYears) buildingPT /= 2
  return landPT * p.propertyTaxRate + buildingPT + (landCP + building) * p.cityPlanningTaxRate
}

/** Property tax is paid in four installments: April, July, December, February. */
export function isPropertyTaxMonth(t: number): boolean {
  return [4, 7, 12, 2].includes(monthOf(t))
}

import { ageAt, schoolAge } from './time'

/**
 * 児童手当 (from October 2024): paid until the end of the school year in which the child turns 18.
 * - under 3: 15,000 / month
 * - 3 to high school: 10,000 / month
 * - 3rd child or later: 30,000 / month
 * Children are counted (for "3rd child") until the end of the school year they turn 22.
 */
export function childAllowanceMonthly(childBirths: number[], t: number): number {
  const counted = childBirths
    .filter((b) => b <= t && schoolAge(b, t) <= 21)
    .sort((a, b) => a - b)
  let total = 0
  counted.forEach((b, i) => {
    if (schoolAge(b, t) > 17) return
    if (i >= 2) total += 30_000
    else total += ageAt(b, t) < 3 ? 15_000 : 10_000
  })
  return total
}

/** Upper limit of the wage base for the childcare leave benefit, per 30 days (approx.; revised every August). */
const LEAVE_WAGE_CAP_30DAYS = 470_700

/**
 * 育児休業給付金 for the n-th month of leave (1-based).
 * 67% for the first 6 months, 50% afterwards. With the post-birth supplement (出生後休業支援給付),
 * an extra 13% is paid for the first 28 days (counted as the first month here).
 * The benefit is not taxed and social insurance is exempt during leave.
 */
export function parentalLeaveBenefit(monthlySalary: number, leaveMonth: number, postBirthSupplement: boolean): number {
  const base = Math.min(monthlySalary, LEAVE_WAGE_CAP_30DAYS)
  let rate = leaveMonth <= 6 ? 0.67 : 0.5
  if (postBirthSupplement && leaveMonth === 1) rate += 0.13 * (28 / 30)
  return Math.floor(base * rate)
}

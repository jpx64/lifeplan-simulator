/**
 * Public pension rules (amounts for FY2025, people born on or after April 2, 1956).
 * Annual amounts in yen.
 */

/** 老齢基礎年金の満額 (40 years of coverage). */
export const BASIC_PENSION_FULL = 831_700
/** 報酬比例部分の給付乗率 (coverage from April 2003, bonuses included). */
export const EARNINGS_RATE = 5.481 / 1000
/** 加給年金: spouse (239,300) + special addition (176,600). */
export const SPOUSE_ADDITION = 415_900
/** 加給年金 / 子の加算: 1st and 2nd child. */
export const CHILD_ADDITION = 239_300
/** 加給年金 / 子の加算: 3rd child and later. */
export const CHILD_ADDITION_3RD = 79_800
/** 中高齢寡婦加算. */
export const WIDOW_MIDDLE_AGE_ADDITION = 623_800
/** Standard monthly remuneration cap for employees' pension (標準報酬月額の上限). */
export const STANDARD_MONTHLY_CAP = 650_000
/** Standard bonus cap per payment for employees' pension (標準賞与額の上限). */
export const STANDARD_BONUS_CAP = 1_500_000
/** Employees' pension coverage needed for 加給年金 (20 years). */
export const KAKYU_MIN_MONTHS = 240

/** Monthly threshold of 在職老齢年金 (51万 → 62万 from April 2026). */
export function workingPensionThreshold(year: number, month: number): number {
  return year > 2026 || (year === 2026 && month >= 4) ? 620_000 : 510_000
}

/**
 * 在職老齢年金: monthly amount of the earnings-related pension that is suspended
 * when salary (総報酬月額相当額) plus the pension (基本月額) exceeds the threshold.
 */
export function workingPensionReduction(earningsMonthly: number, totalPayMonthly: number, threshold: number): number {
  const over = earningsMonthly + totalPayMonthly - threshold
  return over > 0 ? Math.min(earningsMonthly, over / 2) : 0
}

/** Early (繰上げ: −0.4%/month) or late (繰下げ: +0.7%/month) start relative to 65. */
export function startAgeAdjustment(startAge: number): number {
  const months = (startAge - 65) * 12
  return months < 0 ? 1 + 0.004 * months : 1 + 0.007 * months
}

/** Child additions (子の加算 / 加給年金) for `n` eligible children. */
export function childAdditions(n: number): number {
  let total = 0
  for (let i = 0; i < n; i++) total += i < 2 ? CHILD_ADDITION : CHILD_ADDITION_3RD
  return total
}

/** 老齢基礎年金 for the given months of coverage. */
export function basicPension(months: number): number {
  return (BASIC_PENSION_FULL * Math.min(480, Math.max(0, months))) / 480
}

/**
 * 遺族厚生年金 before adjustment with the survivor's own pension:
 * 3/4 of the deceased's earnings-related pension. When the deceased was covered at death
 * (短期要件), coverage is treated as at least 300 months.
 */
export function survivorEarningsPension(deceasedEarnings: number, deceasedMonths: number, coveredAtDeath: boolean): number {
  if (deceasedEarnings <= 0) return 0
  const factor = coveredAtDeath && deceasedMonths > 0 && deceasedMonths < 300 ? 300 / deceasedMonths : 1
  return deceasedEarnings * factor * 0.75
}

/**
 * From 65 the survivor's own 老齢厚生年金 is paid first; the survivor's pension pays the difference.
 * The survivor's pension amount is the larger of (A) and (2/3 A + 1/2 own).
 */
export function survivorEarningsAfter65(survivorPension: number, ownEarnings: number): number {
  const amount = Math.max(survivorPension, (survivorPension * 2) / 3 + ownEarnings / 2)
  return Math.max(0, amount - ownEarnings)
}

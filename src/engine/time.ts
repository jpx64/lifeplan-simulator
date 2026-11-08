/**
 * Months are handled internally as an integer index: year * 12 + (month - 1).
 * In plans (JSON) they are stored as 'YYYY-MM' strings.
 */
export type YM = string

export function ymToIndex(ym: YM): number {
  const m = /^(\d{4})-(\d{1,2})$/.exec(ym)
  if (!m) throw new Error(`Invalid year-month: ${ym}`)
  return Number(m[1]) * 12 + (Number(m[2]) - 1)
}

export function indexToYm(i: number): YM {
  const y = Math.floor(i / 12)
  const m = (i % 12) + 1
  return `${y}-${String(m).padStart(2, '0')}`
}

export const yearOf = (i: number) => Math.floor(i / 12)
export const monthOf = (i: number) => (i % 12) + 1

/** Age in full years at month index t (birthday counted in the birth month). */
export function ageAt(birthIndex: number, t: number): number {
  return Math.floor((t - birthIndex) / 12)
}

/** Month index at which someone born at birthIndex reaches the given age. */
export function monthAtAge(birthIndex: number, age: number): number {
  return birthIndex + age * 12
}

/**
 * Japanese school-year age: age on April 1 of the current school (fiscal) year.
 * A child with schoolAge 6 is in the 1st grade of elementary school.
 */
export function schoolAge(birthIndex: number, t: number): number {
  const fy = monthOf(t) >= 4 ? yearOf(t) : yearOf(t) - 1
  const by = yearOf(birthIndex)
  const bm = monthOf(birthIndex)
  return fy - by - (bm >= 4 ? 1 : 0)
}

/** Age as of December 31 of the given calendar year (used for tax dependents). */
export function ageAtYearEnd(birthIndex: number, year: number): number {
  return year - yearOf(birthIndex)
}

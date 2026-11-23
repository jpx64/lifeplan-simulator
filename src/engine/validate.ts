import { simulate } from './simulate'
import type { Plan } from './types'

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const isNum = (v: unknown) => typeof v === 'number' && Number.isFinite(v)
const isYM = (v: unknown) => typeof v === 'string' && /^\d{4}-(0?[1-9]|1[0-2])$/.test(v)

const SETTINGS_NUMBERS = [
  'endAge',
  'inflationRate',
  'pensionGrowthRate',
  'annualUpdateMonth',
  'cash',
  'cashFloor',
  'healthInsuranceRate',
  'careInsuranceRate',
  'pensionInsuranceRate',
  'employmentInsuranceRate',
  'daycareFee',
] as const

const LISTS = ['work', 'pensions', 'retirementAllowances', 'expenses', 'oneOffs', 'accounts'] as const

/**
 * Why a plan (read from a file, a shared link or the browser) cannot be used; empty when it can.
 * Checks the shape first, then runs the simulation once so that a plan that would break the screens is rejected.
 */
export function planProblems(p: unknown): string[] {
  if (!isObj(p)) return ['プランの形式ではありません']
  const out: string[] = []
  if (typeof p.id !== 'string' || !p.id) out.push('プランの id がありません')
  if (typeof p.name !== 'string') out.push('プラン名がありません')

  const s = p.settings
  if (!isObj(s)) out.push('設定（settings）がありません')
  else {
    if (!isYM(s.start)) out.push('開始年月（settings.start）が正しくありません')
    for (const k of SETTINGS_NUMBERS) if (!isNum(s[k])) out.push(`settings.${k} が数値ではありません`)
    if (!Array.isArray(s.withdrawalOrder)) out.push('settings.withdrawalOrder がありません')
    if (!isObj(s.childLivingCost)) out.push('settings.childLivingCost がありません')
  }

  if (!Array.isArray(p.members)) out.push('家族（members）がありません')
  else {
    p.members.forEach((m, i) => {
      if (!isObj(m) || typeof m.id !== 'string' || !['self', 'spouse', 'child'].includes(m.role as string) || !isYM(m.birth)) {
        out.push(`家族の ${i + 1} 人目（members[${i}]）が正しくありません`)
      }
    })
    if (p.members.filter((m) => isObj(m) && m.role === 'self').length !== 1) out.push('本人（role: self）がちょうど1人必要です')
  }

  for (const k of LISTS) if (!Array.isArray(p[k])) out.push(`${k} がありません`)
  if (!isObj(p.housing) || !Array.isArray(p.housing.rents)) out.push('住まい（housing）がありません')
  if (out.length > 0) return out

  try {
    simulate(p as unknown as Plan)
  } catch (e) {
    out.push(`このプランは計算できません（${e instanceof Error ? e.message : String(e)}）`)
  }
  return out
}

export type ParsedPlans = { ok: true; plans: Plan[] } | { ok: false; error: string }

/** Plans from exported JSON: `{ plans: [...] }` (all plans) or a single plan. */
export function parsePlans(data: unknown): ParsedPlans {
  const list = isObj(data) && Array.isArray(data.plans) ? data.plans : [data]
  if (list.length === 0) return { ok: false, error: 'プランが1件も入っていません' }
  const problems = list.flatMap((p, i) => {
    const name = isObj(p) && typeof p.name === 'string' ? `「${p.name}」` : `${i + 1}件目`
    return planProblems(p).map((msg) => `${name}: ${msg}`)
  })
  if (problems.length > 0) {
    const more = problems.length > 5 ? `\n…ほか ${problems.length - 5} 件` : ''
    return { ok: false, error: problems.slice(0, 5).join('\n') + more }
  }
  return { ok: true, plans: list as Plan[] }
}

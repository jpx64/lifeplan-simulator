import { describe, expect, it } from 'vitest'
import { simulate } from './simulate'
import { kpis, yearly } from './summary'
import { ymToIndex } from './time'
import { buildPlan, defaultWizard, normalizeWizard } from './wizard'

describe('wizard → plan', () => {
  const w = defaultWizard('2026-11')
  const plan = buildPlan(w)

  it('creates members, work periods and accounts', () => {
    expect(plan.members.map((m) => m.role)).toEqual(['self', 'spouse', 'child'])
    expect(plan.accounts.some((a) => a.id === 'self-nisa')).toBe(true)
  })

  it('spouse takes leave for the child born after the start, then short hours, then full time', () => {
    const spouseWork = plan.work.filter((p) => p.memberId === 'spouse')
    const kinds = spouseWork.map((p) => `${p.kind}:${p.label}`)
    expect(kinds.slice(0, 4)).toEqual(['employed:会社員', 'parentalLeave:産休・育休', 'employed:時短勤務', 'employed:通常勤務に戻る'])
    const leave = spouseWork[1]
    // maternity leave starts the month before the birth
    expect(ymToIndex(leave.from)).toBe(ymToIndex(w.children[0].birth) - 1)
    expect(leave.maternity).toBe(true)
    expect(spouseWork[2].shortTimeBenefitTo).toBeDefined()
    const short = spouseWork[2]
    const full = spouseWork[3]
    expect(short.monthlySalary).toBeLessThan(full.monthlySalary)
  })

  it('work periods are contiguous', () => {
    const spouseWork = plan.work.filter((p) => p.memberId === 'spouse' && p.label !== '再雇用')
    for (let i = 1; i < spouseWork.length; i++) {
      const [py, pm] = spouseWork[i - 1].to!.split('-').map(Number)
      const next = pm === 12 ? `${py + 1}-01` : `${py}-${String(pm + 1).padStart(2, '0')}`
      expect(spouseWork[i].from).toBe(next)
    }
  })

  it('buying a home ends the rent the month before', () => {
    const p = buildPlan({ ...w, housing: { ...w.housing, mode: 'buy', buyYM: '2029-04' } })
    expect(p.housing.rents[0].to).toBe('2029-03')
    expect(p.housing.purchase?.loan?.amount).toBe(w.housing.price - w.housing.downPayment)
    expect(p.housing.purchase?.loanDeductionLimit).toBe(45_000_000)
  })

  it('simulates without errors and produces yearly rows and indicators', () => {
    const res = simulate(plan)
    const ys = yearly(res)
    expect(ys[0].year).toBe(2026)
    expect(ys.at(-1)!.ages.self).toBe(100)
    const k = kpis(plan, res, plan.retirementAge)
    expect(k.assetsAtRetirement?.age).toBe(60)
  })

  it('quit after the birth: maternity leave only, then part-time work from the given child age', () => {
    const q = buildPlan({ ...w, spouse: { ...w.spouse, afterLeave: 'quit', returnChildAge: 6, returnIncome: 1_000_000 } })
    const sw = q.work.filter((p) => p.memberId === 'spouse')
    expect(sw.map((p) => p.label)).toEqual(['会社員', '産休', 'パートで再就職'])
    expect(sw[2].socialInsurance).toBe(false)
    expect(q.retirementAllowances.some((r) => r.memberId === 'spouse')).toBe(false)
    const res = simulate(q)
    expect(res.pensions.spouse.koseiMonths).toBeGreaterThan(0)
  })

  it('pensions are estimated automatically by default', () => {
    const res = simulate(plan)
    expect(plan.pensions[0].mode).toBe('auto')
    expect(res.pensions.self.total).toBeGreaterThan(1_500_000)
    expect(res.pensions.self.total).toBeLessThan(3_000_000)
  })

  it('older saved wizard answers are upgraded (manual pension, employee by default)', () => {
    const old = { ...w, self: { ...w.self, workStyle: undefined, pensionMode: undefined, working: true } }
    const n = normalizeWizard(old)
    expect(n.self.workStyle).toBe('employee')
    expect(n.self.pensionMode).toBe('manual')
  })
})

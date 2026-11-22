import { describe, expect, it } from 'vitest'
import { samplePlan, sampleWizard } from './sample'
import { buildScenarios, childrenFor, defaultAssumptions, homeValueAt, housingOf, scenarioNotes, variantPlan } from './scenarios'
import { simulate } from './simulate'
import { yearly } from './summary'
import { buildPlan, defaultWizard } from './wizard'

const sum = (plan: Parameters<typeof simulate>[0], f: (y: ReturnType<typeof yearly>[number]) => number) =>
  yearly(simulate(plan)).reduce((s, y) => s + f(y), 0)

describe('scenarios: variants of a plan', () => {
  const plan = samplePlan()
  const leaves = (p: typeof plan) => p.work.filter((w) => w.memberId === 'spouse' && w.kind === 'parentalLeave')

  it('the same children and housing give back the plan itself', () => {
    expect(variantPlan(plan, 1, 'buy')).toBe(plan)
    const s = buildScenarios(plan, [0, 1, 2], ['rent', 'buy'], defaultAssumptions(plan))
    expect(s.map((x) => `${x.children}${x.housing}`)).toEqual(['0rent', '0buy', '1rent', '1buy', '2rent', '2buy'])
    expect(s.filter((x) => x.isCurrent).map((x) => x.plan)).toEqual([plan])
  })

  it('without children there is no childcare leave or shorter hours', () => {
    const v = variantPlan(plan, 0, 'buy')
    expect(v.members.some((m) => m.role === 'child')).toBe(false)
    expect(leaves(v)).toHaveLength(0)
    expect(v.work.some((w) => w.label === '時短勤務')).toBe(false)
    expect(leaves(plan)).toHaveLength(1)
    expect(sum(v, (y) => y.expenseBreakdown.education)).toBe(0)
    expect(sum(v, (y) => y.incomeBreakdown.childAllowance)).toBe(0)
  })

  it('an added child is born after the youngest, with another childcare leave', () => {
    const v = variantPlan(plan, 2, 'buy')
    const kids = v.members.filter((m) => m.role === 'child')
    expect(kids.map((k) => k.birth)).toEqual(['2026-06', '2028-06'])
    expect(leaves(v)).toHaveLength(2)
    expect(sum(v, (y) => y.expenseBreakdown.education)).toBeGreaterThan(sum(plan, (y) => y.expenseBreakdown.education) * 1.8)
    expect(v.wizard?.children).toHaveLength(2)
  })

  it('renting instead of buying keeps the rent and drops the loan', () => {
    const v = variantPlan(plan, 1, 'rent')
    expect(housingOf(v)).toBe('rent')
    expect(v.housing.rents).toEqual([expect.objectContaining({ monthlyRent: 120_000, to: undefined })])
    expect(simulate(v).rows.every((r) => r.loanBalance === 0)).toBe(true)
    // everything else is unchanged
    expect(v.work).toBe(plan.work)
    expect(v.accounts).toBe(plan.accounts)
  })

  it('a renting household can be compared with buying on the purchase conditions given', () => {
    const renter = buildPlan({ ...defaultWizard('2026-01'), housing: { ...defaultWizard('2026-01').housing, mode: 'rent' } }, 'r', 'r')
    const a = defaultAssumptions(renter)
    const v = variantPlan(renter, 1, 'buy', { ...a, housing: { ...a.housing, price: 40_000_000, buyYM: '2029-04' } })
    expect(v.housing.purchase?.price).toBe(40_000_000)
    expect(v.housing.purchase?.ym).toBe('2029-04')
    expect(v.housing.rents[0].to).toBe('2029-03')
    // the renting pattern stays the plan itself: purchase conditions do not matter for it
    expect(variantPlan(renter, 1, 'rent', { ...a, housing: { ...a.housing, price: 40_000_000 } })).toBe(renter)
  })

  it('changed purchase conditions also apply to a plan that already buys', () => {
    const a = defaultAssumptions(plan)
    const changed = { ...a, housing: { ...a.housing, price: 60_000_000 } }
    const v = variantPlan(plan, 1, 'buy', changed)
    expect(v).not.toBe(plan)
    expect(v.housing.purchase?.price).toBe(60_000_000)
    // so that pattern is no longer the plan as it is
    expect(buildScenarios(plan, [1], ['buy'], changed)[0].isCurrent).toBe(false)
    // renting does not depend on the purchase conditions
    expect(buildScenarios(plan, [1], ['rent'], changed)[0].plan.housing).toEqual(variantPlan(plan, 1, 'rent').housing)
  })

  it('a parent who quits at the first birth keeps working (with a retirement allowance) without children', () => {
    const w = sampleWizard()
    const quitter = buildPlan({ ...w, spouse: { ...w.spouse, afterLeave: 'quit', retirementAllowance: 3_000_000 }, children: [{ ...w.children[0], birth: '2027-06' }] }, 'q', 'q')
    expect(quitter.retirementAllowances.some((r) => r.memberId === 'spouse')).toBe(false)
    const v = variantPlan(quitter, 0, 'buy')
    expect(v.retirementAllowances.some((r) => r.memberId === 'spouse')).toBe(true)
  })
})

describe('scenarios: plans made in 詳細設定', () => {
  const plan = { ...samplePlan(), wizard: undefined }

  it('children change but work stays, with a note saying so', () => {
    const v = variantPlan(plan, 0, 'buy')
    expect(v.members.some((m) => m.role === 'child')).toBe(false)
    expect(v.work).toBe(plan.work)
    expect(scenarioNotes(plan)).toHaveLength(1)
    expect(scenarioNotes(samplePlan())).toHaveLength(0)
  })

  it('reads the purchase conditions back from the plan', () => {
    const a = defaultAssumptions(plan)
    expect(a.housing).toMatchObject({ mode: 'buy', rent: 120_000, buyYM: '2028-04', price: 50_000_000, downPayment: 5_000_000, initialRate: 0.01, rateRiseEvery5y: 0.005 })
    expect(variantPlan(plan, 1, 'buy', a)).toBe(plan)
  })
})

describe('childrenFor', () => {
  it('removes the youngest first and adds after the youngest', () => {
    const plan = samplePlan()
    const three = childrenFor(plan, 3, 3)
    expect(three.map((c) => c.birth)).toEqual(['2026-06', '2029-06', '2032-06'])
    expect(childrenFor({ ...plan, members: [...plan.members, ...three.slice(1)] }, 1, 2).map((c) => c.birth)).toEqual(['2026-06'])
  })

  it('a child added to a family whose youngest is older comes a year after the start at the earliest', () => {
    const plan = samplePlan()
    const older = { ...plan, members: plan.members.map((m) => (m.role === 'child' ? { ...m, birth: '2018-04' } : m)) }
    expect(childrenFor(older, 2, 2)[1].birth).toBe('2027-01')
    expect(childrenFor({ ...plan, members: plan.members.filter((m) => m.role !== 'child') }, 1, 2)[0].birth).toBe('2027-01')
  })
})

describe('homeValueAt', () => {
  it('keeps the land and writes the building off over its useful life', () => {
    const plan = samplePlan()
    expect(homeValueAt(plan, '2028-03')).toBe(0)
    expect(homeValueAt(plan, '2028-04')).toBe(50_000_000)
    expect(homeValueAt(plan, '2039-04')).toBeCloseTo(25_000_000 + 25_000_000 * 0.5, 0)
    expect(homeValueAt(plan, '2090-12')).toBe(25_000_000)
    expect(homeValueAt(variantPlan(plan, 1, 'rent'), '2090-12')).toBe(0)
  })
})

import { indexToYm, monthAtAge, ymToIndex } from './time'
import type { Plan, WorkPeriod } from './types'

/**
 * "What helps the most": one change at a time to a copy of the plan, to compare their effects.
 * The plan itself is never changed.
 */
export interface Hint {
  id: string
  label: string
  detail: string
  plan: Plan
}

const nameOf = (plan: Plan, id: string) => plan.members.find((m) => m.id === id)?.name ?? id

/** The member's last salaried period that ends (the end of working life). */
function lastWork(plan: Plan, memberId: string): WorkPeriod | undefined {
  return plan.work
    .filter((w) => w.memberId === memberId && w.kind === 'employed' && w.to !== undefined)
    .sort((a, b) => ymToIndex(b.to!) - ymToIndex(a.to!))[0]
}

export function improvementHints(plan: Plan): Hint[] {
  const hints: Hint[] = []
  const start = plan.settings.start
  const self = plan.members.find((m) => m.role === 'self')!
  const adults = plan.members.filter((m) => m.role !== 'child')

  // spend 10,000 yen a month less, for good
  hints.push({
    id: 'living',
    label: '生活費を月1万円減らす',
    detail: 'いまからずっと（物価に合わせて増えます）',
    plan: {
      ...plan,
      expenses: [...plan.expenses, { id: 'hint-living', label: '生活費の見直し', category: 'living', frequency: 'monthly', amount: -10_000, inflate: true, from: start }],
    },
  })

  // work one more year
  for (const m of adults) {
    // someone who works "until further notice" has no end to move
    if (plan.work.some((x) => x.memberId === m.id && x.kind === 'employed' && x.to === undefined)) continue
    const w = lastWork(plan, m.id)
    if (!w) continue
    const endT = ymToIndex(w.to!)
    if (endT < ymToIndex(start)) continue
    const age = Math.floor((endT + 1 - ymToIndex(m.birth)) / 12)
    hints.push({
      id: `work-${m.id}`,
      label: `${m.name}が1年長く働く`,
      detail: `いまの予定は${age}歳まで。最後の働き方（${w.label === '通常勤務に戻る' ? '会社員' : w.label}）のまま${age + 1}歳まで`,
      plan: { ...plan, work: plan.work.map((x) => (x === w ? { ...x, to: indexToYm(endT + 12) } : x)) },
    })
  }

  // save 10,000 yen a month more in NISA, until the current savings plan ends (or the retirement age)
  const nisa = plan.accounts.find((a) => a.kind === 'nisa' && a.ownerId === self.id) ?? plan.accounts.find((a) => a.kind === 'nisa')
  if (nisa) {
    const birth = ymToIndex(plan.members.find((m) => m.id === nisa.ownerId)!.birth)
    const planned = nisa.contributions.map((c) => c.to).filter((t): t is string => !!t)
    const to = planned.length ? planned.sort().at(-1)! : indexToYm(monthAtAge(birth, plan.retirementAge ?? 60) - 1)
    if (ymToIndex(to) >= ymToIndex(start)) {
      hints.push({
        id: 'nisa',
        label: 'NISAの積立を月1万円増やす',
        detail: `${nisa.label}に、いまから${to.slice(0, 4)}年まで`,
        plan: {
          ...plan,
          accounts: plan.accounts.map((a) => (a === nisa ? { ...a, contributions: [...a.contributions, { from: start, to, monthly: 10_000 }] } : a)),
        },
      })
    }
  }

  // start the public pension at 70 (繰下げ受給, +42%)
  const early = plan.pensions.filter((p) => p.startAge < 70)
  if (early.length > 0) {
    hints.push({
      id: 'pension70',
      label: '公的年金を70歳から受け取る',
      detail: `${early.map((p) => nameOf(plan, p.memberId)).join('・')}。65歳からより年金額が42%増え、おおむね82歳より長生きすると有利`,
      plan: { ...plan, pensions: plan.pensions.map((p) => (p.startAge < 70 ? { ...p, startAge: 70 } : p)) },
    })
  }

  // a cheaper home (only before buying)
  const p = plan.housing.purchase
  if (p && ymToIndex(p.ym) > ymToIndex(start) && p.price > 10_000_000) {
    const cut = 5_000_000
    hints.push({
      id: 'house',
      label: '家を500万円安くする',
      detail: `物件価格 ${Math.round((p.price - cut) / 10_000).toLocaleString('ja-JP')}万円（借入をその分減らす）`,
      plan: {
        ...plan,
        housing: {
          ...plan.housing,
          purchase: {
            ...p,
            price: p.price - cut,
            loan: p.loan && p.loan.amount > cut ? { ...p.loan, amount: p.loan.amount - cut } : undefined,
          },
        },
      },
    })
  }

  // no car
  if (plan.expenses.some((e) => e.category === 'car')) {
    hints.push({
      id: 'car',
      label: '車を持たない',
      detail: '車の維持費と買い替えをなくす（代わりの交通費は含みません）',
      plan: {
        ...plan,
        expenses: plan.expenses.filter((e) => e.category !== 'car'),
        oneOffs: plan.oneOffs.filter((o) => !(o.amount < 0 && o.label.includes('車'))),
      },
    })
  }

  return hints
}

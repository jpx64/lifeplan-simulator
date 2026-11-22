import { useMemo, useState } from 'react'
import { accountLabels, simulate } from '../engine/simulate'
import { DEDUCTION_LABELS, EXPENSE_LABELS, INCOME_LABELS, yearly, type DeductionKey, type ExpenseKey, type IncomeKey, type YearRow } from '../engine/summary'
import type { Plan } from '../engine/types'
import { downloadCsv } from './store'
import { YearDetail } from './YearDetail'

type Col = { key: string; label: string; get: (r: YearRow) => number }

const BASIC: Col[] = [
  { key: 'income', label: '収入', get: (r) => r.income },
  { key: 'tax', label: '税・社会保険', get: (r) => r.taxAndInsurance },
  { key: 'takeHome', label: '手取り', get: (r) => r.takeHome },
  { key: 'expenses', label: '支出', get: (r) => r.expenses },
  { key: 'balance', label: '年間収支', get: (r) => r.balance },
  { key: 'cash', label: '預貯金', get: (r) => r.cash },
  { key: 'total', label: '資産合計', get: (r) => r.totalAssets },
  { key: 'loan', label: 'ローン残高', get: (r) => r.loanBalance },
]
const INCOME: Col[] = (Object.keys(INCOME_LABELS) as IncomeKey[]).map((k) => ({ key: `i-${k}`, label: INCOME_LABELS[k], get: (r) => r.incomeBreakdown[k] }))
const DEDUCTIONS: Col[] = (Object.keys(DEDUCTION_LABELS) as DeductionKey[]).map((k) => ({ key: `d-${k}`, label: DEDUCTION_LABELS[k], get: (r) => r.deductionBreakdown[k] }))
const EXPENSES: Col[] = (Object.keys(EXPENSE_LABELS) as ExpenseKey[]).map((k) => ({ key: `e-${k}`, label: EXPENSE_LABELS[k], get: (r) => r.expenseBreakdown[k] }))

const GROUPS = [
  { id: 'income', label: '収入の内訳' },
  { id: 'deductions', label: '税・社保の内訳' },
  { id: 'expenses', label: '支出の内訳' },
  { id: 'accounts', label: '口座ごとの残高' },
] as const
type GroupId = (typeof GROUPS)[number]['id']

const m = (v: number) => Math.round(v / 10_000).toLocaleString('ja-JP')

export function YearTable({ plan, real }: { plan: Plan; real: boolean }) {
  const [groups, setGroups] = useState<GroupId[]>([])
  const [selected, setSelected] = useState<number | undefined>()
  const { years, labels } = useMemo(() => {
    const res = simulate(plan)
    return { years: yearly(res, real), labels: accountLabels(plan, res) }
  }, [plan, real])
  const accountCols: Col[] = Object.keys(labels).map((id) => ({ key: `a-${id}`, label: labels[id], get: (r) => r.accounts[id] ?? 0 }))
  const cols: Col[] = [
    ...BASIC,
    ...(groups.includes('income') ? INCOME : []),
    ...(groups.includes('deductions') ? DEDUCTIONS : []),
    ...(groups.includes('expenses') ? EXPENSES : []),
    ...(groups.includes('accounts') ? accountCols : []),
  ]
  const people = plan.members
  const toggle = (g: GroupId) => setGroups((s) => (s.includes(g) ? s.filter((x) => x !== g) : [...s, g]))
  const sel = years.find((y) => y.year === selected)

  const exportCsv = () => {
    const all = [...BASIC, ...INCOME, ...DEDUCTIONS, ...EXPENSES, ...accountCols]
    const header = ['年', ...people.map((x) => `${x.name}の年齢`), ...all.map((c) => c.label), 'イベント']
    const rows = years.map((r) => [
      r.year,
      ...people.map((x) => (r.ages[x.id] >= 0 ? r.ages[x.id] : '')),
      ...all.map((c) => Math.round(c.get(r))),
      [...new Set(r.events)].join(' / '),
    ])
    downloadCsv(`${plan.name}${real ? '（いまの物価）' : ''}.csv`, [header, ...rows])
  }

  return (
    <>
      <section className="card">
        <div className="card-head">
          <h2>年ごとの表</h2>
          <button type="button" className="secondary" onClick={exportCsv}>
            CSVで書き出す（全項目・円単位）
          </button>
        </div>
        <p className="note">
          単位: 万円{real ? '（いまの物価に換算）' : ''}。残高は各年の12月末時点。行をクリックすると、その年の内訳と月ごとの動きを表示します。
        </p>
        <div className="chips" role="group" aria-label="表示する列">
          {GROUPS.map((g) => (
            <label key={g.id} className={`chip ${groups.includes(g.id) ? 'on' : ''}`}>
              <input type="checkbox" checked={groups.includes(g.id)} onChange={() => toggle(g.id)} />
              {g.label}
            </label>
          ))}
        </div>
        <div className="table-wrap">
          <table className="num-table clickable">
            <thead>
              <tr>
                <th>年</th>
                {people.map((x) => (
                  <th key={x.id}>{x.name}</th>
                ))}
                {cols.map((c) => (
                  <th key={c.key}>{c.label}</th>
                ))}
                <th className="text">イベント</th>
              </tr>
            </thead>
            <tbody>
              {years.map((r) => (
                <tr
                  key={r.year}
                  className={`${r.shortfall ? 'bad' : ''} ${r.year === selected ? 'selected' : ''}`}
                  onClick={() => setSelected(r.year === selected ? undefined : r.year)}
                  tabIndex={0}
                  onKeyDown={(e) => e.key === 'Enter' && setSelected(r.year === selected ? undefined : r.year)}
                >
                  <th>{r.year}</th>
                  {people.map((x) => (
                    <td key={x.id}>{r.ages[x.id] >= 0 ? r.ages[x.id] : ''}</td>
                  ))}
                  {cols.map((c) => (
                    <td key={c.key} className={c.get(r) < 0 ? 'neg' : ''}>
                      {m(c.get(r))}
                    </td>
                  ))}
                  <td className="text">{[...new Set(r.events)].join('、')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      {sel && <YearDetail plan={plan} row={sel} labels={labels} real={real} onClose={() => setSelected(undefined)} />}
    </>
  )
}

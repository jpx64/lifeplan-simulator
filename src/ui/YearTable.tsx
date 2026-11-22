import { useMemo, useState, type CSSProperties } from 'react'
import { accountLabels, simulate } from '../engine/simulate'
import { DEDUCTION_LABELS, EXPENSE_LABELS, INCOME_LABELS, yearly, type DeductionKey, type ExpenseKey, type IncomeKey, type YearRow } from '../engine/summary'
import type { Plan } from '../engine/types'
import { downloadCsv } from './store'
import { YearDetail } from './YearDetail'

/**
 * How a column is drawn: `key` columns are the ones to read first (bold),
 * `signed` shows +/− in color, `bar` draws a bar behind the value,
 * `detail` columns are breakdowns (quieter).
 */
type Col = { key: string; label: string; get: (r: YearRow) => number; style?: 'key' | 'signed' | 'bar' | 'detail' }
type ColGroup = { id: string; label: string; cols: Col[] }

const FLOW: ColGroup = {
  id: 'flow',
  label: '1年間のお金',
  cols: [
    { key: 'income', label: '収入', get: (r) => r.income },
    { key: 'tax', label: '税・社会保険', get: (r) => r.taxAndInsurance },
    { key: 'takeHome', label: '手取り', get: (r) => r.takeHome },
    { key: 'expenses', label: '支出', get: (r) => r.expenses },
    { key: 'balance', label: '年間収支', get: (r) => r.balance, style: 'signed' },
  ],
}
const STOCK: ColGroup = {
  id: 'stock',
  label: '12月末の残高',
  cols: [
    { key: 'cash', label: '預貯金', get: (r) => r.cash },
    { key: 'total', label: '資産合計', get: (r) => r.totalAssets, style: 'bar' },
    { key: 'loan', label: 'ローン残高', get: (r) => r.loanBalance },
  ],
}
const detail = <K extends string>(prefix: string, labels: Record<K, string>, get: (r: YearRow, k: K) => number): Col[] =>
  (Object.keys(labels) as K[]).map((k) => ({ key: `${prefix}-${k}`, label: labels[k], get: (r) => get(r, k), style: 'detail' }))
const INCOME = detail<IncomeKey>('i', INCOME_LABELS, (r, k) => r.incomeBreakdown[k])
const DEDUCTIONS = detail<DeductionKey>('d', DEDUCTION_LABELS, (r, k) => r.deductionBreakdown[k])
const EXPENSES = detail<ExpenseKey>('e', EXPENSE_LABELS, (r, k) => r.expenseBreakdown[k])

const OPTIONAL = [
  { id: 'income', label: '収入の内訳' },
  { id: 'deductions', label: '税・社保の内訳' },
  { id: 'expenses', label: '支出の内訳' },
  { id: 'accounts', label: '口座ごとの残高' },
] as const
type OptionalId = (typeof OPTIONAL)[number]['id']

const man = (v: number) => Math.round(v / 10_000)
const fmt = (v: number) => man(v).toLocaleString('ja-JP').replace('-', '−')

function Cell({ col, row, max, groupStart }: { col: Col; row: YearRow; max: number; groupStart: boolean }) {
  const v = col.get(row)
  const n = man(v)
  const gs = groupStart ? 'gs' : ''
  if (n === 0 && col.style !== 'bar') return <td className={`zero ${gs}`}>–</td>
  const cls = [gs, n < 0 ? 'neg' : '', col.style === 'signed' && n > 0 ? 'pos' : '', col.style ?? ''].filter(Boolean).join(' ')
  const text = col.style === 'signed' && n > 0 ? `+${fmt(v)}` : fmt(v)
  const bar = col.style === 'bar' && max > 0 ? Math.max(0, Math.min(1, v / max)) : undefined
  if (bar === undefined) return <td className={cls}>{text}</td>
  return (
    <td className={cls} style={{ '--bar': bar.toFixed(3) } as CSSProperties}>
      <span>{text}</span>
    </td>
  )
}

export function YearTable({ plan, real }: { plan: Plan; real: boolean }) {
  const [shown, setShown] = useState<OptionalId[]>([])
  const [selected, setSelected] = useState<number | undefined>()
  const { years, labels } = useMemo(() => {
    const res = simulate(plan)
    return { years: yearly(res, real), labels: accountLabels(plan, res) }
  }, [plan, real])
  const accountCols: Col[] = Object.keys(labels).map((id) => ({ key: `a-${id}`, label: labels[id], get: (r) => r.accounts[id] ?? 0, style: 'detail' }))
  const optional: Record<OptionalId, ColGroup> = {
    income: { id: 'income', label: '収入の内訳', cols: INCOME },
    deductions: { id: 'deductions', label: '税・社会保険の内訳', cols: DEDUCTIONS },
    expenses: { id: 'expenses', label: '支出の内訳', cols: EXPENSES },
    accounts: { id: 'accounts', label: '口座ごとの残高（12月末）', cols: accountCols },
  }
  const groups: ColGroup[] = [FLOW, STOCK, ...OPTIONAL.filter((g) => shown.includes(g.id)).map((g) => optional[g.id])]
  const people = plan.members
  const toggle = (g: OptionalId) => setShown((s) => (s.includes(g) ? s.filter((x) => x !== g) : [...s, g]))
  const sel = years.find((y) => y.year === selected)
  const maxTotal = Math.max(0, ...years.map((y) => y.totalAssets))
  const pick = (r: YearRow) => setSelected(r.year === selected ? undefined : r.year)

  const exportCsv = () => {
    const all = [...FLOW.cols, ...STOCK.cols, ...INCOME, ...DEDUCTIONS, ...EXPENSES, ...accountCols]
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
          単位: 万円{real ? '（いまの物価に換算）' : ''}。行をクリックすると、その年の内訳と月ごとの動きを表示します。
        </p>
        <div className="chips" role="group" aria-label="表示する列">
          {OPTIONAL.map((g) => (
            <label key={g.id} className={`chip ${shown.includes(g.id) ? 'on' : ''}`}>
              <input type="checkbox" checked={shown.includes(g.id)} onChange={() => toggle(g.id)} />
              {g.label}
            </label>
          ))}
        </div>
        <div className="table-wrap">
          <table className="num-table year-table clickable">
            <thead>
              <tr className="group-row">
                <th rowSpan={2} className="year-col">
                  年
                </th>
                <th colSpan={people.length}>
                  <span className="group-label">年齢</span>
                </th>
                {groups.map((g) => (
                  <th key={g.id} colSpan={g.cols.length} className="gs">
                    <span className="group-label">{g.label}</span>
                  </th>
                ))}
                <th rowSpan={2} className="gs text">
                  イベント
                </th>
              </tr>
              <tr>
                {people.map((x) => (
                  <th key={x.id} className="age">
                    {x.name}
                  </th>
                ))}
                {groups.flatMap((g) =>
                  g.cols.map((c, i) => (
                    <th key={c.key} className={[i === 0 ? 'gs' : '', c.style ?? ''].filter(Boolean).join(' ')}>
                      {c.label}
                    </th>
                  )),
                )}
              </tr>
            </thead>
            <tbody>
              {years.map((r) => (
                <tr
                  key={r.year}
                  className={`${r.shortfall ? 'bad' : ''} ${r.year === selected ? 'selected' : ''}`}
                  onClick={() => pick(r)}
                  tabIndex={0}
                  onKeyDown={(e) => e.key === 'Enter' && pick(r)}
                >
                  <th className="year-col">{r.year}</th>
                  {people.map((x) => (
                    <td key={x.id} className="age">
                      {r.ages[x.id] >= 0 ? r.ages[x.id] : ''}
                    </td>
                  ))}
                  {groups.flatMap((g) => g.cols.map((c, i) => <Cell key={c.key} col={c} row={r} max={maxTotal} groupStart={i === 0} />))}
                  <td className="gs text events">{[...new Set(r.events)].join('、')}</td>
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

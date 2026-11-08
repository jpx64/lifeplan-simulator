import { useMemo } from 'react'
import { accountLabels, simulate } from '../engine/simulate'
import { yearly, type YearRow } from '../engine/summary'
import type { Plan } from '../engine/types'
import { downloadCsv } from './store'

const COLS: { key: string; label: string; get: (r: YearRow) => number }[] = [
  { key: 'income', label: '収入', get: (r) => r.income },
  { key: 'tax', label: '税・社会保険', get: (r) => r.taxAndInsurance },
  { key: 'takeHome', label: '手取り', get: (r) => r.takeHome },
  { key: 'expenses', label: '支出', get: (r) => r.expenses },
  { key: 'housing', label: 'うち住居', get: (r) => r.housing },
  { key: 'education', label: 'うち教育', get: (r) => r.education },
  { key: 'balance', label: '年間収支', get: (r) => r.balance },
  { key: 'cash', label: '預貯金', get: (r) => r.cash },
  { key: 'total', label: '資産合計', get: (r) => r.totalAssets },
  { key: 'loan', label: 'ローン残高', get: (r) => r.loanBalance },
]

const m = (v: number) => Math.round(v / 10_000).toLocaleString('ja-JP')

export function YearTable({ plan }: { plan: Plan }) {
  const { years, labels } = useMemo(() => {
    const res = simulate(plan)
    return { years: yearly(res), labels: accountLabels(plan, res) }
  }, [plan])
  const adults = plan.members.filter((x) => x.role !== 'child')
  const children = plan.members.filter((x) => x.role === 'child')

  const exportCsv = () => {
    const accIds = Object.keys(labels)
    const header = ['年', ...plan.members.map((x) => `${x.name}の年齢`), ...COLS.map((c) => c.label), ...accIds.map((id) => labels[id]), 'イベント']
    const rows = years.map((r) => [
      r.year,
      ...plan.members.map((x) => (r.ages[x.id] >= 0 ? r.ages[x.id] : '')),
      ...COLS.map((c) => Math.round(c.get(r))),
      ...accIds.map((id) => Math.round(r.accounts[id] ?? 0)),
      [...new Set(r.events)].join(' / '),
    ])
    downloadCsv(`${plan.name}.csv`, [header, ...rows])
  }

  return (
    <section className="card">
      <div className="card-head">
        <h2>年ごとの表</h2>
        <button type="button" className="secondary" onClick={exportCsv}>
          CSVで書き出す（円単位）
        </button>
      </div>
      <p className="note">単位: 万円。残高は各年の12月末時点。</p>
      <div className="table-wrap">
        <table className="num-table">
          <thead>
            <tr>
              <th>年</th>
              {adults.map((x) => (
                <th key={x.id}>{x.name}</th>
              ))}
              {children.map((x) => (
                <th key={x.id}>{x.name}</th>
              ))}
              {COLS.map((c) => (
                <th key={c.key}>{c.label}</th>
              ))}
              <th className="text">イベント</th>
            </tr>
          </thead>
          <tbody>
            {years.map((r) => (
              <tr key={r.year} className={r.shortfall ? 'bad' : ''}>
                <th>{r.year}</th>
                {[...adults, ...children].map((x) => (
                  <td key={x.id}>{r.ages[x.id] >= 0 ? r.ages[x.id] : ''}</td>
                ))}
                {COLS.map((c) => (
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
  )
}

import { DEDUCTION_LABELS, EXPENSE_LABELS, INCOME_LABELS, type DeductionKey, type ExpenseKey, type IncomeKey, type YearRow } from '../engine/summary'
import type { Plan } from '../engine/types'
import { man } from './format'

const m1 = (v: number) => man(v, 1)

function Breakdown<K extends string>({ title, labels, values, total, totalLabel }: { title: string; labels: Record<K, string>; values: Record<K, number>; total: number; totalLabel: string }) {
  const keys = (Object.keys(labels) as K[]).filter((k) => Math.abs(values[k]) >= 1)
  return (
    <div className="breakdown">
      <h3>{title}</h3>
      <table>
        <tbody>
          {keys.map((k) => (
            <tr key={k}>
              <th>{labels[k]}</th>
              <td className={values[k] < 0 ? 'neg' : ''}>{m1(values[k])}</td>
            </tr>
          ))}
          {keys.length === 0 && (
            <tr>
              <th>なし</th>
              <td />
            </tr>
          )}
        </tbody>
        <tfoot>
          <tr>
            <th>{totalLabel}</th>
            <td>{m1(total)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  )
}

export function YearDetail({ plan, row, labels, onClose, real }: { plan: Plan; row: YearRow; labels: Record<string, string>; onClose: () => void; real: boolean }) {
  const ages = plan.members.filter((x) => row.ages[x.id] >= 0).map((x) => `${x.name} ${row.ages[x.id]}歳`)
  const accIds = Object.keys(row.accountFlows).filter((id) => {
    const f = row.accountFlows[id]
    return f.balance > 0.5 || f.contribution > 0.5 || f.withdrawal > 0.5
  })
  return (
    <section className="card year-detail" aria-label={`${row.year}年の内訳`}>
      <div className="card-head">
        <h2>
          {row.year}年の内訳 <small>{ages.join('・')}</small>
        </h2>
        <button type="button" className="link" onClick={onClose}>
          閉じる
        </button>
      </div>
      {real && <p className="note">いまの物価に換算した金額です。</p>}
      {row.events.length > 0 && <p className="events">この年のできごと: {[...new Set(row.events)].join('、')}</p>}
      <div className="breakdowns">
        <Breakdown<IncomeKey> title="収入" labels={INCOME_LABELS} values={row.incomeBreakdown} total={row.income} totalLabel="収入の合計" />
        <Breakdown<DeductionKey> title="税・社会保険料" labels={DEDUCTION_LABELS} values={row.deductionBreakdown} total={row.taxAndInsurance} totalLabel="合計" />
        <Breakdown<ExpenseKey> title="支出" labels={EXPENSE_LABELS} values={row.expenseBreakdown} total={row.expenses} totalLabel="支出の合計" />
      </div>
      <p className="summary-line">
        手取り <strong>{m1(row.takeHome)}</strong> − 支出 <strong>{m1(row.expenses)}</strong> ＝ 年間収支{' '}
        <strong className={row.balance < 0 ? 'neg' : 'pos'}>{m1(row.balance)}</strong>
      </p>

      <h3>口座の動き</h3>
      <div className="table-wrap">
        <table className="num-table">
          <thead>
            <tr>
              <th className="text">口座</th>
              <th>積立・入金</th>
              <th>運用益</th>
              <th>取り崩し・受取</th>
              <th>年末残高</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <th className="text">預貯金</th>
              <td>—</td>
              <td>—</td>
              <td>—</td>
              <td className={row.cash < 0 ? 'neg' : ''}>{m1(row.cash)}</td>
            </tr>
            {accIds.map((id) => {
              const f = row.accountFlows[id]
              return (
                <tr key={id}>
                  <th className="text">{labels[id] ?? id}</th>
                  <td>{m1(f.contribution)}</td>
                  <td className={f.growth < 0 ? 'neg' : ''}>{m1(f.growth)}</td>
                  <td>{m1(f.withdrawal)}</td>
                  <td>{m1(f.balance)}</td>
                </tr>
              )
            })}
            {row.loanBalance > 0 && (
              <tr>
                <th className="text">住宅ローン残高</th>
                <td>—</td>
                <td>—</td>
                <td>—</td>
                <td className="neg">{m1(-row.loanBalance)}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <details className="months">
        <summary>月ごとの動きを見る</summary>
        <div className="table-wrap">
          <table className="num-table">
            <thead>
              <tr>
                <th>月</th>
                <th>収入</th>
                <th>税・社保</th>
                <th>支出</th>
                <th>収支</th>
                <th>預貯金</th>
                <th className="text">できごと</th>
              </tr>
            </thead>
            <tbody>
              {row.months.map((r) => (
                <tr key={r.ym} className={r.shortfall ? 'bad' : ''}>
                  <th>{Number(r.ym.slice(5))}月</th>
                  <td>{m1(r.income.total)}</td>
                  <td>{m1(r.deductions.total)}</td>
                  <td>{m1(r.expenses.total)}</td>
                  <td className={r.net < 0 ? 'neg' : ''}>{m1(r.net)}</td>
                  <td className={r.cash < 0 ? 'neg' : ''}>{m1(r.cash)}</td>
                  <td className="text">{r.events.join('、')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  )
}

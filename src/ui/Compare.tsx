import { useMemo, useState } from 'react'
import { simulate } from '../engine/simulate'
import { kpis, yearly } from '../engine/summary'
import type { Plan } from '../engine/types'
import { CompareChart } from './Charts'
import { man } from './format'

export function Compare({ plans, real }: { plans: Plan[]; real: boolean }) {
  const [selected, setSelected] = useState<string[]>(() => plans.slice(0, 3).map((p) => p.id))
  const [field, setField] = useState<'totalAssets' | 'liquidAssets'>('totalAssets')
  const data = useMemo(
    () =>
      plans
        .filter((p) => selected.includes(p.id))
        .map((p) => {
          const res = simulate(p)
          return { plan: p, years: yearly(res, real), k: kpis(p, res, p.retirementAge, real), selfId: p.members.find((m) => m.role === 'self')!.id, pensions: res.pensions }
        }),
    [plans, selected, real],
  )

  if (plans.length < 2) {
    return (
      <section className="card">
        <h2>シナリオ比較</h2>
        <p>
          比べるには、プランが2つ以上必要です。上の「複製」でいまのプランをコピーし、条件を変えてみてください（例: 共働きを続ける／片働きになる、家を買う／賃貸のまま）。
        </p>
      </section>
    )
  }

  const toggle = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id].slice(-4)))

  return (
    <div className="compare">
      <section className="card">
        <h2>シナリオ比較</h2>
        <p className="note">比べるプランを選んでください（4つまで）。横軸は本人の年齢です。{real ? 'いまの物価に換算しています。' : ''}</p>
        <div className="chips">
          {plans.map((p) => (
            <label key={p.id} className={`chip ${selected.includes(p.id) ? 'on' : ''}`}>
              <input type="checkbox" checked={selected.includes(p.id)} onChange={() => toggle(p.id)} />
              {p.name}
            </label>
          ))}
        </div>
        <div className="segmented" role="group" aria-label="グラフの対象">
          <button type="button" className={field === 'totalAssets' ? 'on' : ''} onClick={() => setField('totalAssets')}>
            資産合計
          </button>
          <button type="button" className={field === 'liquidAssets' ? 'on' : ''} onClick={() => setField('liquidAssets')}>
            すぐ使える資産（iDeCo などを除く）
          </button>
        </div>
        <CompareChart field={field} series={data.map((d) => ({ name: d.plan.name, years: d.years, selfId: d.selfId }))} />
      </section>
      <section className="card">
        <h2>主な指標</h2>
        <div className="table-wrap">
          <table className="num-table">
            <thead>
              <tr>
                <th className="text">指標</th>
                {data.map((d) => (
                  <th key={d.plan.id}>{d.plan.name}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                <th className="text">資金が尽きる年齢</th>
                {data.map((d) => (
                  <td key={d.plan.id} className={d.k.firstShortfall ? 'neg' : ''}>
                    {d.k.firstShortfall ? `${d.k.firstShortfall.age}歳` : 'なし'}
                  </td>
                ))}
              </tr>
              <tr>
                <th className="text">定年時点の資産</th>
                {data.map((d) => (
                  <td key={d.plan.id}>{d.k.assetsAtRetirement ? man(d.k.assetsAtRetirement.value) : '—'}</td>
                ))}
              </tr>
              <tr>
                <th className="text">資産のピーク</th>
                {data.map((d) => (
                  <td key={d.plan.id}>
                    {man(d.k.peakAssets.value)}（{d.k.peakAssets.age}歳）
                  </td>
                ))}
              </tr>
              <tr>
                <th className="text">預貯金の最小</th>
                {data.map((d) => (
                  <td key={d.plan.id} className={d.k.minCash.value < 0 ? 'neg' : ''}>
                    {man(d.k.minCash.value)}（{d.k.minCash.age}歳）
                  </td>
                ))}
              </tr>
              <tr>
                <th className="text">老後の毎月の収支（平均）</th>
                {data.map((d) => (
                  <td key={d.plan.id} className={(d.k.retirementMonthly?.value ?? 0) < 0 ? 'neg' : ''}>
                    {d.k.retirementMonthly ? man(d.k.retirementMonthly.value, 1) : '—'}
                  </td>
                ))}
              </tr>
              <tr>
                <th className="text">公的年金（世帯・65歳時点の年額）</th>
                {data.map((d) => (
                  <td key={d.plan.id}>{man(Object.values(d.pensions).reduce((s, p) => s + p.total, 0))}</td>
                ))}
              </tr>
              <tr>
                <th className="text">最終年の資産</th>
                {data.map((d) => (
                  <td key={d.plan.id}>
                    {man(d.k.finalAssets.value)}（{d.k.finalAssets.age}歳）
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}

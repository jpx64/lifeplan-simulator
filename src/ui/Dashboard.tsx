import { useMemo, useState } from 'react'
import { simulate } from '../engine/simulate'
import { kpis, yearly } from '../engine/summary'
import type { Plan } from '../engine/types'
import { AssetChart, CashflowChart } from './Charts'
import { man, pct, ymLabel } from './format'

interface Adjust {
  returnDelta: number
  inflation: number
  raiseDelta: number
}

/** Apply "what if" adjustments to a copy of the plan. */
export function adjustPlan(plan: Plan, a: Adjust): Plan {
  return {
    ...plan,
    settings: { ...plan.settings, inflationRate: a.inflation },
    accounts: plan.accounts.map((acc) => ({ ...acc, annualReturn: acc.annualReturn + a.returnDelta })),
    work: plan.work.map((w) => ({ ...w, raiseRate: w.raiseRate + a.raiseDelta })),
  }
}

export function Dashboard({ plan, onApply }: { plan: Plan; onApply: (p: Plan) => void }) {
  const base: Adjust = { returnDelta: 0, inflation: plan.settings.inflationRate, raiseDelta: 0 }
  const [adj, setAdj] = useState<Adjust>(base)
  const adjusted = adj.returnDelta !== 0 || adj.inflation !== base.inflation || adj.raiseDelta !== 0
  const effective = useMemo(() => (adjusted ? adjustPlan(plan, adj) : plan), [plan, adj, adjusted])

  const { result, error } = useMemo(() => {
    try {
      return { result: simulate(effective), error: undefined }
    } catch (e) {
      return { result: undefined, error: e instanceof Error ? e.message : String(e) }
    }
  }, [effective])
  if (!result) return <div className="card error">計算できませんでした: {error}</div>

  const years = yearly(result)
  const k = kpis(effective, result, effective.retirementAge)
  const selfId = plan.members.find((m) => m.role === 'self')!.id
  const eventYears = years.filter((y) => y.events.length > 0)

  return (
    <div className="dashboard">
      {result.warnings.length > 0 && (
        <div className="callout warn" role="status">
          {result.warnings.map((w) => (
            <p key={w}>{w}</p>
          ))}
        </div>
      )}

      <div className="kpis">
        <Kpi
          label={k.firstShortfall ? '資金が尽きる時期' : '資金ショート'}
          value={k.firstShortfall ? `${k.firstShortfall.age}歳` : 'なし'}
          sub={k.firstShortfall ? ymLabel(k.firstShortfall.ym) : `${k.finalAssets.age}歳まで`}
          tone={k.firstShortfall ? 'bad' : 'good'}
        />
        {k.assetsAtRetirement && <Kpi label={`定年（${k.assetsAtRetirement.age}歳）時点の資産`} value={man(k.assetsAtRetirement.value)} />}
        <Kpi label="資産のピーク" value={man(k.peakAssets.value)} sub={`${k.peakAssets.age}歳（${k.peakAssets.year}年）`} />
        <Kpi label="預貯金がいちばん少ない時" value={man(k.minCash.value)} sub={`${k.minCash.age}歳（${ymLabel(k.minCash.ym)}）`} />
        <Kpi label={`${k.finalAssets.age}歳時点の資産`} value={man(k.finalAssets.value)} />
      </div>

      <section className="card">
        <div className="card-head">
          <h2>もしも… で試す</h2>
          {adjusted && (
            <div className="actions">
              <button type="button" className="link" onClick={() => setAdj(base)}>
                元に戻す
              </button>
              <button type="button" className="secondary" onClick={() => { onApply(adjustPlan(plan, adj)); setAdj({ ...base, inflation: adj.inflation }) }}>
                この条件をプランに反映
              </button>
            </div>
          )}
        </div>
        <div className="sliders">
          <Slider label="運用利回り" value={adj.returnDelta} min={-0.04} max={0.04} step={0.005} format={(v) => `${v >= 0 ? '+' : ''}${pct(v)}`} onChange={(v) => setAdj({ ...adj, returnDelta: v })} />
          <Slider label="インフレ率" value={adj.inflation} min={0} max={0.04} step={0.0025} format={(v) => pct(v, 2)} onChange={(v) => setAdj({ ...adj, inflation: v })} />
          <Slider label="昇給率" value={adj.raiseDelta} min={-0.02} max={0.02} step={0.0025} format={(v) => `${v >= 0 ? '+' : ''}${pct(v, 2)}`} onChange={(v) => setAdj({ ...adj, raiseDelta: v })} />
        </div>
        {adjusted && <p className="note">グラフと数値は調整後の条件で表示しています（プランはまだ変わっていません）。</p>}
      </section>

      <section className="card">
        <h2>資産の推移</h2>
        <p className="note">各年の12月末時点。住宅ローン残高は負の値で表示しています。</p>
        <AssetChart plan={effective} years={years} />
      </section>

      <section className="card">
        <h2>毎年の収支</h2>
        <p className="note">手取り収入（税・社会保険料を引いた後）と支出。投資への積立は支出に含めていません。</p>
        <CashflowChart plan={effective} years={years} />
      </section>

      <section className="card">
        <h2>ライフイベント</h2>
        <ul className="timeline">
          {eventYears.map((y) => (
            <li key={y.year}>
              <span className="when">
                {y.year}年<small>{y.ages[selfId]}歳</small>
              </span>
              <span className="what">{[...new Set(y.events)].join('、')}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}

function Kpi({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'good' | 'bad' }) {
  return (
    <div className={`kpi ${tone ?? ''}`}>
      <span className="kpi-label">{label}</span>
      <strong className="kpi-value">{value}</strong>
      {sub && <span className="kpi-sub">{sub}</span>}
    </div>
  )
}

function Slider(props: { label: string; value: number; min: number; max: number; step: number; format: (v: number) => string; onChange: (v: number) => void }) {
  return (
    <label className="slider">
      <span>
        {props.label} <strong>{props.format(props.value)}</strong>
      </span>
      <input type="range" min={props.min} max={props.max} step={props.step} value={props.value} onChange={(e) => props.onChange(Number(e.target.value))} />
    </label>
  )
}

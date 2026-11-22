import { useMemo, useState } from 'react'
import { accountLabels, simulate } from '../engine/simulate'
import { kpis, yearly, type YearRow } from '../engine/summary'
import type { Plan } from '../engine/types'
import { AssetChart, CashflowChart, ExpenseChart } from './Charts'
import { man, manOku, pct, ymLabel } from './format'
import { MonteCarloPanel } from './MonteCarlo'
import { YearDetail } from './YearDetail'

interface Adjust {
  returnDelta: number
  inflation: number
  raiseDelta: number
  expense: number
  pension: number
}

/** Apply "what if" adjustments to a copy of the plan. */
export function adjustPlan(plan: Plan, a: Adjust): Plan {
  return {
    ...plan,
    settings: {
      ...plan.settings,
      inflationRate: a.inflation,
      expenseMultiplier: (plan.settings.expenseMultiplier ?? 1) * a.expense,
      pensionMultiplier: (plan.settings.pensionMultiplier ?? 1) * a.pension,
    },
    accounts: plan.accounts.map((acc) => ({ ...acc, annualReturn: acc.annualReturn + a.returnDelta })),
    work: plan.work.map((w) => ({ ...w, raiseRate: w.raiseRate + a.raiseDelta })),
  }
}

export function Dashboard({ plan, onApply, real }: { plan: Plan; onApply: (p: Plan) => void; real: boolean }) {
  const base: Adjust = { returnDelta: 0, inflation: plan.settings.inflationRate, raiseDelta: 0, expense: 1, pension: 1 }
  const [adj, setAdj] = useState<Adjust>(base)
  const [selectedYear, setSelectedYear] = useState<number | undefined>()
  const adjusted = adj.returnDelta !== 0 || adj.inflation !== base.inflation || adj.raiseDelta !== 0 || adj.expense !== 1 || adj.pension !== 1
  const effective = useMemo(() => (adjusted ? adjustPlan(plan, adj) : plan), [plan, adj, adjusted])

  const { result, error } = useMemo(() => {
    try {
      return { result: simulate(effective), error: undefined }
    } catch (e) {
      return { result: undefined, error: e instanceof Error ? e.message : String(e) }
    }
  }, [effective])
  const years = useMemo(() => (result ? yearly(result, real) : []), [result, real])
  if (!result) return <div className="card error">計算できませんでした: {error}</div>

  const k = kpis(effective, result, effective.retirementAge, real)
  const selfId = plan.members.find((m) => m.role === 'self')!.id
  const eventYears = years.filter((y) => y.events.length > 0)
  const selected = years.find((y) => y.year === selectedYear)
  const labels = accountLabels(effective, result)
  const adults = plan.members.filter((m) => m.role !== 'child')

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
        {k.retirementMonthly && (
          <Kpi
            label="老後の毎月の収支（平均）"
            value={`${k.retirementMonthly.value >= 0 ? '+' : ''}${man(k.retirementMonthly.value, 1)}`}
            sub={`${k.retirementMonthly.fromAge}〜${k.retirementMonthly.toAge}歳。マイナスは資産の取り崩し`}
            tone={k.retirementMonthly.value < 0 ? undefined : 'good'}
          />
        )}
        <Kpi label="資産のピーク" value={man(k.peakAssets.value)} sub={`${k.peakAssets.age}歳（${k.peakAssets.year}年）`} />
        <Kpi label="預貯金がいちばん少ない時" value={man(k.minCash.value)} sub={`${k.minCash.age}歳（${ymLabel(k.minCash.ym)}）`} tone={k.minCash.value < 0 ? 'bad' : undefined} />
        <Kpi label={`${k.finalAssets.age}歳時点の資産`} value={man(k.finalAssets.value)} />
        {adults.map((m) =>
          result.pensions[m.id] ? (
            <Kpi
              key={m.id}
              label={`${m.name}の公的年金（65歳時点・年額）`}
              value={man(result.pensions[m.id].total)}
              sub={`基礎 ${man(result.pensions[m.id].basic)}＋厚生 ${man(result.pensions[m.id].earnings)}（いまの価値）`}
            />
          ) : null,
        )}
      </div>
      <p className="note">
        {real ? 'いまの物価に換算した金額で表示しています。' : '将来の金額はインフレを含んだ額面（名目）です。上の「いまの物価で表示」で換算できます。'}
      </p>

      <section className="card">
        <div className="card-head">
          <h2>もしも… で試す</h2>
          {adjusted && (
            <div className="actions">
              <button type="button" className="link" onClick={() => setAdj(base)}>
                元に戻す
              </button>
              <button
                type="button"
                className="secondary"
                onClick={() => {
                  onApply(adjustPlan(plan, adj))
                  setAdj({ ...base, inflation: adj.inflation })
                }}
              >
                この条件をプランに反映
              </button>
            </div>
          )}
        </div>
        <div className="sliders">
          <Slider label="運用利回り" value={adj.returnDelta} min={-0.04} max={0.04} step={0.005} format={(v) => `${v >= 0 ? '+' : ''}${pct(v)}`} onChange={(v) => setAdj({ ...adj, returnDelta: v })} />
          <Slider label="インフレ率" value={adj.inflation} min={0} max={0.04} step={0.0025} format={(v) => pct(v, 2)} onChange={(v) => setAdj({ ...adj, inflation: v })} />
          <Slider label="昇給率" value={adj.raiseDelta} min={-0.02} max={0.02} step={0.0025} format={(v) => `${v >= 0 ? '+' : ''}${pct(v, 2)}`} onChange={(v) => setAdj({ ...adj, raiseDelta: v })} />
          <Slider label="生活費などの支出" value={adj.expense} min={0.7} max={1.3} step={0.05} format={(v) => `${v >= 1 ? '+' : ''}${pct(v - 1, 0)}`} onChange={(v) => setAdj({ ...adj, expense: v })} />
          <Slider label="公的年金の額" value={adj.pension} min={0.6} max={1.2} step={0.05} format={(v) => `${v >= 1 ? '+' : ''}${pct(v - 1, 0)}`} onChange={(v) => setAdj({ ...adj, pension: v })} />
        </div>
        {adjusted && <p className="note">グラフと数値は調整後の条件で表示しています（プランはまだ変わっていません）。</p>}
      </section>

      <section className="card">
        <h2>資産の推移</h2>
        <p className="note">各年の12月末時点。いちばん上の線が資産合計、住宅ローン残高は負の値で表示しています。カーソルを合わせると合計とローンを差し引いた額、クリックするとその年の内訳を表示します。</p>
        <AssetChart plan={effective} years={years} selected={selectedYear} onSelect={setSelectedYear} />
      </section>

      {selected && <YearDetail plan={effective} row={selected} labels={labels} real={real} onClose={() => setSelectedYear(undefined)} />}

      <section className="card">
        <h2>毎年の収支</h2>
        <p className="note">手取り収入（税・社会保険料を引いた後）と支出。投資への積立は支出に含めていません。</p>
        <CashflowChart plan={effective} years={years} onSelect={setSelectedYear} />
      </section>

      <section className="card">
        <h2>支出の内訳</h2>
        <p className="note">住居費には住宅ローンの返済・固定資産税・修繕費、教育には保育料・学費を含みます。グラフにカーソルを合わせると、その年の合計と割合を表示します。</p>
        <ExpenseStats years={years} real={real} />
        <ExpenseChart plan={effective} years={years} onSelect={setSelectedYear} />
      </section>

      <MonteCarloPanel plan={effective} years={years} real={real} />

      <section className="card">
        <h2>ライフイベント</h2>
        <ul className="timeline">
          {eventYears.map((y) => (
            <li key={y.year}>
              <button type="button" className="when link" onClick={() => setSelectedYear(y.year)}>
                {y.year}年<small>{y.ages[selfId]}歳</small>
              </button>
              <span className="what">{[...new Set(y.events)].join('、')}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}

/** Totals over the whole period, shown above the expense chart. */
function ExpenseStats({ years, real }: { years: YearRow[]; real: boolean }) {
  if (years.length === 0) return null
  const total = years.reduce((s, y) => s + y.expenses, 0)
  const months = years.reduce((s, y) => s + y.months.length, 0)
  const peak = years.reduce((a, b) => (b.expenses > a.expenses ? b : a))
  return (
    <dl className="stat-line">
      <div>
        <dt>
          {years[0].year}〜{years.at(-1)!.year}年の支出合計{real ? '（いまの物価）' : ''}
        </dt>
        <dd>{manOku(total)}</dd>
      </div>
      <div>
        <dt>1年あたり平均</dt>
        <dd>{man(months ? (total / months) * 12 : 0)}</dd>
      </div>
      <div>
        <dt>いちばん多い年</dt>
        <dd>
          {peak.year}年 {man(peak.expenses)}
        </dd>
      </div>
    </dl>
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

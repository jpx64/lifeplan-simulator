import { useMemo, useState } from 'react'
import {
  WORK_CHOICES,
  WORK_LABEL,
  buildScenarios,
  childrenOf,
  currentWork,
  defaultAssumptions,
  homeValueAt,
  housingOf,
  scenarioLabel,
  scenarioNotes,
  workPerson,
  type HousingChoice,
  type Scenario,
  type ScenarioAssumptions,
  type WorkChoice,
  type WorkInput,
} from '../engine/scenarios'
import { simulate } from '../engine/simulate'
import { kpis, yearly, type YearRow } from '../engine/summary'
import type { Plan } from '../engine/types'
import { normalizeWizard } from '../engine/wizard'
import { CompareChart } from './Charts'
import { ManField, MonthField, NumField, PercentField, SelectField } from './fields'
import { man, manOku } from './format'
import { newId } from './store'

type Mode = 'scenario' | 'plans'

export function Compare({ plan, plans, real, onSave }: { plan: Plan; plans: Plan[]; real: boolean; onSave: (p: Plan) => void }) {
  const [mode, setMode] = useState<Mode>('scenario')
  return (
    <div className="compare">
      <div className="segmented" role="group" aria-label="比べ方">
        <button type="button" className={mode === 'scenario' ? 'on' : ''} onClick={() => setMode('scenario')}>
          子ども・住まい・働き方で比べる
        </button>
        <button type="button" className={mode === 'plans' ? 'on' : ''} onClick={() => setMode('plans')}>
          保存したプランどうしで比べる
        </button>
      </div>
      {mode === 'scenario' ? <ScenarioCompare key={plan.id} plan={plan} real={real} onSave={onSave} /> : <PlanCompare plans={plans} real={real} />}
    </div>
  )
}

/* ---------- children × housing × work ---------- */

/** One color per number of children, the same wherever it appears. */
const CHILD_COLORS = ['var(--c9)', 'var(--c1)', 'var(--c2)', 'var(--c3)', 'var(--c4)', 'var(--c7)', 'var(--c6)']
const childColor = (n: number) => CHILD_COLORS[Math.min(n, CHILD_COLORS.length - 1)]
const WORK_COLORS: Record<WorkChoice, string> = { dual: 'var(--c1)', quit: 'var(--c5)', parttime: 'var(--c3)', none: 'var(--c9)' }
const PALETTE = ['var(--c1)', 'var(--c5)', 'var(--c2)', 'var(--c3)', 'var(--c4)', 'var(--c6)', 'var(--c7)', 'var(--c8)', 'var(--c10)', 'var(--c9)']
const HOUSING_LABEL: Record<HousingChoice, string> = { rent: '賃貸のまま', buy: '家を買う' }

type Metric = 'retirement' | 'final' | 'minCash'
const METRICS: { id: Metric; label: string }[] = [
  { id: 'retirement', label: '定年時点の資産' },
  { id: 'final', label: '最終年の資産' },
  { id: 'minCash', label: '預貯金がいちばん少ない時' },
]

interface Result extends Scenario {
  years: YearRow[]
  k: ReturnType<typeof kpis>
  selfId: string
  childCost: number
  childAllowance: number
  housingCost: number
  homeValue: number
  income: number
}

function evaluate(s: Scenario, real: boolean): Result {
  const res = simulate(s.plan)
  const years = yearly(res, real)
  const total = (f: (y: YearRow) => number) => years.reduce((a, y) => a + f(y), 0)
  const last = res.rows.at(-1)!
  return {
    ...s,
    years,
    k: kpis(s.plan, res, s.plan.retirementAge, real),
    selfId: s.plan.members.find((m) => m.role === 'self')!.id,
    childCost: total((y) => y.expenseBreakdown.education + y.expenseBreakdown.childLiving),
    childAllowance: total((y) => y.incomeBreakdown.childAllowance),
    housingCost: total((y) => y.expenseBreakdown.housing),
    homeValue: homeValueAt(s.plan, last.ym) / (real ? last.inflationIndex : 1),
    income: total((y) => y.takeHome),
  }
}

const metricOf = (r: Result, m: Metric) =>
  m === 'retirement' ? (r.k.assetsAtRetirement?.value ?? r.k.finalAssets.value) : m === 'final' ? r.k.finalAssets.value : r.k.minCash.value

function Diff({ value, base }: { value: number; base: number }) {
  const d = Math.round((value - base) / 10_000)
  if (d === 0) return <small className="diff">いまと同じ</small>
  return <small className={`diff ${d > 0 ? 'pos' : 'neg'}`}>{`${d > 0 ? '+' : '−'}${Math.abs(d).toLocaleString('ja-JP')}万円`}</small>
}

function LineSample({ color, dashed }: { color: string; dashed: boolean }) {
  return <span className={`line-sample ${dashed ? 'dashed' : ''}`} style={{ borderColor: color }} aria-hidden />
}

function ScenarioCompare({ plan, real, onSave }: { plan: Plan; real: boolean; onSave: (p: Plan) => void }) {
  const now = childrenOf(plan).length
  const current = housingOf(plan)
  const nowWork = currentWork(plan)
  const who = workPerson(plan)
  const whoName = who ? normalizeWizard(plan.wizard!)[who].name : ''
  const maxKids = Math.max(4, now + 1)
  const [counts, setCounts] = useState<number[]>(() => [now - 1, now, now + 1].filter((n) => n >= 0 && n <= maxKids))
  const [housings, setHousings] = useState<HousingChoice[]>(['rent', 'buy'])
  const [works, setWorks] = useState<WorkChoice[]>(() => (nowWork ? [nowWork] : []))
  const [assume, setAssume] = useState<ScenarioAssumptions>(() => defaultAssumptions(plan))
  const [field, setField] = useState<'totalAssets' | 'liquidAssets'>('totalAssets')
  const [metric, setMetric] = useState<Metric>('retirement')
  const [saved, setSaved] = useState<string[]>([])
  const notes = useMemo(() => scenarioNotes(plan), [plan])
  const changed = JSON.stringify(assume) !== JSON.stringify(defaultAssumptions(plan))

  const base = useMemo(() => evaluate({ children: now, housing: current, work: nowWork, plan, isCurrent: true }, real), [plan, now, current, nowWork, real])
  // results already computed stay while patterns are switched on and off
  const cache = useMemo(() => new Map<string, Result>(), [plan, assume, real])
  const key = (r: Scenario) => `${r.children}-${r.work ?? ''}-${r.housing}`
  const results = useMemo(
    () =>
      buildScenarios(plan, counts, housings, assume, works).map((s) => {
        const k = `${s.children}-${s.work ?? ''}-${s.housing}`
        let r = cache.get(k)
        if (!r) {
          r = evaluate(s, real)
          cache.set(k, r)
        }
        return r
      }),
    [plan, counts, housings, works, assume, real, cache],
  )

  // the plan as it is stays in the chart and the table as the reference, even when it is not one of the patterns
  const shown = results.some((r) => r.isCurrent) ? results : [base, ...results]

  const toggle = <T,>(set: (f: (s: T[]) => T[]) => void, v: T) => set((s) => (s.includes(v) ? (s.length > 1 ? s.filter((x) => x !== v) : s) : [...s, v]))
  const setHousing = (patch: Partial<ScenarioAssumptions['housing']>) => setAssume((a) => ({ ...a, housing: { ...a.housing, ...patch } }))
  const setWork = (patch: Partial<WorkInput>) => setAssume((a) => ({ ...a, work: { ...a.work, ...patch } }))
  const h = assume.housing
  const multiWork = works.length > 1
  const labelOf = (r: Scenario) =>
    scenarioLabel(r.children, r.housing, r.work && (multiWork || r.work !== nowWork) ? { work: r.work, name: whoName } : undefined)
  const name = (r: Scenario) => `${labelOf(r)}${r.isCurrent ? '（いま）' : ''}`

  // colors: by number of children, by work when only work varies, one per pattern when both vary
  const combos = [...new Set(results.map((r) => `${r.children}-${r.work ?? ''}`))]
  const colorOf = (r: Scenario) => {
    if (!multiWork) return childColor(r.children)
    if (counts.length <= 1 && r.work) return WORK_COLORS[r.work]
    const i = combos.indexOf(`${r.children}-${r.work ?? ''}`)
    return i < 0 ? 'var(--text)' : PALETTE[i % PALETTE.length]
  }

  const sortedCounts = [...counts].sort((a, b) => a - b)
  const hcols = (['rent', 'buy'] as const).filter((x) => housings.includes(x))
  const wcols: (WorkChoice | undefined)[] = nowWork ? WORK_CHOICES.filter((x) => works.includes(x)) : [undefined]
  const cell = (n: number, wk: WorkChoice | undefined, hc: HousingChoice) => results.find((r) => r.children === n && r.work === wk && r.housing === hc)
  const maxGap = Math.max(1, ...results.map((r) => Math.abs(metricOf(r, metric) - metricOf(base, metric))))
  const nowLabel = `子ども${now}人・${HOUSING_LABEL[current]}${nowWork ? `・${whoName}${WORK_PHRASE_SHORT[nowWork]}` : ''}`

  const save = (r: Result) => {
    onSave({ ...structuredClone(r.plan), id: newId(), name: `${plan.name}（${labelOf(r)}）` })
    setSaved((s) => [...s, key(r)])
  }

  return (
    <>
      <section className="card">
        <h2>子ども・住まい・働き方で比べる</h2>
        <p className="lead">
          いまのプラン「{plan.name}」（{nowLabel}）をもとに、子どもの人数・住まい・働き方だけを変えて比べます。生活費・運用などほかの条件はそのままです。
        </p>
        <div className="axis-pick">
          <span className="axis-label">子どもの人数</span>
          <div className="chips" role="group" aria-label="比べる子どもの人数">
            {Array.from({ length: maxKids + 1 }, (_, n) => (
              <label key={n} className={`chip ${counts.includes(n) ? 'on' : ''}`}>
                <input type="checkbox" checked={counts.includes(n)} onChange={() => toggle(setCounts, n)} />
                {!multiWork && <span className="swatch" style={{ background: childColor(n) }} />}
                {n}人{n === now && <em>いま</em>}
              </label>
            ))}
          </div>
        </div>
        <div className="axis-pick">
          <span className="axis-label">住まい</span>
          <div className="chips" role="group" aria-label="比べる住まい">
            {(['rent', 'buy'] as const).map((x) => (
              <label key={x} className={`chip ${housings.includes(x) ? 'on' : ''}`}>
                <input type="checkbox" checked={housings.includes(x)} onChange={() => toggle(setHousings, x)} />
                <span className={`line-sample ${x === 'rent' ? 'dashed' : ''}`} aria-hidden />
                {HOUSING_LABEL[x]}
                {x === current && <em>いま</em>}
              </label>
            ))}
          </div>
        </div>
        <div className="axis-pick">
          <span className="axis-label">{who ? `${whoName}の働き方` : '働き方'}</span>
          {nowWork ? (
            <div className="chips" role="group" aria-label="比べる働き方">
              {WORK_CHOICES.map((x) => (
                <label key={x} className={`chip ${works.includes(x) ? 'on' : ''}`}>
                  <input type="checkbox" checked={works.includes(x)} onChange={() => toggle(setWorks, x)} />
                  {multiWork && counts.length <= 1 && <span className="swatch" style={{ background: WORK_COLORS[x] }} />}
                  {WORK_LABEL[x]}
                  {x === nowWork && <em>いま</em>}
                </label>
              ))}
            </div>
          ) : (
            <p className="note axis-off">働き方を変えた比較は、かんたん入力で作った夫婦（パートナー）のプランで使えます。</p>
          )}
        </div>
        {works.includes('quit') && (
          <p className="note">「出産を機に退職」は、これから生まれる子がいないパターン（子ども0人など）では「会社員を続ける」と同じ結果になります。</p>
        )}

        <details className="assumptions">
          <summary>比べるときの前提{changed ? '（変更あり）' : ''}</summary>
          <div className="grid compact">
            <NumField
              label="増やす子どもの生まれる間隔"
              value={assume.childSpacingYears}
              onChange={(v) => setAssume((a) => ({ ...a, childSpacingYears: Math.min(10, Math.max(1, v)) }))}
              suffix="年"
              min={1}
              max={10}
              hint="いちばん下の子の何年後か。進路はいちばん下の子と同じにします"
            />
            <ManField label="賃貸の家賃（月）" value={h.rent} onChange={(v) => setHousing({ rent: v })} hint="賃貸のままの場合、ずっとこの家賃" />
          </div>
          <h3>家を買う場合</h3>
          <div className="grid compact">
            <MonthField label="購入する時期" value={h.buyYM} onChange={(v) => v && setHousing({ buyYM: v })} hint="それまでは上の家賃で賃貸" />
            <SelectField
              label="種類"
              value={h.homeType}
              options={[
                { value: 'house', label: '戸建て' },
                { value: 'condo', label: 'マンション' },
              ]}
              onChange={(v) => setHousing({ homeType: v })}
            />
            <ManField label="物件価格" value={h.price} onChange={(v) => setHousing({ price: v })} step={100} />
            <ManField
              label="頭金"
              value={h.downPayment}
              onChange={(v) => setHousing({ downPayment: v })}
              step={50}
              hint="諸費用（物件価格の約7%）は別に現金で払います"
            />
            <NumField label="借入期間" value={h.loanYears} onChange={(v) => setHousing({ loanYears: v })} suffix="年" min={1} max={50} />
            <PercentField label="当初の金利" value={h.initialRate} onChange={(v) => setHousing({ initialRate: v })} step={0.05} />
            <PercentField
              label="5年ごとの金利の上昇"
              value={h.rateRiseEvery5y}
              onChange={(v) => setHousing({ rateRiseEvery5y: v })}
              step={0.05}
              hint="変動金利で上がっていく想定。固定金利なら0%"
            />
            {h.homeType === 'condo' && <ManField label="管理費・修繕積立金（月）" value={h.condoFees} onChange={(v) => setHousing({ condoFees: v })} />}
          </div>
          {nowWork && (
            <>
              <h3>{whoName}の働き方を変える場合</h3>
              <div className="grid compact">
                <ManField
                  label="会社員の場合の額面年収"
                  value={assume.work.income}
                  onChange={(v) => setWork({ income: v })}
                  step={10}
                  hint="「会社員を続ける」「出産を機に退職」で、いまの年収として使います"
                />
                <ManField
                  label="パートの額面年収"
                  value={assume.work.partTimeIncome}
                  onChange={(v) => setWork({ partTimeIncome: v })}
                  step={10}
                  hint="130万円未満なら配偶者の扶養に入ります"
                />
                <NumField
                  label="退職後、パートを始める子の年齢"
                  value={assume.work.returnChildAge}
                  onChange={(v) => setWork({ returnChildAge: Math.min(18, Math.max(0, v)) })}
                  suffix="歳"
                  min={0}
                  max={18}
                  hint="0ならパートもしない"
                />
              </div>
            </>
          )}
          <div className="actions">
            <button type="button" className="link" disabled={!changed} onClick={() => setAssume(defaultAssumptions(plan))}>
              プランの値に戻す
            </button>
          </div>
        </details>
        {notes.map((n) => (
          <p key={n} className="callout warn">
            {n}
          </p>
        ))}
      </section>

      <section className="card">
        <div className="card-head">
          <h2>ひと目で比べる</h2>
          <div className="segmented" role="group" aria-label="比べる指標">
            {METRICS.map((m) => (
              <button key={m.id} type="button" className={metric === m.id ? 'on' : ''} onClick={() => setMetric(m.id)}>
                {m.label}
              </button>
            ))}
          </div>
        </div>
        <p className="note">
          {METRICS.find((m) => m.id === metric)!.label}と、いまのプラン（{nowLabel}）との差。{real ? 'いまの物価に換算しています。' : ''}
          家を買う場合の家そのものの価値は含みません（下の表の「家の価値の目安」を参照）。
        </p>
        <div className="table-wrap">
          <table className="matrix">
            <thead>
              {multiWork && (
                <tr>
                  <th />
                  {wcols.map((wk) => (
                    <th key={wk} scope="colgroup" colSpan={hcols.length} className="group">
                      {wk && WORK_LABEL[wk]}
                      {wk === nowWork && <em>いま</em>}
                    </th>
                  ))}
                </tr>
              )}
              <tr>
                <th />
                {wcols.flatMap((wk) =>
                  hcols.map((c) => (
                    <th key={`${wk}-${c}`} scope="col">
                      {HOUSING_LABEL[c]}
                      {c === current && !multiWork && <em>いま</em>}
                    </th>
                  )),
                )}
              </tr>
            </thead>
            <tbody>
              {sortedCounts.map((n) => (
                <tr key={n}>
                  <th scope="row">
                    {!multiWork && <span className="swatch" style={{ background: childColor(n) }} />}
                    子ども{n}人{n === now && <em>いま</em>}
                  </th>
                  {wcols.flatMap((wk) =>
                    hcols.map((c) => {
                      const r = cell(n, wk, c)
                      if (!r) return <td key={`${wk}-${c}`} />
                      const v = metricOf(r, metric)
                      const gap = (v - metricOf(base, metric)) / maxGap
                      const tint = Math.round(Math.abs(gap) * 22)
                      return (
                        <td
                          key={`${wk}-${c}`}
                          className={r.isCurrent ? 'current' : ''}
                          style={{
                            background:
                              r.isCurrent || tint === 0 ? undefined : `color-mix(in srgb, var(${gap > 0 ? '--good' : '--bad'}) ${tint}%, transparent)`,
                          }}
                        >
                          {multiWork && <LineSample color={colorOf(r)} dashed={r.housing === 'rent'} />}
                          <strong className={v < 0 ? 'neg' : ''}>{man(v)}</strong>
                          {r.isCurrent ? <small className="diff">いまのプラン</small> : <Diff value={v} base={metricOf(base, metric)} />}
                          {r.k.firstShortfall && <small className="neg">{r.k.firstShortfall.age}歳で資金が尽きる</small>}
                        </td>
                      )
                    }),
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <div className="card-head">
          <h2>資産の推移</h2>
          <div className="segmented" role="group" aria-label="グラフの対象">
            <button type="button" className={field === 'totalAssets' ? 'on' : ''} onClick={() => setField('totalAssets')}>
              資産合計
            </button>
            <button type="button" className={field === 'liquidAssets' ? 'on' : ''} onClick={() => setField('liquidAssets')}>
              すぐ使える資産（iDeCo などを除く）
            </button>
          </div>
        </div>
        <p className="note">
          {!multiWork ? '色が子どもの人数、' : counts.length <= 1 ? '色が働き方、' : '色はパターンごと（上の表の線の見本と同じ）、'}
          実線が家を買う場合、破線が賃貸のままの場合です。太い線がいまのプラン。横軸は本人の年齢です。
        </p>
        <CompareChart
          field={field}
          series={shown.map((r) => ({ name: name(r), years: r.years, selfId: r.selfId, color: colorOf(r), dashed: r.housing === 'rent', bold: r.isCurrent }))}
        />
      </section>

      <section className="card">
        <h2>パターンごとの結果</h2>
        <p className="note">
          金額は{real ? 'いまの物価に換算した' : '額面の'}
          合計です。家を買う場合、家そのものの価値は資産合計に含めていないため「家の価値の目安」として別に示します（土地は購入時の価格のまま、建物は木造22年・マンション47年で価値がなくなるとした概算）。
        </p>
        <div className="table-wrap">
          <table className="num-table scenario-table">
            <thead>
              <tr>
                <th className="text">パターン</th>
                <th>資金が尽きる年齢</th>
                <th>定年時点の資産</th>
                <th>預貯金の最少</th>
                <th>老後の毎月の収支</th>
                <th>最終年の資産</th>
                <th>家の価値の目安</th>
                {multiWork && <th>生涯の手取り収入</th>}
                <th>教育費・子の生活費</th>
                <th>児童手当</th>
                <th>住居費</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={`${key(r)}${r.isCurrent ? '-current' : ''}`} className={r.isCurrent ? 'selected' : ''}>
                  <th className="text">
                    <LineSample color={colorOf(r)} dashed={r.housing === 'rent'} />
                    {name(r)}
                  </th>
                  <td className={r.k.firstShortfall ? 'neg' : ''}>{r.k.firstShortfall ? `${r.k.firstShortfall.age}歳` : 'なし'}</td>
                  <td>
                    {r.k.assetsAtRetirement ? man(r.k.assetsAtRetirement.value) : '—'}
                    {r.k.assetsAtRetirement && base.k.assetsAtRetirement && !r.isCurrent && (
                      <Diff value={r.k.assetsAtRetirement.value} base={base.k.assetsAtRetirement.value} />
                    )}
                  </td>
                  <td className={r.k.minCash.value < 0 ? 'neg' : ''}>
                    {man(r.k.minCash.value)}
                    <small className="diff">{r.k.minCash.age}歳</small>
                  </td>
                  <td className={(r.k.retirementMonthly?.value ?? 0) < 0 ? 'neg' : ''}>{r.k.retirementMonthly ? man(r.k.retirementMonthly.value, 1) : '—'}</td>
                  <td>
                    {manOku(r.k.finalAssets.value)}
                    {!r.isCurrent && <Diff value={r.k.finalAssets.value} base={base.k.finalAssets.value} />}
                  </td>
                  <td>{r.homeValue > 0 ? manOku(r.homeValue) : '—'}</td>
                  {multiWork && (
                    <td>
                      {manOku(r.income)}
                      {!r.isCurrent && <Diff value={r.income} base={base.income} />}
                    </td>
                  )}
                  <td>{manOku(r.childCost)}</td>
                  <td>{man(r.childAllowance)}</td>
                  <td>{manOku(r.housingCost)}</td>
                  <td>
                    {r.isCurrent ? (
                      <small className="diff">いまのプラン</small>
                    ) : saved.includes(key(r)) ? (
                      <small className="diff">保存しました</small>
                    ) : (
                      <button
                        type="button"
                        className="link"
                        onClick={() => save(r)}
                        title="このパターンを新しいプランとして保存し、詳しい結果を見られるようにします"
                      >
                        プランとして保存
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="note">
          住居費は家賃・頭金・諸費用・ローン返済・固定資産税・修繕費などの合計です。
          {multiWork ? '生涯の手取り収入は、給与・年金・給付金などから税・社会保険料を引いた合計です。' : ''}
          保存したプランは上の「プラン」から選べます。
        </p>
      </section>
    </>
  )
}

const WORK_PHRASE_SHORT: Record<WorkChoice, string> = { dual: 'は会社員', quit: 'は出産で退職', parttime: 'はパート', none: 'は働かない' }

/* ---------- saved plans ---------- */

function PlanCompare({ plans, real }: { plans: Plan[]; real: boolean }) {
  const [selected, setSelected] = useState<string[]>(() => plans.slice(0, 3).map((p) => p.id))
  const [field, setField] = useState<'totalAssets' | 'liquidAssets'>('totalAssets')
  const data = useMemo(
    () =>
      plans
        .filter((p) => selected.includes(p.id))
        .map((p) => {
          const res = simulate(p)
          return {
            plan: p,
            years: yearly(res, real),
            k: kpis(p, res, p.retirementAge, real),
            selfId: p.members.find((m) => m.role === 'self')!.id,
            pensions: res.pensions,
          }
        }),
    [plans, selected, real],
  )

  if (plans.length < 2) {
    return (
      <section className="card">
        <h2>保存したプランどうしで比べる</h2>
        <p>
          比べるには、プランが2つ以上必要です。「子どもの人数・住まいで比べる」の結果を「プランとして保存」するか、上の「複製」でいまのプランをコピーして条件を変えてみてください（例:
          共働きを続ける／片働きになる）。
        </p>
      </section>
    )
  }

  const toggle = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id].slice(-4)))

  return (
    <>
      <section className="card">
        <h2>保存したプランどうしで比べる</h2>
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
    </>
  )
}

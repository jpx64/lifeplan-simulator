import { useMemo, useState } from 'react'
import { analyzeDeath, deathScenarioAtAge } from '../engine/risk'
import { simulate } from '../engine/simulate'
import { realMonth, shortfallSpans, yearly } from '../engine/summary'
import { ageAt, ymToIndex } from '../engine/time'
import type { Plan } from '../engine/types'
import { CompareChart } from './Charts'
import { ManField, NumField, PercentField, SelectField } from './fields'
import { man } from './format'

export function Risk({ plan, real }: { plan: Plan; real: boolean }) {
  const adults = plan.members.filter((m) => m.role !== 'child')
  const startT = ymToIndex(plan.settings.start)
  const ageNow = (id: string) => ageAt(ymToIndex(plan.members.find((m) => m.id === id)!.birth), startT)
  const [memberId, setMemberId] = useState(adults[0].id)
  const [age, setAge] = useState(() => ageNow(adults[0].id))
  const [insurance, setInsurance] = useState(0)
  const [livingRatio, setLivingRatio] = useState(0.7)
  const [survivorIsWife, setSurvivorIsWife] = useState(memberId === 'self')
  const hasSpouse = adults.length > 1
  const name = plan.members.find((m) => m.id === memberId)!.name
  const survivor = adults.find((m) => m.id !== memberId)

  const analysis = useMemo(
    () => analyzeDeath(plan, deathScenarioAtAge(plan, memberId, age, { lifeInsurance: insurance, livingRatio, survivorIsWife })),
    [plan, memberId, age, insurance, livingRatio, survivorIsWife],
  )
  const baseYears = useMemo(() => yearly(simulate(plan), real), [plan, real])
  const deathYears = useMemo(() => yearly(analysis.result, real), [analysis, real])
  const selfId = plan.members.find((m) => m.role === 'self')!.id

  // coverage needed by age at death, to see how it shrinks over time
  const byAge = useMemo(() => {
    const from = ageNow(memberId)
    const ages: number[] = []
    for (let a = from; a <= Math.min(64, from + 30); a += 5) ages.push(a)
    return ages.map((a) => ({
      age: a,
      coverage: analyzeDeath(plan, deathScenarioAtAge(plan, memberId, a, { lifeInsurance: 0, livingRatio, survivorIsWife })).requiredCoverage,
    }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan, memberId, livingRatio, survivorIsWife])

  const gap = analysis.requiredCoverage - insurance
  const spans = useMemo(() => shortfallSpans(real ? analysis.result.rows.map(realMonth) : analysis.result.rows), [analysis, real])
  const runsOut = spans.find((s) => s.toEnd)
  const brief = spans.find((s) => !s.toEnd)
  const whenFor = (ym: string, ages: Record<string, number>) => (survivor ? `${survivor.name}が${ages[survivor.id]}歳` : `${ym.slice(0, 4)}年`)
  const deathYear = Math.floor(ymToIndex(analysis.scenario.ym) / 12)
  const after = deathYears.filter((y) => y.year >= deathYear).slice(0, 12)

  return (
    <div className="risk">
      <section className="card">
        <h2>万一のときの備え（必要保障額）</h2>
        <p className="lead">
          家族のだれかが亡くなった場合に、遺族年金・団体信用生命保険（団信）・死亡保険金でお金が足りるかを試算します。
        </p>
        <div className="grid">
          <SelectField label="亡くなる人" value={memberId} options={adults.map((m) => ({ value: m.id, label: m.name }))} onChange={(v) => { setMemberId(v); setAge(ageNow(v)); setSurvivorIsWife(v === 'self') }} />
          <NumField label="亡くなる年齢" value={age} onChange={(v) => setAge(Math.max(ageNow(memberId), v))} suffix="歳" min={ageNow(memberId)} max={80} />
          <ManField label="加入している死亡保険の保険金" value={insurance} onChange={setInsurance} step={100} hint="団信は自動で反映します（住宅ローンが完済されます）" />
          <PercentField label="亡くなった後の生活費（住居・教育以外）" value={livingRatio} onChange={setLivingRatio} step={5} hint="目安は7割前後" />
          {hasSpouse && (
            <SelectField
              label={`遺される${survivor?.name ?? '配偶者'}は`}
              value={survivorIsWife ? 'wife' : 'husband'}
              options={[
                { value: 'wife', label: '妻' },
                { value: 'husband', label: '夫' },
              ]}
              onChange={(v) => setSurvivorIsWife(v === 'wife')}
              hint="遺族厚生年金・中高齢寡婦加算の条件が男女で異なるため使います"
            />
          )}
        </div>
      </section>

      <div className="kpis">
        <div className={`kpi ${gap > 0 ? 'bad' : 'good'}`}>
          <span className="kpi-label">必要な保障額の目安</span>
          <strong className="kpi-value">{man(analysis.requiredCoverage)}</strong>
          <span className="kpi-sub">{gap > 0 ? `いまの保険では ${man(gap)} 不足` : 'いまの保険・資産で足りる見込み'}</span>
        </div>
        <div className="kpi">
          <span className="kpi-label">亡くなった翌年の年金収入</span>
          <strong className="kpi-value">{man(analysis.survivorPensionFirstYear)}</strong>
          <span className="kpi-sub">遺族年金を含む（非課税）</span>
        </div>
        {runsOut ? (
          <div className="kpi bad">
            <span className="kpi-label">保険金を含めても、お金が尽きる時期</span>
            <strong className="kpi-value">{runsOut.from.ym.slice(0, 4)}年</strong>
            <span className="kpi-sub">{whenFor(runsOut.from.ym, runsOut.from.ages)}のとき。その後も足りないまま</span>
          </div>
        ) : brief ? (
          <div className="kpi warn">
            <span className="kpi-label">保険金を含めても、一時的に足りなくなる額</span>
            <strong className="kpi-value">最大{man(brief.maxDeficit)}</strong>
            <span className="kpi-sub">
              {brief.from.ym.slice(0, 4)}年（{whenFor(brief.from.ym, brief.from.ages)}）から。その後は持ち直す
            </span>
          </div>
        ) : (
          <div className="kpi good">
            <span className="kpi-label">保険金を含めた、お金が尽きる時期</span>
            <strong className="kpi-value">なし</strong>
            <span className="kpi-sub">{baseYears.at(-1)?.year ?? ''}年まで</span>
          </div>
        )}
      </div>

      <section className="card">
        <h2>資産の推移の比べ</h2>
        <p className="note">
          {name}が{age}歳で亡くなった場合と、そうでない場合。{real ? 'いまの物価に換算しています。' : ''}横軸は本人の年齢です。
        </p>
        <CompareChart
          series={[
            { name: 'ふだんどおり', years: baseYears, selfId },
            { name: `${name}が${age}歳で亡くなった場合`, years: deathYears, selfId },
          ]}
        />
      </section>

      <section className="card">
        <h2>亡くなった後の家計（12年分）</h2>
        <div className="table-wrap">
          <table className="num-table">
            <thead>
              <tr>
                <th>年</th>
                {survivor && <th>{survivor.name}</th>}
                <th>給与</th>
                <th>年金（遺族年金を含む）</th>
                <th>児童手当</th>
                <th>その他の収入</th>
                <th>税・社保</th>
                <th>支出</th>
                <th>年間収支</th>
                <th>預貯金</th>
                <th>資産合計</th>
              </tr>
            </thead>
            <tbody>
              {after.map((y) => (
                <tr key={y.year} className={y.shortfall ? 'bad' : ''}>
                  <th>{y.year}</th>
                  {survivor && <td>{y.ages[survivor.id]}歳</td>}
                  <td>{man(y.incomeBreakdown.salary)}</td>
                  <td>{man(y.incomeBreakdown.pension)}</td>
                  <td>{man(y.incomeBreakdown.childAllowance)}</td>
                  <td>{man(y.incomeBreakdown.other + y.incomeBreakdown.retirement + y.incomeBreakdown.accountPayout + y.incomeBreakdown.leaveBenefit + y.incomeBreakdown.taxRefund)}</td>
                  <td>{man(y.taxAndInsurance)}</td>
                  <td>{man(y.expenses)}</td>
                  <td className={y.balance < 0 ? 'neg' : ''}>{man(y.balance)}</td>
                  <td className={y.cash < 0 ? 'neg' : ''}>{man(y.cash)}</td>
                  <td>{man(y.totalAssets)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <h2>亡くなる年齢ごとの必要保障額</h2>
        <p className="note">保険金なしで試算した場合の、資金が尽きないために必要な額です。子どもが大きくなり、資産が増えるほど小さくなります。</p>
        <div className="table-wrap">
          <table className="num-table">
            <thead>
              <tr>
                <th>{name}が亡くなる年齢</th>
                <th>必要保障額の目安</th>
              </tr>
            </thead>
            <tbody>
              {byAge.map((r) => (
                <tr key={r.age}>
                  <th>{r.age}歳</th>
                  <td>{man(r.coverage)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <h2>この試算に含まれるもの</h2>
        <ul className="plain">
          <li>遺族基礎年金: 18歳の年度末までの子がいる間、基礎年金の満額＋子の加算（2人目まで年23.9万円、3人目から7.98万円）</li>
          <li>遺族厚生年金: 亡くなった人の報酬比例部分の3/4（会社員のまま亡くなった場合、加入300月未満は300月とみなす）。65歳からは自分の老齢厚生年金との差額</li>
          <li>中高齢寡婦加算: 子のいない40〜64歳の妻に年62.4万円。夫が遺される場合、遺族厚生年金は55歳以上で亡くなったときに60歳から（子がいる間は支給）</li>
          <li>団信: 住宅ローンを借りている人が亡くなると残高が0になり、返済がなくなります</li>
          <li>亡くなった人の給与・年金・積立は止まり、iDeCo・企業型DCは死亡一時金、退職金はそれまでの勤続分を死亡退職金として受け取ります（相続税は考慮していません）</li>
          <li>2028年4月からの遺族厚生年金の見直し（子のいない配偶者への5年間の有期給付など）は反映していません</li>
        </ul>
      </section>
    </div>
  )
}

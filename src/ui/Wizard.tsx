import { useMemo, useState } from 'react'
import { DEFAULT_EDUCATION } from '../engine/defaults'
import { simulate } from '../engine/simulate'
import { shortfallSpans, type ShortfallSpan } from '../engine/summary'
import { ymToIndex } from '../engine/time'
import type { EducationPlan, Plan } from '../engine/types'
import { buildPlan, normalizeWizard, type CareInput, type WizardAdult, type WizardInput, type WorkStyle } from '../engine/wizard'
import { CheckField, ManField, MonthField, NumField, PercentField, SelectField, TextField } from './fields'
import { man, pct, ymLabel } from './format'

const STEPS = ['家族', '働き方', '住まい', 'いまの資産', '毎月の支出', '老後'] as const

interface Props {
  initial: WizardInput
  onFinish: (w: WizardInput) => void
  onCancel?: () => void
  finishLabel: string
}

export function Wizard({ initial, onFinish, onCancel, finishLabel }: Props) {
  const [w, setW] = useState<WizardInput>(() => normalizeWizard(initial))
  const [step, setStep] = useState(0)
  const set = <K extends keyof WizardInput>(k: K, v: WizardInput[K]) => setW((x) => ({ ...x, [k]: v }))
  const setAdult = (who: 'self' | 'spouse', patch: Partial<WizardAdult>) => setW((x) => ({ ...x, [who]: { ...x[who], ...patch } }))
  const setHousing = (patch: Partial<WizardInput['housing']>) => setW((x) => ({ ...x, housing: { ...x.housing, ...patch } }))
  const adults: ('self' | 'spouse')[] = w.hasSpouse ? ['self', 'spouse'] : ['self']
  // the plan as entered so far: the money at a house purchase (from the housing step) and the pension estimate (last step)
  const preview = useMemo(() => {
    if (step < 2) return undefined
    try {
      const plan = buildPlan(w)
      return { plan, result: simulate(plan) }
    } catch {
      return undefined
    }
  }, [w, step])
  const pensionPreview = step === 5 ? preview?.result.pensions : undefined
  const buysLater = w.housing.mode === 'buy' && w.housing.buyYM > w.start
  // short of money within a year of the purchase: the down payment and costs are more than the savings
  const purchaseGap = useMemo(() => {
    if (!preview || !buysLater) return undefined
    const buyT = ymToIndex(w.housing.buyYM)
    return shortfallSpans(preview.result.rows).find((s) => s.from.t >= buyT && s.from.t < buyT + 12)
  }, [preview, buysLater, w.housing.buyYM])

  return (
    <div className="wizard">
      <ol className="steps" aria-label="入力ステップ">
        {STEPS.map((s, i) => (
          <li key={s} className={i === step ? 'current' : i < step ? 'done' : ''}>
            <button type="button" onClick={() => setStep(i)}>
              <span className="num">{i + 1}</span>
              {s}
            </button>
          </li>
        ))}
      </ol>

      <section className="card step-body">
        {step === 0 && (
          <>
            <h2>家族</h2>
            <p className="lead">シミュレーションの対象になる家族を入力します。生まれる予定の子も入れられます。</p>
            <div className="grid">
              <MonthField label="シミュレーション開始" value={w.start} onChange={(v) => v && set('start', v)} />
              <NumField label="何歳まで計算するか（本人）" value={w.endAge} onChange={(v) => set('endAge', v)} suffix="歳" min={60} max={110} />
            </div>
            <h3>大人</h3>
            <div className="grid">
              <TextField label="本人の呼び名" value={w.self.name} onChange={(v) => setAdult('self', { name: v })} />
              <MonthField label="本人の生まれ年月" value={w.self.birth} onChange={(v) => v && setAdult('self', { birth: v })} />
            </div>
            <CheckField label="配偶者・パートナーがいる" checked={w.hasSpouse} onChange={(v) => set('hasSpouse', v)} />
            {w.hasSpouse && (
              <div className="grid">
                <TextField label="配偶者の呼び名" value={w.spouse.name} onChange={(v) => setAdult('spouse', { name: v })} />
                <MonthField label="配偶者の生まれ年月" value={w.spouse.birth} onChange={(v) => v && setAdult('spouse', { birth: v })} />
              </div>
            )}
            <h3>子ども</h3>
            {w.children.map((c, i) => (
              <div className="subcard" key={i}>
                <div className="subcard-head">
                  <strong>{c.name}</strong>
                  <button type="button" className="link danger" onClick={() => set('children', w.children.filter((_, j) => j !== i))}>
                    削除
                  </button>
                </div>
                <div className="grid">
                  <TextField label="呼び名" value={c.name} onChange={(v) => set('children', w.children.map((x, j) => (j === i ? { ...x, name: v } : x)))} />
                  <MonthField
                    label="生まれ年月（予定も可）"
                    value={c.birth}
                    onChange={(v) => v && set('children', w.children.map((x, j) => (j === i ? { ...x, birth: v } : x)))}
                  />
                </div>
                <EducationFields value={c.education} onChange={(e) => set('children', w.children.map((x, j) => (j === i ? { ...x, education: e } : x)))} />
              </div>
            ))}
            <button
              type="button"
              className="secondary"
              onClick={() => set('children', [...w.children, { name: `子${w.children.length + 1}`, birth: w.start, education: { ...DEFAULT_EDUCATION } }])}
            >
              ＋ 子どもを追加
            </button>
          </>
        )}

        {step === 1 && (
          <>
            <h2>働き方</h2>
            <p className="lead">
              年収は<strong>額面（税・社会保険料を引く前）</strong>で入力します。手取り・税金・社会保険料は自動で計算します。
            </p>
            {adults.map((who) => {
              const a = w[who]
              const style = a.workStyle ?? 'employee'
              const futureChild = w.children.some((c) => c.birth >= w.start)
              return (
                <div className="subcard" key={who}>
                  <div className="subcard-head">
                    <strong>{a.name}</strong>
                  </div>
                  <div className="grid">
                    <SelectField<WorkStyle>
                      label="いまの働き方"
                      value={style}
                      options={[
                        { value: 'employee', label: '会社員（厚生年金に加入）' },
                        { value: 'parttime', label: 'パート・アルバイト' },
                        { value: 'none', label: '働いていない' },
                      ]}
                      onChange={(v) => setAdult(who, { workStyle: v, working: v !== 'none' })}
                    />
                  </div>
                  {style === 'employee' && (
                    <>
                      <div className="grid">
                        <ManField label="額面年収（賞与込み）" value={a.annualIncome} onChange={(v) => setAdult(who, { annualIncome: v })} step={10} />
                        <PercentField label="うち賞与の割合" value={a.bonusShare} onChange={(v) => setAdult(who, { bonusShare: v })} step={5} />
                        <PercentField label="昇給率（年）" value={a.raiseRate} onChange={(v) => setAdult(who, { raiseRate: v })} />
                        <NumField label="定年" value={a.retireAge} onChange={(v) => setAdult(who, { retireAge: v })} suffix="歳" />
                        <ManField label="退職金（額面）" value={a.retirementAllowance} onChange={(v) => setAdult(who, { retirementAllowance: v })} step={50} />
                      </div>
                      <CheckField label="定年後も再雇用などで働く" checked={a.reemploy} onChange={(v) => setAdult(who, { reemploy: v })} />
                      {a.reemploy && (
                        <div className="grid">
                          <ManField label="再雇用後の額面年収" value={a.reemployIncome} onChange={(v) => setAdult(who, { reemployIncome: v })} step={10} />
                          <NumField label="何歳まで働くか" value={a.reemployUntilAge} onChange={(v) => setAdult(who, { reemployUntilAge: v })} suffix="歳" />
                        </div>
                      )}
                      {futureChild && (
                        <>
                          <h4>これから生まれる子のとき</h4>
                          <CheckField
                            label="出産する（産前産後休業を取る）"
                            checked={!!a.givesBirth}
                            onChange={(v) => setAdult(who, { givesBirth: v })}
                            hint="出産の前月から約3か月、出産手当金（給与の2/3）を受け取ります"
                          />
                          <SelectField
                            label="出産・育休のあと"
                            value={a.afterLeave ?? 'return'}
                            options={[
                              { value: 'return', label: '同じ会社に復職する' },
                              { value: 'quit', label: '退職する（あとでパートなどで働く）' },
                            ]}
                            onChange={(v) => setAdult(who, { afterLeave: v })}
                          />
                          {(a.afterLeave ?? 'return') === 'return' ? (
                            <div className="grid">
                              <NumField
                                label="育休の長さ（出産から）"
                                value={a.leaveMonths}
                                onChange={(v) => setAdult(who, { leaveMonths: v })}
                                suffix="か月"
                                hint="育児休業給付金（最初の6か月は67%、その後は50%）を自動で計算します"
                              />
                              <PercentField
                                label="時短勤務中の給与"
                                value={a.shortTimeRatio}
                                onChange={(v) => setAdult(who, { shortTimeRatio: v })}
                                step={5}
                                hint="100%なら時短なし。2歳になるまでは育児時短就業給付（10%）を受け取ります"
                              />
                              <NumField label="時短は子が何歳になるまで" value={a.shortTimeUntilChildAge} onChange={(v) => setAdult(who, { shortTimeUntilChildAge: v })} suffix="歳" />
                            </div>
                          ) : (
                            <div className="grid">
                              <NumField
                                label="再び働き始めるのは子が何歳のとき"
                                value={a.returnChildAge ?? 6}
                                onChange={(v) => setAdult(who, { returnChildAge: v })}
                                suffix="歳"
                                hint="0なら働かない"
                              />
                              <ManField label="そのときの年収（パートなど）" value={a.returnIncome ?? 1_000_000} onChange={(v) => setAdult(who, { returnIncome: v })} step={10} hint="130万円未満なら配偶者の扶養に入ります" />
                            </div>
                          )}
                        </>
                      )}
                    </>
                  )}
                  {style === 'parttime' && (
                    <div className="grid">
                      <ManField label="年収（額面）" value={a.partTimeIncome ?? 1_000_000} onChange={(v) => setAdult(who, { partTimeIncome: v })} step={10} />
                      <CheckField
                        label="勤務先の社会保険に入っている"
                        checked={!!a.partTimeSocialInsurance}
                        onChange={(v) => setAdult(who, { partTimeSocialInsurance: v })}
                        hint="入っていない場合、年収130万円未満なら会社員の配偶者の扶養、それ以上なら国民健康保険・国民年金"
                      />
                      <NumField label="何歳まで働くか" value={a.retireAge} onChange={(v) => setAdult(who, { retireAge: v })} suffix="歳" />
                    </div>
                  )}
                </div>
              )
            })}
          </>
        )}

        {step === 2 && (
          <>
            <h2>住まい</h2>
            <SelectField
              label="住まいの予定"
              value={w.housing.mode}
              options={[
                { value: 'rent', label: 'ずっと賃貸' },
                { value: 'buy', label: '家を買う（購入済みも含む）' },
              ]}
              onChange={(v) => setHousing({ mode: v })}
            />
            {(w.housing.mode === 'rent' || w.housing.buyYM > w.start) && (
              <div className="grid">
                <ManField label="いまの家賃（月）" value={w.housing.rent} onChange={(v) => setHousing({ rent: v })} step={0.5} />
              </div>
            )}
            {w.housing.mode === 'buy' && (
              <>
                <div className="grid">
                  <MonthField label="購入（入居）年月" value={w.housing.buyYM} onChange={(v) => v && setHousing({ buyYM: v })} hint="購入済みなら過去の年月を入力" />
                  <ManField label="物件価格" value={w.housing.price} onChange={(v) => setHousing({ price: v })} step={100} />
                  <SelectField
                    label="種類"
                    value={w.housing.homeType}
                    options={[
                      { value: 'house', label: '戸建て' },
                      { value: 'condo', label: 'マンション' },
                    ]}
                    onChange={(v) => setHousing({ homeType: v })}
                  />
                  <SelectField
                    label="新築／中古"
                    value={w.housing.isNew ? 'new' : 'used'}
                    options={[
                      { value: 'new', label: '新築' },
                      { value: 'used', label: '中古' },
                    ]}
                    onChange={(v) => setHousing({ isNew: v === 'new' })}
                  />
                  <SelectField
                    label="住宅の省エネ性能"
                    value={w.housing.performance}
                    options={[
                      { value: 'longLife', label: '長期優良住宅・低炭素住宅' },
                      { value: 'zeh', label: 'ZEH水準省エネ住宅' },
                      { value: 'energy', label: '省エネ基準適合住宅' },
                      { value: 'other', label: 'その他' },
                    ]}
                    onChange={(v) => setHousing({ performance: v })}
                    hint="住宅ローン控除の上限額が変わります"
                  />
                  <CheckField label="子育て世帯・若者夫婦世帯" checked={w.housing.childRearing} onChange={(v) => setHousing({ childRearing: v })} />
                  {w.housing.homeType === 'condo' && (
                    <ManField label="管理費＋修繕積立金（月）" value={w.housing.condoFees} onChange={(v) => setHousing({ condoFees: v })} step={0.5} />
                  )}
                </div>
                <h3>住宅ローン</h3>
                <div className="grid">
                  <ManField label="頭金" value={w.housing.downPayment} onChange={(v) => setHousing({ downPayment: v })} step={50} hint={`借入額: ${((w.housing.price - w.housing.downPayment) / 10_000).toLocaleString()}万円`} />
                  <NumField label="返済期間" value={w.housing.loanYears} onChange={(v) => setHousing({ loanYears: v })} suffix="年" />
                  <PercentField label="当初の金利" value={w.housing.initialRate} onChange={(v) => setHousing({ initialRate: v })} step={0.05} />
                  <PercentField
                    label="5年ごとの金利上昇幅"
                    value={w.housing.rateRiseEvery5y}
                    onChange={(v) => setHousing({ rateRiseEvery5y: v })}
                    step={0.05}
                    hint="変動金利の上昇を見込む場合。固定金利なら0%"
                  />
                  <NumField label="残りを一括返済する年齢（本人）" value={w.housing.payoffAge} onChange={(v) => setHousing({ payoffAge: v })} suffix="歳" hint="0なら一括返済しない" />
                  {w.housing.rateRiseEvery5y > 0 && (
                    <CheckField
                      label="変動金利の5年ルール・125%ルールあり"
                      checked={!!w.housing.fiveYearRule}
                      onChange={(v) => setHousing({ fiveYearRule: v })}
                      hint="返済額は5年ごとにしか変わらず、上がっても1.25倍まで。払いきれない利息は最後に精算します"
                    />
                  )}
                </div>
                <p className="note">
                  固定資産税・都市計画税は物件価格から自動で概算します。諸費用（物件価格の7%）、火災・地震保険、修繕費も自動で入ります。あとから「詳細設定」で変更できます。
                </p>
                {buysLater && preview && <PurchaseCheck plan={preview.plan} gap={purchaseGap} early />}
              </>
            )}
          </>
        )}

        {step === 3 && (
          <>
            <h2>いまの資産</h2>
            <div className="grid">
              <ManField label="預貯金" value={w.cash} onChange={(v) => set('cash', v)} step={10} />
              <ManField label="特定口座（課税口座）の時価" value={w.taxableBalance} onChange={(v) => set('taxableBalance', v)} step={10} />
              <ManField label="特定口座の取得額（元本）" value={w.taxableCostBasis} onChange={(v) => set('taxableCostBasis', v)} step={10} hint="売却時の税金の計算に使います" />
              <PercentField label="運用の想定利回り（年）" value={w.investReturn} onChange={(v) => set('investReturn', v)} />
            </div>
            {adults.map((who) => {
              const a = w[who]
              return (
                <div className="subcard" key={who}>
                  <div className="subcard-head">
                    <strong>{a.name}</strong>
                  </div>
                  <div className="grid">
                    <ManField label="NISAの時価" value={a.nisaBalance} onChange={(v) => setAdult(who, { nisaBalance: v })} step={10} />
                    <ManField label="NISAの取得額（元本）" value={a.nisaCostBasis} onChange={(v) => setAdult(who, { nisaCostBasis: v })} step={10} hint="生涯の非課税枠（1,800万円）の残りの計算に使います" />
                    <ManField label="NISAの毎月の積立" value={a.nisaMonthly} onChange={(v) => setAdult(who, { nisaMonthly: v })} step={0.5} />
                    <ManField label="iDeCoの残高" value={a.idecoBalance} onChange={(v) => setAdult(who, { idecoBalance: v })} step={10} />
                    <ManField label="iDeCoの毎月の掛金" value={a.idecoMonthly} onChange={(v) => setAdult(who, { idecoMonthly: v })} step={0.1} hint="65歳から受け取ります（受け取り方は「老後」で選べます）" />
                    <MonthField label="iDeCoの加入年月" value={a.idecoJoined} onChange={(v) => v && setAdult(who, { idecoJoined: v })} />
                    <ManField label="企業型DCの残高" value={a.dcBalance} onChange={(v) => setAdult(who, { dcBalance: v })} step={10} />
                    <ManField label="企業型DCの会社掛金（月）" value={a.dcMonthly} onChange={(v) => setAdult(who, { dcMonthly: v })} step={0.1} />
                    {a.dcMonthly > 0 && (
                      <ManField
                        label="企業型DCのマッチング拠出（自分の掛金・月）"
                        value={a.dcMatchingMonthly ?? 0}
                        onChange={(v) => setAdult(who, { dcMatchingMonthly: v })}
                        step={0.1}
                        hint="給与から天引きされ、iDeCoと同じく所得控除になります。上限は会社の規約で確認してください"
                      />
                    )}
                    <MonthField label="企業型DCの加入年月" value={a.dcJoined} onChange={(v) => v && setAdult(who, { dcJoined: v })} />
                  </div>
                </div>
              )
            })}
          </>
        )}

        {step === 4 && (
          <>
            <h2>毎月の支出</h2>
            <p className="lead">いまの金額で入力します。インフレ率に合わせて毎年自動で増えます。住居費・教育費・子の生活費は別に計算するので含めないでください。</p>
            <div className="grid">
              <ManField label="生活費（食費・日用品・光熱通信・交通・医療など）" value={w.living} onChange={(v) => set('living', v)} step={0.5} />
              <ManField label={`${w.self.name}の小遣い`} value={w.allowanceSelf} onChange={(v) => set('allowanceSelf', v)} step={0.5} />
              {w.hasSpouse && <ManField label={`${w.spouse.name}の小遣い`} value={w.allowanceSpouse} onChange={(v) => set('allowanceSpouse', v)} step={0.5} />}
              <ManField label="生命保険（死亡保障）の保険料（月）" value={w.lifeInsurance} onChange={(v) => set('lifeInsurance', v)} step={0.1} hint="65歳まで。生命保険料控除に使います" />
              <ManField label="医療保険の保険料（月）" value={w.medicalInsurance} onChange={(v) => set('medicalInsurance', v)} step={0.1} />
              <ManField label="特別費（旅行・家電など）の年額" value={w.specialAnnual} onChange={(v) => set('specialAnnual', v)} step={10} />
              <PercentField label="インフレ率（年）" value={w.inflationRate} onChange={(v) => set('inflationRate', v)} step={0.05} />
            </div>
            <h3>車</h3>
            <div className="grid">
              <ManField label="維持費（月）" value={w.carMonthly} onChange={(v) => set('carMonthly', v)} step={0.5} hint="0なら車なし" />
              <ManField label="買い替え時の価格" value={w.carPrice} onChange={(v) => set('carPrice', v)} step={10} />
              <NumField label="買い替えの間隔" value={w.carReplaceYears} onChange={(v) => set('carReplaceYears', v)} suffix="年" />
              <NumField label="何歳まで車を持つか（本人）" value={w.carUntilAge} onChange={(v) => set('carUntilAge', v)} suffix="歳" />
            </div>
            <h3>介護</h3>
            <p className="note">
              介護にかかった費用の平均は、月9.0万円・期間4年7か月、住宅の改修などの一時費用が47.2万円です（生命保険文化センター「生命保険に関する全国実態調査」2024年度）。
            </p>
            <CareFields
              label="親の介護費用を見込む"
              ageLabel={`始まる時期（${w.self.name}の年齢）`}
              monthlyHint="親の年金や貯蓄で賄えない分"
              value={w.parentCare!}
              onChange={(v) => set('parentCare', v)}
            />
            <CareFields
              label={w.hasSpouse ? '自分たちの介護費用を見込む（1人ずつ）' : '自分の介護費用を見込む'}
              ageLabel={w.hasSpouse ? '始まる年齢（それぞれの年齢）' : '始まる年齢'}
              monthlyHint={w.hasSpouse ? '1人あたり。公的介護保険の自己負担を含む' : '公的介護保険の自己負担を含む'}
              value={w.ownCare!}
              onChange={(v) => set('ownCare', v)}
            />
          </>
        )}

        {step === 5 && (
          <>
            <h2>老後</h2>
            <h3>公的年金</h3>
            <p className="note">
              「自動で概算」では、これまでの平均年収と、このシミュレーションで計算する将来の給与から、老齢基礎年金と老齢厚生年金を計算します。ねんきん定期便の金額がわかる場合は「手入力」も選べます。
            </p>
            {adults.map((who) => {
              const a = w[who]
              const est = pensionPreview?.[who]
              const employee = (a.workStyle ?? 'employee') === 'employee'
              return (
                <div className="subcard" key={who}>
                  <div className="subcard-head">
                    <strong>{a.name}</strong>
                  </div>
                  <div className="grid">
                    <SelectField
                      label="年金額の決め方"
                      value={a.pensionMode ?? 'auto'}
                      options={[
                        { value: 'auto', label: '自動で概算（おすすめ）' },
                        { value: 'manual', label: 'ねんきん定期便の額を手入力' },
                      ]}
                      onChange={(v) => setAdult(who, { pensionMode: v })}
                    />
                    {(a.pensionMode ?? 'auto') === 'auto' ? (
                      <>
                        {employee ? (
                          <NumField label="会社員として働き始めた年齢" value={a.careerStartAge ?? 22} onChange={(v) => setAdult(who, { careerStartAge: v })} suffix="歳" />
                        ) : (
                          <NumField label="これまでに会社員だった年数" value={a.pastKoseiYears ?? 0} onChange={(v) => setAdult(who, { pastKoseiYears: v })} suffix="年" />
                        )}
                        <ManField
                          label="会社員だった間の平均年収（額面）"
                          value={a.pastAverageIncome ?? 0}
                          onChange={(v) => setAdult(who, { pastAverageIncome: v })}
                          step={10}
                          hint="いまの物価でざっくりと。賞与込み"
                        />
                      </>
                    ) : (
                      <ManField
                        label="65歳からの年金額（年額）"
                        value={a.pensionAt65}
                        onChange={(v) => setAdult(who, { pensionAt65: v })}
                        step={1}
                        hint="ねんきん定期便の見込み額（老齢基礎年金＋老齢厚生年金）"
                      />
                    )}
                    <NumField
                      label="受給開始年齢"
                      value={a.pensionStartAge}
                      onChange={(v) => setAdult(who, { pensionStartAge: v })}
                      suffix="歳"
                      min={60}
                      max={75}
                      hint="繰上げは1か月あたり0.4%減、繰下げは0.7%増"
                    />
                  </div>
                  {est && (
                    <p className="pension-estimate">
                      65歳時点の見込み（いまの価値・年額）: <strong>{man(est.total)}</strong>（老齢基礎年金 {man(est.basic)}＋老齢厚生年金 {man(est.earnings)}、厚生年金の加入 約{Math.round(est.koseiMonths / 12)}年）
                    </p>
                  )}
                </div>
              )
            })}
            {adults.some((who) => w[who].idecoBalance > 0 || w[who].idecoMonthly > 0 || w[who].dcBalance > 0 || w[who].dcMonthly > 0) && (
              <>
                <h3>iDeCo・企業型DCの受け取り方</h3>
                <div className="grid">
                  <SelectField
                    label="受け取り方"
                    value={w.dcReceiveMode ?? 'lump'}
                    options={[
                      { value: 'lump', label: '一時金で受け取る' },
                      { value: 'annuity', label: '年金で受け取る（分割）' },
                      { value: 'mixed', label: '半分ずつ（一時金と年金の併用）' },
                    ]}
                    onChange={(v) => set('dcReceiveMode', v)}
                    hint="一時金は退職所得（退職金と控除を分け合う）、年金は公的年金と合わせた雑所得として課税されます"
                  />
                  {(w.dcReceiveMode ?? 'lump') !== 'lump' && (
                    <NumField label="年金で受け取る期間" value={w.dcAnnuityYears ?? 10} onChange={(v) => set('dcAnnuityYears', Math.min(20, Math.max(5, v)))} suffix="年" min={5} max={20} />
                  )}
                </div>
              </>
            )}
            <h3>老後の暮らしと資産の取り崩し</h3>
            <div className="grid">
              <PercentField label="退職後の生活費（現役時代に対して）" value={w.retirementLivingRatio} onChange={(v) => set('retirementLivingRatio', v)} step={5} />
              <ManField label="生活防衛資金（預金の下限）" value={w.cashFloor} onChange={(v) => set('cashFloor', v)} step={10} hint="預金がこれを下回る月は積立を止め、特定口座→NISAの順に売って補います" />
              <SelectField
                label="NISAなどの取り崩し方"
                value={w.withdrawMode ?? 'needed'}
                options={[
                  { value: 'needed', label: '預金が足りなくなったときだけ売る' },
                  { value: 'rate', label: '決まった年齢から毎年一定の割合を売る' },
                ]}
                onChange={(v) => set('withdrawMode', v)}
              />
              {w.withdrawMode === 'rate' && (
                <>
                  <NumField label="取り崩しを始める年齢" value={w.withdrawStartAge} onChange={(v) => set('withdrawStartAge', v)} suffix="歳" />
                  <PercentField label="毎年取り崩す割合" value={w.withdrawRate} onChange={(v) => set('withdrawRate', v)} />
                </>
              )}
            </div>
            <CheckField
              label="預金が多すぎるときは、超えた分を毎月NISAに回す"
              checked={!!w.sweep}
              onChange={(v) => set('sweep', v)}
              hint="NISAの枠を超えた分は特定口座（課税）に回します"
            />
            {w.sweep && (
              <div className="grid">
                <ManField label="預金の上限" value={w.cashCeiling ?? 10_000_000} onChange={(v) => set('cashCeiling', v)} step={50} />
              </div>
            )}
            {purchaseGap && preview && <PurchaseCheck plan={preview.plan} gap={purchaseGap} onFix={() => setStep(2)} />}
          </>
        )}
      </section>

      <div className="wizard-nav">
        {onCancel && (
          <button type="button" className="link" onClick={onCancel}>
            キャンセル
          </button>
        )}
        <span className="spacer" />
        {step > 0 && (
          <button type="button" className="secondary" onClick={() => setStep(step - 1)}>
            戻る
          </button>
        )}
        {step < STEPS.length - 1 ? (
          <button type="button" className="primary" onClick={() => setStep(step + 1)}>
            次へ
          </button>
        ) : (
          <button type="button" className="primary" onClick={() => onFinish(w)}>
            {finishLabel}
          </button>
        )}
      </div>
    </div>
  )
}

/**
 * The money needed when buying a home, and a warning when it is more than the savings at that time.
 * `early`: shown before the assets and expenses are entered, so it says what the check is based on.
 */
function PurchaseCheck({ plan, gap, early, onFix }: { plan: Plan; gap?: ShortfallSpan; early?: boolean; onFix?: () => void }) {
  const p = plan.housing.purchase
  if (!p) return null
  const down = p.price - (p.loan?.amount ?? 0)
  const costs = p.price * p.closingCostRate
  return (
    <div className={`callout purchase-check ${gap ? 'warn' : ''}`} role={gap ? 'status' : undefined}>
      <p>
        購入時に必要なお金の目安: 頭金 {man(down)}＋諸費用 約{man(costs)}（物件価格の{pct(p.closingCostRate, 0)}）＝ 約{man(down + costs)}
      </p>
      {gap && (
        <p>
          <strong>
            このままだと、{gap.from.ym === gap.to.ym ? ymLabel(gap.from.ym) : `${ymLabel(gap.from.ym)}〜${ymLabel(gap.to.ym)}`}にお金が最大{man(gap.maxDeficit)}
            足りなくなります。
          </strong>
          頭金を減らす、購入を遅らせる、それまでに貯めるなどで解消できます。
        </p>
      )}
      {early && <p className="note">預貯金や毎月の支出は、この先の画面で入力した値（まだなら初期値）で試算しています。</p>}
      {onFix && (
        <button type="button" className="link" onClick={onFix}>
          住まいの入力に戻る
        </button>
      )}
    </div>
  )
}

function EducationFields({ value, onChange }: { value: EducationPlan; onChange: (e: EducationPlan) => void }) {
  const school = [
    { value: 'public' as const, label: '公立' },
    { value: 'private' as const, label: '私立' },
  ]
  const set = <K extends keyof EducationPlan>(k: K, v: EducationPlan[K]) => onChange({ ...value, [k]: v })
  return (
    <div className="grid compact">
      <CheckField label="0〜2歳は保育園" checked={value.daycare} onChange={(v) => set('daycare', v)} />
      <SelectField label="幼稚園・保育園(3〜5歳)" value={value.kindergarten} options={school} onChange={(v) => set('kindergarten', v)} />
      <SelectField label="小学校" value={value.elementary} options={school} onChange={(v) => set('elementary', v)} />
      <SelectField label="中学校" value={value.juniorHigh} options={school} onChange={(v) => set('juniorHigh', v)} />
      <SelectField label="高校" value={value.high} options={school} onChange={(v) => set('high', v)} />
      <SelectField
        label="大学"
        value={value.university}
        options={[
          { value: 'none', label: '進学しない' },
          { value: 'national', label: '国公立' },
          { value: 'privateArts', label: '私立文系' },
          { value: 'privateScience', label: '私立理系' },
        ]}
        onChange={(v) => set('university', v)}
      />
      {value.university !== 'none' && <CheckField label="大学は下宿（仕送り）" checked={value.livingAway} onChange={(v) => set('livingAway', v)} />}
    </div>
  )
}

function CareFields(props: { label: string; ageLabel: string; monthlyHint: string; value: CareInput; onChange: (v: CareInput) => void }) {
  const { value: c } = props
  const set = (patch: Partial<CareInput>) => props.onChange({ ...c, ...patch })
  return (
    <div className="subcard">
      <CheckField label={props.label} checked={c.enabled} onChange={(v) => set({ enabled: v })} />
      {c.enabled && (
        <div className="grid">
          <NumField label={props.ageLabel} value={c.startAge} onChange={(v) => set({ startAge: v })} suffix="歳" min={20} max={110} />
          <NumField label="期間" value={c.years} onChange={(v) => set({ years: Math.max(0, v) })} suffix="年" min={0} max={30} />
          <ManField label="費用（月）" value={c.monthly} onChange={(v) => set({ monthly: v })} step={0.5} hint={props.monthlyHint} />
          <ManField label="一時費用" value={c.initial} onChange={(v) => set({ initial: v })} step={5} hint="住宅の改修・介護用品など。始まる月に払います" />
        </div>
      )}
    </div>
  )
}

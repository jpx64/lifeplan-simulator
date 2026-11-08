import { useState } from 'react'
import { DEFAULT_EDUCATION } from '../engine/defaults'
import type { EducationPlan } from '../engine/types'
import type { WizardAdult, WizardInput } from '../engine/wizard'
import { CheckField, ManField, MonthField, NumField, PercentField, SelectField, TextField } from './fields'

const STEPS = ['家族', '働き方', '住まい', 'いまの資産', '毎月の支出', '老後'] as const

interface Props {
  initial: WizardInput
  onFinish: (w: WizardInput) => void
  onCancel?: () => void
  finishLabel: string
}

export function Wizard({ initial, onFinish, onCancel, finishLabel }: Props) {
  const [w, setW] = useState<WizardInput>(initial)
  const [step, setStep] = useState(0)
  const set = <K extends keyof WizardInput>(k: K, v: WizardInput[K]) => setW((x) => ({ ...x, [k]: v }))
  const setAdult = (who: 'self' | 'spouse', patch: Partial<WizardAdult>) => setW((x) => ({ ...x, [who]: { ...x[who], ...patch } }))
  const setHousing = (patch: Partial<WizardInput['housing']>) => setW((x) => ({ ...x, housing: { ...x.housing, ...patch } }))
  const adults: ('self' | 'spouse')[] = w.hasSpouse ? ['self', 'spouse'] : ['self']

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
              年収は<strong>額面（税・社会保険料を引く前）</strong>で入力します。手取りや税金は自動で計算します。会社員を前提にしています。
            </p>
            {adults.map((who) => {
              const a = w[who]
              return (
                <div className="subcard" key={who}>
                  <div className="subcard-head">
                    <strong>{a.name}</strong>
                  </div>
                  <CheckField label="会社員として働いている" checked={a.working} onChange={(v) => setAdult(who, { working: v })} />
                  {a.working && (
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
                      {w.children.some((c) => c.birth >= w.start) && (
                        <>
                          <h4>これから生まれる子の育休・時短</h4>
                          <div className="grid">
                            <NumField
                              label="育休の長さ"
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
                              hint="100%なら時短なし"
                            />
                            <NumField label="時短は子が何歳になるまで" value={a.shortTimeUntilChildAge} onChange={(v) => setAdult(who, { shortTimeUntilChildAge: v })} suffix="歳" />
                          </div>
                        </>
                      )}
                    </>
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
                </div>
                <p className="note">
                  固定資産税・都市計画税は物件価格から自動で概算します。諸費用（物件価格の7%）、火災・地震保険、修繕費も自動で入ります。あとから「詳細設定」で変更できます。
                </p>
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
                    <ManField label="iDeCoの毎月の掛金" value={a.idecoMonthly} onChange={(v) => setAdult(who, { idecoMonthly: v })} step={0.1} hint="65歳で一時金として受け取ります" />
                    <MonthField label="iDeCoの加入年月" value={a.idecoJoined} onChange={(v) => v && setAdult(who, { idecoJoined: v })} />
                    <ManField label="企業型DCの残高" value={a.dcBalance} onChange={(v) => setAdult(who, { dcBalance: v })} step={10} />
                    <ManField label="企業型DCの会社掛金（月）" value={a.dcMonthly} onChange={(v) => setAdult(who, { dcMonthly: v })} step={0.1} />
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
          </>
        )}

        {step === 5 && (
          <>
            <h2>老後</h2>
            {adults.map((who) => {
              const a = w[who]
              return (
                <div className="grid" key={who}>
                  <ManField
                    label={`${a.name}の公的年金（65歳時点の年額）`}
                    value={a.pensionAt65}
                    onChange={(v) => setAdult(who, { pensionAt65: v })}
                    step={1}
                    hint="ねんきん定期便の見込み額を入力。目安: 会社員の厚生年金＋基礎年金で150〜200万円"
                  />
                  <NumField
                    label={`${a.name}の受給開始年齢`}
                    value={a.pensionStartAge}
                    onChange={(v) => setAdult(who, { pensionStartAge: v })}
                    suffix="歳"
                    min={60}
                    max={75}
                    hint="繰上げは1か月あたり0.4%減、繰下げは0.7%増"
                  />
                </div>
              )
            })}
            <div className="grid">
              <PercentField label="退職後の生活費（現役時代に対して）" value={w.retirementLivingRatio} onChange={(v) => set('retirementLivingRatio', v)} step={5} />
              <ManField label="生活防衛資金（預金の下限）" value={w.cashFloor} onChange={(v) => set('cashFloor', v)} step={10} hint="預金がこれを下回ったら、特定口座→NISAの順に売って補います" />
              <NumField label="NISAなどの計画的な取り崩しを始める年齢" value={w.withdrawStartAge} onChange={(v) => set('withdrawStartAge', v)} suffix="歳" />
              <PercentField label="毎年取り崩す割合" value={w.withdrawRate} onChange={(v) => set('withdrawRate', v)} />
            </div>
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

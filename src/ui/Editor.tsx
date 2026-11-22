import { useState, type ReactNode } from 'react'
import { DEFAULT_EDUCATION, defaultPurchase } from '../engine/defaults'
import { propertyTaxAnnual } from '../engine/housing'
import { DEFAULT_VOLATILITY } from '../engine/simulate'
import type {
  Account,
  AccountKind,
  Contribution,
  Expense,
  ExpenseCategory,
  InsuranceDeductionType,
  Member,
  OneOff,
  Plan,
  Purchase,
  RentPeriod,
  WorkPeriod,
} from '../engine/types'
import { CheckField, ManField, MonthField, NumField, PercentField, SelectField, TextField, YenField } from './fields'
import { man } from './format'
import { newId } from './store'

const SECTIONS = ['基本設定', '家族', '仕事', '年金・退職金', '支出', '一時的な収支', '住まい', '資産口座'] as const
type Section = (typeof SECTIONS)[number]

export function Editor({ plan, onChange }: { plan: Plan; onChange: (p: Plan) => void }) {
  const [section, setSection] = useState<Section>('基本設定')
  const set = <K extends keyof Plan>(k: K, v: Plan[K]) => onChange({ ...plan, [k]: v })
  const memberOptions = plan.members.filter((m) => m.role !== 'child').map((m) => ({ value: m.id, label: m.name }))

  return (
    <div className="editor">
      <nav className="side-nav" aria-label="詳細設定の項目">
        {SECTIONS.map((s) => (
          <button key={s} type="button" className={s === section ? 'on' : ''} onClick={() => setSection(s)}>
            {s}
          </button>
        ))}
      </nav>
      <div className="editor-body">
        {plan.wizard && plan.id !== 'sample' && (
          <p className="callout">
            ここで変更した内容は、「かんたん入力」をやり直すと上書きされます。
          </p>
        )}
        {section === '基本設定' && <SettingsSection plan={plan} onChange={onChange} />}
        {section === '家族' && (
          <ListSection<Member>
            title="家族"
            items={plan.members}
            onChange={(v) => set('members', v)}
            create={() => ({ id: newId(), name: `子${plan.members.filter((m) => m.role === 'child').length + 1}`, role: 'child', birth: plan.settings.start, education: { ...DEFAULT_EDUCATION } })}
            addLabel="子どもを追加"
            canRemove={(m) => m.role === 'child'}
            itemTitle={(m) => m.name}
            render={(m, up) => (
              <>
                <div className="grid">
                  <TextField label="呼び名" value={m.name} onChange={(v) => up({ name: v })} />
                  <MonthField label="生まれ年月" value={m.birth} onChange={(v) => v && up({ birth: v })} />
                </div>
                {m.role === 'child' && m.education && (
                  <div className="grid compact">
                    <CheckField label="0〜2歳は保育園" checked={m.education.daycare} onChange={(v) => up({ education: { ...m.education!, daycare: v } })} />
                    {(['kindergarten', 'elementary', 'juniorHigh', 'high'] as const).map((k) => (
                      <SelectField
                        key={k}
                        label={{ kindergarten: '幼稚園・保育園(3〜5歳)', elementary: '小学校', juniorHigh: '中学校', high: '高校' }[k]}
                        value={m.education![k]}
                        options={[
                          { value: 'public', label: '公立' },
                          { value: 'private', label: '私立' },
                        ]}
                        onChange={(v) => up({ education: { ...m.education!, [k]: v } })}
                      />
                    ))}
                    <SelectField
                      label="大学"
                      value={m.education.university}
                      options={[
                        { value: 'none', label: '進学しない' },
                        { value: 'national', label: '国公立' },
                        { value: 'privateArts', label: '私立文系' },
                        { value: 'privateScience', label: '私立理系' },
                      ]}
                      onChange={(v) => up({ education: { ...m.education!, university: v } })}
                    />
                    <CheckField label="大学は下宿" checked={m.education.livingAway} onChange={(v) => up({ education: { ...m.education!, livingAway: v } })} />
                  </div>
                )}
              </>
            )}
          />
        )}
        {section === '仕事' && (
          <ListSection<WorkPeriod>
            title="仕事の期間"
            intro="期間ごとに額面の月給と年間賞与を入力します。育休の期間は、直前の勤務の給与から育児休業給付金を計算します。"
            items={plan.work}
            onChange={(v) => set('work', v)}
            create={() => ({ id: newId(), memberId: 'self', label: '会社員', kind: 'employed', from: plan.settings.start, monthlySalary: 300_000, annualBonus: 0, raiseRate: 0.01 })}
            addLabel="期間を追加"
            itemTitle={(w) => `${nameOf(plan, w.memberId)}: ${w.label}（${w.from}〜${w.to ?? ''}）`}
            render={(w, up) => (
              <div className="grid">
                <SelectField label="誰の" value={w.memberId} options={memberOptions} onChange={(v) => up({ memberId: v })} />
                <TextField label="名前" value={w.label} onChange={(v) => up({ label: v })} />
                <SelectField
                  label="種類"
                  value={w.kind}
                  options={[
                    { value: 'employed', label: '勤務（会社員）' },
                    { value: 'parentalLeave', label: '育休' },
                  ]}
                  onChange={(v) => up({ kind: v })}
                />
                <MonthField label="開始" value={w.from} onChange={(v) => v && up({ from: v })} />
                <MonthField label="終了（この月まで）" value={w.to} onChange={(v) => up({ to: v })} optional />
                {w.kind === 'employed' ? (
                  <>
                    <ManField label="額面月給" value={w.monthlySalary} onChange={(v) => up({ monthlySalary: v })} step={0.5} />
                    <ManField label="年間賞与（額面）" value={w.annualBonus} onChange={(v) => up({ annualBonus: v })} step={5} hint="6月と12月に半分ずつ" />
                    <PercentField label="昇給率（年）" value={w.raiseRate} onChange={(v) => up({ raiseRate: v })} />
                    <CheckField
                      label="勤務先の社会保険（厚生年金・健康保険）に入る"
                      checked={w.socialInsurance !== false}
                      onChange={(v) => up({ socialInsurance: v })}
                      hint="パートで入らない場合、年収130万円未満なら会社員の配偶者の扶養に入ります"
                    />
                    <MonthField
                      label="育児時短就業給付を受ける最後の月"
                      value={w.shortTimeBenefitTo}
                      onChange={(v) => up({ shortTimeBenefitTo: v })}
                      optional
                      hint="2歳未満の子のための時短勤務中、賃金の10%。空欄なら受けない"
                    />
                  </>
                ) : (
                  <>
                    <CheckField label="産前産後休業から始まる（最初の3か月は出産手当金）" checked={!!w.maternity} onChange={(v) => up({ maternity: v })} />
                    <CheckField label="出生後休業支援給付（育休の最初の28日に+13%）" checked={!!w.postBirthSupplement} onChange={(v) => up({ postBirthSupplement: v })} />
                  </>
                )}
              </div>
            )}
          />
        )}
        {section === '年金・退職金' && (
          <>
            <ListSection
              title="公的年金"
              items={plan.pensions.map((p) => ({ ...p, id: p.memberId }))}
              onChange={(v) => set('pensions', v.map(({ id: _id, ...p }) => p))}
              create={() => ({ id: 'x', memberId: memberOptions[0].value, startAge: 65, mode: 'auto' as const, annualAmountAt65: 1_500_000, careerStartAge: 22, pastAverageIncome: 4_000_000 })}
              addLabel="年金を追加"
              itemTitle={(p) => `${nameOf(plan, p.memberId)}（${p.mode === 'auto' ? '自動で概算' : `手入力 ${man(p.annualAmountAt65)}`}・${p.startAge}歳から）`}
              render={(p, up) => (
                <div className="grid">
                  <SelectField label="誰の" value={p.memberId} options={memberOptions} onChange={(v) => up({ memberId: v })} />
                  <SelectField
                    label="年金額の決め方"
                    value={p.mode ?? 'manual'}
                    options={[
                      { value: 'auto', label: '給与の履歴から自動で概算' },
                      { value: 'manual', label: 'ねんきん定期便の額を手入力' },
                    ]}
                    onChange={(v) => up({ mode: v })}
                  />
                  {p.mode === 'auto' ? (
                    <>
                      <NumField label="会社員として働き始めた年齢" value={p.careerStartAge ?? 22} onChange={(v) => up({ careerStartAge: v })} suffix="歳" />
                      <CheckField
                        label="開始時点で会社員ではない"
                        checked={p.pastKoseiYears !== undefined}
                        onChange={(v) => up({ pastKoseiYears: v ? 0 : undefined })}
                        hint="オフにすると、働き始めた年齢から開始時点までずっと会社員として計算します"
                      />
                      {p.pastKoseiYears !== undefined && (
                        <NumField label="これまでに会社員だった年数" value={p.pastKoseiYears} onChange={(v) => up({ pastKoseiYears: v })} suffix="年" />
                      )}
                      <ManField label="これまでの平均年収（額面・いまの価値）" value={p.pastAverageIncome ?? 0} onChange={(v) => up({ pastAverageIncome: v })} step={10} />
                      <NumField label="国民年金の加入月数（20〜60歳）" value={p.basicMonths ?? 480} onChange={(v) => up({ basicMonths: v })} suffix="か月" max={480} hint="未納・免除がなければ480" />
                    </>
                  ) : (
                    <ManField label="65歳時点の年額（いまの価値）" value={p.annualAmountAt65} onChange={(v) => up({ annualAmountAt65: v })} step={1} hint="ねんきん定期便の見込み額" />
                  )}
                  <NumField label="受給開始年齢" value={p.startAge} onChange={(v) => up({ startAge: v })} suffix="歳" min={60} max={75} />
                  <CheckField label="加給年金を受け取る（条件を満たす場合）" checked={p.spousalAddition !== false} onChange={(v) => up({ spousalAddition: v })} />
                </div>
              )}
            />
            <ListSection
              title="退職金"
              items={plan.retirementAllowances}
              onChange={(v) => set('retirementAllowances', v)}
              create={() => ({ id: newId(), memberId: 'self', ym: plan.settings.start, amount: 10_000_000, yearsOfService: 30 })}
              addLabel="退職金を追加"
              itemTitle={(r) => `${nameOf(plan, r.memberId)}（${r.ym}）`}
              render={(r, up) => (
                <div className="grid">
                  <SelectField label="誰の" value={r.memberId} options={memberOptions} onChange={(v) => up({ memberId: v })} />
                  <MonthField label="受け取る月" value={r.ym} onChange={(v) => v && up({ ym: v })} />
                  <ManField label="額面" value={r.amount} onChange={(v) => up({ amount: v })} step={50} />
                  <NumField label="勤続年数" value={r.yearsOfService} onChange={(v) => up({ yearsOfService: v })} suffix="年" hint="退職所得控除の計算に使います" />
                </div>
              )}
            />
          </>
        )}
        {section === '支出' && (
          <ListSection<Expense>
            title="支出"
            intro="住居費・教育費・子の生活費は自動で計算するので、ここには含めません。"
            items={plan.expenses}
            onChange={(v) => set('expenses', v)}
            create={() => ({ id: newId(), label: '新しい支出', category: 'living', frequency: 'monthly', amount: 10_000, inflate: true })}
            addLabel="支出を追加"
            itemTitle={(e) => `${e.label}（${e.frequency === 'monthly' ? '月' : '年'} ${man(e.amount, 1)}）`}
            render={(e, up) => (
              <div className="grid">
                <TextField label="名前" value={e.label} onChange={(v) => up({ label: v })} />
                <SelectField<ExpenseCategory>
                  label="分類"
                  value={e.category}
                  options={[
                    { value: 'living', label: '生活費' },
                    { value: 'allowance', label: '小遣い' },
                    { value: 'insurance', label: '保険' },
                    { value: 'special', label: '特別費' },
                    { value: 'car', label: '車' },
                    { value: 'other', label: 'その他' },
                  ]}
                  onChange={(v) => up({ category: v })}
                />
                <SelectField
                  label="頻度"
                  value={e.frequency}
                  options={[
                    { value: 'monthly', label: '毎月' },
                    { value: 'annual', label: '毎年1回' },
                  ]}
                  onChange={(v) => up({ frequency: v })}
                />
                {e.frequency === 'annual' && <NumField label="支払う月" value={e.month ?? 12} onChange={(v) => up({ month: v })} suffix="月" min={1} max={12} />}
                <YenField label="金額（いまの価値）" value={e.amount} onChange={(v) => up({ amount: v })} />
                <MonthField label="開始（空欄なら最初から）" value={e.from} onChange={(v) => up({ from: v })} optional />
                <MonthField label="終了（空欄なら最後まで）" value={e.to} onChange={(v) => up({ to: v })} optional />
                <CheckField label="インフレで増える" checked={e.inflate} onChange={(v) => up({ inflate: v })} />
                {e.category === 'insurance' && (
                  <>
                    <SelectField<InsuranceDeductionType>
                      label="保険料控除の区分"
                      value={e.insuranceDeduction ?? 'none'}
                      options={[
                        { value: 'none', label: '控除なし' },
                        { value: 'general', label: '一般生命保険' },
                        { value: 'medical', label: '介護医療保険' },
                        { value: 'privatePension', label: '個人年金保険' },
                        { value: 'earthquake', label: '地震保険' },
                      ]}
                      onChange={(v) => up({ insuranceDeduction: v })}
                    />
                    <SelectField label="控除を受ける人" value={e.payerId ?? 'self'} options={memberOptions} onChange={(v) => up({ payerId: v })} />
                  </>
                )}
              </div>
            )}
          />
        )}
        {section === '一時的な収支' && (
          <ListSection<OneOff>
            title="一時的な収入・支出"
            intro="祝い金・相続などの収入はプラス、車の購入・結婚式などの支出はマイナスで入力します。"
            items={plan.oneOffs}
            onChange={(v) => set('oneOffs', v)}
            create={() => ({ id: newId(), label: '新しい項目', ym: plan.settings.start, amount: -1_000_000, inflate: true })}
            addLabel="項目を追加"
            itemTitle={(o) => `${o.ym} ${o.label}（${man(o.amount)}）`}
            render={(o, up) => (
              <div className="grid">
                <TextField label="名前" value={o.label} onChange={(v) => up({ label: v })} />
                <MonthField label="時期" value={o.ym} onChange={(v) => v && up({ ym: v })} />
                <ManField label="金額（支出はマイナス）" value={o.amount} onChange={(v) => up({ amount: v })} step={10} />
                <CheckField label="インフレで増える" checked={o.inflate} onChange={(v) => up({ inflate: v })} />
              </div>
            )}
          />
        )}
        {section === '住まい' && <HousingSection plan={plan} onChange={onChange} memberOptions={memberOptions} />}
        {section === '資産口座' && <AccountsSection plan={plan} onChange={onChange} memberOptions={memberOptions} />}
      </div>
    </div>
  )
}

function nameOf(plan: Plan, id: string) {
  return plan.members.find((m) => m.id === id)?.name ?? id
}

function ListSection<T extends { id: string }>(props: {
  title: string
  intro?: string
  items: T[]
  onChange: (items: T[]) => void
  create: () => T
  addLabel: string
  itemTitle: (item: T) => string
  render: (item: T, update: (patch: Partial<T>) => void) => ReactNode
  canRemove?: (item: T) => boolean
}) {
  const [open, setOpen] = useState<string | null>(null)
  return (
    <section className="card">
      <h2>{props.title}</h2>
      {props.intro && <p className="note">{props.intro}</p>}
      <div className="list">
        {props.items.map((item, i) => {
          const isOpen = open === `${i}`
          return (
            <div key={`${item.id}-${i}`} className={`list-item ${isOpen ? 'open' : ''}`}>
              <button type="button" className="list-item-head" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : `${i}`)}>
                <span>{props.itemTitle(item)}</span>
                <span className="chev" aria-hidden>
                  {isOpen ? '▾' : '▸'}
                </span>
              </button>
              {isOpen && (
                <div className="list-item-body">
                  {props.render(item, (patch) => props.onChange(props.items.map((x, j) => (j === i ? { ...x, ...patch } : x))))}
                  {(props.canRemove?.(item) ?? true) && (
                    <button type="button" className="link danger" onClick={() => props.onChange(props.items.filter((_, j) => j !== i))}>
                      この項目を削除
                    </button>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
      <button
        type="button"
        className="secondary"
        onClick={() => {
          props.onChange([...props.items, props.create()])
          setOpen(`${props.items.length}`)
        }}
      >
        ＋ {props.addLabel}
      </button>
    </section>
  )
}

function SettingsSection({ plan, onChange }: { plan: Plan; onChange: (p: Plan) => void }) {
  const s = plan.settings
  const up = (patch: Partial<Plan['settings']>) => onChange({ ...plan, settings: { ...s, ...patch } })
  const liquid = plan.accounts.filter((a) => a.kind === 'nisa' || a.kind === 'taxable' || a.kind === 'stock')
  const order = [...s.withdrawalOrder.filter((id) => liquid.some((a) => a.id === id)), ...liquid.filter((a) => !s.withdrawalOrder.includes(a.id)).map((a) => a.id)]
  const move = (i: number, d: number) => {
    const o = [...order]
    const [x] = o.splice(i, 1)
    o.splice(i + d, 0, x)
    up({ withdrawalOrder: o })
  }
  return (
    <>
      <section className="card">
        <h2>基本設定</h2>
        <div className="grid">
          <TextField label="プラン名" value={plan.name} onChange={(v) => onChange({ ...plan, name: v })} />
          <MonthField label="開始年月" value={s.start} onChange={(v) => v && up({ start: v })} />
          <NumField label="本人が何歳になる年まで計算するか" value={s.endAge} onChange={(v) => up({ endAge: v })} suffix="歳" />
          <NumField label="本人の定年（指標の表示用）" value={plan.retirementAge ?? 60} onChange={(v) => onChange({ ...plan, retirementAge: v })} suffix="歳" />
          <PercentField label="インフレ率（年）" value={s.inflationRate} onChange={(v) => up({ inflationRate: v })} step={0.05} />
          <PercentField label="年金額の伸び率（年）" value={s.pensionGrowthRate} onChange={(v) => up({ pensionGrowthRate: v })} step={0.05} hint="マクロ経済スライドで、インフレ率より低くなるのが一般的" />
          <NumField label="インフレ・昇給を反映する月" value={s.annualUpdateMonth} onChange={(v) => up({ annualUpdateMonth: v })} suffix="月" min={1} max={12} />
          <PercentField label="支出の調整（生活費など）" value={s.expenseMultiplier ?? 1} onChange={(v) => up({ expenseMultiplier: v })} step={5} hint="100%が入力どおり。「もしも」で反映した値もここに入ります" />
          <PercentField label="公的年金の調整" value={s.pensionMultiplier ?? 1} onChange={(v) => up({ pensionMultiplier: v })} step={5} hint="100%が計算どおり" />
        </div>
      </section>
      <section className="card">
        <h2>預貯金と取り崩し</h2>
        <div className="grid">
          <ManField label="開始時点の預貯金" value={s.cash} onChange={(v) => up({ cash: v })} step={10} />
          <ManField label="生活防衛資金（預金の下限）" value={s.cashFloor} onChange={(v) => up({ cashFloor: v })} step={10} hint="これを下回る月は積立を止め、下の順に口座を売って補います" />
          <ManField label="預金の上限" value={s.cashCeiling ?? 0} onChange={(v) => up({ cashCeiling: v > 0 ? v : undefined })} step={50} hint="超えた分を毎月、下の口座に回します。0ならしない" />
          {(s.cashCeiling ?? 0) > 0 && (
            <SelectField
              label="上限を超えた分を回す口座"
              value={s.sweepAccountId ?? ''}
              options={[{ value: '', label: '選んでください' }, ...liquid.map((a) => ({ value: a.id, label: a.label }))]}
              onChange={(v) => up({ sweepAccountId: v || undefined })}
            />
          )}
        </div>
        <h3>不足したときに売る順番</h3>
        <ol className="order-list">
          {order.map((id, i) => (
            <li key={id}>
              <span>{plan.accounts.find((a) => a.id === id)?.label}</span>
              <button type="button" className="link" disabled={i === 0} onClick={() => move(i, -1)} aria-label="上へ">
                ↑
              </button>
              <button type="button" className="link" disabled={i === order.length - 1} onClick={() => move(i, 1)} aria-label="下へ">
                ↓
              </button>
            </li>
          ))}
        </ol>
      </section>
      <section className="card">
        <h2>子どもにかかる費用（いまの価値・月額）</h2>
        <p className="note">学校の費用（文部科学省「子供の学習費調査」）とは別に、食費・衣類などの増加分です。</p>
        <div className="grid">
          <ManField label="保育料（0〜2歳）" value={s.daycareFee} onChange={(v) => up({ daycareFee: v })} step={0.5} hint="3〜5歳は無償化" />
          <ManField label="未就学" value={s.childLivingCost.preschool} onChange={(v) => up({ childLivingCost: { ...s.childLivingCost, preschool: v } })} step={0.5} />
          <ManField label="小学生" value={s.childLivingCost.elementary} onChange={(v) => up({ childLivingCost: { ...s.childLivingCost, elementary: v } })} step={0.5} />
          <ManField label="中学生" value={s.childLivingCost.juniorHigh} onChange={(v) => up({ childLivingCost: { ...s.childLivingCost, juniorHigh: v } })} step={0.5} />
          <ManField label="高校生" value={s.childLivingCost.high} onChange={(v) => up({ childLivingCost: { ...s.childLivingCost, high: v } })} step={0.5} />
          <ManField label="大学生（自宅）" value={s.childLivingCost.university} onChange={(v) => up({ childLivingCost: { ...s.childLivingCost, university: v } })} step={0.5} />
        </div>
      </section>
      <section className="card">
        <h2>社会保険料率（会社員・本人負担分）</h2>
        <div className="grid">
          <PercentField label="健康保険" value={s.healthInsuranceRate} onChange={(v) => up({ healthInsuranceRate: v })} step={0.01} hint="協会けんぽの全国平均は約5%（労使折半後）" />
          <PercentField label="介護保険（40〜64歳）" value={s.careInsuranceRate} onChange={(v) => up({ careInsuranceRate: v })} step={0.01} />
          <PercentField label="厚生年金" value={s.pensionInsuranceRate} onChange={(v) => up({ pensionInsuranceRate: v })} step={0.01} />
          <PercentField label="雇用保険" value={s.employmentInsuranceRate} onChange={(v) => up({ employmentInsuranceRate: v })} step={0.01} />
        </div>
      </section>
    </>
  )
}

function HousingSection({ plan, onChange, memberOptions }: { plan: Plan; onChange: (p: Plan) => void; memberOptions: { value: string; label: string }[] }) {
  const h = plan.housing
  const setH = (patch: Partial<Plan['housing']>) => onChange({ ...plan, housing: { ...h, ...patch } })
  const p = h.purchase
  const upP = (patch: Partial<Purchase>) => p && setH({ purchase: { ...p, ...patch } })
  const loan = p?.loan
  const upL = (patch: Partial<NonNullable<Purchase['loan']>>) => p && loan && upP({ loan: { ...loan, ...patch } })

  return (
    <>
      <ListSection<RentPeriod>
        title="賃貸"
        items={h.rents}
        onChange={(v) => setH({ rents: v })}
        create={() => ({ id: newId(), label: '賃貸', from: plan.settings.start, monthlyRent: 100_000, renewalMonths: 1 })}
        addLabel="賃貸の期間を追加"
        itemTitle={(r) => `${r.label}（${r.from}〜${r.to ?? ''}、月 ${man(r.monthlyRent, 1)}）`}
        render={(r, up) => (
          <div className="grid">
            <TextField label="名前" value={r.label} onChange={(v) => up({ label: v })} />
            <MonthField label="開始" value={r.from} onChange={(v) => v && up({ from: v })} />
            <MonthField label="終了（この月まで）" value={r.to} onChange={(v) => up({ to: v })} optional />
            <ManField label="家賃（月）" value={r.monthlyRent} onChange={(v) => up({ monthlyRent: v })} step={0.5} />
            <NumField label="更新料（2年ごと、家賃の何か月分）" value={r.renewalMonths} onChange={(v) => up({ renewalMonths: v })} suffix="か月" />
          </div>
        )}
      />
      <section className="card">
        <h2>住宅の購入</h2>
        <CheckField
          label="家を買う（購入済みも含む）"
          checked={!!p}
          onChange={(v) => {
            if (!v) return setH({ purchase: undefined })
            // default: two years after the start; rent periods end the month before
            const [y, m] = plan.settings.start.split('-')
            const ym = `${Number(y) + 2}-${m}`
            const prev = Number(m) === 1 ? `${Number(y) + 1}-12` : `${Number(y) + 2}-${String(Number(m) - 1).padStart(2, '0')}`
            setH({ purchase: defaultPurchase(ym, 'self'), rents: h.rents.map((r) => (r.to === undefined || r.to >= ym ? { ...r, to: prev } : r)) })
          }}
        />
        {p && (
          <>
            <div className="grid">
              <MonthField label="購入（入居）年月" value={p.ym} onChange={(v) => v && upP({ ym: v })} />
              <ManField label="物件価格" value={p.price} onChange={(v) => upP({ price: v })} step={100} />
              <PercentField label="うち土地の割合" value={p.landShare} onChange={(v) => upP({ landShare: v })} step={5} />
              <SelectField
                label="種類"
                value={p.homeType}
                options={[
                  { value: 'house', label: '戸建て' },
                  { value: 'condo', label: 'マンション' },
                ]}
                onChange={(v) => upP({ homeType: v })}
              />
              <CheckField label="新築" checked={p.isNew} onChange={(v) => upP({ isNew: v })} />
              <CheckField label="長期優良住宅" checked={p.longLife} onChange={(v) => upP({ longLife: v })} />
              <CheckField label="木造" checked={p.wooden} onChange={(v) => upP({ wooden: v })} />
              <CheckField label="土地が200㎡以下" checked={p.smallLand} onChange={(v) => upP({ smallLand: v })} />
              <PercentField label="諸費用（物件価格に対して）" value={p.closingCostRate} onChange={(v) => upP({ closingCostRate: v })} />
            </div>

            <h3>住宅ローン</h3>
            <CheckField
              label="ローンを組む"
              checked={!!loan}
              onChange={(v) =>
                upP({ loan: v ? { amount: p.price * 0.9, years: 35, rates: [{ fromYear: 1, rate: 0.01 }], prepayments: [], borrowerId: 'self' } : undefined })
              }
            />
            {loan && (
              <>
                <div className="grid">
                  <ManField label="借入額" value={loan.amount} onChange={(v) => upL({ amount: v })} step={100} />
                  <NumField label="返済期間" value={loan.years} onChange={(v) => upL({ years: v })} suffix="年" />
                  <SelectField label="借りる人（ローン控除を受ける人）" value={loan.borrowerId} options={memberOptions} onChange={(v) => upL({ borrowerId: v })} />
                  <NumField label="残りを一括返済する年齢" value={loan.payoffAge ?? 0} onChange={(v) => upL({ payoffAge: v > 0 ? v : undefined })} suffix="歳" hint="0なら一括返済しない" />
                  <CheckField label="5年ルール・125%ルール（変動金利）" checked={!!loan.fiveYearRule} onChange={(v) => upL({ fiveYearRule: v })} hint="返済額は5年ごとに見直し、上がっても1.25倍まで" />
                  <CheckField label="団体信用生命保険（団信）に加入" checked={loan.dansin !== false} onChange={(v) => upL({ dansin: v })} hint="「万一の備え」で、亡くなったときにローンが完済されます" />
                  <ManField label="ローン控除の上限残高" value={p.loanDeductionLimit} onChange={(v) => upP({ loanDeductionLimit: v })} step={500} />
                  <NumField label="ローン控除の期間" value={p.loanDeductionYears} onChange={(v) => upP({ loanDeductionYears: v })} suffix="年" />
                </div>
                <h4>金利の推移</h4>
                <table className="mini-table">
                  <thead>
                    <tr>
                      <th>何年目から</th>
                      <th>金利</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {loan.rates.map((r, i) => (
                      <tr key={i}>
                        <td>
                          <NumField label="" value={r.fromYear} onChange={(v) => upL({ rates: loan.rates.map((x, j) => (j === i ? { ...x, fromYear: v } : x)) })} suffix="年目" />
                        </td>
                        <td>
                          <PercentField label="" value={r.rate} onChange={(v) => upL({ rates: loan.rates.map((x, j) => (j === i ? { ...x, rate: v } : x)) })} step={0.05} />
                        </td>
                        <td>
                          {i > 0 && (
                            <button type="button" className="link danger" onClick={() => upL({ rates: loan.rates.filter((_, j) => j !== i) })}>
                              削除
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => {
                    const last = loan.rates[loan.rates.length - 1]
                    upL({ rates: [...loan.rates, { fromYear: last.fromYear + 5, rate: last.rate + 0.0025 }] })
                  }}
                >
                  ＋ 金利の変更を追加
                </button>
                <h4>繰上返済</h4>
                {loan.prepayments.map((pp, i) => (
                  <div className="grid" key={i}>
                    <MonthField label="時期" value={pp.ym} onChange={(v) => v && upL({ prepayments: loan.prepayments.map((x, j) => (j === i ? { ...x, ym: v } : x)) })} />
                    <ManField label="金額" value={pp.amount} onChange={(v) => upL({ prepayments: loan.prepayments.map((x, j) => (j === i ? { ...x, amount: v } : x)) })} step={50} />
                    <SelectField
                      label="方法"
                      value={pp.type}
                      options={[
                        { value: 'shorten', label: '期間短縮型' },
                        { value: 'reduce', label: '返済額軽減型' },
                      ]}
                      onChange={(v) => upL({ prepayments: loan.prepayments.map((x, j) => (j === i ? { ...x, type: v } : x)) })}
                    />
                    <button type="button" className="link danger" onClick={() => upL({ prepayments: loan.prepayments.filter((_, j) => j !== i) })}>
                      削除
                    </button>
                  </div>
                ))}
                <button type="button" className="secondary" onClick={() => upL({ prepayments: [...loan.prepayments, { ym: p.ym, amount: 1_000_000, type: 'shorten' }] })}>
                  ＋ 繰上返済を追加
                </button>
              </>
            )}

            <h3>維持費</h3>
            <div className="grid">
              {p.homeType === 'condo' && (
                <>
                  <ManField label="管理費（月）" value={p.managementFee} onChange={(v) => upP({ managementFee: v })} step={0.1} />
                  <ManField label="修繕積立金（月）" value={p.repairReserve} onChange={(v) => upP({ repairReserve: v })} step={0.1} />
                  <NumField label="修繕積立金を上げる間隔" value={p.repairReserveRaiseYears} onChange={(v) => upP({ repairReserveRaiseYears: v })} suffix="年" />
                  <PercentField label="1回の値上げ率" value={p.repairReserveRaiseRate} onChange={(v) => upP({ repairReserveRaiseRate: v })} />
                </>
              )}
              <ManField label="火災保険（年）" value={p.fireInsuranceAnnual} onChange={(v) => upP({ fireInsuranceAnnual: v })} step={0.5} />
              <ManField label="地震保険（年）" value={p.earthquakeInsuranceAnnual} onChange={(v) => upP({ earthquakeInsuranceAnnual: v })} step={0.5} hint="地震保険料控除に使います" />
            </div>
            <h4>定期的な修繕</h4>
            {p.repairs.map((r, i) => (
              <div className="grid" key={i}>
                <TextField label="内容" value={r.label} onChange={(v) => upP({ repairs: p.repairs.map((x, j) => (j === i ? { ...x, label: v } : x)) })} />
                <NumField label="間隔" value={r.everyYears} onChange={(v) => upP({ repairs: p.repairs.map((x, j) => (j === i ? { ...x, everyYears: v } : x)) })} suffix="年ごと" />
                <ManField label="費用（いまの価値）" value={r.amount} onChange={(v) => upP({ repairs: p.repairs.map((x, j) => (j === i ? { ...x, amount: v } : x)) })} step={10} />
                <button type="button" className="link danger" onClick={() => upP({ repairs: p.repairs.filter((_, j) => j !== i) })}>
                  削除
                </button>
              </div>
            ))}
            <button type="button" className="secondary" onClick={() => upP({ repairs: [...p.repairs, { label: '修繕', everyYears: 10, amount: 1_000_000 }] })}>
              ＋ 修繕を追加
            </button>

            <h3>固定資産税・都市計画税</h3>
            <p className="note">
              物件価格から自動で概算しています（土地は価格の70%、建物は60%を評価額とし、住宅用地の特例・新築の減額・建物の経年減価を反映）。
              1年目の概算: <strong>{man(propertyTaxAnnual({ ...p, propertyTaxOverride: undefined }, 1), 1)}</strong>、
              10年目: <strong>{man(propertyTaxAnnual({ ...p, propertyTaxOverride: undefined }, 10), 1)}</strong>
            </p>
            <div className="grid">
              <PercentField label="固定資産税の税率" value={p.propertyTaxRate} onChange={(v) => upP({ propertyTaxRate: v })} step={0.01} />
              <PercentField label="都市計画税の税率" value={p.cityPlanningTaxRate} onChange={(v) => upP({ cityPlanningTaxRate: v })} step={0.01} />
              <CheckField
                label="納税通知書の金額を使う"
                checked={p.propertyTaxOverride !== undefined}
                onChange={(v) => upP({ propertyTaxOverride: v ? Math.round(propertyTaxAnnual({ ...p, propertyTaxOverride: undefined }, 1)) : undefined })}
              />
              {p.propertyTaxOverride !== undefined && <YenField label="年税額" value={p.propertyTaxOverride} onChange={(v) => upP({ propertyTaxOverride: v })} />}
            </div>
          </>
        )}
      </section>
    </>
  )
}

const KIND_LABEL: Record<AccountKind, string> = {
  nisa: 'NISA',
  taxable: '特定口座（課税）',
  stock: '持株会',
  ideco: 'iDeCo',
  dc: '企業型DC',
  annuity: '個人年金保険',
}

function AccountsSection({ plan, onChange, memberOptions }: { plan: Plan; onChange: (p: Plan) => void; memberOptions: { value: string; label: string }[] }) {
  return (
    <ListSection<Account>
      title="資産口座"
      intro="NISAは年360万円・生涯1,800万円（取得額）の枠を自動で確認し、超えた分は課税口座に回します。iDeCo・企業型DCは受取年齢で全額を一時金として受け取り、退職所得として課税します。"
      items={plan.accounts}
      onChange={(v) => onChange({ ...plan, accounts: v })}
      create={() => ({ id: newId(), kind: 'nisa', ownerId: 'self', label: '新しい口座', balance: 0, annualReturn: 0.04, contributions: [] })}
      addLabel="口座を追加"
      itemTitle={(a) => `${a.label}（${KIND_LABEL[a.kind]}・${man(a.balance)}）`}
      render={(a, up) => (
        <>
          <div className="grid">
            <TextField label="名前" value={a.label} onChange={(v) => up({ label: v })} />
            <SelectField<AccountKind>
              label="種類"
              value={a.kind}
              options={(Object.keys(KIND_LABEL) as AccountKind[]).map((k) => ({ value: k, label: KIND_LABEL[k] }))}
              onChange={(v) => up({ kind: v })}
            />
            <SelectField label="名義" value={a.ownerId} options={memberOptions} onChange={(v) => up({ ownerId: v })} />
            <ManField label="いまの時価" value={a.balance} onChange={(v) => up({ balance: v })} step={10} />
            {(a.kind === 'nisa' || a.kind === 'taxable' || a.kind === 'stock' || a.kind === 'annuity') && (
              <ManField label="取得額（元本）" value={a.costBasis ?? a.balance} onChange={(v) => up({ costBasis: v })} step={10} hint="未入力なら時価と同じとみなします" />
            )}
            <PercentField label="想定利回り（年）" value={a.annualReturn} onChange={(v) => up({ annualReturn: v })} />
            <PercentField
              label="値動きの大きさ（年率の標準偏差）"
              value={a.volatility ?? DEFAULT_VOLATILITY[a.kind]}
              onChange={(v) => up({ volatility: v })}
              step={1}
              hint="運用リスクの試算に使います。株式の投資信託で15〜20%、債券中心で5%前後"
            />
            {(a.kind === 'ideco' || a.kind === 'dc') && (
              <>
                <NumField label="一時金で受け取る年齢" value={a.receiveAge ?? 65} onChange={(v) => up({ receiveAge: v })} suffix="歳" min={60} max={75} />
                <MonthField label="加入年月" value={a.joined} onChange={(v) => up({ joined: v })} hint="退職所得控除の年数に使います" optional />
              </>
            )}
            {a.kind === 'annuity' && (
              <>
                <NumField label="受け取り開始年齢" value={a.payoutStartAge ?? 65} onChange={(v) => up({ payoutStartAge: v })} suffix="歳" />
                <NumField label="受け取る年数" value={a.payoutYears ?? 10} onChange={(v) => up({ payoutYears: v })} suffix="年" />
              </>
            )}
          </div>
          <h4>{a.kind === 'dc' ? '会社掛金' : '積立'}</h4>
          {a.contributions.map((c, i) => (
            <ContributionRow
              key={i}
              c={c}
              onChange={(nc) => up({ contributions: a.contributions.map((x, j) => (j === i ? nc : x)) })}
              onRemove={() => up({ contributions: a.contributions.filter((_, j) => j !== i) })}
            />
          ))}
          <button type="button" className="secondary" onClick={() => up({ contributions: [...a.contributions, { from: plan.settings.start, monthly: 10_000 }] })}>
            ＋ 積立を追加
          </button>
          {(a.kind === 'nisa' || a.kind === 'taxable' || a.kind === 'stock') && (
            <>
              <h4>計画的な取り崩し</h4>
              <CheckField
                label="決まったペースで取り崩す"
                checked={!!a.withdrawal}
                onChange={(v) => up({ withdrawal: v ? { startAge: 65, mode: 'rate', value: 0.04 } : undefined })}
              />
              {a.withdrawal && (
                <div className="grid">
                  <NumField label="開始年齢（名義人）" value={a.withdrawal.startAge} onChange={(v) => up({ withdrawal: { ...a.withdrawal!, startAge: v } })} suffix="歳" />
                  <SelectField
                    label="方法"
                    value={a.withdrawal.mode}
                    options={[
                      { value: 'rate', label: '残高の一定割合（定率）' },
                      { value: 'amount', label: '毎月一定額（定額）' },
                    ]}
                    onChange={(v) => up({ withdrawal: { ...a.withdrawal!, mode: v, value: v === 'rate' ? 0.04 : 100_000 } })}
                  />
                  {a.withdrawal.mode === 'rate' ? (
                    <PercentField label="毎年の割合" value={a.withdrawal.value} onChange={(v) => up({ withdrawal: { ...a.withdrawal!, value: v } })} />
                  ) : (
                    <ManField label="毎月の額（いまの価値）" value={a.withdrawal.value} onChange={(v) => up({ withdrawal: { ...a.withdrawal!, value: v } })} step={1} />
                  )}
                </div>
              )}
            </>
          )}
        </>
      )}
    />
  )
}

function ContributionRow({ c, onChange, onRemove }: { c: Contribution; onChange: (c: Contribution) => void; onRemove: () => void }) {
  return (
    <div className="grid">
      <ManField label="毎月" value={c.monthly} onChange={(v) => onChange({ ...c, monthly: v })} step={0.1} />
      <MonthField label="開始" value={c.from} onChange={(v) => v && onChange({ ...c, from: v })} />
      <MonthField label="終了（この月まで）" value={c.to} onChange={(v) => onChange({ ...c, to: v })} optional />
      <ManField label="年1回の追加（ボーナス月など）" value={c.extraAnnual ?? 0} onChange={(v) => onChange({ ...c, extraAnnual: v || undefined })} step={1} />
      {!!c.extraAnnual && <NumField label="追加する月" value={c.extraMonth ?? 12} onChange={(v) => onChange({ ...c, extraMonth: v })} suffix="月" min={1} max={12} />}
      <button type="button" className="link danger" onClick={onRemove}>
        削除
      </button>
    </div>
  )
}

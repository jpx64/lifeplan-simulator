import { useRef, useState } from 'react'
import type { Plan } from './engine/types'
import { buildPlan, defaultWizard } from './engine/wizard'
import { Assumptions } from './ui/Assumptions'
import { Compare } from './ui/Compare'
import { Dashboard } from './ui/Dashboard'
import { Editor } from './ui/Editor'
import { Risk } from './ui/Risk'
import { currentYM } from './ui/format'
import { downloadJson, newId, usePlans } from './ui/store'
import { Wizard } from './ui/Wizard'
import { YearTable } from './ui/YearTable'

type Tab = 'result' | 'table' | 'compare' | 'risk' | 'wizard' | 'edit' | 'assumptions'

const TABS: { id: Tab; label: string }[] = [
  { id: 'result', label: '結果' },
  { id: 'table', label: '年ごとの表' },
  { id: 'compare', label: 'シナリオ比較' },
  { id: 'risk', label: '万一の備え' },
  { id: 'wizard', label: 'かんたん入力' },
  { id: 'edit', label: '詳細設定' },
  { id: 'assumptions', label: '計算の前提' },
]

const SHOWS_AMOUNTS: Tab[] = ['result', 'table', 'compare', 'risk']

export default function App() {
  const store = usePlans()
  const { plans, active } = store
  const [tab, setTab] = useState<Tab>(store.isFirstVisit ? 'wizard' : 'result')
  const [wizardKey, setWizardKey] = useState(0)
  const [real, setReal] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const finishWizard = (w: Parameters<typeof buildPlan>[0]) => {
    if (active.wizard) store.update(buildPlan(w, active.id, active.name))
    else store.add(buildPlan(w, newId(), plans.some((p) => p.name === 'わが家のプラン') ? `わが家のプラン ${plans.length + 1}` : 'わが家のプラン'))
    setTab('result')
  }

  const importJson = async (file: File) => {
    try {
      const data = JSON.parse(await file.text()) as { plans?: Plan[] } | Plan
      const list = 'plans' in data && Array.isArray(data.plans) ? data.plans : [data as Plan]
      if (!list.every((p) => p && Array.isArray(p.members) && p.settings)) throw new Error('形式が違います')
      if (confirm(`${list.length}件のプランを読み込みます。いまブラウザにあるプランは置き換えられます。よろしいですか？`)) {
        store.replaceAll(list)
        setTab('result')
      }
    } catch (e) {
      alert(`読み込めませんでした: ${e instanceof Error ? e.message : e}`)
    }
  }

  return (
    <div className="app">
      <header className="app-header">
        <div className="brand">
          <h1>Lifeplan Simulator</h1>
          <p>家族のお金の流れを、生涯にわたって月ごとに試算します</p>
        </div>
        <div className="plan-bar">
          <label className="plan-select">
            <span>プラン</span>
            <select value={active.id} onChange={(e) => store.select(e.target.value)}>
              {plans.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <button type="button" className="secondary" onClick={() => store.duplicate(active.id)} title="条件を変えて比べるために、いまのプランをコピーします">
            複製
          </button>
          <button
            type="button"
            className="secondary"
            onClick={() => {
              const name = prompt('プラン名', active.name)
              if (name) store.update({ ...active, name })
            }}
          >
            名前を変更
          </button>
          <button
            type="button"
            className="secondary danger"
            onClick={() => confirm(`「${active.name}」を削除します。元に戻せません。よろしいですか？`) && store.remove(active.id)}
          >
            削除
          </button>
          <details className="menu">
            <summary className="secondary">保存・読み込み</summary>
            <div className="menu-body">
              <button type="button" className="link" onClick={() => downloadJson('lifeplan.json', { plans })}>
                すべてのプランをファイルに保存
              </button>
              <button type="button" className="link" onClick={() => fileRef.current?.click()}>
                ファイルから読み込む
              </button>
              <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={(e) => e.target.files?.[0] && importJson(e.target.files[0])} />
            </div>
          </details>
        </div>
      </header>

      <div className="tab-bar">
        <nav className="tabs" aria-label="画面">
          {TABS.map((t) => (
            <button key={t.id} type="button" className={tab === t.id ? 'on' : ''} aria-current={tab === t.id} onClick={() => { setTab(t.id); window.scrollTo(0, 0) }}>
              {t.label}
            </button>
          ))}
        </nav>
        {SHOWS_AMOUNTS.includes(tab) && (
          <div className="segmented" role="group" aria-label="金額の表示">
            <button type="button" className={!real ? 'on' : ''} onClick={() => setReal(false)} title="インフレを含んだ将来の額面">
              額面
            </button>
            <button type="button" className={real ? 'on' : ''} onClick={() => setReal(true)} title="インフレ分を割り戻した、いまの物価での金額">
              いまの物価で表示
            </button>
          </div>
        )}
      </div>

      <main>
        {active.id === 'sample' && tab !== 'wizard' && (
          <div className="callout">
            いま表示しているのは架空の<strong>サンプル世帯</strong>です。
            <button type="button" className="link" onClick={() => setTab('wizard')}>
              かんたん入力でわが家のプランを作る →
            </button>
          </div>
        )}
        {tab === 'result' && <Dashboard key={active.id} plan={active} onApply={store.update} real={real} />}
        {tab === 'table' && <YearTable plan={active} real={real} />}
        {tab === 'compare' && <Compare plans={plans} real={real} />}
        {tab === 'risk' && <Risk key={active.id} plan={active} real={real} />}
        {tab === 'assumptions' && <Assumptions />}
        {tab === 'wizard' && (
          <>
            {!active.wizard && active.id !== 'sample' && (
              <div className="callout">このプランは詳細設定で作られているため、かんたん入力の結果は新しいプランとして追加されます。</div>
            )}
            <Wizard
              key={`${active.id}-${wizardKey}`}
              initial={active.wizard ?? defaultWizard(currentYM())}
              onFinish={(w) => {
                finishWizard(w)
                setWizardKey((k) => k + 1)
              }}
              onCancel={() => setTab('result')}
              finishLabel={active.wizard ? 'この内容でプランを作り直す' : 'この内容でプランを作る'}
            />
          </>
        )}
        {tab === 'edit' && <Editor plan={active} onChange={store.update} />}
      </main>

      <footer className="app-footer">
        <p>
          入力した内容と計算はすべてこのブラウザの中だけで行い、サーバーには送信しません。保存先もこのブラウザ（localStorage）です。
        </p>
        <p>
          税・社会保険は2025〜2026年の制度にもとづく概算です。結果は試算であり、金融・税務の助言ではありません。大切な判断の前には専門家に確認してください。
        </p>
      </footer>
    </div>
  )
}

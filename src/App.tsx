import { useEffect, useRef, useState } from 'react'
import type { Plan } from './engine/types'
import { parsePlans } from './engine/validate'
import { buildPlan, defaultWizard } from './engine/wizard'
import { Assumptions } from './ui/Assumptions'
import { Compare } from './ui/Compare'
import { Dashboard } from './ui/Dashboard'
import { Editor } from './ui/Editor'
import { ErrorBoundary } from './ui/ErrorBoundary'
import { currentYM } from './ui/format'
import { Modal } from './ui/Modal'
import { Risk } from './ui/Risk'
import { canShare, clearSharedPlanFromUrl, hasSharedPlan, readSharedPlan, shareUrl } from './ui/share'
import {
  downloadAllPlans,
  downloadJson,
  downloadUnreadableData,
  forgetUnreadableData,
  hasUnreadableData,
  needsBackupReminder,
  newId,
  requestPersistentStorage,
  snoozeBackupReminder,
  usePlans,
} from './ui/store'
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

/** Plans waiting for the user to choose how to take them in (from a file or a shared link). */
type Incoming = { source: 'file' | 'link'; plans: Plan[] } | { source: 'file' | 'link'; error: string }

export default function App() {
  const store = usePlans()
  const { plans, active } = store
  const [tab, setTab] = useState<Tab>(store.isFirstVisit && !hasSharedPlan() ? 'wizard' : 'result')
  const [wizardKey, setWizardKey] = useState(0)
  const [real, setReal] = useState(false)
  const [incoming, setIncoming] = useState<Incoming>()
  const [link, setLink] = useState<{ url: string; copied: boolean }>()
  const [reminder, setReminder] = useState(() => needsBackupReminder(plans))
  const [unreadable, setUnreadable] = useState(hasUnreadableData)
  const fileRef = useRef<HTMLInputElement>(null)
  const menuRef = useRef<HTMLDetailsElement>(null)
  const hasOwnPlans = plans.some((p) => p.id !== 'sample')

  // the sample's answers are not offered for editing: かんたん入力 on the sample creates a new plan
  const ownWizard = active.id === 'sample' ? undefined : active.wizard

  // a plan shared as a link (also when a link is opened in a tab that already shows the app)
  useEffect(() => {
    const check = () => {
      if (!hasSharedPlan()) return
      readSharedPlan().then((r) => setIncoming(r.ok ? { source: 'link', plans: r.plans } : { source: 'link', error: r.error }))
    }
    check()
    window.addEventListener('hashchange', check)
    return () => window.removeEventListener('hashchange', check)
  }, [])

  // once there are plans of one's own, ask the browser not to delete them when storage runs low
  useEffect(() => {
    if (hasOwnPlans) requestPersistentStorage()
  }, [hasOwnPlans])

  const closeMenu = () => menuRef.current?.removeAttribute('open')

  const finishWizard = (w: Parameters<typeof buildPlan>[0]) => {
    if (ownWizard) store.update(buildPlan(w, active.id, active.name))
    else store.add(buildPlan(w, newId(), plans.some((p) => p.name === 'わが家のプラン') ? `わが家のプラン ${plans.length + 1}` : 'わが家のプラン'))
    setTab('result')
  }

  const importJson = async (file: File) => {
    closeMenu()
    let data: unknown
    try {
      data = JSON.parse(await file.text())
    } catch {
      setIncoming({ source: 'file', error: 'JSON ファイルとして読めませんでした。このアプリで保存したファイルか確認してください。' })
      return
    }
    const r = parsePlans(data)
    setIncoming(r.ok ? { source: 'file', plans: r.plans } : { source: 'file', error: r.error })
  }

  const finishIncoming = (how?: 'add' | 'replace') => {
    if (incoming && 'plans' in incoming && how) {
      if (how === 'add') store.addMany(incoming.plans)
      else store.replaceAll(incoming.plans)
      setTab('result')
    }
    if (incoming?.source === 'link') clearSharedPlanFromUrl()
    setIncoming(undefined)
  }

  const makeLink = async () => {
    closeMenu()
    const url = await shareUrl(active)
    let copied = false
    try {
      await navigator.clipboard.writeText(url)
      copied = true
    } catch {
      // clipboard not available: the link is shown to copy by hand
    }
    setLink({ url, copied })
  }

  const saveAll = () => {
    downloadAllPlans(plans)
    setReminder(false)
    closeMenu()
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
          <details className="menu" ref={menuRef}>
            <summary className="secondary">保存・共有</summary>
            <div className="menu-body">
              <button type="button" className="link" onClick={saveAll}>
                すべてのプランをファイルに保存
              </button>
              <button type="button" className="link" onClick={() => fileRef.current?.click()}>
                ファイルから読み込む
              </button>
              {canShare() && (
                <button type="button" className="link" onClick={makeLink}>
                  このプランを共有するリンクを作る
                </button>
              )}
              <input
                ref={fileRef}
                type="file"
                accept="application/json,.json"
                hidden
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  e.target.value = ''
                  if (f) importJson(f)
                }}
              />
            </div>
          </details>
        </div>
      </header>

      <div className="tab-bar">
        <nav className="tabs" aria-label="画面">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              className={tab === t.id ? 'on' : ''}
              aria-current={tab === t.id}
              onClick={() => {
                setTab(t.id)
                window.scrollTo(0, 0)
              }}
            >
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
        {unreadable && (
          <div className="callout warn backup-reminder" role="alert">
            <p>
              このブラウザに保存されていたデータの一部（または全部）を読み込めませんでした。読み込めなかったデータは消さずに取ってあります。ファイルに保存しておくと、あとで中身を確かめられます。
            </p>
            <div className="actions">
              <button type="button" onClick={downloadUnreadableData}>
                読み込めなかったデータをファイルに保存
              </button>
              <button
                type="button"
                className="link"
                onClick={() => {
                  if (!confirm('読み込めなかったデータを消します。元に戻せません。よろしいですか？')) return
                  forgetUnreadableData()
                  setUnreadable(false)
                }}
              >
                このデータを消す
              </button>
            </div>
          </div>
        )}
        {reminder && tab !== 'wizard' && (
          <div className="callout warn backup-reminder" role="status">
            <p>
              プランはこのブラウザの中にだけ保存されています。ブラウザのデータを消したときや、Safari
              などでしばらくこのサイトを開かなかったときには、消えてしまうことがあります。ファイルに保存しておくと、あとで読み込んで元に戻せます。
            </p>
            <div className="actions">
              <button type="button" onClick={saveAll}>
                すべてのプランをファイルに保存
              </button>
              <button
                type="button"
                className="link"
                onClick={() => {
                  snoozeBackupReminder()
                  setReminder(false)
                }}
              >
                あとで
              </button>
            </div>
          </div>
        )}
        {active.id === 'sample' && tab !== 'wizard' && (
          <div className="callout">
            いま表示しているのは架空の<strong>サンプル世帯</strong>です。
            <button type="button" className="link" onClick={() => setTab('wizard')}>
              かんたん入力でわが家のプランを作る →
            </button>
          </div>
        )}
        <ErrorBoundary
          resetKeys={[active, tab]}
          fallback={(e) => <ScreenError error={e} plan={active} onDelete={() => store.remove(active.id)} onEdit={() => setTab('edit')} />}
        >
          {tab === 'result' && <Dashboard key={active.id} plan={active} onApply={store.update} real={real} />}
          {tab === 'table' && <YearTable plan={active} real={real} />}
          {tab === 'compare' && <Compare plan={active} plans={plans} real={real} onSave={(p) => store.add(p, false)} />}
          {tab === 'risk' && <Risk key={active.id} plan={active} real={real} />}
          {tab === 'assumptions' && <Assumptions />}
          {tab === 'wizard' && (
            <>
              {!active.wizard && active.id !== 'sample' && (
                <div className="callout">このプランは詳細設定で作られているため、かんたん入力の結果は新しいプランとして追加されます。</div>
              )}
              <Wizard
                key={`${active.id}-${wizardKey}`}
                initial={ownWizard ?? defaultWizard(currentYM())}
                onFinish={(w) => {
                  finishWizard(w)
                  setWizardKey((k) => k + 1)
                }}
                onCancel={() => setTab('result')}
                finishLabel={ownWizard ? 'この内容でプランを作り直す' : 'この内容でプランを作る'}
              />
            </>
          )}
          {tab === 'edit' && <Editor plan={active} onChange={store.update} />}
        </ErrorBoundary>
      </main>

      {incoming && 'error' in incoming && (
        <Modal title={incoming.source === 'link' ? '共有されたプランを開けませんでした' : 'ファイルを読み込めませんでした'} onClose={() => finishIncoming()}>
          <pre className="crash-detail">{incoming.error}</pre>
          <div className="actions">
            <button type="button" onClick={() => finishIncoming()}>
              閉じる
            </button>
          </div>
        </Modal>
      )}
      {incoming && 'plans' in incoming && (
        <Modal title={incoming.source === 'link' ? '共有されたプランを受け取りました' : 'ファイルからプランを読み込みます'} onClose={() => finishIncoming()}>
          <p>
            {incoming.plans.map((p) => `「${p.name}」`).join('')}
            {incoming.plans.length > 1 ? `の${incoming.plans.length}件` : ''}
            {incoming.source === 'link' ? 'をこのブラウザに追加しますか？' : 'を読み込みます。いまのプランに追加するか、すべて置き換えるかを選んでください。'}
          </p>
          {incoming.source === 'file' && plans.some((p) => p.id !== 'sample') && (
            <p className="note">「すべて置き換える」を選ぶと、いまこのブラウザにある {plans.length} 件のプランは消え、元に戻せません。</p>
          )}
          <div className="actions">
            <button type="button" onClick={() => finishIncoming('add')}>
              {incoming.source === 'link' ? '追加して表示' : 'いまのプランに追加'}
            </button>
            {incoming.source === 'file' && (
              <button type="button" className="secondary danger" onClick={() => finishIncoming('replace')}>
                すべて置き換える
              </button>
            )}
            <button type="button" className="link" onClick={() => finishIncoming()}>
              やめる
            </button>
          </div>
        </Modal>
      )}
      {link && (
        <Modal title="共有するリンクを作りました" onClose={() => setLink(undefined)}>
          <p>
            {link.copied
              ? 'リンクをコピーしました。家族などに送ると、開いた人のブラウザに「' + active.name + '」を追加できます。'
              : '下のリンクをコピーして送ってください。'}
          </p>
          <textarea className="share-url" readOnly value={link.url} rows={3} onFocus={(e) => e.currentTarget.select()} />
          <p className="note">
            リンクの「#」から後ろに、プランの内容（生年月・収入・資産など）がそのまま入っています。この部分はサーバーには送られませんが、リンクを受け取った人は誰でも内容を見られます。メッセージアプリやメールで送ると、そのサービスにも内容が残ります。
          </p>
          <div className="actions">
            {!link.copied && navigator.clipboard && (
              <button type="button" onClick={() => navigator.clipboard.writeText(link.url).then(() => setLink({ ...link, copied: true }))}>
                コピー
              </button>
            )}
            <button type="button" className={link.copied ? '' : 'secondary'} onClick={() => setLink(undefined)}>
              閉じる
            </button>
          </div>
        </Modal>
      )}

      <footer className="app-footer">
        <p>入力した内容と計算はすべてこのブラウザの中だけで行い、サーバーには送信しません。保存先もこのブラウザ（localStorage）です。</p>
        <p>
          税・社会保険は2025〜2026年の制度にもとづく概算です。結果は試算であり、金融・税務の助言ではありません。大切な判断の前には専門家に確認してください。
        </p>
      </footer>
    </div>
  )
}

/** Shown in place of a screen that failed to draw: the other plans and tabs keep working. */
function ScreenError({ error, plan, onDelete, onEdit }: { error: Error; plan: Plan; onDelete: () => void; onEdit: () => void }) {
  return (
    <section className="card crash">
      <h2>この画面を表示できませんでした</h2>
      <p>
        プラン「{plan.name}
        」の内容に、計算できない値が入っている可能性があります。上の「プラン」でほかのプランに切り替えるか、詳細設定で値を見直してください。直せない場合は、このプランをファイルに保存してから削除できます。
      </p>
      <pre className="crash-detail">{error.message}</pre>
      <div className="actions">
        <button type="button" className="secondary" onClick={onEdit}>
          詳細設定を開く
        </button>
        <button type="button" className="secondary" onClick={() => downloadJson(`${plan.name}.json`, plan)}>
          このプランをファイルに保存
        </button>
        <button
          type="button"
          className="secondary danger"
          onClick={() => confirm(`「${plan.name}」を削除します。元に戻せません。よろしいですか？`) && onDelete()}
        >
          このプランを削除
        </button>
      </div>
    </section>
  )
}

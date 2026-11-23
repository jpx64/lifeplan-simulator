import { Component, type ReactNode } from 'react'
import { clearStoredData, downloadStoredData } from './store'

interface Props {
  children: ReactNode
  /** What to show instead of the children after an error. */
  fallback: (error: Error) => ReactNode
  /** The error is cleared when any of these change (another plan or tab was chosen, the plan was edited). */
  resetKeys?: unknown[]
}

/** Keeps an error in one part of the screen from blanking the whole app. */
export class ErrorBoundary extends Component<Props, { error?: Error; keys?: unknown[] }> {
  state: { error?: Error; keys?: unknown[] } = {}

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  static getDerivedStateFromProps(props: Props, state: { error?: Error; keys?: unknown[] }) {
    const keys = props.resetKeys ?? []
    const changed = !state.keys || keys.length !== state.keys.length || keys.some((k, i) => k !== state.keys![i])
    if (!changed) return null
    return { keys, error: state.keys && state.error ? undefined : state.error }
  }

  componentDidCatch(error: Error) {
    console.error(error)
  }

  render() {
    return this.state.error ? this.props.fallback(this.state.error) : this.props.children
  }
}

/** Shown when the app itself cannot be drawn: the saved data can still be kept or cleared. */
export function AppCrash({ error }: { error: Error }) {
  return (
    <div className="app">
      <section className="card crash">
        <h1>画面を表示できませんでした</h1>
        <p>
          ブラウザに保存されているプランのデータが、このアプリで読めない形になっている可能性があります。まず下のボタンでデータをファイルに保存してから、最初の状態に戻してください。保存したファイルは、あとで「保存・読み込み」から読み込めるか試せます。
        </p>
        <pre className="crash-detail">{error.message}</pre>
        <div className="actions">
          <button type="button" onClick={downloadStoredData}>
            データをファイルに保存
          </button>
          <button
            type="button"
            className="secondary danger"
            onClick={() => {
              if (!confirm('このブラウザに保存されているプランをすべて消して、最初の状態に戻します。元に戻せません。よろしいですか？')) return
              clearStoredData()
              location.reload()
            }}
          >
            すべて消して最初の状態に戻す
          </button>
          <button type="button" className="link" onClick={() => location.reload()}>
            再読み込み
          </button>
        </div>
      </section>
    </div>
  )
}

import { useEffect, useRef, useState } from 'react'
import { runMonteCarlo, type MonteCarloResult } from '../engine/montecarlo'
import type { YearRow } from '../engine/summary'
import type { Plan } from '../engine/types'
import { BandChart } from './Charts'
import { man, pct } from './format'

const RUNS = 300

/** Monte Carlo: how much the result depends on the order and size of market ups and downs. */
export function MonteCarloPanel({ plan, years, real }: { plan: Plan; years: YearRow[]; real: boolean }) {
  const [result, setResult] = useState<MonteCarloResult | null>(null)
  const [progress, setProgress] = useState<number | null>(null)
  const cancel = useRef({ cancelled: false })

  // results become stale when the plan or the display mode changes
  useEffect(() => {
    cancel.current.cancelled = true
    setResult(null)
    setProgress(null)
  }, [plan, real])

  const run = async () => {
    cancel.current = { cancelled: false }
    setProgress(0)
    const res = await runMonteCarlo(plan, { runs: RUNS, real, onProgress: (d) => setProgress(d), signal: cancel.current })
    if (!cancel.current.cancelled) {
      setResult(res)
      setProgress(null)
    }
  }

  const lastI = result ? result.years.length - 1 : 0
  return (
    <section className="card">
      <div className="card-head">
        <h2>運用リスク（モンテカルロ・シミュレーション）</h2>
        {progress === null ? (
          <button type="button" className="secondary" onClick={run}>
            {result ? 'もう一度試算する' : `${RUNS}通りの相場で試算する`}
          </button>
        ) : (
          <span className="note" role="status">
            試算中… {progress} / {RUNS}
          </span>
        )}
      </div>
      <p className="note">
        利回りは毎年一定ではなく、上がったり下がったりします。NISA・iDeCo などの値動き（年率の標準偏差: 株式15%、持株25% など。口座ごとに詳細設定で変更可）を乱数で再現し、{RUNS}通りの将来を計算します。
      </p>
      {result && (
        <>
          <div className="kpis compact">
            <div className={`kpi ${result.successRate >= 0.9 ? 'good' : result.successRate < 0.7 ? 'bad' : ''}`}>
              <span className="kpi-label">お金が尽きない確率</span>
              <strong className="kpi-value">{pct(result.successRate, 0)}</strong>
              <span className="kpi-sub">{result.ages[lastI]}歳まで</span>
            </div>
            <div className="kpi">
              <span className="kpi-label">{result.ages[lastI]}歳時点の資産（中央値）</span>
              <strong className="kpi-value">{man(result.bands.p50[lastI])}</strong>
            </div>
            <div className="kpi">
              <span className="kpi-label">悪いほうから10%のケース</span>
              <strong className="kpi-value">{man(result.bands.p10[lastI])}</strong>
            </div>
            {result.depletionAges.length > 0 && (
              <div className="kpi bad">
                <span className="kpi-label">尽きる場合の年齢（中央値）</span>
                <strong className="kpi-value">{result.depletionAges[Math.floor(result.depletionAges.length / 2)]}歳</strong>
              </div>
            )}
          </div>
          <BandChart mc={result} deterministic={result.years.map((y) => years.find((r) => r.year === y)?.totalAssets ?? 0)} />
          <p className="note">
            資産合計（預貯金・NISA・iDeCo など）の各年12月末時点の分布です。{real ? 'いまの物価に換算しています。' : ''}
            平均の利回りが同じでも、値動きがあると複利の伸びは小さくなるため、中央値は「利回りが一定の場合」より低くなるのが普通です。
          </p>
        </>
      )}
    </section>
  )
}

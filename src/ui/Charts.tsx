import { useEffect, useState, type ReactElement, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Area, Bar, CartesianGrid, ComposedChart, Legend, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { EXPENSE_LABELS, type ExpenseKey, type YearRow } from '../engine/summary'
import type { Plan } from '../engine/types'
import { axisYen, man, pct } from './format'

const GROUPS = [
  { key: 'cash', label: '預貯金', color: 'var(--c1)' },
  { key: 'nisa', label: 'NISA', color: 'var(--c2)' },
  { key: 'taxable', label: '特定口座・持株', color: 'var(--c3)' },
  { key: 'pension', label: 'iDeCo・DC・個人年金', color: 'var(--c4)' },
] as const

const EXPENSE_COLORS: Record<ExpenseKey, string> = {
  housing: 'var(--c1)',
  education: 'var(--c2)',
  childLiving: 'var(--c6)',
  living: 'var(--c3)',
  allowance: 'var(--c7)',
  insurance: 'var(--c4)',
  special: 'var(--c8)',
  car: 'var(--c9)',
  care: 'var(--c10)',
  other: 'var(--c5)',
}

function groupOf(plan: Plan, accountId: string): 'nisa' | 'taxable' | 'pension' {
  const acc = plan.accounts.find((a) => a.id === accountId)
  if (!acc) return 'taxable' // auto-created taxable accounts
  if (acc.kind === 'nisa') return 'nisa'
  if (acc.kind === 'taxable' || acc.kind === 'stock') return 'taxable'
  return 'pension'
}

/** Phones and tablets: no mouse to hover with, and a tooltip over the chart hides what it explains. */
const DOCK_QUERY = '(max-width: 640px), (hover: none)'

function useDockedTips() {
  const [docked, setDocked] = useState(() => typeof matchMedia !== 'undefined' && matchMedia(DOCK_QUERY).matches)
  useEffect(() => {
    const m = matchMedia(DOCK_QUERY)
    const on = () => setDocked(m.matches)
    m.addEventListener('change', on)
    return () => m.removeEventListener('change', on)
  }, [])
  return docked
}

type Tip = (body: ReactNode) => ReactNode

/**
 * A chart and its tooltip. With a mouse the tooltip floats over the chart; on phones it is shown in
 * a box under the chart instead, so that it never covers the lines it describes.
 */
function ChartBox({ height, children, legend }: { height: number; children: (tip: Tip) => ReactElement; legend?: ReactNode }) {
  const docked = useDockedTips()
  const [dock, setDock] = useState<HTMLDivElement | null>(null)
  const tip: Tip = (body) => (docked && dock && body ? createPortal(body, dock) : body)
  return (
    <div className="chart-box">
      <ResponsiveContainer width="100%" height={height}>
        {children(tip)}
      </ResponsiveContainer>
      {legend}
      {docked && <div ref={setDock} className="tip-dock" data-hint="グラフをタップするか指でなぞると、その時点の内訳をここに表示します" />}
    </div>
  )
}

const axisProps = { tick: { fill: 'var(--muted)', fontSize: 12 } }

/** Keeps the legend in the order the series are drawn. */
const legendOrder = (keys: string[]) => (item: { dataKey?: unknown }) => keys.indexOf(String(item.dataKey))

function selfIdOf(plan: Plan) {
  return plan.members.find((m) => m.role === 'self')!.id
}

function xLabel(selfId: string) {
  return (r: YearRow) => `${r.year}（${r.ages[selfId]}歳）`
}

interface TipItem {
  label: string
  value: number
  color?: string
}

/** Tooltip body: the items, a bold total row, then optional rows outside the total. */
function ChartTip({ title, items, total, after = [], shares }: { title: string; items: TipItem[]; total?: TipItem; after?: TipItem[]; shares?: boolean }) {
  const row = (it: TipItem, className?: string, share?: boolean) => (
    <tr key={it.label} className={className}>
      <th>
        {it.color && <span className="swatch" style={{ background: it.color }} />}
        {it.label}
      </th>
      <td className={it.value < 0 ? 'neg' : undefined}>{man(it.value)}</td>
      {shares && <td className="share">{share && total && total.value > 0 ? pct(it.value / total.value, 0) : ''}</td>}
    </tr>
  )
  return (
    <div className="chart-tip">
      <div className="chart-tip-title">{title}</div>
      <table>
        <tbody>{items.map((it) => row(it, undefined, true))}</tbody>
        {(total || after.length > 0) && (
          <tfoot>
            {total && row(total, 'total')}
            {after.map((it) => row(it))}
          </tfoot>
        )}
      </table>
    </div>
  )
}

/** Rows that round to 0万円 only add noise to a tooltip. */
const visible = (it: TipItem) => Math.round(it.value / 10_000) !== 0

type ClickState = { activeTooltipIndex?: number | string | null } | null | undefined

function onYearClick(years: YearRow[], onSelect?: (year: number) => void) {
  if (!onSelect) return undefined
  return (e: ClickState) => {
    const i = e?.activeTooltipIndex
    if (i === undefined || i === null) return
    const y = years[Number(i)]
    if (y) onSelect(y.year)
  }
}

export function AssetChart({ plan, years, selected, onSelect }: { plan: Plan; years: YearRow[]; selected?: number; onSelect?: (year: number) => void }) {
  const selfId = selfIdOf(plan)
  const data = years.map((y) => {
    const g = { cash: y.cash, nisa: 0, taxable: 0, pension: 0 }
    for (const [id, bal] of Object.entries(y.accounts)) g[groupOf(plan, id)] += bal
    return { label: xLabel(selfId)(y), year: y.year, age: y.ages[selfId], ...g, loan: -y.loanBalance, total: y.totalAssets }
  })
  type Row = (typeof data)[number]
  const sel = years.find((y) => y.year === selected)
  return (
    <ChartBox height={340}>
      {(tip) => (
        <ComposedChart
          data={data}
          margin={{ top: 8, right: 8, left: 8, bottom: 0 }}
          onClick={onYearClick(years, onSelect)}
          style={{ cursor: onSelect ? 'pointer' : undefined }}
        >
          <CartesianGrid stroke="var(--grid)" vertical={false} />
          <XAxis dataKey="label" {...axisProps} minTickGap={40} />
          <YAxis tickFormatter={axisYen} {...axisProps} width={64} domain={['auto', 'auto']} />
          <Tooltip
            content={({ active, payload }) => {
              const r = payload?.[0]?.payload as Row | undefined
              if (!active || !r) return null
              const loan = -r.loan
              return tip(
                <ChartTip
                  title={`${r.year}年（${r.age}歳）12月末`}
                  // listed top-down, in the order the areas are stacked on screen
                  items={[...GROUPS]
                    .reverse()
                    .map((g) => ({ label: g.label, value: r[g.key], color: g.color }))
                    .filter(visible)}
                  total={{ label: '資産合計', value: r.total }}
                  after={
                    loan > 0
                      ? [
                          { label: '住宅ローン残高', value: loan, color: 'var(--c5)' },
                          { label: '差し引き（資産 − ローン）', value: r.total - loan },
                        ]
                      : []
                  }
                />,
              )
            }}
          />
          <Legend wrapperStyle={{ fontSize: 13 }} itemSorter={legendOrder([...GROUPS.map((g) => g.key), 'total', 'loan'])} />
          <ReferenceLine y={0} stroke="var(--border-strong)" />
          {sel && <ReferenceLine x={xLabel(selfId)(sel)} stroke="var(--text)" strokeDasharray="4 3" />}
          {GROUPS.map((g) => (
            <Area key={g.key} type="monotone" dataKey={g.key} name={g.label} stackId="a" stroke={g.color} fill={g.color} fillOpacity={0.75} />
          ))}
          <Line type="monotone" dataKey="total" name="資産合計" stroke="var(--text)" strokeWidth={1.5} dot={false} activeDot={{ r: 3 }} />
          <Line type="monotone" dataKey="loan" name="住宅ローン残高" stroke="var(--c5)" strokeWidth={2} dot={false} />
        </ComposedChart>
      )}
    </ChartBox>
  )
}

export function CashflowChart({ plan, years, onSelect }: { plan: Plan; years: YearRow[]; onSelect?: (year: number) => void }) {
  const selfId = selfIdOf(plan)
  const data = years.map((y) => ({
    label: xLabel(selfId)(y),
    year: y.year,
    age: y.ages[selfId],
    takeHome: y.takeHome,
    expenses: -y.expenses,
    balance: y.balance,
  }))
  type Row = (typeof data)[number]
  return (
    <ChartBox height={300}>
      {(tip) => (
        <ComposedChart
          data={data}
          margin={{ top: 8, right: 8, left: 8, bottom: 0 }}
          stackOffset="sign"
          onClick={onYearClick(years, onSelect)}
          style={{ cursor: onSelect ? 'pointer' : undefined }}
        >
          <CartesianGrid stroke="var(--grid)" vertical={false} />
          <XAxis dataKey="label" {...axisProps} minTickGap={40} />
          <YAxis tickFormatter={axisYen} {...axisProps} width={64} domain={['auto', 'auto']} />
          <Tooltip
            content={({ active, payload }) => {
              const r = payload?.[0]?.payload as Row | undefined
              if (!active || !r) return null
              return tip(
                <ChartTip
                  title={`${r.year}年（${r.age}歳）`}
                  items={[
                    { label: '手取り収入', value: r.takeHome, color: 'var(--c2)' },
                    { label: '支出', value: -r.expenses, color: 'var(--c5)' },
                  ]}
                  total={{ label: '年間収支', value: r.balance }}
                />,
              )
            }}
          />
          <Legend wrapperStyle={{ fontSize: 13 }} itemSorter={legendOrder(['takeHome', 'expenses', 'balance'])} />
          <ReferenceLine y={0} stroke="var(--border-strong)" />
          <Bar dataKey="takeHome" name="手取り収入" fill="var(--c2)" stackId="s" />
          <Bar dataKey="expenses" name="支出" fill="var(--c5)" stackId="s" />
          <Line type="monotone" dataKey="balance" name="年間収支" stroke="var(--text)" strokeWidth={1.5} dot={false} />
        </ComposedChart>
      )}
    </ChartBox>
  )
}

export function ExpenseChart({ plan, years, onSelect }: { plan: Plan; years: YearRow[]; onSelect?: (year: number) => void }) {
  const selfId = selfIdOf(plan)
  const keys = (Object.keys(EXPENSE_LABELS) as ExpenseKey[]).filter((k) => years.some((y) => y.expenseBreakdown[k] > 0))
  const data = years.map((y) => ({ label: xLabel(selfId)(y), year: y.year, age: y.ages[selfId], total: y.expenses, ...y.expenseBreakdown }))
  type Row = (typeof data)[number]
  return (
    <ChartBox height={300}>
      {(tip) => (
        <ComposedChart
          data={data}
          margin={{ top: 8, right: 8, left: 8, bottom: 0 }}
          onClick={onYearClick(years, onSelect)}
          style={{ cursor: onSelect ? 'pointer' : undefined }}
        >
          <CartesianGrid stroke="var(--grid)" vertical={false} />
          <XAxis dataKey="label" {...axisProps} minTickGap={40} />
          <YAxis tickFormatter={axisYen} {...axisProps} width={64} />
          <Tooltip
            cursor={{ fill: 'var(--grid)' }}
            content={({ active, payload }) => {
              const r = payload?.[0]?.payload as Row | undefined
              if (!active || !r) return null
              return tip(
                <ChartTip
                  title={`${r.year}年（${r.age}歳）`}
                  items={[...keys]
                    .reverse()
                    .map((k) => ({ label: EXPENSE_LABELS[k], value: r[k], color: EXPENSE_COLORS[k] }))
                    .filter(visible)}
                  total={{ label: '支出合計', value: r.total }}
                  shares
                />,
              )
            }}
          />
          <Legend wrapperStyle={{ fontSize: 13 }} itemSorter={legendOrder(keys)} />
          {keys.map((k) => (
            <Bar key={k} dataKey={k} name={EXPENSE_LABELS[k]} stackId="e" fill={EXPENSE_COLORS[k]} />
          ))}
        </ComposedChart>
      )}
    </ChartBox>
  )
}

export interface CompareSeries {
  name: string
  years: YearRow[]
  selfId: string
  color?: string
  dashed?: boolean
  /** Drawn thicker (e.g. the plan as it is). */
  bold?: boolean
}

const COMPARE_COLORS = ['var(--c1)', 'var(--c2)', 'var(--c5)', 'var(--c3)']

export function CompareChart({ series, field = 'totalAssets' }: { series: CompareSeries[]; field?: 'totalAssets' | 'liquidAssets' }) {
  const colorOf = (s: CompareSeries, i: number) => s.color ?? COMPARE_COLORS[i % COMPARE_COLORS.length]
  const byAge = new Map<number, Record<string, number | string>>()
  series.forEach((s, i) => {
    for (const y of s.years) {
      const age = y.ages[s.selfId]
      const row = byAge.get(age) ?? { age: `${age}歳` }
      row[`s${i}`] = y[field]
      byAge.set(age, row)
    }
  })
  const data = [...byAge.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v)
  return (
    <ChartBox
      height={340}
      // many series: an HTML legend under the chart wraps freely instead of eating into the plot
      legend={
        <ul className="chart-legend">
          {series.map((s, i) => (
            <li key={i} className={s.bold ? 'bold' : undefined}>
              <span className={`line-sample ${s.dashed ? 'dashed' : ''}`} style={{ borderColor: colorOf(s, i) }} aria-hidden />
              {s.name}
            </li>
          ))}
        </ul>
      }
    >
      {(tip) => (
        <ComposedChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
          <CartesianGrid stroke="var(--grid)" vertical={false} />
          <XAxis dataKey="age" {...axisProps} minTickGap={30} />
          <YAxis tickFormatter={axisYen} {...axisProps} width={64} domain={['auto', 'auto']} />
          <Tooltip
            content={({ active, payload }) => {
              const r = payload?.[0]?.payload as Record<string, number | string> | undefined
              if (!active || !r) return null
              const items = series
                .map((s, i) => ({ label: s.name, value: r[`s${i}`] as number, color: colorOf(s, i) }))
                .filter((it) => typeof it.value === 'number')
                .sort((a, b) => b.value - a.value)
              return tip(<ChartTip title={`本人が${r.age}のとき`} items={items} />)
            }}
          />
          <ReferenceLine y={0} stroke="var(--border-strong)" />
          {series.map((s, i) => (
            <Line
              key={i}
              type="monotone"
              dataKey={`s${i}`}
              name={s.name}
              stroke={colorOf(s, i)}
              strokeWidth={s.bold ? 3 : 2}
              strokeDasharray={s.dashed ? '6 4' : undefined}
              legendType="plainline"
              dot={false}
            />
          ))}
        </ComposedChart>
      )}
    </ChartBox>
  )
}

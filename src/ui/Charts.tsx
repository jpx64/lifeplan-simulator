import {
  Area,
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { MonteCarloResult } from '../engine/montecarlo'
import { EXPENSE_LABELS, type ExpenseKey, type YearRow } from '../engine/summary'
import type { Plan } from '../engine/types'
import { axisYen, man } from './format'

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
  other: 'var(--c5)',
}

function groupOf(plan: Plan, accountId: string): 'nisa' | 'taxable' | 'pension' {
  const acc = plan.accounts.find((a) => a.id === accountId)
  if (!acc) return 'taxable' // auto-created taxable accounts
  if (acc.kind === 'nisa') return 'nisa'
  if (acc.kind === 'taxable' || acc.kind === 'stock') return 'taxable'
  return 'pension'
}

const tooltipStyle = {
  background: 'var(--surface)',
  border: '1px solid var(--border)',
  borderRadius: 8,
  color: 'var(--text)',
  fontSize: 13,
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
    return { label: xLabel(selfId)(y), ...g, loan: -y.loanBalance, total: y.totalAssets }
  })
  const sel = years.find((y) => y.year === selected)
  return (
    <ResponsiveContainer width="100%" height={340}>
      <ComposedChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 0 }} onClick={onYearClick(years, onSelect)} style={{ cursor: onSelect ? 'pointer' : undefined }}>
        <CartesianGrid stroke="var(--grid)" vertical={false} />
        <XAxis dataKey="label" {...axisProps} minTickGap={40} />
        <YAxis tickFormatter={axisYen} {...axisProps} width={64} domain={['auto', 'auto']} />
        <Tooltip contentStyle={tooltipStyle} formatter={(v, name) => [man(Math.abs(Number(v))), name]} />
        <Legend wrapperStyle={{ fontSize: 13 }} itemSorter={legendOrder([...GROUPS.map((g) => g.key), 'loan'])} />
        <ReferenceLine y={0} stroke="var(--border-strong)" />
        {sel && <ReferenceLine x={xLabel(selfId)(sel)} stroke="var(--text)" strokeDasharray="4 3" />}
        {GROUPS.map((g) => (
          <Area key={g.key} type="monotone" dataKey={g.key} name={g.label} stackId="a" stroke={g.color} fill={g.color} fillOpacity={0.75} />
        ))}
        <Line type="monotone" dataKey="loan" name="住宅ローン残高" stroke="var(--c5)" strokeWidth={2} dot={false} />
      </ComposedChart>
    </ResponsiveContainer>
  )
}

export function CashflowChart({ plan, years, onSelect }: { plan: Plan; years: YearRow[]; onSelect?: (year: number) => void }) {
  const selfId = selfIdOf(plan)
  const data = years.map((y) => ({
    label: xLabel(selfId)(y),
    takeHome: y.takeHome,
    expenses: -y.expenses,
    balance: y.balance,
  }))
  return (
    <ResponsiveContainer width="100%" height={300}>
      <ComposedChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 0 }} stackOffset="sign" onClick={onYearClick(years, onSelect)} style={{ cursor: onSelect ? 'pointer' : undefined }}>
        <CartesianGrid stroke="var(--grid)" vertical={false} />
        <XAxis dataKey="label" {...axisProps} minTickGap={40} />
        <YAxis tickFormatter={axisYen} {...axisProps} width={64} domain={['auto', 'auto']} />
        <Tooltip contentStyle={tooltipStyle} formatter={(v, name) => [man(Math.abs(Number(v))), name]} />
        <Legend wrapperStyle={{ fontSize: 13 }} itemSorter={legendOrder(['takeHome', 'expenses', 'balance'])} />
        <ReferenceLine y={0} stroke="var(--border-strong)" />
        <Bar dataKey="takeHome" name="手取り収入" fill="var(--c2)" stackId="s" />
        <Bar dataKey="expenses" name="支出" fill="var(--c5)" stackId="s" />
        <Line type="monotone" dataKey="balance" name="年間収支" stroke="var(--text)" strokeWidth={1.5} dot={false} />
      </ComposedChart>
    </ResponsiveContainer>
  )
}

export function ExpenseChart({ plan, years, onSelect }: { plan: Plan; years: YearRow[]; onSelect?: (year: number) => void }) {
  const selfId = selfIdOf(plan)
  const keys = (Object.keys(EXPENSE_LABELS) as ExpenseKey[]).filter((k) => years.some((y) => y.expenseBreakdown[k] > 0))
  const data = years.map((y) => ({ label: xLabel(selfId)(y), ...y.expenseBreakdown }))
  return (
    <ResponsiveContainer width="100%" height={300}>
      <ComposedChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 0 }} onClick={onYearClick(years, onSelect)} style={{ cursor: onSelect ? 'pointer' : undefined }}>
        <CartesianGrid stroke="var(--grid)" vertical={false} />
        <XAxis dataKey="label" {...axisProps} minTickGap={40} />
        <YAxis tickFormatter={axisYen} {...axisProps} width={64} />
        <Tooltip contentStyle={tooltipStyle} formatter={(v, name) => [man(Number(v)), name]} />
        <Legend wrapperStyle={{ fontSize: 13 }} itemSorter={legendOrder(keys)} />
        {keys.map((k) => (
          <Bar key={k} dataKey={k} name={EXPENSE_LABELS[k]} stackId="e" fill={EXPENSE_COLORS[k]} />
        ))}
      </ComposedChart>
    </ResponsiveContainer>
  )
}

export function BandChart({ mc, deterministic }: { mc: MonteCarloResult; deterministic?: number[] }) {
  const data = mc.years.map((y, i) => ({
    label: `${y}（${mc.ages[i]}歳）`,
    outer: [mc.bands.p10[i], mc.bands.p90[i]],
    inner: [mc.bands.p25[i], mc.bands.p75[i]],
    median: mc.bands.p50[i],
    base: deterministic?.[i],
  }))
  return (
    <ResponsiveContainer width="100%" height={320}>
      <ComposedChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
        <CartesianGrid stroke="var(--grid)" vertical={false} />
        <XAxis dataKey="label" {...axisProps} minTickGap={40} />
        <YAxis tickFormatter={axisYen} {...axisProps} width={64} domain={['auto', 'auto']} />
        <Tooltip
          contentStyle={tooltipStyle}
          formatter={(v, name) => [Array.isArray(v) ? `${man(Number(v[0]))} 〜 ${man(Number(v[1]))}` : man(Number(v)), name]}
        />
        <Legend wrapperStyle={{ fontSize: 13 }} itemSorter={legendOrder(['outer', 'inner', 'median', 'base'])} />
        <ReferenceLine y={0} stroke="var(--border-strong)" />
        <Area type="monotone" dataKey="outer" name="10〜90%の範囲" stroke="none" fill="var(--c1)" fillOpacity={0.18} />
        <Area type="monotone" dataKey="inner" name="25〜75%の範囲" stroke="none" fill="var(--c1)" fillOpacity={0.35} />
        <Line type="monotone" dataKey="median" name="中央値" stroke="var(--c1)" strokeWidth={2} dot={false} />
        {deterministic && <Line type="monotone" dataKey="base" name="利回りが一定の場合" stroke="var(--muted)" strokeDasharray="5 4" strokeWidth={1.5} dot={false} />}
      </ComposedChart>
    </ResponsiveContainer>
  )
}

export function CompareChart({ series, field = 'totalAssets' }: { series: { name: string; years: YearRow[]; selfId: string }[]; field?: 'totalAssets' | 'liquidAssets' }) {
  const colors = ['var(--c1)', 'var(--c2)', 'var(--c5)', 'var(--c3)']
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
    <ResponsiveContainer width="100%" height={340}>
      <ComposedChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
        <CartesianGrid stroke="var(--grid)" vertical={false} />
        <XAxis dataKey="age" {...axisProps} minTickGap={30} />
        <YAxis tickFormatter={axisYen} {...axisProps} width={64} domain={['auto', 'auto']} />
        <Tooltip contentStyle={tooltipStyle} formatter={(v, name) => [man(Number(v)), name]} />
        <Legend wrapperStyle={{ fontSize: 13 }} itemSorter={legendOrder(series.map((_, i) => `s${i}`))} />
        <ReferenceLine y={0} stroke="var(--border-strong)" />
        {series.map((s, i) => (
          <Line key={i} type="monotone" dataKey={`s${i}`} name={s.name} stroke={colors[i % colors.length]} strokeWidth={2} dot={false} />
        ))}
      </ComposedChart>
    </ResponsiveContainer>
  )
}

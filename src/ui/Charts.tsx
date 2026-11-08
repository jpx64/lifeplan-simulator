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
import type { YearRow } from '../engine/summary'
import type { Plan } from '../engine/types'
import { axisYen, man } from './format'

const GROUPS = [
  { key: 'cash', label: '預貯金', color: 'var(--c1)' },
  { key: 'nisa', label: 'NISA', color: 'var(--c2)' },
  { key: 'taxable', label: '特定口座・持株', color: 'var(--c3)' },
  { key: 'pension', label: 'iDeCo・DC・個人年金', color: 'var(--c4)' },
] as const

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

function xLabel(selfId: string) {
  return (r: YearRow) => `${r.year}（${r.ages[selfId]}歳）`
}

export function AssetChart({ plan, years }: { plan: Plan; years: YearRow[] }) {
  const selfId = plan.members.find((m) => m.role === 'self')!.id
  const data = years.map((y) => {
    const g = { cash: y.cash, nisa: 0, taxable: 0, pension: 0 }
    for (const [id, bal] of Object.entries(y.accounts)) g[groupOf(plan, id)] += bal
    return { label: xLabel(selfId)(y), ...g, loan: -y.loanBalance, total: y.totalAssets }
  })
  return (
    <ResponsiveContainer width="100%" height={340}>
      <ComposedChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
        <CartesianGrid stroke="var(--grid)" vertical={false} />
        <XAxis dataKey="label" tick={{ fill: 'var(--muted)', fontSize: 12 }} minTickGap={40} />
        <YAxis tickFormatter={axisYen} tick={{ fill: 'var(--muted)', fontSize: 12 }} width={64} />
        <Tooltip contentStyle={tooltipStyle} formatter={(v, name) => [man(Math.abs(Number(v))), name]} />
        <Legend wrapperStyle={{ fontSize: 13 }} />
        <ReferenceLine y={0} stroke="var(--border-strong)" />
        {GROUPS.map((g) => (
          <Area key={g.key} type="monotone" dataKey={g.key} name={g.label} stackId="a" stroke={g.color} fill={g.color} fillOpacity={0.75} />
        ))}
        <Line type="monotone" dataKey="loan" name="住宅ローン残高" stroke="var(--c5)" strokeWidth={2} dot={false} />
      </ComposedChart>
    </ResponsiveContainer>
  )
}

export function CashflowChart({ plan, years }: { plan: Plan; years: YearRow[] }) {
  const selfId = plan.members.find((m) => m.role === 'self')!.id
  const data = years.map((y) => ({
    label: xLabel(selfId)(y),
    takeHome: y.takeHome,
    expenses: -y.expenses,
    balance: y.balance,
  }))
  return (
    <ResponsiveContainer width="100%" height={300}>
      <ComposedChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 0 }} stackOffset="sign">
        <CartesianGrid stroke="var(--grid)" vertical={false} />
        <XAxis dataKey="label" tick={{ fill: 'var(--muted)', fontSize: 12 }} minTickGap={40} />
        <YAxis tickFormatter={axisYen} tick={{ fill: 'var(--muted)', fontSize: 12 }} width={64} />
        <Tooltip contentStyle={tooltipStyle} formatter={(v, name) => [man(Math.abs(Number(v))), name]} />
        <Legend wrapperStyle={{ fontSize: 13 }} />
        <ReferenceLine y={0} stroke="var(--border-strong)" />
        <Bar dataKey="takeHome" name="手取り収入" fill="var(--c2)" stackId="s" />
        <Bar dataKey="expenses" name="支出" fill="var(--c5)" stackId="s" />
        <Line type="monotone" dataKey="balance" name="年間収支" stroke="var(--text)" strokeWidth={1.5} dot={false} />
      </ComposedChart>
    </ResponsiveContainer>
  )
}

export function CompareChart({ series }: { series: { name: string; years: YearRow[]; selfId: string }[] }) {
  const colors = ['var(--c1)', 'var(--c2)', 'var(--c5)', 'var(--c3)']
  const byAge = new Map<number, Record<string, number | string>>()
  series.forEach((s, i) => {
    for (const y of s.years) {
      const age = y.ages[s.selfId]
      const row = byAge.get(age) ?? { age: `${age}歳` }
      row[`s${i}`] = y.totalAssets
      byAge.set(age, row)
    }
  })
  const data = [...byAge.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v)
  return (
    <ResponsiveContainer width="100%" height={340}>
      <ComposedChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
        <CartesianGrid stroke="var(--grid)" vertical={false} />
        <XAxis dataKey="age" tick={{ fill: 'var(--muted)', fontSize: 12 }} minTickGap={30} />
        <YAxis tickFormatter={axisYen} tick={{ fill: 'var(--muted)', fontSize: 12 }} width={64} />
        <Tooltip contentStyle={tooltipStyle} formatter={(v, name) => [man(Number(v)), name]} />
        <Legend wrapperStyle={{ fontSize: 13 }} />
        <ReferenceLine y={0} stroke="var(--border-strong)" />
        {series.map((s, i) => (
          <Line key={i} type="monotone" dataKey={`s${i}`} name={s.name} stroke={colors[i % colors.length]} strokeWidth={2} dot={false} />
        ))}
      </ComposedChart>
    </ResponsiveContainer>
  )
}

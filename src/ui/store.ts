import { useCallback, useEffect, useState } from 'react'
import { samplePlan } from '../engine/defaults'
import type { Plan } from '../engine/types'

const KEY = 'lifeplan-simulator:v1'

interface Saved {
  plans: Plan[]
  activeId: string
}

function load(): Saved | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const data = JSON.parse(raw) as Saved
    if (!Array.isArray(data.plans) || data.plans.length === 0) return null
    return data
  } catch {
    return null
  }
}

function save(data: Saved) {
  try {
    localStorage.setItem(KEY, JSON.stringify(data))
  } catch {
    // storage may be unavailable (private mode); the app still works for this session
  }
}

export const newId = () => Math.random().toString(36).slice(2, 10)

/** Whether nothing was saved when the page was opened. */
const FIRST_VISIT = load() === null

/** Plans (scenarios) kept in the browser only. */
export function usePlans() {
  const [state, setState] = useState<Saved>(() => load() ?? { plans: [samplePlan()], activeId: 'sample' })
  const isFirstVisit = FIRST_VISIT

  useEffect(() => save(state), [state])

  const active = state.plans.find((p) => p.id === state.activeId) ?? state.plans[0]

  const update = useCallback((plan: Plan) => {
    setState((s) => ({ ...s, plans: s.plans.map((p) => (p.id === plan.id ? plan : p)) }))
  }, [])

  const add = useCallback((plan: Plan) => {
    setState((s) => ({ plans: [...s.plans, plan], activeId: plan.id }))
  }, [])

  const select = useCallback((id: string) => setState((s) => ({ ...s, activeId: id })), [])

  const remove = useCallback((id: string) => {
    setState((s) => {
      const plans = s.plans.filter((p) => p.id !== id)
      if (plans.length === 0) plans.push(samplePlan())
      return { plans, activeId: s.activeId === id ? plans[0].id : s.activeId }
    })
  }, [])

  const duplicate = useCallback((id: string) => {
    setState((s) => {
      const src = s.plans.find((p) => p.id === id)
      if (!src) return s
      const copy: Plan = { ...structuredClone(src), id: newId(), name: `${src.name}のコピー` }
      return { plans: [...s.plans, copy], activeId: copy.id }
    })
  }, [])

  const replaceAll = useCallback((plans: Plan[]) => {
    if (plans.length) setState({ plans, activeId: plans[0].id })
  }, [])

  return { plans: state.plans, active, update, add, select, remove, duplicate, replaceAll, isFirstVisit }
}

export function downloadJson(name: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  URL.revokeObjectURL(url)
}

export function downloadCsv(name: string, rows: (string | number)[][]) {
  const csv = rows.map((r) => r.map((c) => (typeof c === 'string' && /[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(',')).join('\n')
  const blob = new Blob(['﻿' + csv], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  URL.revokeObjectURL(url)
}

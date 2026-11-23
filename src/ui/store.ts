import { useCallback, useEffect, useRef, useState } from 'react'
import { samplePlan } from '../engine/sample'
import type { Plan } from '../engine/types'

export const STORAGE_KEY = 'lifeplan-simulator:v1'
const BACKUP_KEY = 'lifeplan-simulator:backup'
/** Saved data that could not be read, kept aside instead of being overwritten. */
const UNREADABLE_KEY = 'lifeplan-simulator:unreadable'

interface Saved {
  plans: Plan[]
  activeId: string
}

const looksLikePlan = (p: unknown): p is Plan =>
  typeof p === 'object' && p !== null && typeof (p as Plan).id === 'string' && typeof (p as Plan).name === 'string' && Array.isArray((p as Plan).members)

/** Keeps saved data the app cannot read, so that it is not lost when the app saves again. */
function keepUnreadable(raw: string) {
  try {
    if (!localStorage.getItem(UNREADABLE_KEY)) localStorage.setItem(UNREADABLE_KEY, raw)
  } catch {
    // ignore
  }
}

function load(): Saved | null {
  let raw: string | null = null
  try {
    raw = localStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
  if (!raw) return null
  try {
    const data = JSON.parse(raw) as { plans?: unknown[]; activeId?: string }
    const all = Array.isArray(data.plans) ? data.plans : []
    const plans = all.filter(looksLikePlan)
    if (plans.length < all.length || plans.length === 0) keepUnreadable(raw)
    if (plans.length === 0) return null
    return {
      activeId: typeof data.activeId === 'string' ? data.activeId : plans[0].id,
      // the sample used to be built by hand; replace it with the current one (built from かんたん入力 answers)
      plans: plans.map((p) => (p.id === 'sample' && !p.wizard ? samplePlan() : p)),
    }
  } catch {
    keepUnreadable(raw)
    return null
  }
}

/** Whether some saved data could not be read (and was kept aside). */
export function hasUnreadableData() {
  try {
    return localStorage.getItem(UNREADABLE_KEY) !== null
  } catch {
    return false
  }
}

export function downloadUnreadableData() {
  let raw: string | null = null
  try {
    raw = localStorage.getItem(UNREADABLE_KEY)
  } catch {
    // ignore
  }
  downloadBlob('lifeplan-unreadable.json', new Blob([raw ?? '{}'], { type: 'application/json' }))
}

export function forgetUnreadableData() {
  try {
    localStorage.removeItem(UNREADABLE_KEY)
  } catch {
    // ignore
  }
}

function save(data: Saved) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
  } catch {
    // storage may be unavailable (private mode); the app still works for this session
  }
}

export const newId = () => Math.random().toString(36).slice(2, 10)

/** Whether nothing was saved when the page was opened. */
const FIRST_VISIT = load() === null

/** Plans read from a file or a link get new ids (and names) when they clash with the plans already here. */
export function withoutClashes(existing: Plan[], incoming: Plan[]): Plan[] {
  const ids = new Set(existing.map((p) => p.id))
  const names = new Set(existing.map((p) => p.name))
  return incoming.map((p) => {
    let name = p.name
    for (let k = 2; names.has(name); k++) name = `${p.name}（${k}）`
    const id = ids.has(p.id) ? newId() : p.id
    ids.add(id)
    names.add(name)
    return { ...p, id, name }
  })
}

/** Plans (scenarios) kept in the browser only. */
export function usePlans() {
  const [state, setState] = useState<Saved>(() => load() ?? { plans: [samplePlan()], activeId: 'sample' })
  const isFirstVisit = FIRST_VISIT
  const initial = useRef(state)

  useEffect(() => {
    save(state)
    // writing back what was loaded is not a change
    if (state !== initial.current && state.plans.some((p) => p.id !== 'sample')) updateBackupState({ changedAt: Date.now() })
  }, [state])

  const active = state.plans.find((p) => p.id === state.activeId) ?? state.plans[0]

  const update = useCallback((plan: Plan) => {
    setState((s) => ({ ...s, plans: s.plans.map((p) => (p.id === plan.id ? plan : p)) }))
  }, [])

  const add = useCallback((plan: Plan, select = true) => {
    setState((s) => ({ plans: [...s.plans, plan], activeId: select ? plan.id : s.activeId }))
  }, [])

  /** Adds plans from a file or a link and shows the first one. */
  const addMany = useCallback((plans: Plan[]) => {
    setState((s) => {
      const added = withoutClashes(s.plans, plans)
      return added.length ? { plans: [...s.plans, ...added], activeId: added[0].id } : s
    })
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

  return { plans: state.plans, active, update, add, addMany, select, remove, duplicate, replaceAll, isFirstVisit }
}

/* ---------- backups ---------- */

interface BackupState {
  /** Last time all plans were saved to a file. */
  savedAt?: number
  /** Last time the user's own plans changed. */
  changedAt?: number
  /** The reminder is not shown before this time. */
  snoozeUntil?: number
}

export function backupState(): BackupState {
  try {
    return JSON.parse(localStorage.getItem(BACKUP_KEY) ?? '{}') as BackupState
  } catch {
    return {}
  }
}

export function updateBackupState(patch: BackupState) {
  try {
    localStorage.setItem(BACKUP_KEY, JSON.stringify({ ...backupState(), ...patch }))
  } catch {
    // ignore
  }
}

const DAY = 24 * 60 * 60 * 1000

/**
 * Whether to remind the user to save their plans to a file: they have changed their own plans and
 * have not saved them for a while (data kept only in the browser can be deleted, e.g. by Safari after
 * days without a visit).
 */
export function needsBackupReminder(plans: Plan[], b: BackupState = backupState(), now = Date.now()): boolean {
  if (!plans.some((p) => p.id !== 'sample')) return false
  if (b.snoozeUntil && now < b.snoozeUntil) return false
  if (!b.changedAt) return false
  if (!b.savedAt) return now - b.changedAt > DAY
  return b.changedAt > b.savedAt && now - b.savedAt > 30 * DAY
}

export const snoozeBackupReminder = () => updateBackupState({ snoozeUntil: Date.now() + 14 * DAY })

/** Saves all plans to a file (and remembers when). */
export function downloadAllPlans(plans: Plan[]) {
  downloadJson(`lifeplan-${new Date().toISOString().slice(0, 10)}.json`, { plans })
  updateBackupState({ savedAt: Date.now() })
}

/** What is stored in the browser, as it is (for when the app cannot show it). */
export function downloadStoredData() {
  let raw: string | null = null
  try {
    raw = localStorage.getItem(STORAGE_KEY)
  } catch {
    // ignore
  }
  const blob = new Blob([raw ?? '{}'], { type: 'application/json' })
  downloadBlob('lifeplan-backup.json', blob)
}

export function clearStoredData() {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    // ignore
  }
}

/** Ask the browser to keep the data even when storage runs low (best effort; not all browsers grant it). */
export async function requestPersistentStorage() {
  try {
    if (navigator.storage?.persist && !(await navigator.storage.persisted())) await navigator.storage.persist()
  } catch {
    // ignore
  }
}

function downloadBlob(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  URL.revokeObjectURL(url)
}

export function downloadJson(name: string, data: unknown) {
  downloadBlob(name, new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }))
}

export function downloadCsv(name: string, rows: (string | number)[][]) {
  const csv = rows.map((r) => r.map((c) => (typeof c === 'string' && /[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(',')).join('\n')
  downloadBlob(name, new Blob(['﻿' + csv], { type: 'text/csv' }))
}

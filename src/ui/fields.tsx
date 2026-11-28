import { useEffect, useId, useState, type ReactNode } from 'react'

interface FieldProps {
  label: string
  hint?: ReactNode
  children: ReactNode
  id?: string
}

export function Field({ label, hint, children, id }: FieldProps) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {children}
      {hint && <small className="hint">{hint}</small>}
    </div>
  )
}

/** Number input that keeps the text while editing and commits a number. */
function NumberInput({
  value,
  onChange,
  scale = 1,
  step,
  min,
  max,
  id,
  suffix,
}: {
  value: number
  onChange: (v: number) => void
  scale?: number
  step?: number
  min?: number
  max?: number
  id?: string
  suffix?: string
}) {
  const show = (v: number) => String(Math.round((v / scale) * 10_000) / 10_000)
  const [text, setText] = useState(show(value))
  useEffect(() => {
    if (Number(text) * scale !== value) setText(show(value))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])
  return (
    <div className="input-suffix">
      <input
        id={id}
        type="number"
        inputMode="decimal"
        value={text}
        step={step}
        min={min}
        max={max}
        onChange={(e) => {
          setText(e.target.value)
          const n = Number(e.target.value)
          if (e.target.value !== '' && Number.isFinite(n)) onChange(n * scale)
        }}
        onBlur={() => setText(show(value))}
      />
      {suffix && <span>{suffix}</span>}
    </div>
  )
}

/** Yen amount entered in 万円. */
export function ManField(props: { label: string; value: number; onChange: (v: number) => void; hint?: ReactNode; step?: number }) {
  const id = useId()
  return (
    <Field label={props.label} hint={props.hint} id={id}>
      <NumberInput id={id} value={props.value} onChange={props.onChange} scale={10_000} step={props.step ?? 1} suffix="万円" />
    </Field>
  )
}

export function PercentField(props: { label: string; value: number; onChange: (v: number) => void; hint?: ReactNode; step?: number }) {
  const id = useId()
  return (
    <Field label={props.label} hint={props.hint} id={id}>
      <NumberInput id={id} value={props.value} onChange={props.onChange} scale={0.01} step={props.step ?? 0.1} suffix="%" />
    </Field>
  )
}

export function NumField(props: { label: string; value: number; onChange: (v: number) => void; suffix?: string; hint?: ReactNode; min?: number; max?: number }) {
  const id = useId()
  return (
    <Field label={props.label} hint={props.hint} id={id}>
      <NumberInput id={id} value={props.value} onChange={props.onChange} suffix={props.suffix} min={props.min} max={props.max} step={1} />
    </Field>
  )
}

export function MonthField(props: { label: string; value: string | undefined; onChange: (v: string | undefined) => void; hint?: ReactNode; optional?: boolean }) {
  const id = useId()
  return (
    <Field label={props.label} hint={props.hint} id={id}>
      <input
        id={id}
        type="month"
        value={props.value ?? ''}
        onChange={(e) => {
          if (e.target.value) props.onChange(e.target.value)
          else if (props.optional) props.onChange(undefined)
        }}
      />
    </Field>
  )
}

export function TextField(props: { label: string; value: string; onChange: (v: string) => void; hint?: ReactNode }) {
  const id = useId()
  return (
    <Field label={props.label} hint={props.hint} id={id}>
      <input id={id} type="text" value={props.value} onChange={(e) => props.onChange(e.target.value)} />
    </Field>
  )
}

export function SelectField<T extends string>(props: {
  label: string
  value: T
  options: { value: T; label: string }[]
  onChange: (v: T) => void
  hint?: ReactNode
}) {
  const id = useId()
  return (
    <Field label={props.label} hint={props.hint} id={id}>
      <select id={id} value={props.value} onChange={(e) => props.onChange(e.target.value as T)}>
        {props.options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </Field>
  )
}

export function CheckField(props: { label: string; checked: boolean; onChange: (v: boolean) => void; hint?: ReactNode }) {
  const id = useId()
  return (
    <div className="field check">
      <label htmlFor={id}>
        <input id={id} type="checkbox" checked={props.checked} onChange={(e) => props.onChange(e.target.checked)} />
        {props.label}
      </label>
      {props.hint && <small className="hint">{props.hint}</small>}
    </div>
  )
}

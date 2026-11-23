import { useEffect, useRef, type ReactNode } from 'react'

/** A modal dialog (native <dialog>), open while it is rendered. Esc or the backdrop closes it. */
export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    // closing is left to unmounting (removing the element ends the modal state); closing here would fire onClose
    const d = ref.current
    if (d && !d.open) d.showModal()
  }, [])
  return (
    <dialog
      ref={ref}
      className="modal"
      aria-label={title}
      onClose={onClose}
      onClick={(e) => {
        // a click on the backdrop (outside the content) closes the dialog
        if (e.target === ref.current) onClose()
      }}
    >
      <div className="modal-body">
        <h2>{title}</h2>
        {children}
      </div>
    </dialog>
  )
}

// In-app confirmation dialog. Replaces window.confirm(), whose text size the browser
// controls, so confirmation dialogs follow the typography settings ("Confirmation
// dialogs" section scale). Usage:
//   if (!(await confirmDialog({ message: 'Delete this?', confirmLabel: 'Delete', danger: true }))) return;
import { useEffect, useRef, useState } from 'react';

let show = null; // set by the mounted <ConfirmHost />

export function confirmDialog(options) {
  const opts = typeof options === 'string' ? { message: options } : options;
  // Host not mounted (should not happen): fall back to the browser dialog.
  if (!show) return Promise.resolve(window.confirm(opts.message));
  return new Promise((resolve) => show({ ...opts, resolve }));
}

export function ConfirmHost() {
  const [req, setReq] = useState(null);
  const confirmRef = useRef(null);
  const cancelRef = useRef(null);
  const returnFocus = useRef(null);

  useEffect(() => {
    show = (r) => {
      returnFocus.current = document.activeElement;
      setReq(r);
    };
    return () => {
      show = null;
    };
  }, []);

  useEffect(() => {
    if (!req) return undefined;
    // Focus the safe choice for destructive actions.
    (req.danger ? cancelRef : confirmRef).current?.focus();
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        close(false);
      } else if (e.key === 'Tab') {
        // keep focus inside the dialog
        const items = [cancelRef.current, confirmRef.current].filter(Boolean);
        const i = items.indexOf(document.activeElement);
        e.preventDefault();
        items[(i + (e.shiftKey ? -1 : 1) + items.length) % items.length].focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [req]);

  function close(result) {
    req?.resolve(result);
    setReq(null);
    returnFocus.current?.focus?.();
  }

  if (!req) return null;
  return (
    <div className="confirm-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close(false)}>
      <div className="confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" aria-describedby="confirm-message">
        <h2 id="confirm-title">{req.title || 'Please confirm'}</h2>
        <p id="confirm-message">{req.message}</p>
        <div className="confirm-actions">
          <button type="button" className="btn" ref={cancelRef} onClick={() => close(false)}>
            {req.cancelLabel || 'Cancel'}
          </button>
          <button
            type="button"
            className={`btn ${req.danger ? 'btn-danger' : 'btn-primary'}`}
            ref={confirmRef}
            onClick={() => close(true)}
          >
            {req.confirmLabel || 'OK'}
          </button>
        </div>
      </div>
    </div>
  );
}

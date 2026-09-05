'use client';

import { useState } from 'react';
import Button from './Button';
import Modal from './Modal';

interface ConfirmDialogProps {
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'danger' | 'primary';
  onConfirm: () => Promise<void> | void;
  onClose: () => void;
}

/** Replaces window.confirm(), which cannot show context and blocks the main thread. */
export default function ConfirmDialog({
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  tone = 'danger',
  onConfirm,
  onClose,
}: ConfirmDialogProps) {
  const [busy, setBusy] = useState(false);

  const run = async () => {
    setBusy(true);
    try {
      await onConfirm();
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={title}
      onClose={onClose}
      size="sm"
      dismissable={!busy}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            {cancelLabel}
          </Button>
          <Button variant={tone === 'danger' ? 'danger' : 'primary'} onClick={run} loading={busy}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <p className="text-sm leading-relaxed text-fg-muted">{description}</p>
    </Modal>
  );
}

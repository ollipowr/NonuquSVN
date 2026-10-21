import { t } from '@nonu/app/i18n';
import { Button } from '@nonu/components';
import React, { useEffect, useRef } from 'react';
import { DialogOverlay } from './Dialog.js';
import './ConfirmDialog.css';

export interface ConfirmDialogProps {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  /** Optional middle action, e.g. "discard" between "save" and "cancel". */
  extraLabel?: string;
  onExtra?: () => void;
  icon?: string;
  confirmIcon?: string;
}

export function ConfirmDialog({
  title,
  message,
  confirmLabel = 'OK',
  cancelLabel = t('cancel'),
  danger = false,
  onConfirm,
  onCancel,
  extraLabel,
  onExtra,
  icon,
  confirmIcon,
}: ConfirmDialogProps) {
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
      if (e.key === 'Enter') onConfirm();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onConfirm, onCancel]);

  useEffect(() => {
    confirmRef.current?.focus();
  }, []);

  return (
    <DialogOverlay className="svn-auth-overlay" onClose={onCancel}>
      <div
        className="svn-confirm-dialog"
        onClick={(e) => e.stopPropagation()}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="svn-confirm-title"
        aria-describedby="svn-confirm-message"
      >
        <div className="svn-confirm-head">
          {icon && (
            <span
              className={`material-symbols-outlined svn-confirm-icon${danger ? ' svn-confirm-icon--danger' : ''}`}
            >
              {icon}
            </span>
          )}
          <span id="svn-confirm-title" className="svn-confirm-title">
            {title}
          </span>
        </div>
        <p id="svn-confirm-message" className="svn-confirm-message">
          {message}
        </p>
        <div className="svn-auth-actions">
          <Button onClick={onCancel}>{cancelLabel}</Button>
          {extraLabel && onExtra && (
            <Button onClick={onExtra}>{extraLabel}</Button>
          )}
          <Button
            ref={confirmRef}
            variant="primary"
            icon
            className={danger ? 'svn-confirm-btn--danger' : undefined}
            onClick={onConfirm}
          >
            {confirmIcon && (
              <span className="material-symbols-outlined">{confirmIcon}</span>
            )}
            {confirmLabel}
          </Button>
        </div>
      </div>
    </DialogOverlay>
  );
}

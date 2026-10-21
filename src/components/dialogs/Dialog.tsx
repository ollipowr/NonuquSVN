import { Button } from '@nonu/components';
import React, { useEffect } from 'react';
import './Dialog.css';

/** Shared backdrop for standard, authentication and confirmation dialogs. */
export function DialogOverlay({
  children,
  onClose,
  className = 'dialog-overlay',
}: {
  children: React.ReactNode;
  onClose?: () => void;
  className?: string;
}) {
  return (
    <div className={className} onClick={onClose}>
      {children}
    </div>
  );
}
interface DialogProps {
  title: React.ReactNode;
  onClose: () => void;
  wide?: boolean;
  className?: string;
  children: React.ReactNode;
}

export function Dialog({
  title,
  onClose,
  wide,
  className,
  children,
}: DialogProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <DialogOverlay onClose={onClose}>
      <div
        className={`dialog-box${wide ? ' dialog-box--wide' : ''}${className ? ` ${className}` : ''}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="dialog-head">
          <span>{title}</span>
          <Button onClick={onClose}>✕</Button>
        </div>
        <div className="dialog-body">{children}</div>
      </div>
    </DialogOverlay>
  );
}

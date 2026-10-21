import { t } from '@nonu/app/i18n';
import React from 'react';
import './Spinner.css';

export interface SpinnerProps {
  label?: string;
  size?: number;
  className?: string;
}

/** A compact, inline loading indicator for asynchronous UI state. */
export function Spinner({
  label = t('loading'),
  size = 10,
  className = '',
}: SpinnerProps) {
  return (
    <span
      className={`svn-spinner${className ? ` ${className}` : ''}`}
      role="status"
      aria-label={label}
      style={{ '--svn-spinner-size': `${size}px` } as React.CSSProperties}
    />
  );
}

import type { ButtonHTMLAttributes } from 'react';
import './ActionButton.css';

export interface ActionButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  icon: string;
  label: string;
  hint?: string;
}

/** An action with an icon, label and optional explanation. Safe to use inside forms. */
export function ActionButton({
  icon,
  label,
  hint,
  className,
  type = 'button',
  ...props
}: ActionButtonProps) {
  return (
    <button
      {...props}
      type={type}
      className={['svn-action-button', className].filter(Boolean).join(' ')}
    >
      <span
        className="material-symbols-outlined svn-action-button-icon"
        aria-hidden="true"
      >
        {icon}
      </span>
      <span className="svn-action-button-label">{label}</span>
      {hint && <span className="svn-action-button-hint">{hint}</span>}
    </button>
  );
}

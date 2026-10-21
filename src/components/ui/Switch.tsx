import type { InputHTMLAttributes } from 'react';
import './Switch.css';

export interface SwitchProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'onChange'> {
  checked: boolean;
  onChange: (checked: boolean) => void;
}

export function Switch({
  checked,
  onChange,
  className,
  ...input
}: SwitchProps) {
  return (
    <input
      {...input}
      type="checkbox"
      role="switch"
      className={['svn-switch', className].filter(Boolean).join(' ')}
      checked={checked}
      onChange={(e) => onChange(e.target.checked)}
    />
  );
}

import './ProgressBar.css';

export interface ProgressBarProps {
  active: boolean;
  className?: string;
}

/** Indeterminate progress line. Its height is always reserved, so toggling `active` never shifts the content around it. */
export function ProgressBar({ active, className = '' }: ProgressBarProps) {
  return (
    <div
      className={`svn-progress-bar${active ? ' svn-progress-bar--active' : ''}${className ? ` ${className}` : ''}`}
      aria-hidden="true"
    />
  );
}

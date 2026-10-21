import './Splitter.css';

interface SplitterProps {
  direction: 'h' | 'v';
  onMouseDown?: (e: React.MouseEvent) => void;
  disabled?: boolean;
  subtle?: boolean;
  variant?: 'default' | 'ghost';
  className?: string;
}

export function Splitter({
  direction,
  onMouseDown,
  disabled,
  subtle,
  variant = 'default',
  className,
}: SplitterProps) {
  const cls = [
    'svn-splitter',
    `svn-splitter--${direction}`,
    disabled ? 'svn-splitter--disabled' : '',
    subtle ? 'svn-splitter--subtle' : '',
    variant !== 'default' && `svn-splitter--${variant}`,
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={cls} onMouseDown={disabled ? undefined : onMouseDown} />
  );
}

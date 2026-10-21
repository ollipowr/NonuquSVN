import {
  type CSSProperties,
  forwardRef,
  type HTMLAttributes,
  type ReactNode,
} from 'react';
import './StructuredListRow.css';

type Props = HTMLAttributes<HTMLDivElement> & {
  columns: string;
  children: ReactNode;
  active?: boolean;
};

/** Shared responsive row primitive for dense, column-based application lists. */
export const StructuredListRow = forwardRef<HTMLDivElement, Props>(
  function StructuredListRow(
    { columns, children, active, className, style, ...props },
    ref,
  ) {
    return (
      <div
        {...props}
        ref={ref}
        className={[
          'svn-structured-row',
          active && 'svn-structured-row--active',
          className,
        ]
          .filter(Boolean)
          .join(' ')}
        style={{ ...style, '--svn-list-columns': columns } as CSSProperties}
      >
        {children}
      </div>
    );
  },
);

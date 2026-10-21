import type React from 'react';
import './ViewHeader.css';

interface ViewHeaderProps {
  title: string;
  /** Dimmed secondary text next to the title (e.g. a URL). */
  subtitle?: string;
  /** Right-aligned actions. */
  children?: React.ReactNode;
}

/** Shared title bar shown at the top of every activity-bar view. */
export function ViewHeader({ title, subtitle, children }: ViewHeaderProps) {
  return (
    <div className="svn-view-header">
      <span className="svn-view-header-title">{title}</span>
      {subtitle && (
        <span className="svn-view-header-subtitle" title={subtitle}>
          {subtitle}
        </span>
      )}
      <div className="svn-view-header-spacer" />
      {children}
    </div>
  );
}

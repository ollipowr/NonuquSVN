import { t } from '@nonu/app/i18n';
import { Dialog } from '@nonu/components';
import type { SvnProperty } from '@nonu/svn';
import React from 'react';
import './PropertiesDialog.css';

interface PropertiesDialogProps {
  path: string;
  properties: SvnProperty[];
  onClose: () => void;
}

export function PropertiesDialog({
  path,
  properties,
  onClose,
}: PropertiesDialogProps) {
  return (
    <Dialog
      title={(t('propertiesTitle') as (path: string) => string)(path)}
      onClose={onClose}
    >
      {properties.length === 0 && (
        <div className="svn-props-empty">{t('noProperties') as string}</div>
      )}
      {properties.map((prop) => (
        <div key={prop.name} className="svn-props-entry">
          <span className="svn-props-name">{prop.name}</span>
          <span className="svn-props-value">{prop.value || '—'}</span>
        </div>
      ))}
    </Dialog>
  );
}

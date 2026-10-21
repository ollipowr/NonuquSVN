import { t } from '@nonu/app/i18n';
import { Button } from '@nonu/components';
import { TextInput } from '@nonu/components/ui/TextInput';
import React, { useState } from 'react';
import { DialogOverlay } from './Dialog.js';
import './AuthDialog.css';

export interface AuthDialogResult {
  username: string;
  password: string;
  trustServerCert: boolean;
}

export function AuthDialog({
  onSubmit,
  onCancel,
  busy,
}: {
  onSubmit: (result: AuthDialogResult) => void;
  onCancel: () => void;
  busy: boolean;
}) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [trustServerCert, setTrustServerCert] = useState(false);

  const submit = () => {
    if (!username.trim() || !password) return;
    onSubmit({ username: username.trim(), password, trustServerCert });
  };

  return (
    <DialogOverlay className="svn-auth-overlay">
      <div className="svn-auth-dialog">
        <div className="svn-auth-title">{t('authTitle')}</div>
        <div className="svn-auth-hint">{t('authHint')}</div>
        <label className="svn-auth-field">
          <span>{t('authUsername')}</span>
          <TextInput
            type="text"
            value={username}
            onChange={setUsername}
            autoFocus
            onKeyDown={(e) => e.key === 'Enter' && submit()}
          />
        </label>
        <label className="svn-auth-field">
          <span>{t('authPassword')}</span>
          <TextInput
            type="password"
            value={password}
            onChange={setPassword}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
          />
        </label>
        <label className="svn-auth-checkbox">
          <input
            type="checkbox"
            checked={trustServerCert}
            onChange={(e) => setTrustServerCert(e.target.checked)}
          />
          <span>{t('authTrustCert')}</span>
        </label>
        <div className="svn-auth-actions">
          <Button onClick={onCancel} disabled={busy}>
            {t('authCancel')}
          </Button>
          <Button
            variant="primary"
            onClick={submit}
            disabled={busy || !username.trim() || !password}
          >
            {busy ? t('authRetrying') : t('authRetry')}
          </Button>
        </div>
      </div>
    </DialogOverlay>
  );
}

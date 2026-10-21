import { Button, Select, Spinner, Switch } from '@nonu/components';
import { TextArea, TextInput } from '@nonu/components/ui/TextInput';
import React, { createContext, useContext, useEffect, useState } from 'react';
import './SettingsPanel.css';
import { type Locale, setLocale, t } from '@nonu/app/i18n';
import { ViewHeader } from '@nonu/components';
import type { HostAdapter } from '@nonu/host/types';
import { listAiModels } from '@nonu/stores';
import { scanFormatterRules } from '@nonu/utils';
import {
  DEFAULT_SETTINGS,
  type FormatterRule,
  loadSettings,
  type SvnSettings,
  saveSettings,
} from './settings.js';

const CLAUDE_CODE_MODELS = [
  { id: 'claude-code:haiku', name: 'Claude Haiku (fast, cheap)' },
  { id: 'claude-code:sonnet', name: 'Claude Sonnet' },
  { id: 'claude-code:opus', name: 'Claude Opus' },
];

function modelsFor(
  provider: SvnSettings['aiProvider'],
  all: { id: string; name: string; provider?: string }[],
) {
  if (provider === 'claude-code') return CLAUDE_CODE_MODELS;
  return all.filter((m) => m.provider === provider);
}

type Page = 'general' | 'ai' | 'formatter';

const NAV: { id: Page; icon: string; label: Parameters<typeof t>[0] }[] = [
  { id: 'general', icon: 'tune', label: 'settingsNavGeneral' },
  { id: 'ai', icon: 'auto_awesome', label: 'settingsNavAi' },
  { id: 'formatter', icon: 'code', label: 'settingsFormatterSection' },
];

// Lower-cased search query; items that don't match render nothing.
const Query = createContext('');

export function SvnSettingsPanel({
  host,
  onClose,
}: {
  host: HostAdapter;
  onClose: () => void;
}) {
  const [settings, setSettings] = useState<SvnSettings>(() =>
    loadSettings(host.storage),
  );
  const [models, setModels] = useState<
    { id: string; name: string; provider?: string }[]
  >([]);
  const [scanning, setScanning] = useState(false);
  const [scanMsg, setScanMsg] = useState<string | null>(null);
  const [page, setPage] = useState<Page>('general');
  const [query, setQuery] = useState('');
  const searching = query.trim() !== '';
  const show = (p: Page) => searching || page === p;

  useEffect(() => {
    listAiModels()
      .then(setModels)
      .catch(() => setModels([]));
  }, []);

  const update = <K extends keyof SvnSettings>(
    key: K,
    value: SvnSettings[K],
  ) => {
    const next = { ...settings, [key]: value };
    setSettings(next);
    void saveSettings(host.storage, next);
  };

  const onScan = async () => {
    setScanning(true);
    setScanMsg(null);
    try {
      const found = await scanFormatterRules(host);
      if (found.length === 0) {
        setScanMsg(t('settingsFormatterScanNone') as string);
      } else {
        const existing = new Set(settings.formatterRules.map((r) => r.path));
        const toAdd = found.filter((r) => !existing.has(r.path));
        const next = [...settings.formatterRules, ...toAdd];
        update('formatterRules', next);
        setScanMsg(
          (t('settingsFormatterScanFound') as (n: number) => string)(
            toAdd.length,
          ),
        );
      }
    } finally {
      setScanning(false);
    }
  };

  const addRule = () => {
    update('formatterRules', [
      ...settings.formatterRules,
      { path: '', cmd: '', enabled: true },
    ]);
  };

  const removeRule = (i: number) => {
    update(
      'formatterRules',
      settings.formatterRules.filter((_, idx) => idx !== i),
    );
  };

  const updateRule = (
    i: number,
    field: keyof FormatterRule,
    value: string | boolean,
  ) => {
    const next = settings.formatterRules.map((r, idx) =>
      idx === i ? { ...r, [field]: value } : r,
    );
    update('formatterRules', next);
  };

  const updateLocale = (locale: Locale) => {
    setLocale(locale);
    update('uiLanguage', locale);
  };

  return (
    <div className="svn-settings">
      <ViewHeader title={t('settingsTitle') as string}>
        <Button onClick={onClose}>{t('settingsDone') as string}</Button>
      </ViewHeader>
      <div className="svn-settings-layout">
        <nav className="svn-settings-nav">
          <TextInput
            type="search"
            className="svn-settings-search"
            value={query}
            onChange={setQuery}
            placeholder={t('settingsSearch') as string}
            aria-label={t('settingsSearch') as string}
          />
          {NAV.map((n) => (
            <button
              key={n.id}
              type="button"
              className={`svn-settings-nav-item${!searching && page === n.id ? ' svn-settings-nav-item--active' : ''}`}
              onClick={() => {
                setQuery('');
                setPage(n.id);
              }}
            >
              <span className="material-symbols-outlined">{n.icon}</span>
              {t(n.label) as string}
            </button>
          ))}
        </nav>
        <Query.Provider value={query.trim().toLowerCase()}>
          <div className="svn-settings-body">
            <div className="svn-settings-content">
              {show('general') && (
                <>
                  <Card title={t('settingsUiSection') as string}>
                    <Row label={t('settingsUiLanguage') as string}>
                      <Select
                        value={settings.uiLanguage}
                        options={[
                          {
                            value: 'de',
                            label: t('settingsUiLangDe') as string,
                          },
                          {
                            value: 'en',
                            label: t('settingsUiLangEn') as string,
                          },
                        ]}
                        onChange={(v) => updateLocale(v as Locale)}
                      />
                    </Row>
                  </Card>
                  <Card title={t('settingsCardUpdates') as string}>
                    <Check
                      label={t('settingsAutoRefresh') as string}
                      value={settings.autoRefresh}
                      onChange={(v) => update('autoRefresh', v)}
                    />
                    <Row
                      label={t('settingsUpdateCheck') as string}
                      hint={t('settingsUpdateCheckHint') as string}
                    >
                      <Select
                        value={String(settings.updateCheckSeconds)}
                        options={[
                          {
                            value: '30',
                            label: t('settingsEvery30s') as string,
                          },
                          {
                            value: '60',
                            label: t('settingsEvery1m') as string,
                          },
                          {
                            value: '300',
                            label: t('settingsEvery5m') as string,
                          },
                          {
                            value: '0',
                            label: t('settingsUpdateNever') as string,
                          },
                        ]}
                        onChange={(v) =>
                          update('updateCheckSeconds', Number(v))
                        }
                      />
                    </Row>
                  </Card>
                  <Card title={t('settingsFileListSection') as string}>
                    <Row
                      label={t('settingsDefaultSelection') as string}
                      hint={t('settingsDefaultSelectionHint') as string}
                    >
                      <Select
                        value={settings.defaultSelection}
                        options={[
                          {
                            value: 'all',
                            label: t('settingsSelAll') as string,
                          },
                          {
                            value: 'none',
                            label: t('settingsSelNone') as string,
                          },
                        ]}
                        onChange={(v) =>
                          update(
                            'defaultSelection',
                            v as SvnSettings['defaultSelection'],
                          )
                        }
                      />
                    </Row>
                    <Check
                      label={t('settingsRememberView') as string}
                      value={settings.rememberView}
                      onChange={(v) => update('rememberView', v)}
                    />
                    <Check
                      label={t('settingsOpenLastOnStart') as string}
                      value={settings.openLastOnStart}
                      onChange={(v) => update('openLastOnStart', v)}
                    />
                    <Check
                      label={t('settingsSingleProject') as string}
                      value={settings.singleProject}
                      onChange={(v) => update('singleProject', v)}
                    />
                  </Card>
                </>
              )}

              {show('ai') && (
                <>
                  <Card title={t('settingsModel') as string}>
                    <Row label={t('settingsProvider') as string}>
                      <Select
                        value={settings.aiProvider}
                        options={[
                          {
                            value: 'claude-code',
                            label: 'Claude Code (Agent)',
                          },
                          { value: 'claude', label: 'Claude (API)' },
                          { value: 'openai', label: 'OpenAI' },
                        ]}
                        onChange={(v) => {
                          const provider = v as SvnSettings['aiProvider'];
                          const first =
                            modelsFor(provider, models)[0]?.id ?? '';
                          setSettings((prev) => {
                            const next = {
                              ...prev,
                              aiProvider: provider,
                              aiModel: first,
                            };
                            void saveSettings(host.storage, next);
                            return next;
                          });
                        }}
                      />
                    </Row>
                    <Row
                      label={t('settingsModel') as string}
                      hint={t('settingsModelHint') as string}
                    >
                      <Select
                        value={settings.aiModel}
                        options={modelsFor(settings.aiProvider, models).map(
                          (m) => ({ value: m.id, label: m.name }),
                        )}
                        onChange={(v) => update('aiModel', v)}
                      />
                    </Row>
                  </Card>
                  <Card title={t('settingsCardMessage') as string}>
                    <Row label={t('settingsLanguage') as string}>
                      <Select
                        value={settings.aiLanguage}
                        options={[
                          {
                            value: 'auto',
                            label: t('settingsLangAuto') as string,
                          },
                          { value: 'de', label: t('settingsLangDe') as string },
                          { value: 'en', label: t('settingsLangEn') as string },
                        ]}
                        onChange={(v) =>
                          update('aiLanguage', v as SvnSettings['aiLanguage'])
                        }
                      />
                    </Row>
                    <Row label={t('settingsExistingMsg') as string}>
                      <Select
                        value={settings.aiMessageMode}
                        options={[
                          {
                            value: 'replace',
                            label: t('settingsMsgReplace') as string,
                          },
                          {
                            value: 'append',
                            label: t('settingsMsgAppend') as string,
                          },
                        ]}
                        onChange={(v) =>
                          update(
                            'aiMessageMode',
                            v as SvnSettings['aiMessageMode'],
                          )
                        }
                      />
                    </Row>
                    <Check
                      label={t('settingsConventional') as string}
                      value={settings.aiConventional}
                      onChange={(v) => update('aiConventional', v)}
                    />
                    <Check
                      label={t('settingsBody') as string}
                      value={settings.aiBody}
                      onChange={(v) => update('aiBody', v)}
                    />
                    <Check
                      label={t('settingsAutoOutput') as string}
                      value={settings.autoOpenOutput}
                      onChange={(v) => update('autoOpenOutput', v)}
                    />
                    <Row
                      label={t('settingsMaxDiff') as string}
                      hint={t('settingsMaxDiffHint') as string}
                    >
                      <TextInput
                        type="number"
                        size="sm"
                        min={1000}
                        step={1000}
                        value={settings.aiMaxDiffChars}
                        onChange={(value) =>
                          update(
                            'aiMaxDiffChars',
                            Math.max(
                              1000,
                              Number(value) || DEFAULT_SETTINGS.aiMaxDiffChars,
                            ),
                          )
                        }
                      />
                    </Row>
                  </Card>
                  <Card title={t('settingsRules') as string}>
                    <Match label={t('settingsRules') as string}>
                      <TextArea
                        size="sm"
                        mono
                        value={settings.aiRules}
                        onChange={(value) => update('aiRules', value)}
                        rows={10}
                        className="svn-settings-textarea"
                        placeholder={t('settingsRulesPlaceholder') as string}
                        aria-label={t('settingsRules') as string}
                      />
                      <div className="svn-settings-card-actions">
                        <Button
                          size="sm"
                          disabled={
                            settings.aiRules === DEFAULT_SETTINGS.aiRules
                          }
                          onClick={() =>
                            update('aiRules', DEFAULT_SETTINGS.aiRules)
                          }
                        >
                          {t('settingsResetRules') as string}
                        </Button>
                      </div>
                    </Match>
                  </Card>
                </>
              )}

              {show('formatter') && (
                <Card title={t('settingsFormatterSection') as string}>
                  <Match label={t('settingsFormatterSection') as string}>
                    <div className="svn-settings-formatter-toolbar">
                      <Button
                        scan
                        scanActive={scanning}
                        onClick={() => void onScan()}
                        disabled={scanning}
                        title={t('settingsFormatterScanTitle') as string}
                      >
                        <span className="svn-btn-scan__label">
                          {scanning
                            ? (t('settingsFormatterScanning') as string)
                            : (t('settingsFormatterScan') as string)}
                        </span>
                        {scanning && (
                          <Spinner
                            label={t('settingsFormatterScanning') as string}
                            size={9}
                          />
                        )}
                      </Button>
                      <Button onClick={addRule}>
                        {t('settingsFormatterAddRule') as string}
                      </Button>
                    </div>
                    {scanMsg && (
                      <p className="svn-settings-hint svn-settings-formatter-msg">
                        {scanMsg}
                      </p>
                    )}
                    {settings.formatterRules.length === 0 && !scanMsg && (
                      <p className="svn-settings-hint svn-settings-formatter-msg">
                        {t('settingsFormatterEmptyHint') as string}
                      </p>
                    )}
                    {settings.formatterRules.map((rule, i) => (
                      <div key={i} className="svn-settings-formatter-rule">
                        <input
                          type="checkbox"
                          checked={rule.enabled}
                          onChange={(e) =>
                            updateRule(i, 'enabled', e.target.checked)
                          }
                          title={t('settingsFormatterEnabled') as string}
                        />
                        <TextInput
                          size="sm"
                          className="svn-settings-input svn-settings-formatter-path"
                          value={rule.path}
                          onChange={(value) => updateRule(i, 'path', value)}
                          placeholder={
                            t('settingsFormatterPathPlaceholder') as string
                          }
                        />
                        <TextInput
                          size="sm"
                          className="svn-settings-input svn-settings-formatter-cmd"
                          value={rule.cmd}
                          onChange={(value) => updateRule(i, 'cmd', value)}
                          placeholder={
                            t('settingsFormatterCmdPlaceholder') as string
                          }
                        />
                        <Button
                          variant="danger"
                          size="sm"
                          onClick={() => removeRule(i)}
                        >
                          {t('settingsFormatterRemoveRule') as string}
                        </Button>
                      </div>
                    ))}
                  </Match>
                </Card>
              )}
              <p className="svn-settings-empty">
                {t('settingsNoResults') as string}
              </p>
            </div>
          </div>
        </Query.Provider>
      </div>
    </div>
  );
}

function Card({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="svn-settings-card">
      <h3>{title}</h3>
      {children}
    </section>
  );
}

/** Renders children only while the search query matches the label/hint. */
function Match({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  const q = useContext(Query);
  if (q && !`${label} ${hint ?? ''}`.toLowerCase().includes(q)) return null;
  return <>{children}</>;
}

function Row({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <Match label={label} hint={hint}>
      <label className="svn-settings-row">
        <span className="svn-settings-label">
          {label}
          {hint && <span className="svn-settings-hint">{hint}</span>}
        </span>
        {children}
      </label>
    </Match>
  );
}

function Check({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <Match label={label}>
      <label className="svn-settings-row">
        <span className="svn-settings-label">{label}</span>
        <Switch checked={value} onChange={onChange} />
      </label>
    </Match>
  );
}

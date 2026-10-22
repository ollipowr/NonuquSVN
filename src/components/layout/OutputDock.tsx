import { t } from '@nonu/app/i18n';
import { ProgressBar } from '@nonu/components/ui/ProgressBar';
import { useResize } from '@nonu/hooks';
import type { HostStorage } from '@nonu/host/types';
import {
  clearOutput,
  setOutputCollapsed,
  setOutputHeight,
  setOutputVisible,
  useOutput,
} from '@nonu/stores/outputLog';
import { useEffect, useRef } from 'react';
import type { ActivityAction } from './ActivityBar';
import { OutputPanel } from './OutputPanel';

const OUTPUT_COLLAPSED_KEY = 'svn.outputCollapsed';
const OUTPUT_HEIGHT_KEY = 'svn.outputHeight';
const OUTPUT_VISIBLE_KEY = 'svn.outputVisible';
const OUTPUT_DEFAULT_HEIGHT = 140;

// Mounted by the active content column; the log lives in the store, so it survives view changes.
export function OutputDock({ storage }: { storage: HostStorage }) {
  const { entries, busy, collapsed, visible, height } = useOutput();
  const bodyRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setOutputCollapsed(storage.get<boolean>(OUTPUT_COLLAPSED_KEY) ?? false);
    setOutputVisible(storage.get<boolean>(OUTPUT_VISIBLE_KEY) ?? false);
    setOutputHeight(
      storage.get<number>(OUTPUT_HEIGHT_KEY) ?? OUTPUT_DEFAULT_HEIGHT,
    );
  }, [storage]);

  useEffect(() => {
    void storage.set(OUTPUT_COLLAPSED_KEY, collapsed);
  }, [storage, collapsed]);

  useEffect(() => {
    void storage.set(OUTPUT_VISIBLE_KEY, visible);
  }, [storage, visible]);

  const startSplitterDrag = useResize({
    start: (event) => {
      const shell = event.currentTarget.closest(
        '.svn-panel, .svn-standalone-home-column',
      );
      const startY = event.clientY;
      return shell
        ? {
            value: (next) => height + startY - next.clientY,
            min: 60,
            max: () => shell.getBoundingClientRect().height - 180,
          }
        : null;
    },
    onChange: setOutputHeight,
    onEnd: (value) => {
      void storage.set(OUTPUT_HEIGHT_KEY, value);
    },
  });

  return (
    <div className="svn-output-dock">
      {visible && (
        <OutputPanel
          outputLog={entries}
          outputHeight={height}
          outputCollapsed={collapsed}
          busy={busy}
          toggleOutputCollapsed={() => setOutputCollapsed(!collapsed)}
          onClear={clearOutput}
          startOutputSplitterDrag={startSplitterDrag}
          outputBodyRef={bodyRef}
        />
      )}
      <ProgressBar active={busy} />
    </div>
  );
}

export function useOutputToggleAction(): ActivityAction {
  const { visible } = useOutput();
  return {
    id: 'output',
    icon: 'terminal',
    label: t('output') as string,
    active: visible,
    separator: true,
    onClick: () => setOutputVisible(!visible),
  };
}

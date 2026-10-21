import { t } from '@nonu/app/i18n';
import { Button } from '@nonu/components/ui/Button';
import type { HostStorage } from '@nonu/host/types';
import { loadProjectStore } from '@nonu/modules/projects/projects';
import {
  getWorkspaceStatus,
  useWorkspaceStatusVersion,
} from '@nonu/modules/workspace/workspaceStore';
import { badgesFor, resumeCards, summarize } from './startModel.js';

/** Row below the title bar on the start page: jump back in, plus a summary over all working copies. */
export function StartBar({
  storage,
  open,
}: {
  storage: HostStorage;
  open: (path: string) => void;
}) {
  useWorkspaceStatusVersion();
  const store = loadProjectStore(storage);
  const paths = store.workspaces.flatMap((w) =>
    w.localPath && !w.hidden ? [w.localPath] : [],
  );
  const views = paths.map((p) => {
    const s = getWorkspaceStatus(p);
    return s
      ? badgesFor({
          changes: s.changes,
          updateAvailable: s.updateAvailable,
          missing: !s.repo.isWorkingCopy,
        })
      : undefined;
  });
  const sum = summarize(views);
  const card = resumeCards(store, (p) => {
    const s = getWorkspaceStatus(p);
    return s ? !s.repo.isWorkingCopy : false;
  })[0];
  return (
    <div className="svn-titlebar-ws">
      {card ? (
        <Button
          variant="primary"
          className="svn-titlebar-btn"
          onClick={() => open(card.workspace.localPath as string)}
        >
          {t('homeContinue')} {card.project.name} · {card.workspace.name}
        </Button>
      ) : (
        <span className="svn-home-muted">{t('homeEmptyTitle')}</span>
      )}
      {sum.conflicts > 0 && (
        <span className="svn-home-badge svn-home-badge--error">
          ⚠ {sum.conflicts}
        </span>
      )}
      {sum.dirty > 0 && (
        <span className="svn-home-badge svn-home-badge--dirty">
          ● {sum.dirty}
        </span>
      )}
      {sum.updates > 0 && (
        <span className="svn-home-badge svn-home-badge--update">
          ↓ {sum.updates}
        </span>
      )}
      <span className="svn-titlebar-path">
        {(t('homeBarCounts') as (p: number, c: number) => string)(
          store.projects.length,
          paths.length,
        )}
      </span>
    </div>
  );
}

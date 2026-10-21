import { t } from '@nonu/app/i18n';
import type { Badges } from './startModel.js';

export function StatusBadges({ badges }: { badges?: Badges }) {
  if (!badges) return null;
  if (badges.missing)
    return (
      <span className="svn-home-badge svn-home-badge--error">
        {t('homeMissing')}
      </span>
    );
  return (
    <>
      {badges.conflicts > 0 && (
        <span className="svn-home-badge svn-home-badge--error">
          ⚠ {t('homeConflict')}
        </span>
      )}
      {badges.dirty > 0 && (
        <span className="svn-home-badge svn-home-badge--dirty">
          ● {badges.dirty}
        </span>
      )}
      {badges.update && (
        <span className="svn-home-badge svn-home-badge--update">
          ↓ {t('homeUpdate')}
        </span>
      )}
      {badges.clean && (
        <span className="svn-home-badge svn-home-badge--ok">
          ✓ {t('homeClean')}
        </span>
      )}
    </>
  );
}

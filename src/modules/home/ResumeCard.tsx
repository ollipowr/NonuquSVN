import { t } from '@nonu/app/i18n';
import { Button } from '@nonu/components';
import { StatusBadges } from './StatusBadges.js';
import type { Badges } from './startModel.js';

export function ResumeCard({
  projectName,
  branchName,
  badges,
  revision,
  disabled,
  onOpen,
}: {
  projectName: string;
  branchName: string;
  badges?: Badges;
  revision?: string;
  disabled?: boolean;
  onOpen: () => void;
}) {
  return (
    <div className="svn-home-resume">
      <div className="svn-home-resume-text">
        <span className="svn-home-label">{t('homeContinue')}</span>
        <strong>
          {projectName} <span className="svn-home-muted">· {branchName}</span>
        </strong>
      </div>
      <span className="svn-home-grow" />
      <StatusBadges badges={badges} />
      {revision && <span className="svn-home-rev">r{revision}</span>}
      <Button variant="primary" disabled={disabled} onClick={onOpen}>
        {t('homeOpen')}
      </Button>
    </div>
  );
}

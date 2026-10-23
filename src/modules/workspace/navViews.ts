import { t } from '@nonu/app/i18n';
import type { ActivityView } from '@nonu/components/layout/ActivityBar';
import type { WorkspaceViewId } from './WorkspaceView.js';
export function buildNavViews(o: {
  hasWorkspace: boolean;
  changesCount: number;
}): ActivityView<WorkspaceViewId>[] {
  const disabledTitle = t('navNeedWorkspace') as string;
  return [
    {
      id: 'changes',
      icon: 'edit_document',
      label: t('navLocalChanges') as string,
      group: 'workspace',
      badge: o.changesCount,
      disabled: !o.hasWorkspace,
      disabledTitle,
    },
    {
      id: 'logs',
      icon: 'view_timeline',
      label: t('navChangelogs') as string,
      group: 'workspace',
      disabled: !o.hasWorkspace,
      disabledTitle,
    },
    {
      id: 'reflog',
      icon: 'restore',
      label: t('navReflog') as string,
      group: 'workspace',
      disabled: !o.hasWorkspace,
      disabledTitle,
    },
    {
      id: 'repo',
      icon: 'folder_open',
      label: t('navRepoBrowser') as string,
      group: 'workspace',
      disabled: !o.hasWorkspace,
      disabledTitle,
    },
  ];
}

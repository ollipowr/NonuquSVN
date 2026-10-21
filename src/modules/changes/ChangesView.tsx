import { t } from '@nonu/app/i18n';
import { Spinner } from '@nonu/components';
import type { ComponentProps } from 'react';

import { ChangesList } from './ChangesList.js';
import { BulkToolbar, ListToolbar } from './ChangesToolbar.js';

import './ChangesView.css';

type Props = {
  toolbar: ComponentProps<typeof ListToolbar>;
  bulk: ComponentProps<typeof BulkToolbar>;
  list: ComponentProps<typeof ChangesList>;
  selectedCount: number;
  totalCount: number;
  filteredCount: number;
  visibleCount: number;
  allSelected: boolean;
  onToggleAll: () => void;
};
export function ChangesView({
  toolbar,
  bulk,
  list,
  selectedCount,
  totalCount,
  filteredCount,
  visibleCount,
  allSelected,
  onToggleAll,
}: Props) {
  return (
    <>
      <ListToolbar {...toolbar} />
      {selectedCount > 0 ? (
        <BulkToolbar {...bulk} />
      ) : (
        <div className="svn-changes-head svn-changes-head--compact">
          <input
            type="checkbox"
            checked={allSelected}
            onChange={onToggleAll}
            disabled={visibleCount === 0}
          />
          <span>
            {totalCount === 0
              ? (t('noPendingChanges') as string)
              : filteredCount < totalCount
                ? (
                    t('fileCountFiltered') as (
                      shown: number,
                      total: number,
                    ) => string
                  )(filteredCount, totalCount)
                : (t('fileCount') as (n: number) => string)(totalCount)}
          </span>
          {list.revalidating && (
            <Spinner
              label={t('refreshing') as string}
              className="svn-head-spinner"
            />
          )}
        </div>
      )}
      <ChangesList {...list} />
    </>
  );
}

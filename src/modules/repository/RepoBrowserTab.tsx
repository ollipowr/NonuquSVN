import {
  asyncDataLoaderFeature,
  hotkeysCoreFeature,
  selectionFeature,
} from '@headless-tree/core';
import { useTree } from '@headless-tree/react';
import { t } from '@nonu/app/i18n';
import {
  Button,
  ContextMenu,
  type ContextMenuItem,
  ViewHeader,
} from '@nonu/components';
import { useContextMenu } from '@nonu/hooks/useContextMenu';
import { RequestCache, useWorkspaceStatus } from '@nonu/modules/workspace';
import { parseSvnProplist, runSvn, type SvnProperty } from '@nonu/svn';
import { useMemo, useRef, useState } from 'react';
import { PropertiesDialog } from './PropertiesDialog.js';
import './RepoBrowserTab.css';

export interface RepoBrowserTabProps {
  cwd: string;
  url?: string;
}

interface RepoNode {
  name: string;
  folder: boolean;
}

const ROOT = 'root';
// Repository tree data has a separate lifetime from working-copy status.
const listings = new RequestCache<string>();

function joinUrl(base: string, rel: string): string {
  return rel
    ? `${base.replace(/\/+$/, '')}/${rel.split('/').map(encodeURIComponent).join('/')}`
    : base;
}

export function RepoBrowserTab({ cwd, url }: RepoBrowserTabProps) {
  const workspace = useWorkspaceStatus(cwd);
  return (
    <RepoBrowserTree
      key={url ?? workspace?.repo.url ?? ''}
      cwd={cwd}
      url={url ?? workspace?.repo.url}
    />
  );
}

function RepoBrowserTree({ cwd, url }: { cwd: string; url?: string }) {
  const nodes = useRef(
    new Map<string, RepoNode>([[ROOT, { name: '/', folder: true }]]),
  );
  const [error, setError] = useState<string | null>(null);
  const {
    menu,
    open: openMenu,
    close: closeMenu,
  } = useContextMenu<{ path: string; nodeUrl: string }>();
  const [propertiesDialog, setPropertiesDialog] = useState<{
    path: string;
    properties: SvnProperty[];
  } | null>(null);

  const onShowProperties = (path: string, nodeUrl: string) => {
    void (async () => {
      try {
        const { stdout } = await runSvn(
          ['proplist', '--verbose', '--xml', nodeUrl],
          cwd,
        );
        setPropertiesDialog({ path, properties: parseSvnProplist(stdout) });
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    })();
  };

  const dataLoader = useMemo(
    () => ({
      getItem: (id: string) =>
        nodes.current.get(id) ?? { name: id, folder: false },
      getChildren: async (id: string) => {
        if (!url) return [];
        try {
          const childUrl = joinUrl(url, id === ROOT ? '' : id);
          const stdout = await listings.load(
            childUrl,
            async () => (await runSvn(['list', childUrl], cwd)).stdout,
          );
          setError(null);
          return stdout
            .split(/\r?\n/)
            .filter(Boolean)
            .map((line) => {
              const folder = line.endsWith('/');
              const name = folder ? line.slice(0, -1) : line;
              const childId = id === ROOT ? name : `${id}/${name}`;
              nodes.current.set(childId, { name, folder });
              return childId;
            });
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err));
          return [];
        }
      },
    }),
    [cwd, url],
  );

  const tree = useTree<RepoNode>({
    rootItemId: ROOT,
    getItemName: (item) => item.getItemData()?.name ?? '',
    isItemFolder: (item) => !!item.getItemData()?.folder,
    dataLoader,
    features: [asyncDataLoaderFeature, selectionFeature, hotkeysCoreFeature],
  });

  return (
    <div className="svn-repo">
      <ViewHeader title={t('repoTitle') as string} subtitle={url}>
        <Button
          icon
          title={t('repoRefresh') as string}
          onClick={() => {
            if (url)
              listings.invalidate(
                (key) =>
                  key === url || key.startsWith(`${url.replace(/\/+$/, '')}/`),
              );
            nodes.current = new Map([[ROOT, { name: '/', folder: true }]]);
            void tree.getItemInstance(ROOT).invalidateChildrenIds();
          }}
        >
          <span className="material-symbols-outlined">refresh</span>
        </Button>
      </ViewHeader>
      {error && <div className="svn-repo-error">{error}</div>}
      <div {...tree.getContainerProps()} className="svn-repo-tree">
        {tree.getItems().map((item) => {
          const folder = item.isFolder();
          const id = item.getId();
          return (
            <button
              {...item.getProps()}
              key={id}
              className={`svn-repo-row${item.isFocused() ? ' svn-repo-row--focus' : ''}${item.isSelected() ? ' svn-repo-row--selected' : ''}`}
              style={{ paddingLeft: 8 + item.getItemMeta().level * 14 }}
              onContextMenu={(e) => {
                if (!url) return;
                openMenu(e, {
                  path: id === ROOT ? '/' : id,
                  nodeUrl: joinUrl(url, id === ROOT ? '' : id),
                });
              }}
            >
              <span className="material-symbols-outlined svn-repo-icon">
                {folder
                  ? item.isExpanded()
                    ? 'folder_open'
                    : 'folder'
                  : 'description'}
              </span>
              <span className="svn-repo-name">{item.getItemName()}</span>
              {item.isLoading() && <span className="svn-repo-loading">…</span>}
            </button>
          );
        })}
      </div>
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          onClose={closeMenu}
          items={[
            {
              label: t('ctxShowProperties') as string,
              icon: 'list_alt',
              onClick: () =>
                onShowProperties(menu.data.path, menu.data.nodeUrl),
            } satisfies ContextMenuItem,
          ]}
        />
      )}
      {propertiesDialog && (
        <PropertiesDialog
          path={propertiesDialog.path}
          properties={propertiesDialog.properties}
          onClose={() => setPropertiesDialog(null)}
        />
      )}
    </div>
  );
}

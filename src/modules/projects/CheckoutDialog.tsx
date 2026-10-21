import { t } from '@nonu/app/i18n';
import { Button } from '@nonu/components';
import { AuthDialog } from '@nonu/components/dialogs/AuthDialog';
import { Dialog } from '@nonu/components/dialogs/Dialog';
import { ProgressBar } from '@nonu/components/ui/ProgressBar';
import { StructuredListRow } from '@nonu/components/ui/StructuredListRow';
import { TextField } from '@nonu/components/ui/TextField';
import { TextInput } from '@nonu/components/ui/TextInput';
import type { HostStorage } from '@nonu/host/types';
import { normalizePath } from '@nonu/modules/branches/branches';
import {
  buildCheckoutArgs,
  detectSvnRepo,
  type OperationNotice,
  runSvn,
  useSvnOperation,
} from '@nonu/svn';
import { useState } from 'react';
import { attachWorkspace, repoName } from './attach.js';
import {
  type BranchCandidate,
  branchCandidates,
  normalizeUrl,
  type PlanRow,
  parseSvnListDirs,
  planRows,
} from './checkoutPlan.js';
import './CheckoutDialog.css';
import { addProject, projectForRepo } from './createProject.js';
import {
  loadProjectStore,
  PROJECTS_CHANGED,
  type ProjectStore,
  saveProjectStore,
} from './projects.js';
import { type FoundCopy, scanWorkingCopies } from './scanWorkingCopies.js';

/** Creates a project from a repository URL: branches already on disk are attached, the rest checked out. */
export function CheckoutDialog({
  storage,
  chooseFolder,
  listSubfolders,
  onDone,
  onCancel,
  initialRepositoryUrl = '',
}: {
  storage: HostStorage;
  chooseFolder: () => Promise<string | null>;
  listSubfolders: (dir: string) => Promise<string[]>;
  onDone: (path: string) => void;
  onCancel: () => void;
  initialRepositoryUrl?: string;
}) {
  const [store, setStore] = useState(() => loadProjectStore(storage));
  const [repoUrl, setRepoUrl] = useState(initialRepositoryUrl);
  const [folder, setFolder] = useState('');
  const [name, setName] = useState('');
  const [rows, setRows] = useState<PlanRow[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<OperationNotice>(null);

  const url = repoUrl.trim().replace(/\/+$/, '');
  const { run, pendingAuth, authBusy, onAuthSubmit, cancelAuth } =
    useSvnOperation({
      setBusy,
      setPill: setNotice,
      appendLog: () => {},
      refresh: async () => {},
    });

  // A repo already known to the store joins its project; the name field only
  // applies to a brand-new one.
  const existingProject = url ? projectForRepo(store, url) : undefined;
  const projectOf = (id?: string) =>
    store.projects.find((p) => p.id === id)?.name;

  const load = () =>
    run(t('checkoutLoad') as string, async (credentials) => {
      const current = loadProjectStore(storage);
      setStore(current);
      const root = await runSvn(['list', url], folder, credentials);
      const rootDirs = parseSvnListDirs(root.stdout);
      const branchDirs = rootDirs.includes('branches')
        ? parseSvnListDirs(
            (await runSvn(['list', `${url}/branches`], folder, credentials))
              .stdout,
          )
        : [];
      const candidates: BranchCandidate[] = branchCandidates(
        url,
        rootDirs,
        branchDirs,
      );
      // Look on disk before planning, so an existing checkout is reused
      // instead of being checked out a second time next to itself.
      const found: FoundCopy[] = folder.trim()
        ? await scanWorkingCopies(
            folder,
            listSubfolders,
            (p) => detectSvnRepo(p, credentials),
            url,
          ).catch(() => [])
        : [];
      const planned = planRows(candidates, current, found, folder);
      setRows(planned);
      // Only what is already on disk starts selected. A repo can hold dozens
      // of release branches and nobody wants them all checked out.
      setPicked(new Set(planned.filter((r) => r.localPath).map((r) => r.url)));
      setName(existingProject?.name ?? repoName(url));
      return (t('checkoutLoaded') as (n: number, onDisk: number) => string)(
        planned.length,
        planned.filter((r) => r.localPath).length,
      );
    });

  const create = () => {
    const chosen = rows?.filter((r) => picked.has(r.url)) ?? [];
    return run(t('checkoutCreate') as string, async (credentials) => {
      let current = loadProjectStore(storage);
      // The project exists before any checkout, so its name is an input and
      // never a repair of whatever attachWorkspace happened to create.
      let projectId = existingProject?.id;
      if (!projectId) {
        current = addProject(current, name.trim() || repoName(url), url);
        projectId = current.activeProjectId;
        await saveProjectStore(storage, current);
      }
      let first = '';
      let attached = 0;
      for (const row of chosen) {
        const target = row.localPath ?? row.target;
        const info = await detectSvnRepo(target, credentials);
        if (!info.isWorkingCopy) {
          await runSvn(
            buildCheckoutArgs({ url: row.url, target }),
            folder.replace(/[\\/]+$/, ''),
            credentials,
          );
        } else {
          // A working copy of a different branch must never be silently
          // adopted under this branch's name.
          const actual = info.workingCopyUrl ?? info.url ?? '';
          if (actual && normalizeUrl(actual) !== normalizeUrl(row.url))
            throw new Error(
              (t('checkoutForeignCopy') as (p: string, u: string) => string)(
                target,
                actual,
              ),
            );
        }
        current = attachWorkspace(
          current,
          target,
          await detectSvnRepo(target, credentials),
        );
        current = withKind(current, target, row);
        // Save per branch so a failure partway leaves no unattached checkout.
        await saveProjectStore(storage, current);
        attached++;
        first ||= target;
      }
      window.dispatchEvent(new Event(PROJECTS_CHANGED));
      onDone(first);
      return (t('checkoutDone') as (n: number) => string)(attached);
    });
  };

  const toggle = (key: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (!next.delete(key)) next.add(key);
      return next;
    });

  const needsCheckout =
    rows?.some((r) => picked.has(r.url) && !r.localPath) ?? false;

  const pickFolder = async () => {
    const path = await chooseFolder();
    if (path) setFolder(path);
  };

  return (
    <>
      <Dialog
        title={t('checkoutTitle') as string}
        onClose={onCancel}
        className="svn-checkout-dialog"
      >
        <p className="svn-checkout-explain">{t('checkoutExplain') as string}</p>

        <label className="svn-checkout-field">
          <span>{t('checkoutRepoLabel') as string}</span>
          <div className="svn-checkout-row">
            <TextInput
              value={repoUrl}
              placeholder="https://…/svn/projekt"
              onChange={setRepoUrl}
            />
          </div>
        </label>

        <div className="svn-checkout-field">
          <span>{t('checkoutFolderLabel') as string}</span>
          <div className="svn-checkout-row">
            <TextInput value={folder} onChange={setFolder} />
            <Button onClick={() => void pickFolder()} disabled={busy}>
              {t('branchFormCheckoutBrowse') as string}
            </Button>
          </div>
          <p className="svn-checkout-muted">
            {t('checkoutFolderHint') as string}
          </p>
        </div>

        <div className="svn-checkout-row">
          <Button
            disabled={busy || !url || !folder.trim()}
            onClick={() => void load()}
          >
            {t('checkoutLoad') as string}
          </Button>
        </div>

        {rows && (
          <div className="svn-checkout-list" role="group">
            {rows.length === 0 && (
              <p className="svn-checkout-muted">
                {t('checkoutNone') as string}
              </p>
            )}
            {rows.map((row) => {
              const foreign =
                row.ownedBy && row.ownedBy !== existingProject?.id;
              return (
                <StructuredListRow
                  key={row.url}
                  columns="auto minmax(0, 1fr) auto"
                  className="svn-checkout-item"
                >
                  <input
                    type="checkbox"
                    checked={picked.has(row.url)}
                    disabled={busy}
                    onChange={() => toggle(row.url)}
                  />
                  <span title={row.url}>{row.name}</span>
                  <span className="svn-checkout-muted">
                    {row.localPath
                      ? `${t('checkoutHasCopy') as string}${
                          foreign ? ` · ${projectOf(row.ownedBy) ?? ''}` : ''
                        } · ${row.localPath}`
                      : (t('checkoutWillCheckout') as (p: string) => string)(
                          row.target,
                        )}
                  </span>
                </StructuredListRow>
              );
            })}
          </div>
        )}

        {rows && !existingProject && (
          <TextField
            label={t('checkoutNameLabel') as string}
            value={name}
            onChange={setName}
          />
        )}
        {existingProject && (
          <p className="svn-checkout-muted">
            {(t('checkoutJoins') as (n: string) => string)(
              existingProject.name,
            )}
          </p>
        )}

        <ProgressBar active={busy} />
        {notice && (
          <p
            className={`svn-checkout-notice svn-checkout-notice--${notice.kind}`}
          >
            {notice.text}
          </p>
        )}
        {notice?.stderr && (
          <pre className="svn-standalone-error">{notice.stderr}</pre>
        )}

        <div className="svn-checkout-actions">
          <Button onClick={onCancel} disabled={busy}>
            {t('branchFormCancel') as string}
          </Button>
          <Button
            variant="primary"
            disabled={busy || picked.size === 0 || !folder.trim()}
            onClick={() => void create()}
          >
            {
              (needsCheckout
                ? t('checkoutCreate')
                : t('checkoutAttach')) as string
            }
          </Button>
        </div>
      </Dialog>

      {pendingAuth && (
        <AuthDialog
          busy={authBusy}
          onSubmit={(result) => void onAuthSubmit(result)}
          onCancel={cancelAuth}
        />
      )}
    </>
  );
}

/** The branch URL knows the kind, so it is never asked for. */
function withKind(
  store: ProjectStore,
  path: string,
  row: PlanRow,
): ProjectStore {
  const key = normalizePath(path);
  return {
    ...store,
    workspaces: store.workspaces.map((w) =>
      w.localPath && normalizePath(w.localPath) === key
        ? { ...w, kind: row.kind, name: row.name }
        : w,
    ),
  };
}

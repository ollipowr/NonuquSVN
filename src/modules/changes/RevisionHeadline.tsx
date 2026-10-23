import './RevisionHeadline.css';

export interface RevisionInfo {
  /** Shown as `r<revision>`; without it, `label` is shown instead. */
  revision?: string;
  label?: string;
  date: string;
  author?: string;
}

export interface DiffHeaders {
  /** Absent when the file was added: there is no old side. */
  old?: RevisionInfo;
  new: RevisionInfo;
}

/** Diff-pane header: the revision (or a label) in white mono, date and author in the UI font. */
export function RevisionHeadline({
  revision,
  label,
  date,
  author,
}: RevisionInfo) {
  return (
    <span className="svn-rev-headline">
      <span className="svn-rev-number">
        {revision ? `r${revision}` : label}
      </span>
      <span className="svn-rev-meta">{date}</span>
      {author && <span className="svn-rev-meta">{author}</span>}
    </span>
  );
}

/** One sticky header per split pane. */
export function DiffPaneHead({ info }: { info: RevisionInfo }) {
  return (
    <div className="svn-diff-pane-head">
      <RevisionHeadline {...info} />
    </div>
  );
}

/** Inline view: both sides in one sticky header, separated by an arrow. */
export function DiffPairHead({ headers }: { headers: DiffHeaders }) {
  return (
    <div className="svn-diff-pane-head svn-diff-pane-head--pair">
      {headers.old && (
        <>
          <RevisionHeadline {...headers.old} />
          <span className="svn-rev-arrow">→</span>
        </>
      )}
      <RevisionHeadline {...headers.new} />
    </div>
  );
}

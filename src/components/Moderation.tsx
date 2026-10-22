import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Flag, RefreshCw, ShieldCheck, ShieldOff } from 'lucide-react';
import { errorMessage, useCommunity } from '../lib/community';
import type { Report } from '../lib/types';
import './moderation.css';

interface ModerationProps {
  onNotice: (message: string) => void;
}

export default function Moderation({ onNotice }: ModerationProps) {
  const { repository, profile } = useCommunity();
  const [access, setAccess] = useState<'checking' | 'allowed' | 'denied'>('checking');
  const [reports, setReports] = useState<Report[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reviewed, setReviewed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmHide, setConfirmHide] = useState<string | null>(null);
  const generation = useRef(0);

  const load = useCallback(async () => {
    const ticket = ++generation.current;
    setLoading(true);
    setError('');
    try {
      const allowed = await repository.isModerator();
      if (ticket !== generation.current) return;
      setAccess(allowed ? 'allowed' : 'denied');
      if (!allowed) {
        setReports([]);
        return;
      }
      const result = await repository.listReports();
      if (ticket === generation.current) setReports(result);
    } catch (err) {
      if (ticket === generation.current) setError(errorMessage(err));
    } finally {
      if (ticket === generation.current) setLoading(false);
    }
  }, [repository, profile?.id]);

  useEffect(() => {
    setAccess('checking');
    setReports([]);
    void load();
    return () => {
      generation.current++;
    };
  }, [load]);

  async function review(report: Report, hidePost: boolean) {
    const ticket = generation.current;
    setBusy(report.id);
    setError('');
    try {
      await repository.reviewReport(report.id, hidePost);
      if (ticket !== generation.current) return;
      setReports((current) =>
        current.map((item) => (item.id === report.id ? { ...item, status: 'reviewed' } : item)),
      );
      setConfirmHide(null);
      onNotice(
        hidePost
          ? 'The reported content has been hidden and the report marked reviewed.'
          : 'Report marked reviewed.',
      );
    } catch (err) {
      if (ticket === generation.current) setError(errorMessage(err));
    } finally {
      if (ticket === generation.current) setBusy(null);
    }
  }

  const openCount = reports.filter((report) => report.status === 'open').length;
  const visibleReports = reports.filter((report) => reviewed || report.status === 'open');

  return (
    <section className="moderation-panel" aria-labelledby="moderation-title">
      <header className="moderation-heading">
        <div className="moderation-heading-icon">
          <ShieldCheck size={23} aria-hidden="true" />
        </div>
        <div>
          <p className="moderation-eyebrow">CARE FOR THE COMMUNITY</p>
          <h1 id="moderation-title">Moderation</h1>
          <p>Review concerns shared by community members.</p>
        </div>
        <button
          className="moderation-button moderation-refresh"
          onClick={() => void load()}
          disabled={loading || !!busy}
          aria-label="Refresh reports"
        >
          <RefreshCw size={17} aria-hidden="true" />
          <span>Refresh</span>
        </button>
      </header>

      {error && (
        <div className="moderation-error" role="alert">
          {error}
          <button
            className="moderation-button"
            onClick={() => void load()}
            disabled={loading || !!busy}
          >
            Try again
          </button>
        </div>
      )}
      {access === 'checking' && loading && (
        <p className="moderation-empty" role="status">
          Checking moderation access…
        </p>
      )}
      {access === 'denied' && (
        <div className="moderation-empty">
          <ShieldOff size={30} aria-hidden="true" />
          <h2>Moderator access required</h2>
          <p>This area is available to designated community moderators.</p>
        </div>
      )}

      {access === 'allowed' && (
        <>
          <div className="moderation-toolbar">
            <span>
              <strong>{openCount}</strong> open {openCount === 1 ? 'report' : 'reports'}
            </span>
            <label>
              <input
                type="checkbox"
                checked={reviewed}
                onChange={(event) => setReviewed(event.target.checked)}
              />{' '}
              Show reviewed
            </label>
          </div>
          <p className="moderation-context-note">
            Reports include a snapshot of the reported content, captured when the report was
            submitted. For private messages, only the reported message is shared for review.
          </p>
          {loading && (
            <p role="status" className="moderation-loading">
              Refreshing reports…
            </p>
          )}
          {!loading && !visibleReports.length && (
            <div className="moderation-empty">
              <Check size={30} aria-hidden="true" />
              <h2>{reviewed ? 'No reports yet' : 'You’re all caught up'}</h2>
              <p>
                {reviewed
                  ? 'Reports will appear here when members submit them.'
                  : 'There are no open reports in the loaded queue.'}
              </p>
            </div>
          )}
          <div className="moderation-reports">
            {visibleReports.map((report) => (
              <article
                className="moderation-report"
                key={report.id}
                aria-labelledby={`report-${report.id}`}
              >
                <header>
                  <span className="moderation-target">
                    <Flag size={15} aria-hidden="true" />
                    {report.post_id ? 'Post report' : 'Message report'}
                  </span>
                  <span className={`moderation-status ${report.status}`}>
                    {report.status === 'open' ? 'Needs review' : 'Reviewed'}
                  </span>
                </header>
                <h2 id={`report-${report.id}`}>{report.reason}</h2>
                <p className="moderation-details">
                  {report.details || 'No additional details were provided.'}
                </p>
                <div className="moderation-evidence">
                  <h3>Reported {report.post_id ? 'post' : 'message'}</h3>
                  {report.evidence ? (
                    <blockquote>{report.evidence}</blockquote>
                  ) : (
                    <p>No content snapshot is available for this older report.</p>
                  )}
                </div>
                <dl className="moderation-metadata">
                  <div>
                    <dt>Submitted</dt>
                    <dd>{new Date(report.created_at).toLocaleString()}</dd>
                  </div>
                  <div>
                    <dt>{report.post_id ? 'Post ID' : 'Message ID'}</dt>
                    <dd>{report.post_id ?? report.message_id}</dd>
                  </div>
                  <div>
                    <dt>Report ID</dt>
                    <dd>{report.id}</dd>
                  </div>
                </dl>
                {report.status === 'open' && (
                  <footer>
                    {confirmHide === report.id ? (
                      <div className="moderation-confirm">
                        <p>
                          Hide this{' '}
                          {report.post_id
                            ? 'post from the community feed'
                            : 'message from the conversation'}{' '}
                          and mark this report reviewed?
                        </p>
                        <div>
                          <button
                            className="moderation-button moderation-danger"
                            disabled={!!busy}
                            onClick={() => void review(report, true)}
                          >
                            {busy === report.id ? 'Hiding…' : 'Yes, hide content'}
                          </button>
                          <button
                            className="moderation-button"
                            disabled={!!busy}
                            onClick={() => setConfirmHide(null)}
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <button
                          className="moderation-button moderation-primary"
                          disabled={!!busy}
                          onClick={() => void review(report, false)}
                        >
                          {busy === report.id ? 'Saving…' : 'Mark reviewed'}
                        </button>
                        <button
                          className="moderation-button moderation-danger"
                          disabled={!!busy}
                          onClick={() => setConfirmHide(report.id)}
                        >
                          Hide reported content
                        </button>
                      </>
                    )}
                  </footer>
                )}
              </article>
            ))}
          </div>
          {reports.length >= 200 && (
            <p className="moderation-context-note">
              Showing the latest 200 reports. The open count applies to this loaded queue.
            </p>
          )}
        </>
      )}
    </section>
  );
}

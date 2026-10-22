import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowLeft, Flag, MessageCircle, Send, ShieldBan } from 'lucide-react';
import { errorMessage, useCommunity } from '../lib/community';
import type { Conversation, Message } from '../lib/types';
import Avatar from './Avatar';
import './panels.css';

export default function Inbox({
  initialConversationId,
  onNotice,
  onChanged,
}: {
  initialConversationId?: string;
  onNotice: (message: string) => void;
  onChanged?: () => void;
}) {
  const { repository, profile, mode } = useCommunity();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedId, setSelectedId] = useState(initialConversationId ?? '');
  const [messages, setMessages] = useState<Message[]>([]);
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [messageLoading, setMessageLoading] = useState(false);
  const [error, setError] = useState('');
  const [actionError, setActionError] = useState('');
  const [messageError, setMessageError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [reporting, setReporting] = useState<Message | null>(null);
  const [reportReason, setReportReason] = useState('Harassment or bullying');
  const [blocking, setBlocking] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  const activeThread = useRef(selectedId);
  activeThread.current = selectedId;
  const actionGeneration = useRef(0);
  const selected = conversations.find((conversation) => conversation.id === selectedId);

  useEffect(() => {
    if (initialConversationId) setSelectedId(initialConversationId);
  }, [initialConversationId]);
  useEffect(() => {
    setConversations([]);
    setMessages([]);
    setSelectedId(initialConversationId ?? '');
  }, [repository, profile?.id]);
  useEffect(() => {
    actionGeneration.current++;
    setBody('');
    setMessages([]);
    setReporting(null);
    setBlocking(false);
    setActionError('');
  }, [selectedId, repository]);
  useEffect(() => {
    let alive = true;
    let pending = false;
    setLoading(true);
    setError('');
    if (!profile) {
      setConversations([]);
      setLoading(false);
      return;
    }
    const load = async () => {
      if (pending || document.hidden) return;
      pending = true;
      try {
        const items = await repository.listConversations();
        if (alive) {
          setConversations(items);
          setError('');
        }
      } catch (cause) {
        if (alive) setError(errorMessage(cause));
      } finally {
        pending = false;
        if (alive) setLoading(false);
      }
    };
    void load();
    const timer = window.setInterval(() => void load(), 8000);
    const visible = () => {
      if (!document.hidden) void load();
    };
    document.addEventListener('visibilitychange', visible);
    return () => {
      alive = false;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [repository, profile?.id, refresh]);
  useEffect(() => {
    let alive = true;
    let pending = false;
    setMessageError('');
    if (!selectedId || selected?.status !== 'accepted') {
      setMessageLoading(false);
      setMessages([]);
      return;
    }
    setMessageLoading(true);
    const load = async () => {
      if (pending || document.hidden) return;
      pending = true;
      try {
        const items = await repository.listMessages(selectedId);
        if (alive) {
          setMessages(items);
          setMessageError('');
        }
      } catch (cause) {
        if (alive) setMessageError(errorMessage(cause));
      } finally {
        pending = false;
        if (alive) setMessageLoading(false);
      }
    };
    void load();
    const timer = window.setInterval(() => void load(), 8000);
    const visible = () => {
      if (!document.hidden) void load();
    };
    document.addEventListener('visibilitychange', visible);
    return () => {
      alive = false;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [repository, selectedId, selected?.status, refresh]);
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'nearest' });
  }, [messages.length]);

  const act = async (action: (isCurrent: () => boolean) => Promise<void>) => {
    const generation = actionGeneration.current;
    setBusy(true);
    setActionError('');
    try {
      await action(() => generation === actionGeneration.current);
      setRefresh((value) => value + 1);
      onChanged?.();
    } catch (cause) {
      if (generation === actionGeneration.current) setActionError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };
  const send = (event: FormEvent) => {
    event.preventDefault();
    if (!selected || selected.status !== 'accepted' || !body.trim()) return;
    const text = body;
    const threadId = selected.id;
    const generation = actionGeneration.current;
    void act(async () => {
      await repository.sendMessage(threadId, text);
      if (activeThread.current === threadId && actionGeneration.current === generation) setBody('');
    });
  };
  if (!profile)
    return (
      <div className="inbox-signin">
        <MessageCircle size={38} />
        <h2>A conversation starts with a connection</h2>
        <p className="muted">
          Sign in using the account button to send and receive message requests.
        </p>
      </div>
    );

  return (
    <section className="inbox-section" aria-label="Direct messages">
      <div className="inbox-heading">
        <div>
          <span className="panel-eyebrow">A little closer</span>
          <h1>Your conversations</h1>
          <p className="muted">A quieter space to listen, connect, and share.</p>
        </div>
        <MessageCircle size={32} />
      </div>
      {mode === 'demo' && (
        <div className="panel-note">
          Demo inbox · These are fictional conversations. Messages stay in this browser and receive
          no automatic replies.
        </div>
      )}
      <div className={`inbox-layout${selectedId ? ' inbox-has-selection' : ''}`}>
        <aside className="inbox-list" aria-label="Conversations">
          <div className="inbox-list-heading">
            Messages <span>{conversations.length}</span>
          </div>
          {loading && !conversations.length && (
            <p className="inbox-padding" role="status">
              Loading conversations…
            </p>
          )}
          {error && (
            <div className="inbox-padding error-message" role="alert">
              {error}
              <button
                className="panel-text-button"
                onClick={() => setRefresh((value) => value + 1)}
              >
                Retry
              </button>
            </div>
          )}
          {!loading && !error && !conversations.length && (
            <div className="inbox-empty">
              <MessageCircle size={28} />
              <h3>Room for a new connection</h3>
              <p>
                Find someone’s post you relate to and send a message request. They choose whether to
                accept.
              </p>
            </div>
          )}
          {conversations.map((conversation) => (
            <button
              key={conversation.id}
              className={`inbox-person${selectedId === conversation.id ? ' selected' : ''}`}
              aria-pressed={selectedId === conversation.id}
              onClick={() => setSelectedId(conversation.id)}
            >
              <Avatar profile={conversation.other} />
              <span className="inbox-person-text">
                <strong>{conversation.other.nickname}</strong>
                <span>
                  {conversation.status === 'pending'
                    ? conversation.recipient_id === profile.id
                      ? 'New message request'
                      : 'Request sent'
                    : conversation.status === 'declined'
                      ? 'Request declined'
                      : conversation.last_message || 'Say a gentle hello'}
                </span>
              </span>
              {conversation.status === 'pending' && conversation.recipient_id === profile.id && (
                <span className="inbox-request-dot" aria-label="Pending request" />
              )}
            </button>
          ))}
        </aside>
        <div className="inbox-thread">
          {!selected ? (
            <div className="inbox-empty inbox-empty-thread">
              {selectedId ? (
                <>
                  <p>This conversation is unavailable or has been removed.</p>
                  <button className="button ghost" onClick={() => setSelectedId('')}>
                    Back to messages
                  </button>
                </>
              ) : (
                <>
                  <span className="inbox-empty-icon">
                    <MessageCircle size={36} />
                  </span>
                  <h2>Sometimes, being heard is everything.</h2>
                  <p>Choose a conversation to begin. You decide who gets to enter your space.</p>
                  <small>Peer support, at your own pace.</small>
                </>
              )}
            </div>
          ) : (
            <>
              <header className="dm-header">
                <button
                  className="panel-icon-button inbox-mobile-back"
                  aria-label="Back to conversations"
                  onClick={() => setSelectedId('')}
                >
                  <ArrowLeft size={20} />
                </button>
                <Avatar profile={selected.other} />
                <div>
                  <h3>{selected.other.nickname}</h3>
                  <span className="muted">
                    {selected.other.region} ·{' '}
                    {selected.status === 'accepted' ? 'Connected' : 'Message request'}
                  </span>
                </div>
                <button
                  className="panel-icon-button dm-block-button"
                  title="Block member"
                  aria-label={`Block ${selected.other.nickname}`}
                  onClick={() => setBlocking(true)}
                >
                  <ShieldBan size={19} />
                </button>
              </header>
              {actionError && (
                <p className="error-message inbox-padding" role="alert">
                  {actionError}
                </p>
              )}
              {blocking && (
                <div className="dm-boundary">
                  <p>
                    Block {selected.other.nickname}? This stops further contact and hides their
                    posts from your feed.
                  </p>
                  <div className="panel-actions">
                    <button
                      className="button danger"
                      disabled={busy}
                      onClick={() =>
                        void act(async (isCurrent) => {
                          await repository.blockUser(selected.other.id);
                          if (isCurrent() && activeThread.current === selected.id) {
                            setSelectedId('');
                            setBlocking(false);
                          }
                          onNotice(
                            'Member blocked. You can manage blocked members in your profile.',
                          );
                        })
                      }
                    >
                      Block member
                    </button>
                    <button className="button ghost" onClick={() => setBlocking(false)}>
                      Cancel
                    </button>
                  </div>
                </div>
              )}
              {selected.status === 'pending' ? (
                <div className="inbox-empty dm-request">
                  <ShieldBan size={30} />
                  <h2>
                    {selected.recipient_id === profile.id
                      ? 'A request to connect'
                      : 'Your invitation is on its way'}
                  </h2>
                  <p>
                    {selected.recipient_id === profile.id
                      ? `${selected.other.nickname} would like to talk. Accept only if you feel comfortable. You can block them at any time.`
                      : `${selected.other.nickname} can choose whether to accept. You can send messages once they do.`}
                  </p>
                  {selected.recipient_id === profile.id && (
                    <div className="panel-actions">
                      <button
                        className="button primary"
                        disabled={busy}
                        onClick={() =>
                          void act(async () => {
                            await repository.respondConversation(selected.id, true);
                            onNotice('Connection accepted.');
                          })
                        }
                      >
                        Accept request
                      </button>
                      <button
                        className="button ghost"
                        disabled={busy}
                        onClick={() =>
                          void act(async () => {
                            await repository.respondConversation(selected.id, false);
                            onNotice('Request declined.');
                          })
                        }
                      >
                        Decline
                      </button>
                    </div>
                  )}
                </div>
              ) : selected.status === 'declined' ? (
                <div className="inbox-empty">
                  <h2>This request was declined</h2>
                  <p>Messages are closed. Everyone gets to choose their own boundaries.</p>
                </div>
              ) : (
                <>
                  <p className="dm-safety-note">
                    Share only what feels right. Messages are not end-to-end encrypted. Be kind and
                    avoid sharing sensitive personal details.
                  </p>
                  <div
                    className="dm-messages"
                    aria-label={`Messages with ${selected.other.nickname}`}
                  >
                    {messageLoading && !messages.length && <p role="status">Loading messages…</p>}
                    {messageError && (
                      <p className="error-message" role="alert">
                        {messageError}{' '}
                        <button
                          className="panel-text-button"
                          onClick={() => setRefresh((value) => value + 1)}
                        >
                          Retry
                        </button>
                      </p>
                    )}
                    {!messageLoading && !messageError && !messages.length && (
                      <p className="dm-first-message">
                        A simple “how are you today?” is a lovely place to start.
                      </p>
                    )}
                    {messages.map((message) => (
                      <div
                        className={`dm-message-row${message.sender_id === profile.id ? ' own' : ''}`}
                        key={message.id}
                      >
                        <div className="dm-message">
                          <p>{message.body}</p>
                          <div className="dm-message-meta">
                            <time dateTime={message.created_at}>
                              {new Date(message.created_at).toLocaleString(undefined, {
                                month: 'short',
                                day: 'numeric',
                                hour: 'numeric',
                                minute: '2-digit',
                              })}
                            </time>
                            {message.sender_id !== profile.id && (
                              <button
                                className="dm-report-button"
                                aria-label="Report this message"
                                onClick={() => {
                                  setReporting(message);
                                  setActionError('');
                                }}
                              >
                                <Flag size={12} /> Report
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                    <div ref={end} />
                  </div>
                  {reporting && (
                    <form
                      className="dm-report-form"
                      onSubmit={(event) => {
                        event.preventDefault();
                        void act(async (isCurrent) => {
                          await repository.report({
                            message_id: reporting.id,
                            reason: reportReason,
                          });
                          if (isCurrent() && activeThread.current === selected.id)
                            setReporting(null);
                          onNotice(
                            mode === 'demo'
                              ? 'Saved in this local demo; no report was sent.'
                              : 'Report received. A moderator can review it.',
                          );
                        });
                      }}
                    >
                      <label className="field">
                        Why are you reporting this message?
                        <select
                          value={reportReason}
                          onChange={(event) => setReportReason(event.target.value)}
                        >
                          <option>Harassment or bullying</option>
                          <option>Harmful or dangerous advice</option>
                          <option>Spam or promotion</option>
                          <option>Threats or abusive content</option>
                          <option>Other concern</option>
                        </select>
                      </label>
                      <p className="panel-help">
                        {mode === 'demo'
                          ? 'Demo reports stay in this browser and are not sent to moderators.'
                          : 'Reporting shares this message and your reason with moderators for review. It does not share your other messages. Reports are not an emergency service.'}
                      </p>
                      <div className="panel-actions">
                        <button className="button primary" disabled={busy}>
                          Send report
                        </button>
                        <button
                          type="button"
                          className="button ghost"
                          onClick={() => setReporting(null)}
                        >
                          Cancel
                        </button>
                      </div>
                    </form>
                  )}
                  <form className="dm-compose" onSubmit={send}>
                    <label className="sr-only" htmlFor="dm-body">
                      Your message
                    </label>
                    <textarea
                      id="dm-body"
                      value={body}
                      onChange={(event) => setBody(event.target.value)}
                      maxLength={2000}
                      rows={2}
                      placeholder="Write with kindness…"
                      disabled={busy}
                      required
                    />
                    <button
                      className="button primary"
                      aria-label="Send message"
                      disabled={busy || !body.trim()}
                    >
                      <Send size={18} />
                      <span>Send</span>
                    </button>
                    <span className="dm-compose-help">
                      {body.length}/2000 · Messages update about every 8 seconds
                    </span>
                  </form>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </section>
  );
}

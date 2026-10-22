import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowLeft, Flag, MessageCircle, Send, ShieldBan } from 'lucide-react';
import { errorMessage, useCommunity } from '../lib/community';
import type { Conversation, Message, MessageCursor } from '../lib/types';
import { startAdaptivePoll, type PollController } from '../lib/adaptive-poll';
import Avatar from './Avatar';
import './panels.css';

function mergeMessages(current: Message[], incoming: Message[]): Message[] {
  const byId = new Map(current.map((message) => [message.id, message]));
  for (const message of incoming) byId.set(message.id, message);
  return [...byId.values()]
    .sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id))
    .slice(-200);
}

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
  const listPoll = useRef<PollController | null>(null);
  const messagePoll = useRef<PollController | null>(null);
  const mutationLock = useRef(false);
  const owner = useRef({ repository, uid: profile?.id });
  const sameOwner = owner.current.repository === repository && owner.current.uid === profile?.id;
  const [reporting, setReporting] = useState<Message | null>(null);
  const [reportReason, setReportReason] = useState('Harassment or bullying');
  const [blocking, setBlocking] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  const activeThread = useRef(selectedId);
  activeThread.current = selectedId;
  const actionGeneration = useRef(0);
  const visibleConversations = sameOwner ? conversations : [];
  const visibleMessages = sameOwner
    ? messages.filter((message) => message.conversation_id === selectedId)
    : [];
  const selected = visibleConversations.find((conversation) => conversation.id === selectedId);

  useEffect(() => {
    if (initialConversationId) setSelectedId(initialConversationId);
  }, [initialConversationId]);
  useEffect(() => {
    owner.current = { repository, uid: profile?.id };
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
  }, [selectedId, repository, profile?.id]);
  useEffect(() => {
    let alive = true;
    let signature = '';
    setLoading(true);
    setError('');
    if (!profile) {
      setConversations([]);
      setLoading(false);
      return;
    }
    const poll = startAdaptivePoll({
      delay: 15000,
      maxDelay: 60000,
      load: async () => {
        try {
          const items = await repository.listConversations();
          const nextSignature = JSON.stringify(items);
          const changed = signature !== nextSignature;
          if (alive) {
            if (changed) setConversations(items);
            signature = nextSignature;
            setError('');
          }
          return changed;
        } finally {
          if (alive) setLoading(false);
        }
      },
      onError: (cause) => {
        if (alive) {
          signature = '';
          setError(errorMessage(cause));
          setConversations([]);
          setMessages([]);
        }
      },
    });
    listPoll.current = poll;
    return () => {
      alive = false;
      poll.stop();
      if (listPoll.current === poll) listPoll.current = null;
    };
  }, [repository, profile?.id]);
  useEffect(() => {
    let alive = true;
    let cursor: MessageCursor | undefined;
    let lastSnapshot = 0;
    let forceSnapshot = false;
    setMessageError('');
    if (!selectedId || selected?.status !== 'accepted') {
      setMessageLoading(false);
      setMessages([]);
      return;
    }
    setMessageLoading(true);
    const revalidate = () => {
      forceSnapshot = true;
    };
    // Register before the scheduler so a returning tab revalidates removals too.
    window.addEventListener('focus', revalidate);
    window.addEventListener('online', revalidate);
    document.addEventListener('visibilitychange', revalidate);
    const poll = startAdaptivePoll({
      delay: 8000,
      maxDelay: 32000,
      load: async () => {
        try {
          let changed = false;
          // Catch up in bounded batches without repeatedly transferring the history.
          for (let batch = 0; batch < 3 && alive; batch++) {
            const snapshot = forceSnapshot || !cursor || Date.now() - lastSnapshot >= 60000;
            if (snapshot) forceSnapshot = false;
            const items = await repository.listMessages(selectedId, snapshot ? undefined : cursor);
            if (!alive) return false;
            if (snapshot) {
              setMessages(items);
              lastSnapshot = Date.now();
            }
            if (items.length) {
              changed = true;
              const last = items[items.length - 1];
              cursor = { created_at: last.created_at, id: last.id };
              if (!snapshot) setMessages((current) => mergeMessages(current, items));
            }
            setMessageError('');
            if (snapshot || items.length < 200) break;
          }
          return changed;
        } finally {
          if (alive) setMessageLoading(false);
        }
      },
      onError: (cause) => {
        if (alive) {
          cursor = undefined;
          setMessages([]);
          setMessageError(errorMessage(cause));
        }
      },
    });
    messagePoll.current = poll;
    return () => {
      alive = false;
      poll.stop();
      window.removeEventListener('focus', revalidate);
      window.removeEventListener('online', revalidate);
      document.removeEventListener('visibilitychange', revalidate);
      if (messagePoll.current === poll) messagePoll.current = null;
    };
  }, [repository, profile?.id, selectedId, selected?.status]);
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'nearest' });
  }, [messages.length]);

  const act = async (action: (isCurrent: () => boolean) => Promise<void>, refreshList = false) => {
    if (mutationLock.current) return;
    mutationLock.current = true;
    const generation = actionGeneration.current;
    setBusy(true);
    setActionError('');
    try {
      await action(() => generation === actionGeneration.current);
      if (refreshList) listPoll.current?.refresh();
      onChanged?.();
    } catch (cause) {
      if (generation === actionGeneration.current) setActionError(errorMessage(cause));
    } finally {
      mutationLock.current = false;
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
      const sent = await repository.sendMessage(threadId, text);
      if (activeThread.current === threadId && actionGeneration.current === generation) {
        setBody('');
        setMessages((current) => mergeMessages(current, [sent]));
        setConversations((current) =>
          current.map((item) =>
            item.id === threadId ? { ...item, last_message: sent.body } : item,
          ),
        );
        messagePoll.current?.refresh();
      }
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
            Messages <span>{visibleConversations.length}</span>
          </div>
          {loading && !visibleConversations.length && (
            <p className="inbox-padding" role="status">
              Loading conversations…
            </p>
          )}
          {error && (
            <div className="inbox-padding error-message" role="alert">
              {error}
              <button className="panel-text-button" onClick={() => listPoll.current?.refresh()}>
                Retry
              </button>
            </div>
          )}
          {!loading && !error && !visibleConversations.length && (
            <div className="inbox-empty">
              <MessageCircle size={28} />
              <h3>Room for a new connection</h3>
              <p>
                Find someone’s post you relate to and send a message request. They choose whether to
                accept.
              </p>
            </div>
          )}
          {visibleConversations.map((conversation) => (
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
                            setConversations((current) =>
                              current.filter((item) => item.other.id !== selected.other.id),
                            );
                            setMessages([]);
                            setSelectedId('');
                            setBlocking(false);
                          }
                          onNotice(
                            'Member blocked. You can manage blocked members in your profile.',
                          );
                        }, true)
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
                          }, true)
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
                          }, true)
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
                    {messageLoading && !visibleMessages.length && (
                      <p role="status">Loading messages…</p>
                    )}
                    {messageError && (
                      <p className="error-message" role="alert">
                        {messageError}{' '}
                        <button
                          className="panel-text-button"
                          onClick={() => messagePoll.current?.refresh()}
                        >
                          Retry
                        </button>
                      </p>
                    )}
                    {!messageLoading && !messageError && !visibleMessages.length && (
                      <p className="dm-first-message">
                        A simple “how are you today?” is a lovely place to start.
                      </p>
                    )}
                    {visibleMessages.map((message) => (
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
                      {body.length}/2000 · Messages refresh automatically while you’re here
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

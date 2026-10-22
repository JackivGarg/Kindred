import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Heart,
  MessageCircle,
  MoreHorizontal,
  Send,
  Globe2,
  MapPin,
  Trash2,
  Flag,
  ShieldOff,
  ArrowUpRight,
  Search,
  X,
} from 'lucide-react';
import { useCommunity, errorMessage } from '../lib/community';
import { TOPICS, type Comment, type Post, type Topic } from '../lib/types';
import Avatar from './Avatar';
import Modal from './Modal';
import PostComposer from './PostComposer';

function age(date: string) {
  const hours = Math.max(0, (Date.now() - Date.parse(date)) / 3600000);
  return hours < 1
    ? 'Just now'
    : hours < 24
      ? `${Math.floor(hours)}h ago`
      : new Date(date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
function PostCard({
  post,
  onChanged,
  onMessage,
  onNotice,
  excludedAuthors,
}: {
  post: Post;
  onChanged: (change: FeedChange) => void;
  onMessage: (id: string) => void;
  onNotice: (message: string) => void;
  excludedAuthors: ReadonlySet<string>;
}) {
  const { repository, profile, mode } = useCommunity();
  const [menu, setMenu] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [comments, setComments] = useState<Comment[]>([]);
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [report, setReport] = useState(false);
  const [reason, setReason] = useState('Harassment or bullying');
  const [details, setDetails] = useState('');
  const [confirm, setConfirm] = useState<'delete' | 'block' | null>(null);
  const mounted = useRef(true);
  const mutationLock = useRef(false);
  const commentRequest = useRef(0);
  const commentsLoaded = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      commentRequest.current++;
    };
  }, []);
  async function run(action: () => Promise<void>) {
    if (mutationLock.current) return;
    mutationLock.current = true;
    setBusy(true);
    try {
      await action();
    } catch (error) {
      onNotice(errorMessage(error));
    } finally {
      mutationLock.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  async function loadComments() {
    const ticket = ++commentRequest.current;
    setLoading(true);
    try {
      const next = await repository.listComments(post.id);
      if (mounted.current && ticket === commentRequest.current) {
        setComments(next);
        commentsLoaded.current = true;
      }
    } catch (error) {
      if (mounted.current && ticket === commentRequest.current) onNotice(errorMessage(error));
    } finally {
      if (mounted.current && ticket === commentRequest.current) setLoading(false);
    }
  }
  async function toggleComments() {
    setExpanded(!expanded);
    if (!expanded && !commentsLoaded.current) await loadComments();
  }
  return (
    <article className="post-card card">
      <div className="post-header">
        <Avatar profile={post.author} />
        <div className="post-author">
          <strong>{post.author.nickname}</strong>
          <span>
            {age(post.created_at)}
            <i>·</i>
            {post.scope === 'regional' ? (
              <>
                <MapPin size={11} />
                {post.region}
              </>
            ) : (
              <>
                <Globe2 size={11} />
                Global community
              </>
            )}
          </span>
        </div>
        <span className={`mood mood-${post.mood.toLowerCase()}`}>{post.mood}</span>
        <div className="post-menu">
          <button
            className="icon-button"
            aria-label={`Options for ${post.author.nickname}'s post`}
            aria-expanded={menu}
            onClick={() => setMenu(!menu)}
          >
            <MoreHorizontal size={20} />
          </button>
          {menu && (
            <div className="dropdown">
              <button
                onClick={() => {
                  setReport(true);
                  setMenu(false);
                }}
              >
                <Flag size={14} />
                Report post
              </button>
              {post.author_id !== profile?.id && (
                <button
                  onClick={() => {
                    setConfirm('block');
                    setMenu(false);
                  }}
                >
                  <ShieldOff size={14} />
                  Block member
                </button>
              )}
              {post.author_id === profile?.id && (
                <button
                  onClick={() => {
                    setConfirm('delete');
                    setMenu(false);
                  }}
                >
                  <Trash2 size={14} />
                  Delete post
                </button>
              )}
            </div>
          )}
        </div>
      </div>
      <p className="post-body">{post.body}</p>
      <span className="topic-label">{post.topic}</span>
      <div className="post-actions">
        <button
          disabled={busy}
          className={`support-button ${post.supported ? 'is-supported' : ''}`}
          aria-pressed={post.supported}
          onClick={() =>
            void run(async () => {
              await repository.toggleSupport(post.id, !post.supported);
              if (mounted.current)
                onChanged({ type: 'support', id: post.id, supported: !post.supported });
            })
          }
        >
          <Heart size={17} fill={post.supported ? 'currentColor' : 'none'} />
          <span>{post.supported ? 'With you' : 'Here for you'}</span>
          <b>{post.support_count}</b>
        </button>
        <button aria-expanded={expanded} onClick={() => void toggleComments()}>
          <MessageCircle size={17} />
          <span>
            {post.comment_count} {post.comment_count === 1 ? 'reply' : 'replies'}
          </span>
        </button>
        {post.author_id !== profile?.id && (
          <button
            disabled={busy}
            className="connect-button"
            onClick={() =>
              void run(async () => {
                const conversation = await repository.requestConversation(post.author_id);
                onMessage(conversation.id);
              })
            }
          >
            Connect
            <ArrowUpRight size={15} />
          </button>
        )}
      </div>
      {expanded && (
        <div className="replies">
          <button
            className="panel-text-button"
            disabled={loading || busy}
            onClick={() => void loadComments()}
          >
            Refresh replies
          </button>
          {loading && !comments.length ? (
            <p className="muted">Listening in…</p>
          ) : comments.length ? (
            comments
              .filter((comment) => !excludedAuthors.has(comment.author_id))
              .map((comment) => (
                <div className="reply" key={comment.id}>
                  <Avatar profile={comment.author} size="sm" />
                  <div>
                    <strong>{comment.author.nickname}</strong>
                    <span className="reply-time">{age(comment.created_at)}</span>
                    <p>{comment.body}</p>
                  </div>
                  {comment.author_id === profile?.id && (
                    <button
                      className="icon-button"
                      aria-label="Delete your reply"
                      disabled={busy}
                      onClick={() =>
                        void run(async () => {
                          await repository.deleteComment(comment.id);
                          if (mounted.current) {
                            setComments((current) =>
                              current.filter((item) => item.id !== comment.id),
                            );
                            onChanged({ type: 'comment', id: post.id, delta: -1 });
                          }
                        })
                      }
                    >
                      <Trash2 size={13} />
                    </button>
                  )}
                </div>
              ))
          ) : (
            <p className="muted">A kind word can make a difference. Be the first to reply.</p>
          )}
          <form
            className="reply-form"
            onSubmit={(event) => {
              event.preventDefault();
              void run(async () => {
                const next = await repository.addComment(post.id, reply);
                if (mounted.current) {
                  setReply('');
                  setComments((current) => [...current, next]);
                  onChanged({ type: 'comment', id: post.id, delta: 1 });
                }
              });
            }}
          >
            <input
              aria-label="Write a supportive reply"
              maxLength={1500}
              placeholder="Offer a little kindness…"
              value={reply}
              disabled={busy || loading}
              onChange={(event) => setReply(event.target.value)}
            />
            <button
              className="icon-button"
              disabled={!reply.trim() || busy || loading}
              aria-label="Send reply"
            >
              <Send size={17} />
            </button>
          </form>
        </div>
      )}
      {report && (
        <Modal title="Help keep Kindred caring" onClose={() => setReport(false)}>
          <form
            className="form-stack"
            onSubmit={(event) => {
              event.preventDefault();
              void run(async () => {
                await repository.report({ post_id: post.id, reason, details });
                setReport(false);
                onNotice(
                  mode === 'demo'
                    ? 'Demo report saved locally. Nothing was sent to moderators.'
                    : 'Report submitted for moderator review.',
                );
              });
            }}
          >
            <p className="muted">
              {mode === 'demo'
                ? 'This demo saves reports only in this browser. Nothing is sent to moderators.'
                : 'Tell us what concerned you. Reports are shared with moderators.'}
            </p>
            <label className="field">
              Reason
              <select value={reason} onChange={(event) => setReason(event.target.value)}>
                {[
                  'Harassment or bullying',
                  'Harmful or dangerous advice',
                  'Spam or promotion',
                  'Privacy concern',
                  'Other concern',
                ].map((item) => (
                  <option key={item}>{item}</option>
                ))}
              </select>
            </label>
            <label className="field">
              Anything else? (optional)
              <textarea
                maxLength={1000}
                rows={3}
                value={details}
                onChange={(event) => setDetails(event.target.value)}
              />
            </label>
            <button className="button primary" disabled={busy}>
              {mode === 'demo' ? 'Save demo report' : 'Submit report'}
            </button>
          </form>
        </Modal>
      )}
      {confirm && (
        <Modal
          title={confirm === 'delete' ? 'Delete your post?' : `Block ${post.author.nickname}?`}
          onClose={() => setConfirm(null)}
        >
          <p className="muted">
            {confirm === 'delete'
              ? 'Your post and its replies will be removed. This cannot be undone.'
              : 'You will no longer see one another’s posts, replies, or messages.'}
          </p>
          <div className="modal-actions">
            <button className="button ghost" onClick={() => setConfirm(null)}>
              Cancel
            </button>
            <button
              className="button danger"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  if (confirm === 'delete') await repository.deletePost(post.id);
                  else await repository.blockUser(post.author_id);
                  setConfirm(null);
                  onChanged(
                    confirm === 'delete'
                      ? { type: 'delete', id: post.id }
                      : { type: 'block', authorId: post.author_id },
                  );
                  onNotice(confirm === 'delete' ? 'Your post was deleted.' : 'Member blocked.');
                })
              }
            >
              {confirm === 'delete' ? 'Delete post' : 'Block member'}
            </button>
          </div>
        </Modal>
      )}
    </article>
  );
}

type FeedChange =
  | { type: 'support'; id: string; supported: boolean }
  | { type: 'comment'; id: string; delta: number }
  | { type: 'delete'; id: string }
  | { type: 'block'; authorId: string };

export default function Feed({
  myPosts = false,
  search = '',
  onMessage,
  onNotice,
}: {
  myPosts?: boolean;
  search?: string;
  onMessage: (id: string) => void;
  onNotice: (message: string) => void;
}) {
  const { repository, profile } = useCommunity();
  const [posts, setPosts] = useState<Post[]>([]);
  const [tab, setTab] = useState<'all' | 'nearby'>('all');
  const [topic, setTopic] = useState<Topic | undefined>();
  const [loading, setLoading] = useState(true);
  const [moreBusy, setMoreBusy] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [excludedAuthors, setExcludedAuthors] = useState<Set<string>>(() => new Set());
  const redacted = useRef({ authors: new Set<string>(), posts: new Set<string>() });
  const request = useRef(0);
  const moreLock = useRef(false);
  const owner = useRef<{ repository: typeof repository; uid: string | undefined } | null>(null);
  const ownData = owner.current?.repository === repository && owner.current?.uid === profile?.id;
  const visiblePosts = ownData ? posts : [];
  const refresh = useCallback(() => setRevision((value) => value + 1), []);
  const applyChange = useCallback((change: FeedChange) => {
    if (change.type === 'block') {
      redacted.current.authors.add(change.authorId);
      setExcludedAuthors(new Set(redacted.current.authors));
    }
    if (change.type === 'delete') redacted.current.posts.add(change.id);
    setPosts((current) => {
      if (change.type === 'delete') return current.filter((post) => post.id !== change.id);
      if (change.type === 'block')
        return current.filter((post) => post.author_id !== change.authorId);
      return current.map((post) =>
        post.id !== change.id
          ? post
          : change.type === 'support'
            ? {
                ...post,
                supported: change.supported,
                support_count: Math.max(0, post.support_count + (change.supported ? 1 : -1)),
              }
            : { ...post, comment_count: Math.max(0, post.comment_count + change.delta) },
      );
    });
  }, []);
  useEffect(() => {
    let active = true;
    request.current++;
    const changedOwner =
      owner.current?.repository !== repository || owner.current?.uid !== profile?.id;
    if (changedOwner) {
      setPosts([]);
      setHasMore(false);
      setLoading(true);
      redacted.current = { authors: new Set(), posts: new Set() };
      setExcludedAuthors(new Set());
    }
    setRefreshing(true);
    setError('');
    repository
      .listPosts({
        author_id: myPosts ? profile?.id : undefined,
        scope: !myPosts && tab === 'nearby' ? 'regional' : undefined,
        region: !myPosts && tab === 'nearby' ? profile?.region : undefined,
        topic,
        search,
      })
      .then((rows) => {
        if (active) {
          owner.current = { repository, uid: profile?.id };
          setPosts(
            rows.filter(
              (post) =>
                !redacted.current.authors.has(post.author_id) &&
                !redacted.current.posts.has(post.id),
            ),
          );
          setHasMore(rows.length === 20);
        }
      })
      .catch((err) => {
        if (active) setError(errorMessage(err));
      })
      .finally(() => {
        if (active) {
          setLoading(false);
          setRefreshing(false);
        }
      });
    return () => {
      active = false;
    };
  }, [repository, profile?.id, profile?.region, myPosts, tab, topic, search, revision]);
  async function more() {
    if (moreLock.current || refreshing) return;
    moreLock.current = true;
    const generation = request.current;
    setMoreBusy(true);
    try {
      const rows = await repository.listPosts({
        author_id: myPosts ? profile?.id : undefined,
        scope: !myPosts && tab === 'nearby' ? 'regional' : undefined,
        region: !myPosts && tab === 'nearby' ? profile?.region : undefined,
        topic,
        search,
        offset: posts.length,
      });
      if (generation === request.current) {
        setPosts((current) => [
          ...current,
          ...rows.filter(
            (row) =>
              !current.some((post) => post.id === row.id) &&
              !redacted.current.authors.has(row.author_id) &&
              !redacted.current.posts.has(row.id),
          ),
        ]);
        setHasMore(rows.length === 20);
      }
    } catch (err) {
      onNotice(errorMessage(err));
    } finally {
      moreLock.current = false;
      setMoreBusy(false);
    }
  }
  return (
    <>
      <PostComposer onCreated={refresh} onNotice={onNotice} />
      {refreshing && visiblePosts.length > 0 && (
        <p className="muted" role="status">
          Updating stories…
        </p>
      )}
      {error && visiblePosts.length > 0 && (
        <p className="error-message" role="alert">
          {error}{' '}
          <button className="button ghost" onClick={refresh}>
            Retry
          </button>
        </p>
      )}
      <div className="feed-toolbar">
        <div className="feed-tabs" aria-label="Feed audience">
          {myPosts ? (
            <span className="active">Your stories</span>
          ) : (
            <>
              <button className={tab === 'all' ? 'active' : ''} onClick={() => setTab('all')}>
                <Globe2 size={15} />
                All stories
              </button>
              <button className={tab === 'nearby' ? 'active' : ''} onClick={() => setTab('nearby')}>
                <MapPin size={15} />
                Near me
              </button>
            </>
          )}
        </div>
        <span className="feed-sort">Latest first</span>
      </div>
      <div className="topic-chips">
        <button className={!topic ? 'selected' : ''} onClick={() => setTopic(undefined)}>
          All topics
        </button>
        {TOPICS.map((item) => (
          <button
            key={item}
            className={topic === item ? 'selected' : ''}
            onClick={() => setTopic(item)}
          >
            {item}
          </button>
        ))}
      </div>
      {search && (
        <p className="search-description">
          <Search size={14} />
          Stories mentioning “{search}”
        </p>
      )}
      {loading && !visiblePosts.length ? (
        <div className="feed-loading" role="status">
          {[1, 2].map((item) => (
            <div className="skeleton card" key={item}>
              <div />
              <p />
              <p />
            </div>
          ))}
          <span className="sr-only">Loading stories</span>
        </div>
      ) : error && !visiblePosts.length ? (
        <div className="empty-state card">
          <p className="error-message">{error}</p>
          <button className="button ghost" onClick={refresh}>
            Try again
          </button>
        </div>
      ) : visiblePosts.length ? (
        <div className="post-list" aria-busy={refreshing}>
          {visiblePosts.map((post) => (
            <PostCard
              key={post.id}
              post={post}
              onChanged={applyChange}
              onMessage={onMessage}
              onNotice={onNotice}
              excludedAuthors={excludedAuthors}
            />
          ))}
          {hasMore && (
            <button
              className="button load-more"
              disabled={moreBusy || refreshing}
              onClick={() => void more()}
            >
              {moreBusy ? 'Loading…' : 'Read more stories'}
            </button>
          )}
        </div>
      ) : (
        <div className="empty-state card">
          <MessageCircle size={30} />
          <h3>There’s room for your story.</h3>
          <p>
            {myPosts
              ? 'Your shared thoughts will appear here.'
              : 'No stories here yet. Try another topic, or share what’s on your mind.'}
          </p>
          {topic && (
            <button className="button ghost" onClick={() => setTopic(undefined)}>
              <X size={14} />
              Clear topic
            </button>
          )}
        </div>
      )}
    </>
  );
}

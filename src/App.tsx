import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import {
  ArrowUpRight,
  BookOpen,
  Check,
  ChevronRight,
  Coffee,
  Heart,
  Home,
  Leaf,
  LogOut,
  Menu,
  MessageCircle,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  Sprout,
  UserRound,
  Users,
  X,
} from 'lucide-react';
import { useCommunity, errorMessage } from './lib/community';
import Feed from './components/Feed';
import Modal from './components/Modal';
import Avatar from './components/Avatar';

const Inbox = lazy(() => import('./components/Inbox'));
const AccountPanel = lazy(() => import('./components/AccountPanel'));
const Moderation = lazy(() => import('./components/Moderation'));
function PanelLoading() {
  return (
    <div className="empty-state card" role="status">
      <Leaf className="loading-leaf" size={26} />
      <p>Making a little room for you…</p>
    </div>
  );
}

function Botanical() {
  return (
    <svg className="botanical" viewBox="0 0 240 210" fill="none" aria-hidden="true">
      <circle cx="132" cy="107" r="81" fill="#dfe9dc" />
      <circle cx="194" cy="39" r="11" fill="#e9c895" />
      <path d="M68 177h132" stroke="#90ab94" strokeWidth="2" strokeLinecap="round" />
      <path
        d="M132 176c-8-45-5-84 7-126M132 153c-19-1-37-14-41-36 25 0 37 14 41 36ZM131 129c19-1 37-15 39-36-24 2-36 15-39 36ZM132 105c-16-4-27-19-27-38 21 5 28 20 27 38ZM137 77c15-3 25-15 26-32-19 4-27 15-26 32Z"
        fill="#73977d"
      />
      <path d="M132 176c-8-45-5-84 7-126" stroke="#3c6952" strokeWidth="3" strokeLinecap="round" />
      <path
        d="M94 176c-2-20-12-38-31-52M85 151c-13 3-27-2-35-14 17-6 28 1 35 14ZM75 136c1-14-6-26-18-32-4 15 4 26 18 32Z"
        fill="#c49376"
      />
      <path
        d="M173 176c-1-22 6-41 22-57M178 149c-11-5-14-16-11-28 13 7 16 16 11 28ZM186 137c13 2 24-4 29-16-15-3-24 4-29 16Z"
        fill="#a5b7a0"
      />
      <path d="M118 176h30l-4 20h-22z" fill="#b9876d" />
      <path
        d="m43 84 3 7 7 3-7 3-3 7-3-7-7-3 7-3zM202 160l2 5 5 2-5 2-2 5-2-5-5-2 5-2z"
        fill="#9fac8f"
      />
    </svg>
  );
}

export default function App() {
  const {
    profile,
    session,
    mode,
    configured,
    repository,
    loading,
    error,
    recovery,
    authLinkError,
    authLinkNotice,
    clearAuthLinkStatus,
    enterDemo,
    enterLive,
    logout,
    refreshProfile,
  } = useCommunity();
  const [page, setPage] = useState<'community' | 'messages' | 'my-posts' | 'moderation'>(
    'community',
  );
  const [account, setAccount] = useState(false);
  const [accountIntent, setAccountIntent] = useState<'signin' | 'signup'>('signin');
  const [info, setInfo] = useState<'guidelines' | 'resources' | null>(null);
  const [toast, setToast] = useState('');
  const [mobileMenu, setMobileMenu] = useState(false);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [conversation, setConversation] = useState<string>();
  const [moderator, setModerator] = useState(false);
  const previousSession = useRef({ mode, uid: session?.user.id ?? null });
  const identity = `${mode}-${profile?.id ?? session?.user.id ?? 'signed-out'}`;
  useEffect(() => {
    setConversation(undefined);
    setSearch('');
    setDebouncedSearch('');
    setToast('');
  }, [identity]);
  useEffect(() => {
    const uid = session?.user.id ?? null;
    const previous = previousSession.current;
    if (
      mode === 'live' &&
      previous.mode === 'live' &&
      previous.uid !== uid &&
      !recovery &&
      !authLinkError &&
      !authLinkNotice
    ) {
      setAccount(false);
      if (uid) setToast('Welcome to Kindred. Your space to be heard.');
    }
    previousSession.current = { mode, uid };
  }, [mode, session?.user.id, recovery, authLinkError, authLinkNotice]);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search), 300);
    return () => window.clearTimeout(timer);
  }, [search]);
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(''), 6000);
    return () => window.clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    let active = true;
    setModerator(false);
    if (profile)
      repository
        .isModerator()
        .then((value) => {
          if (active) setModerator(value);
        })
        .catch(() => {});
    return () => {
      active = false;
    };
  }, [repository, profile]);
  useEffect(() => {
    if (recovery || authLinkError || authLinkNotice) {
      setAccountIntent('signin');
      setAccount(true);
    }
  }, [recovery, authLinkError, authLinkNotice]);
  const signedIn = !!profile && (mode === 'demo' || !!session);
  function navigate(next: typeof page) {
    setPage(next);
    setMobileMenu(false);
  }
  function join() {
    try {
      enterLive();
      setAccountIntent('signup');
      setAccount(true);
      setPage('community');
    } catch (err) {
      setToast(errorMessage(err));
    }
  }
  function openAccount() {
    setAccountIntent('signin');
    setAccount(true);
  }
  function closeAccount() {
    setAccount(false);
    clearAuthLinkStatus();
  }
  function openMessage(id: string) {
    setConversation(id);
    setPage('messages');
  }
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <aside className={`sidebar ${mobileMenu ? 'is-open' : ''}`}>
        <a
          className="brand"
          href="#"
          onClick={(event) => {
            event.preventDefault();
            navigate('community');
          }}
        >
          <span className="brand-mark">
            <Sprout size={25} strokeWidth={1.8} />
          </span>
          kindred<span className="brand-dot">.</span>
        </a>
        <button
          className="icon-button sidebar-close"
          aria-label="Close navigation"
          onClick={() => setMobileMenu(false)}
        >
          <X />
        </button>
        <p className="sidebar-caption">A SPACE TO BE HUMAN</p>
        <nav aria-label="Main navigation">
          <button
            aria-current={page === 'community' ? 'page' : undefined}
            className={page === 'community' ? 'nav-item active' : 'nav-item'}
            onClick={() => navigate('community')}
          >
            <Home size={19} />
            Community
            <span className="nav-active-dot" />
          </button>
          <button
            aria-current={page === 'messages' ? 'page' : undefined}
            className={page === 'messages' ? 'nav-item active' : 'nav-item'}
            onClick={() => navigate('messages')}
          >
            <MessageCircle size={19} />
            Messages
          </button>
          <button
            aria-current={page === 'my-posts' ? 'page' : undefined}
            className={page === 'my-posts' ? 'nav-item active' : 'nav-item'}
            onClick={() => navigate('my-posts')}
          >
            <UserRound size={19} />
            My stories
          </button>
          {moderator && (
            <button
              aria-current={page === 'moderation' ? 'page' : undefined}
              className={page === 'moderation' ? 'nav-item active' : 'nav-item'}
              onClick={() => navigate('moderation')}
            >
              <ShieldCheck size={19} />
              Moderation
            </button>
          )}
        </nav>
        <div className="sidebar-divider" />
        <p className="sidebar-caption">A LITTLE GUIDANCE</p>
        <nav aria-label="Community information">
          <button className="nav-item" onClick={() => setInfo('guidelines')}>
            <BookOpen size={19} />
            Our shared promise
          </button>
          <button className="nav-item" onClick={() => setInfo('resources')}>
            <Heart size={19} />
            Find support
          </button>
        </nav>
        <div className="sidebar-note">
          <Leaf size={23} />
          <p>
            You don’t have to have
            <br />
            it all figured out.
          </p>
          <span>Come as you are.</span>
        </div>
        <div className="sidebar-bottom">
          {profile ? (
            <button className="profile-button" onClick={openAccount}>
              <Avatar profile={profile} size="sm" />
              <span>
                <strong>{profile.nickname}</strong>
                <small>{mode === 'demo' ? 'Demo profile' : 'Your little corner'}</small>
              </span>
              <Settings size={16} />
            </button>
          ) : (
            <button className="button primary" onClick={join}>
              Find your people
              <ArrowUpRight size={16} />
            </button>
          )}
          <div className="sidebar-footer">
            <span>Made for connection.</span>
            {signedIn && mode === 'live' && (
              <button
                aria-label="Sign out"
                onClick={() => void logout().catch((err) => setToast(errorMessage(err)))}
              >
                <LogOut size={15} />
              </button>
            )}
          </div>
        </div>
      </aside>
      {mobileMenu && (
        <button
          className="sidebar-scrim"
          aria-label="Close navigation"
          onClick={() => setMobileMenu(false)}
        />
      )}
      <div className="workspace">
        <header className="topbar">
          <div className="topbar-left">
            <button
              className="icon-button mobile-menu"
              aria-label="Open navigation"
              onClick={() => setMobileMenu(true)}
            >
              <Menu size={21} />
            </button>
            <span className="breadcrumb">
              Your community <ChevronRight size={13} />
              <strong>
                {page === 'messages'
                  ? 'Messages'
                  : page === 'my-posts'
                    ? 'My stories'
                    : page === 'moderation'
                      ? 'Moderation'
                      : 'The shared space'}
              </strong>
            </span>
          </div>
          <div className="topbar-right">
            {page === 'community' && (
              <label className="search-box">
                <Search size={16} />
                <input
                  aria-label="Search community posts"
                  placeholder="Find a story, a feeling…"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
                {search && (
                  <button
                    className="icon-button"
                    aria-label="Clear search"
                    onClick={() => setSearch('')}
                  >
                    <X size={14} />
                  </button>
                )}
              </label>
            )}
            <button className="topbar-profile" aria-label="Open your account" onClick={openAccount}>
              {profile ? <Avatar profile={profile} size="sm" /> : <UserRound size={20} />}
            </button>
          </div>
        </header>
        {mode === 'demo' && (
          <div className="demo-banner">
            <span>
              <Sparkles size={14} />
              <strong>A look around.</strong> Fictional people · local demo · messages aren’t
              delivered.
            </span>
            <button onClick={join}>
              {configured ? 'Join the community' : 'Connect an account'}
              <ArrowUpRight size={13} />
            </button>
          </div>
        )}
        <div
          className={`content-layout ${page === 'messages' || page === 'moderation' ? 'wide-content' : ''}`}
        >
          <main id="main-content" className="main-content" tabIndex={-1}>
            <div className="page-intro">
              <div className="eyebrow">
                <span />
                {page === 'messages'
                  ? 'ONE CONVERSATION AT A TIME'
                  : page === 'my-posts'
                    ? 'YOUR VOICE MATTERS'
                    : page === 'moderation'
                      ? 'CARE FOR THE COMMUNITY'
                      : 'A SHARED SPACE, A SOFTER DAY'}
              </div>
              <h1>
                {page === 'messages'
                  ? 'A space to listen.'
                  : page === 'my-posts'
                    ? 'Your story belongs here.'
                    : page === 'moderation'
                      ? 'Keep this space kind.'
                      : 'A little less alone.'}
              </h1>
              <p>
                {page === 'messages'
                  ? 'Real connection begins with being heard.'
                  : page === 'my-posts'
                    ? 'The thoughts, feelings, and little wins you’ve shared.'
                    : page === 'moderation'
                      ? 'Review concerns with care and protect the shared space.'
                      : 'Share what’s on your mind. Someone here understands.'}
              </p>
            </div>
            {loading ? (
              <div className="empty-state card" role="status">
                <Leaf className="loading-leaf" size={30} />
                <p>Making a little room for you…</p>
              </div>
            ) : error ? (
              <div className="empty-state card">
                <p className="error-message">{error}</p>
                <button className="button primary" onClick={() => void refreshProfile()}>
                  Try again
                </button>
                <button className="button ghost" onClick={openAccount}>
                  Open account
                </button>
              </div>
            ) : !signedIn ? (
              <section className="welcome-panel card">
                <Botanical />
                <span className="eyebrow">YOU ARE WELCOME HERE</span>
                <h2>
                  Some days, being heard
                  <br />
                  is a good place to start.
                </h2>
                <p>
                  Kindred is a peer support community for adults. Share an update, leave a
                  thoughtful reply, or connect privately when you both feel ready.
                </p>
                <div className="welcome-actions">
                  <button className="button primary" onClick={join}>
                    Join the community
                    <ArrowUpRight size={16} />
                  </button>
                  <button className="button ghost" onClick={enterDemo}>
                    Explore the demo
                  </button>
                </div>
                <span className="welcome-footnote">
                  <ShieldCheck size={14} /> A nickname is enough. You choose what to share.
                </span>
              </section>
            ) : page === 'messages' ? (
              <Suspense fallback={<PanelLoading />}>
                <Inbox key={identity} initialConversationId={conversation} onNotice={setToast} />
              </Suspense>
            ) : page === 'moderation' ? (
              moderator ? (
                <Suspense fallback={<PanelLoading />}>
                  <Moderation key={identity} onNotice={setToast} />
                </Suspense>
              ) : (
                <div className="empty-state card">Moderator access is required.</div>
              )
            ) : (
              <>
                {page === 'community' && (
                  <section className="hero-card">
                    <div>
                      <span className="hero-label">
                        <Sprout size={13} />
                        NO PERFECT WORDS NEEDED
                      </span>
                      <h2>
                        Whatever you’re carrying,
                        <br />
                        you don’t have to carry it alone.
                      </h2>
                      <p>
                        A worry. A small win. A day that felt like a lot.
                        <br />
                        There’s room for all of it here.
                      </p>
                      <span className="hero-footer">
                        <Heart size={13} />A little honesty. A little kindness. A little connection.
                      </span>
                    </div>
                    <Botanical />
                  </section>
                )}
                <Feed
                  key={`${identity}-${page}`}
                  myPosts={page === 'my-posts'}
                  search={page === 'community' ? debouncedSearch : ''}
                  onMessage={openMessage}
                  onNotice={setToast}
                />
              </>
            )}
          </main>
          {page !== 'messages' && page !== 'moderation' && (
            <aside className="support-column">
              <div className="support-heading">
                <span className="tiny-flower">✳</span>A gentle reminder
              </div>
              <section className="reminder-card">
                <span className="quote-mark">“</span>
                <p>
                  You don’t need to
                  <br />
                  be doing better
                  <br />
                  to deserve support.
                </p>
                <div className="reminder-line" />
                <span>One day. One breath. One step.</span>
              </section>
              <section className="community-promise">
                <div className="aside-title">
                  <Users size={17} />
                  <h3>Our kind of community</h3>
                </div>
                <p>A place to feel heard, without needing to explain everything.</p>
                <ul>
                  <li>
                    <Check size={14} />
                    Listen with an open heart
                  </li>
                  <li>
                    <Check size={14} />
                    Offer kindness, not judgment
                  </li>
                  <li>
                    <Check size={14} />
                    Respect each other’s boundaries
                  </li>
                  <li>
                    <Check size={14} />
                    Share only what feels right
                  </li>
                </ul>
                <button className="text-button" onClick={() => setInfo('guidelines')}>
                  Read our shared promise
                  <ArrowUpRight size={13} />
                </button>
              </section>
              <section className="breathing-card">
                <div className="breath-icon">
                  <Coffee size={22} strokeWidth={1.4} />
                </div>
                <h3>A moment for you</h3>
                <p>
                  Unclench your jaw.
                  <br />
                  Let your shoulders drop.
                  <br />
                  Take one slow, easy breath.
                </p>
                <span>You can go at your own pace.</span>
              </section>
              <button className="support-link" onClick={() => setInfo('resources')}>
                <Heart size={16} />
                <span>
                  Need a little more support?<small>Explore support options</small>
                </span>
                <ArrowUpRight size={16} />
              </button>
              <p className="peer-note">
                Kindred offers peer support, not professional care or crisis response.
                <br />
                <button onClick={() => setInfo('resources')}>When you need urgent help →</button>
              </p>
              <div className="aside-footer">
                Kindness grows when we share it.
                <Leaf size={13} />
              </div>
            </aside>
          )}
        </div>
      </div>
      {account && (
        <Suspense
          fallback={
            <Modal
              title={profile ? 'Your little corner' : 'Welcome to Kindred'}
              onClose={closeAccount}
            >
              <PanelLoading />
            </Modal>
          }
        >
          <AccountPanel
            key={`${identity}-${accountIntent}`}
            initialScreen={accountIntent}
            onClose={closeAccount}
            onNotice={setToast}
          />
        </Suspense>
      )}
      {info && (
        <Modal
          title={info === 'guidelines' ? 'Our shared promise' : 'You deserve support'}
          onClose={() => setInfo(null)}
        >
          <div className="info-content">
            {info === 'guidelines' ? (
              <>
                <p>Kindred is an adults-only space to share experiences and listen with care.</p>
                <h3>Lead with kindness</h3>
                <p>
                  Speak from your own experience. Ask before offering advice. Avoid diagnoses,
                  treatment instructions, graphic content, harassment, and promotion.
                </p>
                <h3>Respect boundaries and privacy</h3>
                <p>
                  Use a nickname and share only what feels comfortable. Don’t post someone else’s
                  private information. Regional feeds help people discover stories; they do not make
                  a post private.
                </p>
                <h3>Connection is a choice</h3>
                <p>
                  Private messages start with a request. The recipient must accept before messages
                  can be sent. You can decline, report a post or message, and block a member.
                </p>
                <h3>Help us care for this space</h3>
                <p>
                  Use report controls when something feels unsafe. Moderation may take time. Kindred
                  is not monitored as an emergency service.
                </p>
              </>
            ) : (
              <>
                <p>
                  Peer support can offer connection. A qualified mental health professional can help
                  with assessment and ongoing care.
                </p>
                <h3>If you need immediate help</h3>
                <p>
                  If you or someone else is in immediate danger, contact your local emergency
                  service or go to the nearest emergency department. If possible, reach out to a
                  trusted person who can stay with you.
                </p>
                <h3>For ongoing support</h3>
                <p>
                  Consider a licensed mental health professional, your primary care provider, or a
                  reputable local mental health organization. Ask about free or low-cost care if
                  cost is a concern.
                </p>
                <h3>Here on Kindred</h3>
                <p>
                  You never owe anyone a reply or personal details. Use blocking and reporting when
                  needed. The community cannot provide crisis intervention or replace professional
                  care.
                </p>
              </>
            )}
          </div>
        </Modal>
      )}
      {toast && (
        <div className="toast" role="status">
          <Leaf size={17} />
          <span>{toast}</span>
          <button
            className="icon-button"
            aria-label="Dismiss notification"
            onClick={() => setToast('')}
          >
            <X size={16} />
          </button>
        </div>
      )}
    </div>
  );
}

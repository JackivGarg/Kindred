import { useRef, useState } from 'react';
import { ArrowUpRight, ChevronDown, Globe2, Sparkles } from 'lucide-react';
import { useCommunity, errorMessage } from '../lib/community';
import { MOODS, TOPICS, type Mood, type Topic, type Scope } from '../lib/types';
import Avatar from './Avatar';

export default function PostComposer({
  onCreated,
  onNotice,
}: {
  onCreated: () => void;
  onNotice: (message: string) => void;
}) {
  const { repository, profile } = useCommunity();
  const [body, setBody] = useState('');
  const [expanded, setExpanded] = useState(false);
  const [topic, setTopic] = useState<Topic>('Everyday life');
  const [mood, setMood] = useState<Mood>('Okay');
  const [scope, setScope] = useState<Scope>('global');
  const [busy, setBusy] = useState(false);
  const mutationLock = useRef(false);
  async function publish() {
    if (!profile || mutationLock.current) return;
    mutationLock.current = true;
    setBusy(true);
    try {
      await repository.createPost({
        body,
        topic,
        mood,
        scope,
        region: scope === 'regional' ? profile.region : null,
      });
      setBody('');
      setExpanded(false);
      onCreated();
      onNotice('Your story has a place here.');
    } catch (error) {
      onNotice(errorMessage(error));
    } finally {
      mutationLock.current = false;
      setBusy(false);
    }
  }
  if (!profile) return null;
  return (
    <section className="composer card" aria-label="Share an update">
      <div className="composer-input">
        <Avatar profile={profile} />
        <textarea
          aria-label="Your update"
          value={body}
          onFocus={() => setExpanded(true)}
          onChange={(event) => setBody(event.target.value)}
          maxLength={3000}
          rows={expanded ? 4 : 1}
          placeholder="What's on your mind? You can start anywhere."
        />
      </div>
      {expanded && (
        <div className="composer-options">
          <label>
            How are you feeling?
            <select value={mood} onChange={(event) => setMood(event.target.value as Mood)}>
              {MOODS.map((item) => (
                <option key={item}>{item}</option>
              ))}
            </select>
          </label>
          <label>
            A little context
            <select value={topic} onChange={(event) => setTopic(event.target.value as Topic)}>
              {TOPICS.map((item) => (
                <option key={item}>{item}</option>
              ))}
            </select>
          </label>
          <span className="character-count">{body.length}/3000 · 10 characters minimum</span>
        </div>
      )}
      <div className="composer-footer">
        <label className="scope-picker">
          <Globe2 size={16} />
          <select
            aria-label="Post audience"
            value={scope}
            onChange={(event) => setScope(event.target.value as Scope)}
          >
            <option value="global">Everyone in Kindred</option>
            <option value="regional">Regional · {profile.region}</option>
          </select>
          <ChevronDown size={13} />
        </label>
        <button
          className="button primary small"
          disabled={body.trim().length < 10 || busy}
          onClick={() => void publish()}
        >
          {busy ? 'Sharing…' : 'Share your thoughts'}
          <ArrowUpRight size={15} />
        </button>
      </div>
      {expanded && (
        <p className="composer-note">
          <Sparkles size={13} /> Share only what feels comfortable. Regional posts are still visible
          to all members.
        </p>
      )}
    </section>
  );
}

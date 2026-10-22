import type { Profile } from '../lib/types';

export default function Avatar({
  profile,
  size = 'md',
}: {
  profile: Pick<Profile, 'id' | 'nickname'>;
  size?: 'sm' | 'md' | 'lg';
}) {
  const initials =
    profile.nickname
      .trim()
      .split(/\s+/)
      .map((word) => word[0])
      .slice(0, 2)
      .join('')
      .toUpperCase() || '?';
  const hue = [...profile.id].reduce((sum, character) => sum + character.charCodeAt(0), 0) % 4;
  return (
    <span className={`avatar avatar-${size} avatar-tone-${hue}`} aria-hidden="true">
      {initials}
    </span>
  );
}

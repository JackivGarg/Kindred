import type {
  Comment,
  CommunityRepository,
  Conversation,
  CreatePostInput,
  FeedFilter,
  Message,
  MessageCursor,
  Post,
  Profile,
  ReportInput,
} from './types';
import {
  createSeed,
  CURRENT_USER_ID,
  type DemoState,
  type StoredConversation,
  type StoredPost,
} from './seed';
import { text, validatePost } from './validation';
import { REGIONS } from './types';

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}
export const DEMO_STORAGE_KEY = 'kindred-demo-v1';

function browserStorage(): StorageLike | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage;
  } catch {
    return null;
  }
}

function validState(value: unknown): value is DemoState {
  if (!value || typeof value !== 'object') return false;
  const state = value as DemoState;
  return (
    state.version === 1 &&
    [
      'profiles',
      'posts',
      'comments',
      'conversations',
      'messages',
      'supports',
      'blocks',
      'reports',
    ].every((key) => Array.isArray(state[key as keyof DemoState])) &&
    state.profiles.some((p) => p && p.id === CURRENT_USER_ID && typeof p.nickname === 'string') &&
    state.profiles.every(
      (p) =>
        p && typeof p.id === 'string' && typeof p.region === 'string' && typeof p.bio === 'string',
    ) &&
    state.posts.every(
      (p) =>
        p &&
        typeof p.id === 'string' &&
        typeof p.body === 'string' &&
        state.profiles.some((a) => a.id === p.author_id),
    ) &&
    state.comments.every(
      (c) =>
        c &&
        typeof c.id === 'string' &&
        typeof c.body === 'string' &&
        state.profiles.some((a) => a.id === c.author_id),
    ) &&
    state.conversations.every(
      (c) =>
        c &&
        typeof c.id === 'string' &&
        ['pending', 'accepted', 'declined'].includes(c.status) &&
        state.profiles.some((p) => p.id === c.requester_id) &&
        state.profiles.some((p) => p.id === c.recipient_id),
    ) &&
    state.messages.every((m) => m && typeof m.id === 'string' && typeof m.body === 'string') &&
    state.supports.every(
      (s) => s && typeof s.user_id === 'string' && typeof s.post_id === 'string',
    ) &&
    state.blocks.every(
      (b) => b && typeof b.blocker_id === 'string' && typeof b.blocked_id === 'string',
    )
  );
}

/** Local fictional community preview. Mutations never contact other people. */
export class DemoRepository implements CommunityRepository {
  private state: DemoState;
  private storage: StorageLike | null;
  constructor(options: { storage?: StorageLike | null } = {}) {
    this.storage = options.storage === undefined ? browserStorage() : options.storage;
    this.state = createSeed();
    try {
      const saved = this.storage?.getItem(DEMO_STORAGE_KEY);
      if (saved) {
        const parsed: unknown = JSON.parse(saved);
        if (validState(parsed)) this.state = parsed;
      }
    } catch {
      /* Storage denial and invalid JSON fall back to memory. */
    }
  }
  private persist() {
    try {
      this.storage?.setItem(DEMO_STORAGE_KEY, JSON.stringify(this.state));
    } catch {
      /* The in-memory demo remains usable. */
    }
  }
  private id() {
    return (
      globalThis.crypto?.randomUUID?.() ??
      `demo-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
  }
  private now() {
    return new Date().toISOString();
  }
  private profile(id: string): Profile {
    const found = this.state.profiles.find((p) => p.id === id);
    if (!found) throw new Error('Member not found.');
    return found;
  }
  private blocked(id: string) {
    return this.state.blocks.some(
      (b) =>
        (b.blocker_id === CURRENT_USER_ID && b.blocked_id === id) ||
        (b.blocked_id === CURRENT_USER_ID && b.blocker_id === id),
    );
  }
  private post(id: string) {
    const post = this.state.posts.find((p) => p.id === id);
    if (!post || this.blocked(post.author_id)) throw new Error('Post is unavailable.');
    return post;
  }
  private hydrate(post: StoredPost): Post {
    return {
      ...post,
      author: { ...this.profile(post.author_id) },
      support_count: this.state.supports.filter(
        (s) => s.post_id === post.id && !this.blocked(s.user_id),
      ).length,
      supported: this.state.supports.some(
        (s) => s.post_id === post.id && s.user_id === CURRENT_USER_ID,
      ),
      comment_count: this.state.comments.filter(
        (c) => c.post_id === post.id && !this.blocked(c.author_id),
      ).length,
    };
  }
  private conversation(id: string): StoredConversation {
    const c = this.state.conversations.find((item) => item.id === id);
    if (
      !c ||
      ![c.requester_id, c.recipient_id].includes(CURRENT_USER_ID) ||
      this.blocked(c.requester_id) ||
      this.blocked(c.recipient_id)
    )
      throw new Error('Conversation is unavailable.');
    return c;
  }
  private hydrateConversation(c: StoredConversation): Conversation {
    const messages = this.state.messages.filter((m) => m.conversation_id === c.id);
    return {
      ...c,
      other: {
        ...this.profile(c.requester_id === CURRENT_USER_ID ? c.recipient_id : c.requester_id),
      },
      last_message: messages.at(-1)?.body,
    };
  }
  async getProfile() {
    return { ...this.profile(CURRENT_USER_ID) };
  }
  async saveProfile(input: Pick<Profile, 'nickname' | 'region' | 'bio'>) {
    if (!REGIONS.includes(input.region as (typeof REGIONS)[number]))
      throw new Error('Choose a region from the list.');
    const profile = this.profile(CURRENT_USER_ID);
    Object.assign(profile, {
      nickname: text(input.nickname, 'Nickname', 2, 40),
      region: text(input.region, 'Region', 2, 80),
      bio: text(input.bio, 'About you', 0, 300),
    });
    this.persist();
    return { ...profile };
  }
  async listPosts(filter: FeedFilter = {}) {
    const search = filter.search?.trim() ? text(filter.search, 'Search', 1, 200).toLowerCase() : '';
    const offset = filter.offset ?? 0;
    if (!Number.isSafeInteger(offset) || offset < 0) throw new Error('Invalid feed page.');
    return this.state.posts
      .filter(
        (p) =>
          !this.blocked(p.author_id) &&
          (!filter.scope || p.scope === filter.scope) &&
          (!filter.region || p.region === filter.region) &&
          (!filter.topic || p.topic === filter.topic) &&
          (!filter.author_id || p.author_id === filter.author_id) &&
          (!search || p.body.toLowerCase().includes(search)),
      )
      .sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id))
      .slice(offset, offset + 20)
      .map((p) => this.hydrate(p));
  }
  async createPost(input: CreatePostInput) {
    const values = validatePost(input);
    if (values.region && !REGIONS.includes(values.region as (typeof REGIONS)[number]))
      throw new Error('Choose a region from the list.');
    const post = { ...values, id: this.id(), author_id: CURRENT_USER_ID, created_at: this.now() };
    this.state.posts.unshift(post);
    this.persist();
    return this.hydrate(post);
  }
  async deletePost(id: string) {
    const post = this.post(id);
    if (post.author_id !== CURRENT_USER_ID) throw new Error('You can only delete your own posts.');
    this.state.posts = this.state.posts.filter((p) => p.id !== id);
    this.state.comments = this.state.comments.filter((c) => c.post_id !== id);
    this.state.supports = this.state.supports.filter((s) => s.post_id !== id);
    this.state.reports = this.state.reports.filter((r) => r.post_id !== id);
    this.persist();
  }
  async toggleSupport(postId: string, supported: boolean) {
    this.post(postId);
    this.state.supports = this.state.supports.filter(
      (s) => s.post_id !== postId || s.user_id !== CURRENT_USER_ID,
    );
    if (supported) this.state.supports.push({ post_id: postId, user_id: CURRENT_USER_ID });
    this.persist();
  }
  async listComments(postId: string): Promise<Comment[]> {
    this.post(postId);
    return this.state.comments
      .filter((c) => c.post_id === postId && !this.blocked(c.author_id))
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
      .map((c) => ({ ...c, author: { ...this.profile(c.author_id) } }));
  }
  async addComment(postId: string, body: string): Promise<Comment> {
    this.post(postId);
    const comment = {
      id: this.id(),
      post_id: postId,
      author_id: CURRENT_USER_ID,
      body: text(body, 'Reply', 1, 1500),
      created_at: this.now(),
    };
    this.state.comments.push(comment);
    this.persist();
    return { ...comment, author: { ...this.profile(CURRENT_USER_ID) } };
  }
  async deleteComment(id: string) {
    const comment = this.state.comments.find((c) => c.id === id);
    if (!comment || comment.author_id !== CURRENT_USER_ID)
      throw new Error('You can only delete your own replies.');
    this.state.comments = this.state.comments.filter((c) => c.id !== id);
    this.persist();
  }
  async listConversations() {
    return this.state.conversations
      .filter(
        (c) =>
          [c.requester_id, c.recipient_id].includes(CURRENT_USER_ID) &&
          !this.blocked(c.requester_id) &&
          !this.blocked(c.recipient_id),
      )
      .map((c) => this.hydrateConversation(c));
  }
  async requestConversation(recipientId: string) {
    this.profile(recipientId);
    if (recipientId === CURRENT_USER_ID) throw new Error('You cannot message yourself.');
    if (this.blocked(recipientId)) throw new Error('Messaging is unavailable for this member.');
    const existing = this.state.conversations.find(
      (c) =>
        (c.requester_id === CURRENT_USER_ID && c.recipient_id === recipientId) ||
        (c.recipient_id === CURRENT_USER_ID && c.requester_id === recipientId),
    );
    if (existing) {
      if (existing.status === 'declined') throw new Error('This message request was declined.');
      return this.hydrateConversation(existing);
    }
    const c: StoredConversation = {
      id: this.id(),
      requester_id: CURRENT_USER_ID,
      recipient_id: recipientId,
      status: 'pending',
      created_at: this.now(),
    };
    this.state.conversations.unshift(c);
    this.persist();
    return this.hydrateConversation(c);
  }
  async respondConversation(id: string, accept: boolean) {
    const c = this.conversation(id);
    if (c.recipient_id !== CURRENT_USER_ID || c.status !== 'pending')
      throw new Error('Only the recipient can respond to a pending request.');
    c.status = accept ? 'accepted' : 'declined';
    this.persist();
  }
  async listMessages(conversationId: string, after?: MessageCursor) {
    const c = this.conversation(conversationId);
    if (c.status !== 'accepted') return [];
    return this.state.messages
      .filter(
        (m) =>
          m.conversation_id === conversationId &&
          (!after ||
            m.created_at > after.created_at ||
            (m.created_at === after.created_at && m.id > after.id)),
      )
      .sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id))
      .slice(after ? 0 : -200, after ? 200 : undefined)
      .map((m) => ({ ...m }));
  }
  async sendMessage(conversationId: string, body: string): Promise<Message> {
    const c = this.conversation(conversationId);
    if (c.status !== 'accepted')
      throw new Error('The recipient must accept before messages can be sent.');
    const message = {
      id: this.id(),
      conversation_id: conversationId,
      sender_id: CURRENT_USER_ID,
      body: text(body, 'Message', 1, 2000),
      created_at: this.now(),
    };
    this.state.messages.push(message);
    this.persist();
    return { ...message };
  }
  async blockUser(userId: string) {
    this.profile(userId);
    if (userId === CURRENT_USER_ID) throw new Error('You cannot block yourself.');
    if (!this.state.blocks.some((b) => b.blocker_id === CURRENT_USER_ID && b.blocked_id === userId))
      this.state.blocks.push({ blocker_id: CURRENT_USER_ID, blocked_id: userId });
    this.persist();
  }
  async unblockUser(userId: string) {
    this.state.blocks = this.state.blocks.filter(
      (b) => !(b.blocker_id === CURRENT_USER_ID && b.blocked_id === userId),
    );
    this.persist();
  }
  async listBlocked() {
    return this.state.blocks
      .filter((b) => b.blocker_id === CURRENT_USER_ID)
      .map((b) => ({ ...this.profile(b.blocked_id) }));
  }
  async report(input: ReportInput) {
    if (Boolean(input.post_id) === Boolean(input.message_id))
      throw new Error('Choose one post or message to report.');
    if (input.post_id) this.post(input.post_id);
    if (input.message_id) {
      const message = this.state.messages.find((m) => m.id === input.message_id);
      if (!message) throw new Error('Message is unavailable.');
      const c = this.conversation(message.conversation_id);
      if (c.status !== 'accepted') throw new Error('Message is unavailable.');
    }
    const report = {
      id: this.id(),
      reporter_id: CURRENT_USER_ID,
      post_id: input.post_id ?? null,
      message_id: input.message_id ?? null,
      reason: text(input.reason, 'Reason', 3, 100),
      details: text(input.details ?? '', 'Details', 0, 1000),
      status: 'open' as const,
      created_at: this.now(),
    };
    this.state.reports.push(report);
    this.persist();
  }
  async isModerator() {
    return false;
  }
  async listReports(): Promise<never> {
    throw new Error('Moderator access is unavailable in the demo.');
  }
  async reviewReport(_id: string, _removePost: boolean): Promise<never> {
    throw new Error('Moderator access is unavailable in the demo.');
  }
}

export function resetDemo(storage: StorageLike | null = browserStorage()) {
  try {
    storage?.setItem(DEMO_STORAGE_KEY, JSON.stringify(createSeed()));
  } catch {
    /* A fresh repository will still work without storage. */
  }
}

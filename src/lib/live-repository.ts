import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  Comment,
  CommunityRepository,
  Conversation,
  CreatePostInput,
  FeedFilter,
  Message,
  Post,
  Profile,
  Report,
  ReportInput,
} from './types';
import { REGIONS } from './types';
import { text, validatePost } from './validation';

const PROFILE = 'id,nickname,region,bio,created_at';
const POST = `id,author_id,body,topic,mood,scope,region,created_at,author:profiles!posts_author_id_fkey(${PROFILE}),supports(count),comments(count)`;
const COMMENT = `id,post_id,author_id,body,created_at,author:profiles!comments_author_id_fkey(${PROFILE})`;
const CONVERSATION = `id,requester_id,recipient_id,status,created_at,requester:profiles!conversations_requester_id_fkey(${PROFILE}),recipient:profiles!conversations_recipient_id_fkey(${PROFILE})`;
type PostRow = Omit<Post, 'supported' | 'support_count' | 'comment_count'> & {
  supports: { count: number }[];
  comments: { count: number }[];
};
type ConversationRow = Omit<Conversation, 'other' | 'last_message'> & {
  requester: Profile;
  recipient: Profile;
};
type Failure = { message: string; code?: string } | null;

function check(error: Failure, action: string): void {
  if (!error) return;
  if (error.code === '42501')
    throw new Error(
      `${action}: you do not have permission, or this content is no longer available.`,
    );
  if (error.code === '23505') throw new Error(`${action}: this already exists.`);
  throw new Error(`${action}: ${error.message}`);
}

function id(value: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value))
    throw new Error('This item has an invalid identifier.');
  return value;
}

/** Uses a publishable-key client and the signed-in user's session. RLS is authoritative. */
export class SupabaseRepository implements CommunityRepository {
  constructor(private readonly client: SupabaseClient) {}

  private async user(): Promise<string> {
    const { data, error } = await this.client.auth.getUser();
    check(error, 'Verify your sign-in');
    if (!data.user) throw new Error('Please sign in to continue.');
    return data.user.id;
  }

  async getProfile(): Promise<Profile | null> {
    const { data: auth, error: authError } = await this.client.auth.getUser();
    if (authError?.name === 'AuthSessionMissingError') return null;
    check(authError, 'Verify your sign-in');
    if (!auth.user) return null;
    const { data, error } = await this.client
      .from('profiles')
      .select(PROFILE)
      .eq('id', auth.user.id)
      .maybeSingle<Profile>();
    check(error, 'Load your profile');
    return data;
  }

  async saveProfile(input: Pick<Profile, 'nickname' | 'region' | 'bio'>): Promise<Profile> {
    if (!REGIONS.includes(input.region as (typeof REGIONS)[number]))
      throw new Error('Choose a region from the list.');
    const uid = await this.user();
    const values = {
      id: uid,
      nickname: text(input.nickname, 'Nickname', 2, 40),
      region: text(input.region, 'Region', 2, 80),
      bio: text(input.bio, 'About you', 0, 300),
    };
    const { data, error } = await this.client
      .from('profiles')
      .upsert(values, { onConflict: 'id' })
      .select(PROFILE)
      .single<Profile>();
    check(error, 'Save your profile');
    if (!data) throw new Error('Your profile could not be saved.');
    return data;
  }

  private async posts(rows: PostRow[], uid: string): Promise<Post[]> {
    if (!rows.length) return [];
    const { data, error } = await this.client
      .from('supports')
      .select('post_id')
      .eq('user_id', uid)
      .in(
        'post_id',
        rows.map((row) => row.id),
      );
    check(error, 'Load your support reactions');
    const supported = new Set((data ?? []).map((row) => row.post_id as string));
    return rows.map(({ supports, comments, ...row }) => ({
      ...row,
      supported: supported.has(row.id),
      support_count: supports[0]?.count ?? 0,
      comment_count: comments[0]?.count ?? 0,
    }));
  }

  async listPosts(filter: FeedFilter = {}): Promise<Post[]> {
    const uid = await this.user();
    const offset = filter.offset ?? 0;
    if (!Number.isSafeInteger(offset) || offset < 0) throw new Error('Invalid feed page.');
    let query = this.client.from('posts').select(POST).eq('hidden', false);
    if (filter.scope) query = query.eq('scope', filter.scope);
    if (filter.region) query = query.eq('region', text(filter.region, 'Region', 2, 80));
    if (filter.topic) query = query.eq('topic', filter.topic);
    if (filter.author_id) query = query.eq('author_id', id(filter.author_id));
    if (filter.search?.trim()) {
      // Escape LIKE wildcards so search means literal text, not a pattern.
      const search = text(filter.search, 'Search', 1, 200).replace(/[\\%_]/g, '\\$&');
      query = query.ilike('body', `%${search}%`);
    }
    const { data, error } = await query
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(offset, offset + 19)
      .returns<PostRow[]>();
    check(error, 'Load community posts');
    return this.posts(data ?? [], uid);
  }

  async createPost(input: CreatePostInput): Promise<Post> {
    const values = validatePost(input);
    if (values.region && !REGIONS.includes(values.region as (typeof REGIONS)[number]))
      throw new Error('Choose a region from the list.');
    const uid = await this.user();
    const { data, error } = await this.client
      .from('posts')
      .insert({ ...values, author_id: uid })
      .select(POST)
      .single<PostRow>();
    check(error, 'Publish your post');
    if (!data) throw new Error('Your post could not be published.');
    return (await this.posts([data], uid))[0];
  }

  async deletePost(postId: string): Promise<void> {
    const uid = await this.user();
    const { data, error } = await this.client
      .from('posts')
      .delete()
      .eq('id', id(postId))
      .eq('author_id', uid)
      .select('id');
    check(error, 'Delete your post');
    if (!data?.length) throw new Error('This post is unavailable or does not belong to you.');
  }

  async toggleSupport(postId: string, supported: boolean): Promise<void> {
    const uid = await this.user();
    const key = { post_id: id(postId), user_id: uid };
    const result = supported
      ? await this.client
          .from('supports')
          .upsert(key, { onConflict: 'user_id,post_id', ignoreDuplicates: true })
      : await this.client.from('supports').delete().match(key);
    check(result.error, 'Update your support');
  }

  async listComments(postId: string): Promise<Comment[]> {
    await this.user();
    const { data, error } = await this.client
      .from('comments')
      .select(COMMENT)
      .eq('post_id', id(postId))
      .order('created_at')
      .order('id')
      .limit(500)
      .returns<Comment[]>();
    check(error, 'Load replies');
    return data ?? [];
  }

  async addComment(postId: string, body: string): Promise<Comment> {
    const values = {
      post_id: id(postId),
      body: text(body, 'Your reply', 1, 1500),
      author_id: await this.user(),
    };
    const { data, error } = await this.client
      .from('comments')
      .insert(values)
      .select(COMMENT)
      .single<Comment>();
    check(error, 'Send your reply');
    if (!data) throw new Error('Your reply could not be sent.');
    return data;
  }

  async deleteComment(commentId: string): Promise<void> {
    const uid = await this.user();
    const { data, error } = await this.client
      .from('comments')
      .delete()
      .eq('id', id(commentId))
      .eq('author_id', uid)
      .select('id');
    check(error, 'Delete your reply');
    if (!data?.length) throw new Error('This reply is unavailable or does not belong to you.');
  }

  private conversation(row: ConversationRow, uid: string): Conversation {
    const { requester, recipient, ...rest } = row;
    return { ...rest, other: row.requester_id === uid ? recipient : requester };
  }

  async listConversations(): Promise<Conversation[]> {
    const uid = await this.user();
    const { data, error } = await this.client
      .from('conversations')
      .select(CONVERSATION)
      .or(`requester_id.eq.${uid},recipient_id.eq.${uid}`)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(100)
      .returns<ConversationRow[]>();
    check(error, 'Load your conversations');
    // Do not embed message bodies in a broad inbox request: fetch only when opened.
    return (data ?? []).map((row) => this.conversation(row, uid));
  }

  async requestConversation(recipientId: string): Promise<Conversation> {
    const uid = await this.user();
    id(recipientId);
    if (uid === recipientId) throw new Error('Choose another member to connect with.');
    const existing = () =>
      this.client
        .from('conversations')
        .select(CONVERSATION)
        .or(
          `and(requester_id.eq.${uid},recipient_id.eq.${recipientId}),and(requester_id.eq.${recipientId},recipient_id.eq.${uid})`,
        )
        .maybeSingle<ConversationRow>();
    const previous = await existing();
    check(previous.error, 'Check your conversation');
    if (previous.data) return this.conversation(previous.data, uid);
    const { data, error } = await this.client
      .from('conversations')
      .insert({ requester_id: uid, recipient_id: recipientId, status: 'pending' })
      .select(CONVERSATION)
      .single<ConversationRow>();
    if (error?.code === '23505') {
      const raced = await existing();
      check(raced.error, 'Load your conversation');
      if (raced.data) return this.conversation(raced.data, uid);
    }
    check(error, 'Request a conversation');
    if (!data) throw new Error('This member is unavailable for a conversation.');
    return this.conversation(data, uid);
  }

  async respondConversation(conversationId: string, accept: boolean): Promise<void> {
    const uid = await this.user();
    const { data, error } = await this.client
      .from('conversations')
      .update({ status: accept ? 'accepted' : 'declined' })
      .eq('id', id(conversationId))
      .eq('recipient_id', uid)
      .eq('status', 'pending')
      .select('id');
    check(error, 'Respond to the message request');
    if (!data?.length) throw new Error('This request is unavailable or has already been answered.');
  }

  private async acceptedConversation(conversationId: string): Promise<string> {
    const uid = await this.user();
    const { data, error } = await this.client
      .from('conversations')
      .select('id,status')
      .eq('id', id(conversationId))
      .or(`requester_id.eq.${uid},recipient_id.eq.${uid}`)
      .maybeSingle();
    check(error, 'Check your conversation');
    if (!data || data.status !== 'accepted')
      throw new Error(
        'The recipient must accept the message request before you can exchange messages.',
      );
    return uid;
  }

  async listMessages(conversationId: string): Promise<Message[]> {
    await this.acceptedConversation(conversationId);
    const { data, error } = await this.client
      .from('messages')
      .select('id,conversation_id,sender_id,body,created_at')
      .eq('conversation_id', id(conversationId))
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(200)
      .returns<Message[]>();
    check(error, 'Load your messages');
    return (data ?? []).reverse();
  }

  async sendMessage(conversationId: string, body: string): Promise<Message> {
    const cleanBody = text(body, 'Your message', 1, 2000);
    const uid = await this.acceptedConversation(conversationId);
    const { data, error } = await this.client
      .from('messages')
      .insert({ conversation_id: id(conversationId), sender_id: uid, body: cleanBody })
      .select('id,conversation_id,sender_id,body,created_at')
      .single<Message>();
    check(error, 'Send your message');
    if (!data) throw new Error('Your message could not be sent.');
    return data;
  }

  async blockUser(userId: string): Promise<void> {
    const uid = await this.user();
    if (uid === id(userId)) throw new Error('You cannot block yourself.');
    const { error } = await this.client
      .from('blocks')
      .upsert(
        { blocker_id: uid, blocked_id: userId },
        { onConflict: 'blocker_id,blocked_id', ignoreDuplicates: true },
      );
    check(error, 'Block this member');
  }

  async unblockUser(userId: string): Promise<void> {
    const { error } = await this.client
      .from('blocks')
      .delete()
      .eq('blocker_id', await this.user())
      .eq('blocked_id', id(userId));
    check(error, 'Unblock this member');
  }

  async listBlocked(): Promise<Profile[]> {
    const { data, error } = await this.client
      .from('blocks')
      .select(`blocked:profiles!blocks_blocked_id_fkey(${PROFILE})`)
      .eq('blocker_id', await this.user())
      .order('created_at', { ascending: false })
      .order('blocked_id', { ascending: false })
      .limit(500)
      .returns<{ blocked: Profile }[]>();
    check(error, 'Load blocked members');
    return (data ?? []).map((row) => row.blocked);
  }

  async report(input: ReportInput): Promise<void> {
    if (Boolean(input.post_id) === Boolean(input.message_id))
      throw new Error('Choose one post or message to report.');
    const values = {
      reporter_id: await this.user(),
      post_id: input.post_id ? id(input.post_id) : null,
      message_id: input.message_id ? id(input.message_id) : null,
      reason: text(input.reason, 'Report reason', 3, 100),
      details: text(input.details ?? '', 'Report details', 0, 1000),
    };
    const { error } = await this.client.from('reports').insert(values);
    check(error, 'Submit your report');
  }

  async isModerator(): Promise<boolean> {
    await this.user();
    const { data, error } = await this.client.rpc('is_moderator');
    check(error, 'Check moderation access');
    return data === true;
  }

  async listReports(): Promise<Report[]> {
    if (!(await this.isModerator())) throw new Error('Moderator access is required.');
    const { data, error } = await this.client
      .from('reports')
      .select('id,reporter_id,post_id,message_id,reason,details,evidence,status,created_at')
      .order('status')
      .order('created_at', { ascending: false })
      .limit(200)
      .returns<Report[]>();
    check(error, 'Load reports');
    return data ?? [];
  }

  async reviewReport(reportId: string, removePost: boolean): Promise<void> {
    if (!(await this.isModerator())) throw new Error('Moderator access is required.');
    const { error } = await this.client.rpc('review_report', {
      report_id: id(reportId),
      remove_post: removePost,
    });
    check(error, 'Review this report');
  }
}

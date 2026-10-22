export const TOPICS = [
  'Everyday life',
  'Anxiety',
  'Feeling low',
  'Relationships',
  'Work & study',
  'Small wins',
] as const;
export const MOODS = ['Hopeful', 'Okay', 'Low', 'Anxious', 'Overwhelmed'] as const;
export const REGIONS = [
  'India',
  'United Kingdom',
  'United States',
  'Canada',
  'Australia',
  'Europe',
  'Other',
] as const;
export type Topic = (typeof TOPICS)[number];
export type Mood = (typeof MOODS)[number];
export type Scope = 'global' | 'regional';
export interface Profile {
  id: string;
  nickname: string;
  region: string;
  bio: string;
  created_at: string;
}
export interface Post {
  id: string;
  author_id: string;
  body: string;
  topic: Topic;
  mood: Mood;
  scope: Scope;
  region: string | null;
  created_at: string;
  author: Profile;
  support_count: number;
  supported: boolean;
  comment_count: number;
}
export interface Comment {
  id: string;
  post_id: string;
  author_id: string;
  body: string;
  created_at: string;
  author: Profile;
}
export interface Conversation {
  id: string;
  requester_id: string;
  recipient_id: string;
  status: 'pending' | 'accepted' | 'declined';
  created_at: string;
  other: Profile;
  last_message?: string;
}
export interface Message {
  id: string;
  conversation_id: string;
  sender_id: string;
  body: string;
  created_at: string;
}
export interface MessageCursor {
  created_at: string;
  id: string;
}
export interface Report {
  id: string;
  reporter_id: string;
  post_id: string | null;
  message_id: string | null;
  reason: string;
  details: string;
  evidence?: string;
  status: 'open' | 'reviewed';
  created_at: string;
}
export interface FeedFilter {
  scope?: Scope;
  region?: string;
  topic?: Topic;
  search?: string;
  author_id?: string;
  offset?: number;
}
export interface CreatePostInput {
  body: string;
  topic: Topic;
  mood: Mood;
  scope: Scope;
  region: string | null;
}
export interface ReportInput {
  post_id?: string;
  message_id?: string;
  reason: string;
  details?: string;
}
export interface CommunityRepository {
  getProfile(): Promise<Profile | null>;
  saveProfile(input: Pick<Profile, 'nickname' | 'region' | 'bio'>): Promise<Profile>;
  listPosts(filter?: FeedFilter): Promise<Post[]>;
  createPost(input: CreatePostInput): Promise<Post>;
  deletePost(id: string): Promise<void>;
  toggleSupport(postId: string, supported: boolean): Promise<void>;
  listComments(postId: string): Promise<Comment[]>;
  addComment(postId: string, body: string): Promise<Comment>;
  deleteComment(id: string): Promise<void>;
  listConversations(): Promise<Conversation[]>;
  requestConversation(recipientId: string): Promise<Conversation>;
  respondConversation(id: string, accept: boolean): Promise<void>;
  listMessages(conversationId: string, after?: MessageCursor): Promise<Message[]>;
  sendMessage(conversationId: string, body: string): Promise<Message>;
  blockUser(userId: string): Promise<void>;
  unblockUser(userId: string): Promise<void>;
  listBlocked(): Promise<Profile[]>;
  report(input: ReportInput): Promise<void>;
  isModerator(): Promise<boolean>;
  listReports(): Promise<Report[]>;
  reviewReport(id: string, removePost: boolean): Promise<void>;
}

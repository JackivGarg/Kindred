import type { Comment, Message, Profile, Report, CreatePostInput } from './types';

export const CURRENT_USER_ID = 'demo-you';
export interface StoredPost extends CreatePostInput {
  id: string;
  author_id: string;
  created_at: string;
}
export interface StoredConversation {
  id: string;
  requester_id: string;
  recipient_id: string;
  status: 'pending' | 'accepted' | 'declined';
  created_at: string;
}
export interface DemoState {
  version: 1;
  profiles: Profile[];
  posts: StoredPost[];
  comments: Omit<Comment, 'author'>[];
  conversations: StoredConversation[];
  messages: Message[];
  supports: { post_id: string; user_id: string }[];
  blocks: { blocker_id: string; blocked_id: string }[];
  reports: Report[];
}

/** Fictional sample content only. Nobody in the demo is a live community member. */
export function createSeed(): DemoState {
  const ago = (hours: number) => new Date(Date.now() - hours * 3600000).toISOString();
  const profiles: Profile[] = [
    {
      id: CURRENT_USER_ID,
      nickname: 'Alex',
      region: 'India',
      bio: 'Taking things one day at a time.',
      created_at: ago(240),
    },
    {
      id: 'demo-maya',
      nickname: 'Maya',
      region: 'India',
      bio: 'Finding little moments of calm. Fictional demo profile.',
      created_at: ago(230),
    },
    {
      id: 'demo-sam',
      nickname: 'Sam',
      region: 'United Kingdom',
      bio: 'Here to listen and share. Fictional demo profile.',
      created_at: ago(220),
    },
    {
      id: 'demo-jules',
      nickname: 'Jules',
      region: 'Canada',
      bio: 'A fan of walks and fresh starts. Fictional demo profile.',
      created_at: ago(210),
    },
    {
      id: 'demo-ari',
      nickname: 'Ari',
      region: 'India',
      bio: 'Learning to be kinder to myself. Fictional demo profile.',
      created_at: ago(200),
    },
    {
      id: 'demo-noor',
      nickname: 'Noor',
      region: 'Australia',
      bio: 'Small steps count. Fictional demo profile.',
      created_at: ago(190),
    },
    {
      id: 'demo-theo',
      nickname: 'Theo',
      region: 'United States',
      bio: 'Making room for honest conversations. Fictional demo profile.',
      created_at: ago(180),
    },
    {
      id: 'demo-leah',
      nickname: 'Leah',
      region: 'Europe',
      bio: 'Listening without trying to fix everything. Fictional demo profile.',
      created_at: ago(170),
    },
  ];
  const samples: {
    author_id: string;
    body: string;
    topic: CreatePostInput['topic'];
    mood: CreatePostInput['mood'];
    regional?: boolean;
  }[] = [
    {
      author_id: 'demo-maya',
      body: 'I finally went for a short walk after putting it off all week. Just ten minutes, but I felt a little more present afterwards. Sharing this tiny win with anyone who needs a gentle start today.',
      topic: 'Small wins',
      mood: 'Hopeful',
    },
    {
      author_id: 'demo-sam',
      body: 'Does anyone else feel tired after a day of pretending everything is fine? I do not need solutions tonight. It would help just to know someone understands.',
      topic: 'Feeling low',
      mood: 'Low',
    },
    {
      author_id: 'demo-ari',
      body: 'Exam season has my thoughts racing. I am trying shorter study sessions and real breaks. Today was difficult, and I am reminding myself that my grades are not my whole identity.',
      topic: 'Work & study',
      mood: 'Anxious',
      regional: true,
    },
    {
      author_id: 'demo-jules',
      body: 'I told a friend that I have been feeling lonely, and they listened without making it awkward. Asking for company was scary. I am glad I gave it a try.',
      topic: 'Relationships',
      mood: 'Hopeful',
    },
    {
      author_id: 'demo-noor',
      body: 'Some days the ordinary chores feel like a mountain. Today I washed one mug and opened the curtains. That is what I had energy for, and I am letting that be enough.',
      topic: 'Everyday life',
      mood: 'Okay',
    },
    {
      author_id: 'demo-theo',
      body: 'Starting a new job next week and feeling both excited and overwhelmed. I keep rehearsing conversations in my head. Writing it down here is helping me pause for a moment.',
      topic: 'Anxiety',
      mood: 'Overwhelmed',
    },
    {
      author_id: 'demo-leah',
      body: 'A quiet reminder I needed today: I can care about people and still need some space. Practising saying that kindly is a work in progress.',
      topic: 'Relationships',
      mood: 'Okay',
    },
    {
      author_id: 'demo-maya',
      body: 'Feeling a bit disconnected even though I live in a busy city. I would love to hear how others make time for a slower evening after work.',
      topic: 'Everyday life',
      mood: 'Low',
      regional: true,
    },
    {
      author_id: CURRENT_USER_ID,
      body: 'Trying to make a little more space for honest check-ins. Today I am okay, and I am happy to take things slowly.',
      topic: 'Everyday life',
      mood: 'Okay',
    },
  ];
  const posts = samples.map((sample, i): StoredPost => ({
    id: `demo-post-${i + 1}`,
    author_id: sample.author_id,
    body: sample.body,
    topic: sample.topic,
    mood: sample.mood,
    scope: sample.regional ? 'regional' : 'global',
    region: sample.regional ? 'India' : null,
    created_at: ago(i * 3 + 1),
  }));
  return {
    version: 1,
    profiles,
    posts,
    comments: [
      {
        id: 'demo-comment-1',
        post_id: 'demo-post-1',
        author_id: 'demo-jules',
        body: 'Ten minutes counts. Thanks for sharing your small win.',
        created_at: ago(0.7),
      },
      {
        id: 'demo-comment-2',
        post_id: 'demo-post-2',
        author_id: 'demo-leah',
        body: 'That sounds exhausting. You do not have to put a brave face on here.',
        created_at: ago(3.5),
      },
      {
        id: 'demo-comment-3',
        post_id: 'demo-post-3',
        author_id: 'demo-maya',
        body: 'I hear you. Wishing you a little breathing room between study sessions.',
        created_at: ago(6.5),
      },
    ],
    conversations: [
      {
        id: 'demo-conversation-1',
        requester_id: CURRENT_USER_ID,
        recipient_id: 'demo-maya',
        status: 'accepted',
        created_at: ago(24),
      },
      {
        id: 'demo-conversation-2',
        requester_id: 'demo-jules',
        recipient_id: CURRENT_USER_ID,
        status: 'pending',
        created_at: ago(4),
      },
    ],
    messages: [
      {
        id: 'demo-message-1',
        conversation_id: 'demo-conversation-1',
        sender_id: CURRENT_USER_ID,
        body: 'Your post about taking a walk resonated with me. Thanks for sharing.',
        created_at: ago(23),
      },
      {
        id: 'demo-message-2',
        conversation_id: 'demo-conversation-1',
        sender_id: 'demo-maya',
        body: 'This is a sample conversation for exploring the demo. I am glad we can make room for small steps.',
        created_at: ago(22),
      },
    ],
    supports: posts.flatMap((post, i) =>
      profiles
        .slice(1, 2 + (i % 4))
        .filter((p) => p.id !== post.author_id)
        .map((p) => ({ post_id: post.id, user_id: p.id })),
    ),
    blocks: [],
    reports: [],
  };
}

// ================================================================
// FILE STRUCTURE
// ================================================================
// app/
//   api/
//     auth/register/route.ts
//     auth/login/route.ts
//     quests/route.ts
//     quests/[id]/complete/route.ts
//     quests/[id]/rate/route.ts
//     quests/[id]/vote/route.ts
//     feed/route.ts
//     feed/[id]/like/route.ts
//     upload/route.ts
//     leaderboard/route.ts
//     tournaments/route.ts
//     guilds/route.ts
//     notifications/route.ts
//     admin/queue/route.ts
// lib/
//   prisma.ts
//   xp.ts
//   auth.ts
//   upload.ts
//   middleware.ts
// services/
//   questService.ts
//   streakService.ts
//   reputationService.ts
//   tournamentService.ts
//   badgeService.ts

// ================================================================
// lib/prisma.ts
// ================================================================
import { PrismaClient } from '@prisma/client'
declare global { var prisma: PrismaClient | undefined }
export const prisma = global.prisma || new PrismaClient({ log: ['query'] })
if (process.env.NODE_ENV !== 'production') global.prisma = prisma

// ================================================================
// lib/xp.ts — XP, Leveling & Streak Logic
// ================================================================
export const XP_PER_LEVEL = (level: number) =>
  Math.floor(1000 * Math.pow(1.4, level - 1))

export function levelFromXP(totalXP: number): number {
  let level = 1, used = 0
  while (used + XP_PER_LEVEL(level) <= totalXP) {
    used += XP_PER_LEVEL(level)
    level++
  }
  return level
}

export function xpIntoCurrentLevel(totalXP: number): number {
  let level = 1, used = 0
  while (used + XP_PER_LEVEL(level) <= totalXP) {
    used += XP_PER_LEVEL(level)
    level++
  }
  return totalXP - used
}

/** Returns 1.0 / 1.5 / 2.0 / 3.0 / 4.0 based on streak length */
export function streakMultiplier(streak: number): number {
  if (streak >= 30) return 4.0
  if (streak >= 14) return 3.0
  if (streak >=  7) return 2.0
  if (streak >=  3) return 1.5
  return 1.0
}

export const coinsFromXP = (xp: number) => Math.floor(xp / 10)

/** Trending score: decays by hour, boosted by completions + votes + ratings */
export function trendingScore(
  upvotes: number,
  completions: number,
  avgRating: number,
  createdAt: Date
): number {
  const hours = (Date.now() - createdAt.getTime()) / 3_600_000
  const engagement = upvotes * 2 + completions * 5 + avgRating * 10
  return engagement * Math.pow(0.97, hours)
}

// ================================================================
// lib/auth.ts
// ================================================================
import jwt from 'jsonwebtoken'
import bcrypt from 'bcryptjs'

const SECRET = process.env.JWT_SECRET!

export interface JWTPayload { userId: string; email: string; role: string }

export const hashPassword  = (pw: string) => bcrypt.hash(pw, 12)
export const checkPassword = (pw: string, hash: string) => bcrypt.compare(pw, hash)
export const signToken     = (p: JWTPayload) => jwt.sign(p, SECRET, { expiresIn: '7d' })
export const verifyToken   = (t: string) => jwt.verify(t, SECRET) as JWTPayload

// ================================================================
// lib/middleware.ts
// ================================================================
import { NextRequest, NextResponse } from 'next/server'

export function withAuth(handler: Function) {
  return async (req: NextRequest, ctx: any) => {
    const token = req.headers.get('authorization')?.replace('Bearer ', '')
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    try {
      ;(req as any).user = verifyToken(token)
      return handler(req, ctx)
    } catch {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 })
    }
  }
}

export function withRole(minRole: 'MODERATOR' | 'ADMIN', handler: Function) {
  return withAuth(async (req: NextRequest, ctx: any) => {
    const user = (req as any).user as JWTPayload
    const rank = { USER: 0, MODERATOR: 1, ADMIN: 2 }
    if (rank[user.role as keyof typeof rank] < rank[minRole]) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    return handler(req, ctx)
  })
}

// ================================================================
// lib/upload.ts
// ================================================================
import { writeFile, mkdir } from 'fs/promises'
import path from 'path'
import { randomUUID } from 'crypto'

const UPLOAD_DIR = process.env.UPLOAD_DIR || './public/uploads'
const MAX_BYTES  = 10 * 1024 * 1024
const ALLOWED    = ['image/jpeg','image/png','image/webp','image/gif']

export async function saveUpload(file: File): Promise<string> {
  if (!ALLOWED.includes(file.type)) throw new Error('Invalid file type')
  if (file.size > MAX_BYTES)        throw new Error('File too large (max 10MB)')
  const ext  = file.type.split('/')[1]
  const name = `${randomUUID()}.${ext}`
  const sub  = new Date().toISOString().slice(0, 7) // YYYY-MM
  const dir  = path.join(UPLOAD_DIR, sub)
  await mkdir(dir, { recursive: true })
  await writeFile(path.join(dir, name), Buffer.from(await file.arrayBuffer()))
  // Swap this for Cloudinary/Supabase in production:
  // const res = await cloudinary.uploader.upload_stream(...)
  return `/uploads/${sub}/${name}`
}

// ================================================================
// services/questService.ts
// ================================================================
import { prisma } from '@/lib/prisma'
import { streakMultiplier, coinsFromXP, trendingScore, levelFromXP } from '@/lib/xp'

export async function completeQuestForUser(userId: string, questId: string, proofPostId?: string) {
  const [quest, streak, existing] = await Promise.all([
    prisma.quest.findUnique({ where: { id: questId } }),
    prisma.streak.findUnique({ where: { userId } }),
    prisma.questCompletion.findUnique({ where: { userId_questId: { userId, questId } } }),
  ])
  if (!quest)    throw new Error('Quest not found')
  if (existing)  throw new Error('Quest already completed')

  const mult     = streakMultiplier(streak?.current ?? 0)
  const xpEarned = Math.floor(quest.xpReward * mult)
  const coins    = coinsFromXP(xpEarned)

  // Atomic transaction: completion + profile update + streak + feed event
  await prisma.$transaction([
    prisma.questCompletion.create({ data: { userId, questId, xpEarned, proofPostId } }),
    prisma.quest.update({ where: { id: questId }, data: { completionCount: { increment: 1 } } }),
    prisma.profile.upsert({
      where:  { userId },
      create: { userId, displayName: 'Adventurer', totalXP: xpEarned, coins },
      update: { totalXP: { increment: xpEarned }, coins: { increment: coins } },
    }),
    prisma.activityFeedEvent.create({
      data: { userId, type: 'QUEST_COMPLETED', data: { questId, questTitle: quest.title, xpEarned } }
    }),
  ])

  // Async: badge checks + trending update (non-blocking)
  checkBadges(userId).catch(console.error)
  refreshTrendingScore(questId).catch(console.error)

  return { xpEarned, coins, multiplier: mult }
}

export async function refreshTrendingScore(questId: string) {
  const quest = await prisma.quest.findUnique({
    where: { id: questId },
    include: { ratings: true }
  })
  if (!quest) return
  const avg = quest.ratings.length
    ? quest.ratings.reduce((s, r) => s + (r.fun + r.usefulness) / 2, 0) / quest.ratings.length
    : 0
  const score = trendingScore(quest.upvoteCount, quest.completionCount, avg, quest.createdAt)
  await prisma.quest.update({ where: { id: questId }, data: { trendingScore: score } })
}

// ================================================================
// services/badgeService.ts
// ================================================================
async function checkBadges(userId: string) {
  const profile = await prisma.profile.findUnique({
    where: { userId },
    include: { user: { include: { completions: true, streak: true } } }
  })
  if (!profile) return
  const completions = profile.user.completions.length
  const streak      = profile.user.streak?.current ?? 0
  const criteria = [
    { name: 'First Quest',   check: () => completions >= 1 },
    { name: '10 Quests',     check: () => completions >= 10 },
    { name: '50 Quests',     check: () => completions >= 50 },
    { name: '7-Day Streak',  check: () => streak >= 7 },
    { name: '14-Day Streak', check: () => streak >= 14 },
    { name: '30-Day Streak', check: () => streak >= 30 },
  ]
  for (const { name, check } of criteria) {
    if (!check()) continue
    const badge = await prisma.badge.findUnique({ where: { name } })
    if (!badge) continue
    const already = await prisma.userBadge.findUnique({
      where: { userId_badgeId: { userId, badgeId: badge.id } }
    })
    if (already) continue
    await prisma.userBadge.create({ data: { userId, badgeId: badge.id } })
    await prisma.notification.create({
      data: { userId, type: 'BADGE_UNLOCKED', title: 'Badge Unlocked!', body: `You earned: ${name}` }
    })
  }
}

// ================================================================
// services/streakService.ts
// ================================================================
export async function updateStreak(userId: string) {
  const streak = await prisma.streak.findUnique({ where: { userId } })
  const now    = new Date()

  if (!streak) {
    return prisma.streak.create({
      data: { userId, current: 1, longest: 1, lastActivityAt: now, multiplier: 1.0 }
    })
  }

  const last = streak.lastActivityAt
  if (!last) {
    return prisma.streak.update({ where: { userId }, data: { current: 1, longest: 1, lastActivityAt: now } })
  }

  const daysSince = Math.floor((now.getTime() - last.getTime()) / 86_400_000)

  if (daysSince === 0) return streak // Already updated today
  if (daysSince === 1) {
    // Continue streak
    const newCurrent = streak.current + 1
    const mult = streakMultiplier(newCurrent)
    return prisma.streak.update({
      where: { userId },
      data: {
        current: newCurrent,
        longest: Math.max(newCurrent, streak.longest),
        lastActivityAt: now,
        multiplier: mult,
      }
    })
  }

  // Streak broken (unless shielded)
  if (streak.shielded) {
    return prisma.streak.update({
      where: { userId },
      data: { shielded: false, lastActivityAt: now }
    })
  }

  return prisma.streak.update({
    where: { userId },
    data: { current: 1, multiplier: 1.0, lastActivityAt: now }
  })
}

// ================================================================
// services/reputationService.ts
// ================================================================
export async function updateCreatorRep(creatorId: string) {
  const quests = await prisma.quest.findMany({
    where: { creatorId, status: { in: ['APPROVED', 'OFFICIAL'] } },
    include: { ratings: true, _count: { select: { completions: true } } }
  })
  if (!quests.length) return

  const totalRatings = quests.flatMap(q => q.ratings)
  const avgRating = totalRatings.length
    ? totalRatings.reduce((s, r) => s + (r.fun + r.usefulness + r.difficulty) / 3, 0) / totalRatings.length
    : 0

  const totalCompletions = quests.reduce((s, q) => s + q._count.completions, 0)
  const completionRate   = totalCompletions / (quests.length * 10) // normalized

  const score = avgRating * 20 + completionRate * 30 + Math.min(quests.length * 5, 50)

  await prisma.creatorReputation.upsert({
    where:  { userId: creatorId },
    create: { userId: creatorId, score, questsCreated: quests.length, avgRating, completionRate },
    update: { score, questsCreated: quests.length, avgRating, completionRate },
  })
}

// ================================================================
// app/api/auth/register/route.ts
// ================================================================
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

const RegisterSchema = z.object({
  email:       z.string().email(),
  username:    z.string().min(3).max(20).regex(/^[a-zA-Z0-9_]+$/),
  password:    z.string().min(8),
  displayName: z.string().min(1).max(50),
})

export async function POST(req: NextRequest) {
  try {
    const body = RegisterSchema.parse(await req.json())
    const exists = await prisma.user.findFirst({
      where: { OR: [{ email: body.email }, { username: body.username }] }
    })
    if (exists) return NextResponse.json({ error: 'Email or username taken' }, { status: 409 })

    const user = await prisma.$transaction(async tx => {
      const u = await tx.user.create({
        data: { email: body.email, username: body.username, passwordHash: await hashPassword(body.password) }
      })
      await tx.profile.create({ data: { userId: u.id, displayName: body.displayName } })
      await tx.streak.create({ data: { userId: u.id } })
      await tx.creatorReputation.create({ data: { userId: u.id } })
      return u
    })

    const token = signToken({ userId: user.id, email: user.email, role: user.role })
    return NextResponse.json({ token, userId: user.id }, { status: 201 })
  } catch (err: any) {
    if (err?.name === 'ZodError') return NextResponse.json({ error: err.issues }, { status: 400 })
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}

// ================================================================
// app/api/quests/route.ts
// ================================================================
export async function GET(req: NextRequest) {
  const sp  = new URL(req.url).searchParams
  const cat = sp.get('category')?.toUpperCase()
  const tab = sp.get('tab') || 'all'   // all|trending|official|community
  const pg  = parseInt(sp.get('page') || '1')
  const lim = parseInt(sp.get('limit') || '20')

  const where: any = { status: { in: ['APPROVED', 'OFFICIAL'] } }
  if (cat) where.category = cat
  if (tab === 'official')  where.status = 'OFFICIAL'
  if (tab === 'community') where.status = 'APPROVED'

  const orderBy: any = tab === 'trending' ? { trendingScore: 'desc' }
    : tab === 'new'  ? { createdAt: 'desc' }
    : { trendingScore: 'desc' }

  const [quests, total] = await Promise.all([
    prisma.quest.findMany({
      where, orderBy, skip: (pg - 1) * lim, take: lim,
      include: {
        creator: { include: { profile: true } },
        _count:  { select: { completions: true, ratings: true, votes: true } }
      }
    }),
    prisma.quest.count({ where }),
  ])

  return NextResponse.json({ quests, total, page: pg, pages: Math.ceil(total / lim) })
}

// ================================================================
// app/api/quests/[id]/complete/route.ts — protected
// ================================================================
export const POST_complete = withAuth(async (req: NextRequest, { params }: any) => {
  const user = (req as any).user
  try {
    const body   = await req.json()
    const result = await completeQuestForUser(user.userId, params.id, body.proofPostId)
    await updateStreak(user.userId)
    return NextResponse.json(result)
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 400 })
  }
})

// ================================================================
// app/api/quests/[id]/rate/route.ts — protected
// ================================================================
export const POST_rate = withAuth(async (req: NextRequest, { params }: any) => {
  const user = (req as any).user
  const body = await req.json()

  // Must have completed quest first
  const completion = await prisma.questCompletion.findUnique({
    where: { userId_questId: { userId: user.userId, questId: params.id } }
  })
  if (!completion) return NextResponse.json({ error: 'Complete this quest before rating' }, { status: 403 })

  const RateSchema = z.object({
    fun: z.number().int().min(1).max(5),
    usefulness: z.number().int().min(1).max(5),
    difficulty: z.number().int().min(1).max(5),
    repeatability: z.number().int().min(1).max(5),
    recommend: z.boolean(),
  })
  const rating = RateSchema.parse(body)

  const created = await prisma.questRating.upsert({
    where:  { userId_questId: { userId: user.userId, questId: params.id } },
    create: { userId: user.userId, questId: params.id, ...rating },
    update: rating,
  })

  // Async trending refresh
  refreshTrendingScore(params.id).catch(console.error)
  // Update creator reputation
  const quest = await prisma.quest.findUnique({ where: { id: params.id } })
  if (quest) updateCreatorRep(quest.creatorId).catch(console.error)

  return NextResponse.json(created)
})

// ================================================================
// app/api/upload/route.ts — protected
// ================================================================
export const POST_upload = withAuth(async (req: NextRequest) => {
  const form = await req.formData()
  const file = form.get('file') as File | null
  if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 })
  try {
    const url   = await saveUpload(file)
    const media = await prisma.mediaUpload.create({
      data: { url, mimeType: file.type, sizeBytes: file.size }
    })
    return NextResponse.json({ url, mediaId: media.id })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 400 })
  }
})

// ================================================================
// app/api/leaderboard/route.ts
// ================================================================
export async function GET_lb(req: NextRequest) {
  const type    = new URL(req.url).searchParams.get('type') || 'weekly'
  const weekAgo = new Date(Date.now() - 7 * 86_400_000)

  const groups = await prisma.questCompletion.groupBy({
    by:    ['userId'],
    where: type === 'weekly' ? { completedAt: { gte: weekAgo } } : {},
    _sum:  { xpEarned: true },
    orderBy: { _sum: { xpEarned: 'desc' } },
    take:  50,
  })

  const userIds  = groups.map(g => g.userId)
  const profiles = await prisma.profile.findMany({
    where: { userId: { in: userIds } },
    include: { user: { include: { streak: true } } }
  })

  const ranked = groups.map((g, i) => {
    const p = profiles.find(p => p.userId === g.userId)
    return {
      rank:        i + 1,
      userId:      g.userId,
      displayName: p?.displayName ?? 'Unknown',
      avatarUrl:   p?.avatarUrl,
      xp:          g._sum.xpEarned ?? 0,
      streak:      p?.user.streak?.current ?? 0,
      level:       p?.level ?? 1,
    }
  })

  return NextResponse.json({ leaderboard: ranked })
}

// ================================================================
// app/api/admin/queue/route.ts — ADMIN only
// ================================================================
export const GET_queue = withRole('MODERATOR', async (req: NextRequest) => {
  const quests = await prisma.quest.findMany({
    where: { status: 'PENDING_REVIEW' },
    orderBy: { createdAt: 'asc' },
    include: {
      creator: { include: { profile: true, creatorRep: true } },
      _count: { select: { completions: true, votes: true, ratings: true } },
    }
  })
  return NextResponse.json({ quests })
})

export const POST_approve = withRole('MODERATOR', async (req: NextRequest, { params }: any) => {
  const { action } = await req.json() // 'approve' | 'official' | 'reject'
  const statusMap: any = { approve: 'APPROVED', official: 'OFFICIAL', reject: 'REJECTED' }
  const quest = await prisma.quest.update({
    where: { id: params.id },
    data:  { status: statusMap[action] ?? 'APPROVED' }
  })
  if (action !== 'reject') {
    await prisma.notification.create({
      data: { userId: quest.creatorId, type: 'QUEST_APPROVED', title: 'Quest Approved!', body: `"${quest.title}" is now ${quest.status.toLowerCase()}` }
    })
  }
  return NextResponse.json(quest)
})

// ================================================================
// prisma/seed.ts — Run with: npx ts-node prisma/seed.ts
// ================================================================
async function seed() {
  console.log('🌱 Seeding SideQuest…')

  // Badges
  const badgeDefs = [
    { name:'First Quest',   icon:'⚡', description:'Complete your first quest', condition:{ type:'completions', value:1 } },
    { name:'10 Quests',     icon:'🔟', description:'Complete 10 quests',         condition:{ type:'completions', value:10 } },
    { name:'50 Quests',     icon:'🌟', description:'Complete 50 quests',         condition:{ type:'completions', value:50 } },
    { name:'7-Day Streak',  icon:'🔥', description:'7-day streak',               condition:{ type:'streak', value:7 } },
    { name:'14-Day Streak', icon:'🔥', description:'14-day streak',              condition:{ type:'streak', value:14 } },
    { name:'30-Day Streak', icon:'🔥', description:'30-day streak',              condition:{ type:'streak', value:30 } },
    { name:'Iron Mind',     icon:'🧠', description:'Complete 5 focus quests',    condition:{ type:'category', value:'FOCUS', count:5 } },
    { name:'Social Opener', icon:'🗣️', description:'First social quest done',    condition:{ type:'category', value:'SOCIAL', count:1 } },
    { name:'Explorer',      icon:'🌍', description:'Visit 3 unique locations',   condition:{ type:'locations', value:3 } },
    { name:'Quest Creator', icon:'🎨', description:'Submitted approved quest',   condition:{ type:'quests_created', value:1 } },
  ]
  for (const b of badgeDefs) {
    await prisma.badge.upsert({
      where: { name: b.name }, create: { ...b, condition: b.condition as any }, update: {}
    })
  }

  // Admin user
  const admin = await prisma.user.upsert({
    where:  { email: 'admin@sidequest.app' },
    create: { email: 'admin@sidequest.app', username: 'admin', passwordHash: 'CHANGEME', role: 'ADMIN' },
    update: {}
  })
  await prisma.profile.upsert({ where: { userId: admin.id }, create: { userId: admin.id, displayName: 'SideQuest Admin' }, update: {} })

  // Official quests
  const officialQuests = [
    { title:'Morning Run Protocol', description:'Complete 2km before 9am. Log route or photo.', category:'FITNESS',     difficulty:2, estimatedTime:'20 min', xpReward:150, status:'OFFICIAL' },
    { title:'Digital Blackout',     description:'Lock phone for 1 full hour. 3× XP activates.', category:'NO_SCREEN',  difficulty:3, estimatedTime:'1 hr',   xpReward:300, status:'OFFICIAL' },
    { title:'First Contact',        description:'Start a genuine convo with someone new.',       category:'SOCIAL',      difficulty:3, estimatedTime:'10 min', xpReward:200, status:'OFFICIAL' },
    { title:'Sunlight Ritual',      description:'30 min outside. No headphones.',               category:'FITNESS',     difficulty:1, estimatedTime:'30 min', xpReward:120, status:'OFFICIAL' },
    { title:'The Deep Study',       description:'45 min work/study. Phone locked.',             category:'FOCUS',       difficulty:2, estimatedTime:'45 min', xpReward:250, status:'OFFICIAL' },
    { title:'Uncharted Territory',  description:'Go somewhere you\'ve never been.',             category:'EXPLORATION', difficulty:1, estimatedTime:'30 min', xpReward:175, status:'OFFICIAL' },
  ]
  for (const q of officialQuests) {
    await prisma.quest.create({ data: { ...q as any, creatorId: admin.id } })
  }

  // Demo users
  const users = [
    { email:'marcus@demo.app', username:'marcus_irl', displayName:'Marcus R.', level:7, totalXP:3240, coins:1240 },
    { email:'ava@demo.app',    username:'ava_l',       displayName:'Ava L.',    level:6, totalXP:2800, coins:890  },
    { email:'dev@demo.app',    username:'dev_k',       displayName:'Dev K.',    level:5, totalXP:2200, coins:640  },
  ]
  for (const u of users) {
    const created = await prisma.user.upsert({
      where:  { email: u.email },
      create: { email: u.email, username: u.username, passwordHash: await hashPassword('Password123!') },
      update: {}
    })
    await prisma.profile.upsert({
      where:  { userId: created.id },
      create: { userId: created.id, displayName: u.displayName, level: u.level, totalXP: u.totalXP, coins: u.coins },
      update: {}
    })
    await prisma.streak.upsert({
      where:  { userId: created.id },
      create: { userId: created.id, current: 14, longest: 21, multiplier: 3.0 },
      update: {}
    })
  }

  console.log('✅ Seed complete')
}

seed().catch(e => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())

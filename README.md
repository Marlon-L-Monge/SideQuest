<<<<<<< HEAD
# SideQuest — Level Up IRL

A gamified real-world adventure platform that turns movement, focus, and friendship into a game.

## 🚀 Live Demo

**[Open SideQuest →](https://YOUR-USERNAME.github.io/sidequest)**

## 📁 What's In This Repo

| File | Description |
|------|-------------|
| `index.html` | The complete frontend — all pages, styles, and logic in one file |
| `backend-services.ts` | Full Next.js API routes + service layer (XP, streaks, quests, auth) |
| `schema.prisma` | PostgreSQL database schema (Prisma ORM) |
| `quests.ts` | Curated places & quest data (40+ Bay Area locations) |
| `useUserQuests.ts` | React hook for user-submitted place/quest management |

## ✨ Features

- **Quest System** — Daily Quests, Boss Battles, Bounties, Expeditions
- **Discover Mode** — 40+ real Bay Area places filtered by mood, category, energy
- **Place Check-ins** — Earn XP for visiting real locations
- **AI Quest Generator** — Describe your mood, get a custom mission (Claude API)
- **Streak Shield** — Protect your streak with earned shields
- **Seasonal Events** — "The Spring Awakening" and future lore drops
- **Tournaments & Arena** — Live leaderboards, XP races, step challenges
- **Guilds** — Squad goals, weekly XP, member rankings
- **Rewards Shop** — Badges, titles, cosmetics, streak shields
- **Submit a Place** — Community-driven location submissions (localStorage)

## 🛠️ Running Locally

Just open `index.html` in any browser — no server needed.

```bash
# Option 1: Open directly
open index.html

# Option 2: Serve locally (recommended for AI features)
npx serve .
# or
python3 -m http.server 8080
```

## 🔑 AI Quest Generator

The AI Quest Generator on the Create Quest page calls the Anthropic Claude API. It works out of the box on claude.ai. To use it on your own deployment, you'll need to proxy the API call through your own backend with your API key.

## 🗄️ Full Stack (Coming Next)

The `backend-services.ts` and `schema.prisma` files contain the full production backend:

```bash
# Install dependencies
npm install prisma @prisma/client bcryptjs jsonwebtoken zod

# Set up database
npx prisma db push
npx ts-node prisma/seed.ts

# Run dev server (Next.js)
npm run dev
```

## 📊 Tech Stack

- **Frontend**: Vanilla HTML/CSS/JS (prototype) → Next.js 14 (production)
- **Backend**: Next.js API Routes + TypeScript
- **Database**: PostgreSQL + Prisma ORM
- **Auth**: JWT (bcrypt password hashing)
- **Fonts**: Righteous, Nunito, Space Mono (Google Fonts)
- **Images**: Unsplash

## 📄 License

MIT — build on it, ship it, level up.
=======
# SideQuest
A gamified real-world adventure platform — Level Up IRL
>>>>>>> 069394d02275104371b9cee9be4df89d408253da

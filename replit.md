# BuildCustom.Ai

## Overview

BuildCustom.Ai is a landing page and waitlist platform for an AI-powered "vibe coding" tool that lets users build websites, apps, software, games, and SaaS products through natural language. The application consists of a marketing landing page with waitlist signup functionality, an admin dashboard for managing waitlist entries, and a simple authentication system for admin access.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend

- **Framework**: React 18 with TypeScript
- **Routing**: Wouter (lightweight alternative to React Router)
- **Styling**: Tailwind CSS v4 with CSS variables for theming, dark mode by default (near-black `#05050a` background)
- **UI Components**: shadcn/ui (new-york style) built on Radix UI primitives
- **Animations**: Framer Motion for scroll-triggered animations and transitions
- **State Management**: TanStack React Query for server state; local React state for UI
- **Build Tool**: Vite with path aliases (`@/` → `client/src/`, `@shared/` → `shared/`, `@assets/` → `attached_assets/`)

### Pages

- `/` — Marketing landing page with hero, features, showcase, pricing, community sections, and waitlist modal
- `/login` — Admin login page
- `/admin` — Admin dashboard showing waitlist entries (protected by localStorage auth check)

### Backend

- **Runtime**: Node.js with Express 5
- **Language**: TypeScript, executed via `tsx`
- **API Pattern**: RESTful JSON API under `/api/` prefix
- **Development**: Vite dev server middleware is injected into Express for HMR during development
- **Production**: Client is built with Vite, server is bundled with esbuild into `dist/index.cjs`, static files served from `dist/public/`

### API Routes

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/waitlist` | Submit a waitlist entry (name, email, source) |
| POST | `/api/admin/login` | Admin login (checks against env vars or defaults) |
| GET | `/api/admin/waitlist` | Get all waitlist entries |
| DELETE | `/api/admin/waitlist/:id` | Delete a waitlist entry |

### Authentication

- Admin login is a simple credential check against `ADMIN_USERNAME` and `ADMIN_PASSWORD` environment variables (defaults to `admin`/`Stayclassy99`)
- No session management on the server — the client stores auth state in `localStorage`
- Admin routes are **not** protected server-side with middleware; the admin page checks localStorage client-side only

### Database

- **Database**: PostgreSQL (required — `DATABASE_URL` environment variable must be set)
- **ORM**: Drizzle ORM with `drizzle-zod` for schema validation
- **Schema Location**: `shared/schema.ts` (shared between client and server)
- **Migrations**: Drizzle Kit with `drizzle-kit push` command (no migration files approach)
- **Connection**: `pg` Pool via `server/db.ts`

### Database Schema

**users** table:
- `id` — varchar, primary key, auto-generated UUID
- `username` — text, unique, not null
- `password` — text, not null

**waitlist_entries** table:
- `id` — serial, primary key
- `name` — text, not null
- `email` — text, not null
- `source` — text, not null, default "waitlist"
- `status` — text, not null, default "Pending"
- `created_at` — timestamp, default now

### Storage Layer

- `server/storage.ts` defines an `IStorage` interface and a `DatabaseStorage` implementation
- Single exported `storage` instance used by routes

### Build Process

- `npm run dev` — Starts the development server with Vite HMR middleware
- `npm run build` — Builds client with Vite and server with esbuild (bundles key deps, externalizes the rest)
- `npm run start` — Runs the production bundle from `dist/index.cjs`
- `npm run db:push` — Pushes schema changes to the database

## External Dependencies

- **PostgreSQL** — Primary data store, connected via `DATABASE_URL` environment variable
- **Google Fonts** — Inter, Outfit, Plus Jakarta Sans, Space Grotesk font families loaded via CDN
- **Replit Plugins** — `@replit/vite-plugin-runtime-error-modal`, `@replit/vite-plugin-cartographer`, `@replit/vite-plugin-dev-banner` (dev-only Replit integrations)
- **External Logo Images** — Wikipedia SVGs for Anthropic, Google, OpenAI, Cloudflare logos in the logos section
- No third-party auth providers, payment processors, or external APIs are currently integrated (Stripe, OpenAI, etc. are listed in build allowlist but not actively used in routes)
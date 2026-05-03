# BuildCustom.Ai

## Overview

BuildCustom.Ai is an AI-powered "vibe coding" platform where users build websites, apps, software, games, and SaaS products through natural language. The application consists of a marketing landing page with waitlist signup, an admin dashboard for managing waitlist entries, a user-facing app dashboard with project management, project detail pages, and CMS/SEO tools.

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

- `/` — Marketing landing page with hero (LOCKED), features, showcase, pricing, community sections, and waitlist modal
- `/login` — Admin login page
- `/admin` — Admin dashboard showing waitlist entries (protected by localStorage auth check)
- `/app/login` — App user login page (AppAuth component)
- `/app/signup` — App user signup page (AppAuth component, same page, mode toggled by URL)
- `/app` — User-facing app dashboard (Projects grid, requires auth — redirects to /app/login if not logged in)
- `/app/templates` — Template gallery (15 real open-source templates, loaded from DB, forked to thegoldimport GitHub, "Use Template" creates a real project pre-filled with template metadata)
- `/app/editor` — AI Builder interface (chat + responsive preview)
- `/app/project/:id` — Project detail dashboard with universal tabs (Overview, Files, Console, Version History, Settings) plus website-only tabs (Pages, Blog, Auto-Blogger, SEO, Analytics, Domain)
- `/app/users` — (Super Admin) User management table
- `/app/analytics` — (Super Admin) Platform metrics
- `/app/billing` — (Super Admin) Revenue and subscriptions
- `/app/support` — (Super Admin) Ticket management
- `/app/deployments` — (Super Admin) Live deployment monitoring
- `/app/settings` — Account, plan, appearance, API keys, security

### Backend

- **Runtime**: Node.js with Express 5
- **Language**: TypeScript, executed via `tsx`
- **API Pattern**: RESTful JSON API under `/api/` prefix
- **Auth**: bcryptjs password hashing; userId stored in localStorage as `bc_app_user` JSON; sent as `x-user-id` header on all API requests
- **Development**: Vite dev server middleware injected into Express for HMR
- **Production**: Client built with Vite, server bundled with esbuild into `dist/index.cjs`

### API Routes

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/auth/register` | Register new app user (name, email, password) |
| POST | `/api/auth/login` | Login app user (email, password) |
| GET | `/api/auth/me` | Get current user (x-user-id header) |
| POST | `/api/admin/login` | Admin login (env var credentials) |
| GET | `/api/admin/waitlist` | Get all waitlist entries |
| POST | `/api/waitlist` | Submit a waitlist entry |
| DELETE | `/api/admin/waitlist/:id` | Delete a waitlist entry |
| PATCH | `/api/admin/waitlist/:id/status` | Update waitlist entry status |
| GET | `/api/projects` | Get user's projects |
| POST | `/api/projects` | Create a project |
| GET | `/api/projects/:id` | Get a specific project |
| PUT | `/api/projects/:id` | Update a project |
| DELETE | `/api/projects/:id` | Delete a project |
| GET | `/api/projects/:id/blog-posts` | Get blog posts for a project |
| POST | `/api/projects/:id/blog-posts` | Create a blog post |
| PUT | `/api/projects/:id/blog-posts/:postId` | Update a blog post |
| DELETE | `/api/projects/:id/blog-posts/:postId` | Delete a blog post |
| GET | `/api/projects/:id/autoblogger` | Get autoblogger settings |
| PUT | `/api/projects/:id/autoblogger` | Upsert autoblogger settings |
| GET | `/api/projects/:id/seo` | Get SEO settings |
| PUT | `/api/projects/:id/seo` | Upsert SEO settings |
| GET | `/api/templates` | Get all templates (auto-seeds on first call) |
| GET | `/api/templates/:slug` | Get a specific template by slug |
| GET | `/api/projects/:id/pages` | Get site pages |
| POST | `/api/projects/:id/pages` | Create a site page |
| PUT | `/api/projects/:id/pages/:pageId` | Update a site page |
| DELETE | `/api/projects/:id/pages/:pageId` | Delete a site page |

### Authentication

- **App users**: Register/login via `/api/auth/register` and `/api/auth/login`; passwords hashed with bcryptjs; user object stored in localStorage as `bc_app_user`; `x-user-id` header sent with every protected API request
- **Admin**: Simple credential check against `ADMIN_USERNAME`/`ADMIN_PASSWORD` env vars (defaults: `admin`/`Stayclassy99`); no session management
- **Auth redirect**: AppDashboard checks localStorage on mount; redirects to `/app/login` if no user found

### Database

- **Database**: PostgreSQL (required — `DATABASE_URL` environment variable must be set)
- **ORM**: Drizzle ORM with `drizzle-zod` for schema validation
- **Schema Location**: `shared/schema.ts` (shared between client and server)
- **Migrations**: Drizzle Kit with `drizzle-kit push` command
- **Connection**: `pg` Pool via `server/db.ts`

### Database Schema

**users** table:
- `id` — varchar, primary key, auto-generated UUID
- `username` — text, unique, not null
- `password` — text, not null (bcrypt hashed)
- `email` — text, unique, not null
- `plan` — text, default "starter"
- `created_at` — timestamp, default now

**waitlist_entries** table:
- `id` — serial, primary key
- `name`, `email`, `source`, `status`, `created_at`

**projects** table:
- `id` — serial, primary key
- `user_id` — varchar FK to users
- `name`, `type` (website/app/game/saas), `status` (draft/live/building), `description`, `framework`, `url`, `created_at`, `updated_at`

**blog_posts** table:
- `id` — serial, primary key
- `project_id` — FK to projects
- `title`, `slug`, `content`, `status`, `keyword`, `word_count`, `scheduled_at`, `published_at`, `created_at`

**autoblogger_settings** table:
- `id` — serial, unique per project
- `project_id` — unique FK to projects
- `enabled`, `posts_per_day`, `writing_style`, `min_word_count`, `keywords`, `updated_at`

**seo_settings** table:
- `id` — serial, unique per project
- `project_id` — unique FK to projects
- `meta_title`, `meta_description`, `focus_keyword`, `schema_json`, `updated_at`

**site_pages** table:
- `id` — serial, primary key
- `project_id` — FK to projects
- `title`, `slug`, `status`, `page_type`, `content`, `created_at`

**templates** table:
- `id` — serial, primary key
- `name`, `slug` (unique), `category`, `description`, `framework`, `project_type`
- `tags` — text array
- `color` — Tailwind gradient class string
- `github_url` — original upstream repo URL
- `fork_url` — forked repo under thegoldimport GitHub account
- `featured` — boolean
- `stars` — integer (approximate star count)

### Storage Layer

- `server/storage.ts` defines `IStorage` interface and `DatabaseStorage` implementation
- Full CRUD for all tables
- Single exported `storage` instance used by routes

### Key Files

- `shared/schema.ts` — Drizzle schema + Zod types for all tables
- `server/storage.ts` — DatabaseStorage class with all CRUD operations
- `server/routes.ts` — All API routes (auth, waitlist, projects, blog, autoblogger, seo, pages)
- `client/src/pages/app-auth.tsx` — Login/Signup page + auth helpers (getAppUser, setAppUser, clearAppUser, authHeaders)
- `client/src/pages/app-dashboard.tsx` — Main app shell with sidebar, all sub-pages, real project data via React Query
- `client/src/pages/project-detail.tsx` — Project detail page with all tabs
- `client/src/App.tsx` — Route definitions

### Build Process

- `npm run dev` — Development server with Vite HMR
- `npm run build` — Build client + server
- `npm run start` — Run production bundle
- `npm run db:push` — Push schema changes to database

## External Dependencies

- **PostgreSQL** — Primary data store via `DATABASE_URL`
- **bcryptjs** — Password hashing for app users
- **Google Fonts** — Inter, Outfit, Plus Jakarta Sans, Space Grotesk via CDN
- **Replit Plugins** — Vite dev/error plugins (dev-only)

## Brand

- **Gradient**: `#00c9b7` (teal) → `#22d3ee` (cyan) → `#6366f1` (indigo) → `#a855f7` (purple) → `#ec4899` (pink)
- **Background**: near-black `#060610` (dark mode default)
- **Logos**: `client/src/assets/cube-logo.png` (icon), `client/src/assets/logo.png` (full)
- **Hero section is LOCKED** — no changes unless explicitly requested

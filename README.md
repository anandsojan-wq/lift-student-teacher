# LIFT Educations Portal

White-label EdTech MVP with Owner, Admin, Teacher, and Student portals.

## Current Product State

This version is cleaned and simplified for stability and usability:

- Logo rendering removed from portal UI for a cleaner layout.
- Student `Insights` removed from UI and backend student routes.
- Student planner is now a personal To-Do style planner (local browser persistence).
- Teacher message flow simplified (subject filter + student dropdown + text message).
- Teacher class planning flow added and connected to student class view.
- Objective test creation improved with predefined question boxes.
- Notification "mark read" behavior now removes notifications.
- One-click QA check button available inside Admin, Teacher, and Student dashboards.
- Faster tab switching and parallel teacher data loading for snappier response.

## Role Flows

### Owner (`/owner.html`)

- Secure owner login
- Create institutions
- Manage institution plans, limits, and subscription status
- Reset institution admin password
- View owner-level analytics

### Admin

- Create/delete teacher accounts
- View/filter students
- Message teachers and students
- View institution summary
- Account password change

### Teacher

- Create/update/delete subjects (syllabus PDF required)
- Create/delete students
- Upload/delete resources
- Conduct tests:
  - MCQ (20 questions, 5 minutes)
  - True/False (20 questions, 5 minutes)
  - Long/Short answer tests
- Message students
- Class planner:
  - Plan daily classes
  - Attach optional resource while creating class

### Student

- View dashboard, today tests, pending tests, today classes
- Attempt tests with timer (objective types) and submit in-app
- View test history and download answer keys for objective tests
- View resources and syllabus
- Message teachers
- Use personal study To-Do planner
- Focus mode toggle
- Account password change

## Resource Delivery Rules (Important)

Resource visibility is now strictly scoped so content reaches the concerned students only:

- Students only get resources for their assigned subjects.
- Students only get resources from their assigned teacher profile.
- Class planner resources are created as standard resources and therefore appear in student resources as well.
- Student "Today Classes" is filtered by assigned subjects and assigned teacher.

## Project Structure

```text
/Users/anandsojan/Documents/Codex-Student-Teacher-Dashboard
├── public/                 # Frontend pages and portal scripts
├── backend/src/            # Express API, models, controllers, services
├── api/                    # Vercel serverless API bridge
├── server.js               # Local static frontend server
├── vercel.json             # Vercel routes/config
└── README.md
```

## Local Run

From project root:

```bash
npm run backend:install
npm run portal
```

Open:

- Main portal: `http://127.0.0.1:3000`
- Owner portal: `http://127.0.0.1:3000/owner.html`
- API health: `http://127.0.0.1:5050/api/health`

Quick QA from UI:

- Login as Admin/Teacher/Student.
- Click `Run QA Check` in the top-right.
- You will get a pass/fail card for core APIs of that role.

## Seed Owner Account

```bash
cd backend
npm run seed:super-admin
```

Credentials come from `backend/.env`:

- `SUPER_ADMIN_INSTITUTION_ID`
- `SUPER_ADMIN_USERNAME`
- `SUPER_ADMIN_PASSWORD`

## Deploy (Vercel)

Project is configured for Vercel with API routed through `/api/*`.

Required env vars (minimum):

- `MONGODB_URI`
- `JWT_SECRET`
- `CORS_ORIGIN`
- `SUPER_ADMIN_INSTITUTION_ID`
- `SUPER_ADMIN_USERNAME`
- `SUPER_ADMIN_PASSWORD`

Optional upload/storage vars:

- `STORAGE_PROVIDER=inline|s3|cloudinary`
- Cloudinary or S3 variables depending on provider

## Install As App (PWA)

The portal now supports installable PWA mode:

- Manifest: `/manifest.webmanifest`
- Service worker: `/sw.js`
- App icons: `/public/icons/`

Install flow:

1. Open the live URL in Chrome/Edge (Android/Desktop) or Safari (iPhone).
2. Sign in once and allow assets to cache.
3. Install:
   - Chrome/Edge: use the "Install app" prompt.
   - Safari iPhone: Share -> Add to Home Screen.

## Cleanup Done in This Version

- Removed redundant API catch-all file: `api/[...path].js`
- Removed unused logo asset from runtime flow
- Reduced dead student feature surface (insights/planner-cards/doubt routes removed)
- Simplified student-plus controller to only used endpoints
- Removed unused helper logic from frontend
- Updated service worker strategy so API calls are never cached (prevents stale dashboard data)

## Next Recommended Step

Move to backend hardening and production readiness:

1. Add request-level validation tests for critical routes.
2. Add role-based integration tests (Owner/Admin/Teacher/Student).
3. Add DB indexes review for scaling.
4. Lock secrets and rotate all credentials before production rollout.

## SaaS Readiness (Implemented)

- API request IDs + structured error metadata
- Rate limiting for global traffic, login attempts, and write-heavy requests
- Secure cookie-based login sessions with server-side logout
- Subscription enforcement middleware (inactive/cancelled/expired institutions are blocked)
- Readiness probe endpoint: `GET /api/ready`
- PWA install support + branded app icons
- Vercel edge security headers for production responses

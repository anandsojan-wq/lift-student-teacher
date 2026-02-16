# LIFT Educations Portal

Working MVP for:
- `super_admin` (owner)
- `admin` (institution)
- `teacher`
- `student`

## What is already working

- Real authentication with MongoDB (`/api/auth/login`)
- First-time student password setup (`/api/auth/set-password-first-time`)
- Account password change (`/api/auth/change-password`)
- Owner flow:
  - login via hidden page
  - create institutions
  - auto-generate institution ID and admin credentials
- Admin flow:
  - create teacher accounts
  - list teachers/students
- Teacher flow:
  - create/delete subjects
  - create/delete students
  - CSV export + email/WhatsApp share links in UI
- Student flow:
  - login, dashboard, history view, account password change

## Project structure

- `/public/index.html` -> main portal UI
- `/public/live.js` -> frontend app (API connected)
- `/public/owner.html` -> hidden owner panel (not linked publicly)
- `/backend` -> Express + MongoDB API source
- `/api/index.js` -> Vercel serverless bridge for backend
- `/vercel.json` -> Vercel routing/install config

## Local run

```bash
cd /Users/anandsojan/Documents/Codex-Student-Teacher-Dashboard
npm run backend:install
npm run portal
```

Open:
- Main portal: `http://127.0.0.1:3000`
- Owner panel: `http://127.0.0.1:3000/owner.html`
- API health: `http://127.0.0.1:5050/api/health`

Note: if a port is busy, startup auto-falls to next free port.

## Owner account setup (run once)

```bash
cd /Users/anandsojan/Documents/Codex-Student-Teacher-Dashboard/backend
npm run seed:super-admin
```

Default values come from `/backend/.env`:
- `SUPER_ADMIN_INSTITUTION_ID`
- `SUPER_ADMIN_USERNAME`
- `SUPER_ADMIN_PASSWORD`

## Deploy to GitHub + Vercel

1. Push this folder to a GitHub repo.
2. In Vercel, import the repo.
3. Keep project root as repository root.
4. Add environment variables in Vercel Project Settings:
   - `NODE_ENV=production`
   - `HOST=127.0.0.1`
   - `PORT=5050`
   - `MAX_PORT_HOPS=20`
   - `MONGODB_URI=<your atlas uri>`
   - `MONGO_RETRY_MS=5000`
   - `MONGO_CONNECT_TIMEOUT_MS=10000`
   - `JWT_SECRET=<strong random secret>`
   - `JWT_EXPIRES_IN=7d`
   - `CORS_ORIGIN=https://<your-vercel-domain>`
   - `SUPER_ADMIN_INSTITUTION_ID=LIFT-HQ-0000`
   - `SUPER_ADMIN_USERNAME=owner`
   - `SUPER_ADMIN_PASSWORD=<strong owner password>`
5. Deploy.
6. Open:
   - `https://<your-vercel-domain>/`
   - `https://<your-vercel-domain>/owner.html`

## Security before going live

- Rotate MongoDB password (the current shared one should not be reused).
- Use long random `JWT_SECRET`.
- Restrict MongoDB network access.
- Keep owner credentials private.

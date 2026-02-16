# LIFT Educations Portal

Production-style MVP with real backend APIs and role-based flows.

## Roles

- `super_admin` (owner)
- `admin` (institution)
- `teacher`
- `student`

## Working Features

- Real login for admin/teacher/student
- First-time student password setup
- Password change in Accounts for all roles
- Hidden Owner panel (`/owner.html`) to create institutions
- Auto-generated institution IDs (`LIFT-<CITY>-<4 digits>`)
- Admin can create teachers, filter/search students, and message anyone
- Teacher can:
  - create/delete subjects (with syllabus PDF URL)
  - create/delete students
  - upload/delete resources (PDF/eBook/video/link URL)
  - create tests (MCQ/Long)
  - message students
  - export student CSV
- Student can:
  - view today/pending tests
  - attempt tests in-app with timer
  - view score history
  - download answer key (MCQ)
  - view resources with intelligent search/filter
  - view syllabus list and open PDF
  - message teacher
- Notification pipelines for resource upload, test publish, messages, and test submission

## Local Run

```bash
cd /Users/anandsojan/Documents/Codex-Student-Teacher-Dashboard
npm run backend:install
npm run portal
```

Open:
- Main portal: `http://127.0.0.1:3000`
- Owner panel (hidden): `http://127.0.0.1:3000/owner.html`
- API health: `http://127.0.0.1:5050/api/health`

Note: if a port is busy, startup auto-falls to the next free port.

## Seed Owner Account (run once)

```bash
cd /Users/anandsojan/Documents/Codex-Student-Teacher-Dashboard/backend
npm run seed:super-admin
```

Owner credentials come from `/backend/.env`:
- `SUPER_ADMIN_INSTITUTION_ID`
- `SUPER_ADMIN_USERNAME`
- `SUPER_ADMIN_PASSWORD`

## GitHub + Vercel Deployment

1. Push repo to GitHub.
2. Import repo in Vercel.
3. Add environment variables in Vercel:
   - `NODE_ENV=production`
   - `HOST=127.0.0.1`
   - `PORT=5050`
   - `MAX_PORT_HOPS=20`
   - `MONGODB_URI=<atlas-uri>`
   - `MONGO_RETRY_MS=5000`
   - `MONGO_CONNECT_TIMEOUT_MS=10000`
   - `JWT_SECRET=<strong-random-secret>`
   - `JWT_EXPIRES_IN=7d`
   - `CORS_ORIGIN=https://<your-vercel-domain>`
   - `SUPER_ADMIN_INSTITUTION_ID=LIFT-HQ-0000`
   - `SUPER_ADMIN_USERNAME=owner`
   - `SUPER_ADMIN_PASSWORD=<strong-owner-password>`
4. Deploy.
5. Open:
   - `https://<your-domain>/`
   - `https://<your-domain>/owner.html`

## Security Before Launch

- Rotate MongoDB password immediately.
- Use a strong `JWT_SECRET`.
- Restrict MongoDB network access.
- Keep owner credentials private.

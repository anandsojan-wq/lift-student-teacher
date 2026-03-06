# Backend API (LIFT)

Express + MongoDB backend for the portal.

## Run

```bash
npm install
npm run dev
npm run seed:super-admin
```

## Snapshot Backup (Per Institution)

Create a JSON backup snapshot:

```bash
npm run backup:institution -- LIFT-DEMO-1001
```

Optional output file path:

```bash
npm run backup:institution -- LIFT-DEMO-1001 ./backups/demo.json
```

## Health

- `GET /api/health`
- `GET /api/ready` (returns `503` if DB is not connected)

## SaaS Hardening Included

- Request IDs on every API response (`x-request-id` header + `requestId` field)
- Global, auth, and write rate limiting
- CORS allowlist + Vercel/local origin support
- Institution access guard:
  - blocks cancelled, inactive, or expired subscriptions
  - applies to login and all protected routes (except super admin)
- Graceful shutdown handling (`SIGINT`, `SIGTERM`)

## Key Production Env Vars

- `JWT_SECRET` (must be strong)
- `CORS_ORIGIN`
- `ENFORCE_INSTITUTION_ACCESS=true`
- `RATE_LIMIT_WINDOW_MS=900000`
- `RATE_LIMIT_MAX=400`
- `AUTH_RATE_LIMIT_MAX=25`
- `WRITE_RATE_LIMIT_MAX=180`

## Auth

- `POST /api/auth/login`
- `GET /api/auth/me`
- `POST /api/auth/change-password`

## Super Admin

- `GET /api/super-admin/institutions`
- `POST /api/super-admin/institutions`
- `DELETE /api/super-admin/institutions/purge-cancelled`

## Admin

- `GET /api/admin/summary`
- `GET /api/admin/subjects`
- `GET /api/admin/teachers`
- `POST /api/admin/teachers`
- `POST /api/admin/teachers/:teacherId/reset-password`
- `DELETE /api/admin/teachers/:teacherId`
- `GET /api/admin/students`
- `GET /api/admin/users`
- `GET /api/admin/messages?userId=<id>`
- `POST /api/admin/messages`
- `GET /api/admin/notifications`
- `POST /api/admin/notifications/read`

## Teacher

- `GET /api/teacher/subjects`
- `POST /api/teacher/subjects`
- `DELETE /api/teacher/subjects/:subjectId`
- `GET /api/teacher/students`
- `POST /api/teacher/students`
- `DELETE /api/teacher/students/:studentId`
- `GET /api/teacher/resources`
- `POST /api/teacher/resources`
- `DELETE /api/teacher/resources/:resourceId`
- `GET /api/teacher/tests`
- `POST /api/teacher/tests`
- `GET /api/teacher/messages?studentId=<id>`
- `POST /api/teacher/messages`
- `GET /api/teacher/notifications`
- `POST /api/teacher/notifications/read`

## Student

- `GET /api/student/dashboard`
- `GET /api/student/tests/queue`
- `POST /api/student/tests/:testId/attempt`
- `GET /api/student/tests/history`
- `GET /api/student/tests/attempts/:attemptId/answer-key`
- `GET /api/student/resources`
- `GET /api/student/syllabus`
- `GET /api/student/teachers`
- `GET /api/student/messages?teacherId=<id>`
- `POST /api/student/messages`
- `GET /api/student/notifications`
- `POST /api/student/notifications/read`

# Backend API (LIFT)

Express + MongoDB backend for the portal.

## Run

```bash
npm install
npm run dev
npm run seed:super-admin
```

## Health

- `GET /api/health`

## Auth

- `POST /api/auth/login`
- `GET /api/auth/me`
- `POST /api/auth/set-password-first-time`
- `POST /api/auth/change-password`

## Super Admin

- `GET /api/super-admin/institutions`
- `POST /api/super-admin/institutions`

## Admin

- `GET /api/admin/summary`
- `GET /api/admin/subjects`
- `GET /api/admin/teachers`
- `POST /api/admin/teachers`
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

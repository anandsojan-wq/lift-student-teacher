# Backend API (LIFT)

Express + MongoDB backend used by the portal.

## Scripts

```bash
npm install
npm run dev
npm run seed:super-admin
```

## Core endpoints

### Auth
- `POST /api/auth/login`
- `GET /api/auth/me`
- `POST /api/auth/set-password-first-time`
- `POST /api/auth/change-password`

### Super Admin
- `GET /api/super-admin/institutions`
- `POST /api/super-admin/institutions`

### Admin
- `GET /api/admin/summary`
- `GET /api/admin/teachers`
- `POST /api/admin/teachers`
- `GET /api/admin/students`

### Teacher
- `GET /api/teacher/subjects`
- `POST /api/teacher/subjects`
- `DELETE /api/teacher/subjects/:subjectId`
- `GET /api/teacher/students`
- `POST /api/teacher/students`
- `DELETE /api/teacher/students/:studentId`

### Student
- `GET /api/student/dashboard`
- `GET /api/student/tests/history`

## Health
- `GET /api/health`

Returns uptime and DB status.

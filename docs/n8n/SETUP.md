# LIFT Onboarding Automation (n8n)

This gives you automatic onboarding messages when:
- a new institution is created
- a new teacher is created
- a new student is created

## 1) Import the n8n workflow

1. Open n8n.
2. Go to **Workflows -> Import from File**.
3. Import:
   - `/Users/anandsojan/Documents/Codex-Student-Teacher-Dashboard/docs/n8n/LIFT-onboarding-template.json`

## 2) Configure credentials in n8n

### SMTP (for email)
- Create SMTP credentials in n8n.
- In the node **Send Email**, attach your SMTP credential.
- Set environment variable in n8n:
  - `SMTP_FROM_EMAIL=your-email@domain.com`

### WhatsApp
Use your WhatsApp provider API endpoint.
Set environment variables in n8n:
- `WHATSAPP_API_URL=https://your-provider-endpoint`
- `WHATSAPP_AUTH_HEADER=Bearer <token-or-api-key>`

## 3) Optional security key

Set in n8n:
- `LIFT_AUTOMATION_SECRET=<your-secret>`

Then set same secret in your backend/Vercel:
- `AUTOMATION_WEBHOOK_SECRET=<your-secret>`

## 4) Copy webhook URL from n8n

After workflow import, open **Webhook** node and copy Production URL.
It will look like:
- `https://<your-n8n-domain>/webhook/lift-onboarding`

## 5) Set backend environment variables

In Vercel project env:
- `AUTOMATION_ENABLED=true`
- `AUTOMATION_WEBHOOK_URL=<your-n8n-webhook-url>`
- `AUTOMATION_WEBHOOK_SECRET=<same-secret-as-n8n>`

Redeploy after saving env vars.

## 6) Verify it works

1. Create a new institution in owner panel.
2. Go to owner API logs endpoint:
   - `/api/super-admin/automations/logs`
3. Status should change from `skipped` to `sent`.

If it shows `failed`, open the log entry to see response status/message.

## Expected webhook payload from LIFT

```json
{
  "eventType": "onboarding.new_teacher",
  "emittedAt": "2026-02-16T11:00:00.000Z",
  "payload": {
    "teacher": {
      "id": "...",
      "fullName": "...",
      "username": "...",
      "email": "...",
      "phone": "...",
      "temporaryPassword": "..."
    }
  }
}
```

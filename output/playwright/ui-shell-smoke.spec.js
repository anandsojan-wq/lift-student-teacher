const { test, expect } = require('@playwright/test');

const APP_URL = 'http://127.0.0.1:3000';
const INSTITUTION_ID = 'LIFT-DEMO-1001';
const ADMIN_USERNAME = 'admindemo';
const ADMIN_PASSWORD = 'Admin@12345';
const TEACHER_USERNAME = 'teachdemo';
const TEACHER_PASSWORD = 'Teacher@12345';
const STUDENT_USERNAME = 'studemo';
const STUDENT_PASSWORD = 'Student@12345';

async function login(page, roleButtonName, username, password) {
  await page.goto(APP_URL, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: roleButtonName }).click();
  await page.getByRole('textbox', { name: 'Institution ID' }).fill(INSTITUTION_ID);
  await page.getByRole('textbox', { name: 'Username' }).fill(username);
  await page.getByRole('textbox', { name: 'Password' }).fill(password);
  await page.getByRole('button', { name: 'Sign In' }).click();
}

test.describe('portal shell smoke', () => {
  test('admin dropdown buttons and in-app modals work without browser dialogs', async ({ page }) => {
    let nativeDialogSeen = false;
    page.on('dialog', async (dialog) => {
      nativeDialogSeen = true;
      await dialog.dismiss();
    });

    await login(page, "I'm an Admin", ADMIN_USERNAME, ADMIN_PASSWORD);
    await expect(page.getByText('Welcome, Demo Admin')).toBeVisible({ timeout: 30000 });

    await page.getByText('Teachers', { exact: true }).click();
    await expect(page.getByRole('button', { name: 'Edit Existing Teacher' })).toBeVisible();
    await page.getByRole('button', { name: 'Edit Existing Teacher' }).click();
    await expect(page.getByRole('heading', { name: 'Edit Existing Teacher' })).toBeVisible();
    await page.getByRole('button', { name: 'Edit' }).first().click();
    await expect(page.getByRole('dialog', { name: 'Edit Teacher' })).toBeVisible();
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByRole('dialog', { name: 'Edit Teacher' })).toHaveCount(0);

    await page.getByText('Teachers', { exact: true }).click();
    await page.getByRole('button', { name: 'Create New Password' }).click();
    await expect(page.getByRole('heading', { name: 'Create New Password for Teacher' })).toBeVisible();
    await page.getByRole('button', { name: 'Reset Temp' }).first().click();
    await expect(page.getByRole('dialog', { name: 'Reset Teacher Password' })).toBeVisible();
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByRole('dialog', { name: 'Reset Teacher Password' })).toHaveCount(0);

    await page.getByText('Courses', { exact: true }).click();
    await page.getByRole('button', { name: 'Edit Course' }).click();
    await expect(page.getByRole('heading', { name: 'Edit Course & Syllabus Manager' })).toBeVisible();
    await page.getByRole('button', { name: 'Edit Course' }).first().click();
    await expect(page.getByRole('dialog', { name: 'Edit Course' })).toBeVisible();
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByRole('dialog', { name: 'Edit Course' })).toHaveCount(0);

    await page.getByText('Courses', { exact: true }).click();
    await page.getByRole('button', { name: 'Delete Course' }).click();
    await expect(page.getByRole('heading', { name: 'Delete Course' })).toBeVisible();
    await page.getByRole('button', { name: 'Delete' }).first().click();
    await expect(page.getByRole('dialog', { name: 'Delete Course' })).toBeVisible();
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByRole('dialog', { name: 'Delete Course' })).toHaveCount(0);

    expect(nativeDialogSeen).toBeFalsy();
  });

  test('teacher shell buttons and in-app delete modals work without browser dialogs', async ({ page }) => {
    let nativeDialogSeen = false;
    page.on('dialog', async (dialog) => {
      nativeDialogSeen = true;
      await dialog.dismiss();
    });

    await login(page, "I'm a Teacher", TEACHER_USERNAME, TEACHER_PASSWORD);
    await expect(page.getByText('Welcome, Demo Teacher')).toBeVisible({ timeout: 30000 });
    await expect(page.locator('#runQaBtn')).toBeVisible();

    await page.getByText('Management', { exact: true }).click();
    await expect(page.locator('[data-teacher-tab="students"]:visible')).toBeVisible();
    await page.locator('[data-teacher-tab="students"]:visible').click();
    await expect(page.getByRole('heading', { name: 'Student Directory' })).toBeVisible();
    await page.getByRole('button', { name: 'Delete' }).first().click();
    await expect(page.getByRole('dialog', { name: 'Delete Student' })).toBeVisible();
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByRole('dialog', { name: 'Delete Student' })).toHaveCount(0);

    await page.getByRole('button', { name: 'Upload Resources' }).click();
    await expect(page.getByRole('heading', { name: 'Resource Library' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'View File' }).first()).toBeVisible();
    await page.getByRole('button', { name: 'View File' }).first().click();
    await expect(page.getByRole('dialog', { name: 'Teacher PDF Viewer' })).toBeVisible();
    await expect(page.getByText('Protected view mode enabled. Download is disabled in this interface.')).toBeVisible();
    await page.getByRole('button', { name: 'Close' }).click();
    await expect(page.getByRole('dialog', { name: 'Teacher PDF Viewer' })).toHaveCount(0);

    await page.getByRole('button', { name: 'Delete' }).first().click();
    await expect(page.getByRole('dialog', { name: 'Delete Resource' })).toBeVisible();
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByRole('dialog', { name: 'Delete Resource' })).toHaveCount(0);

    await page.getByText('Assessment', { exact: true }).click();
    await expect(page.locator('[data-teacher-tab="assessment_conduct"]:visible')).toBeVisible();
    await page.locator('[data-teacher-tab="assessment_conduct"]:visible').click();
    await expect(page.getByRole('heading', { name: 'Conduct Test' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Published Tests' })).toBeVisible();
    await page.getByRole('button', { name: 'Delete' }).last().click();
    await expect(page.getByRole('dialog', { name: 'Delete Test' })).toBeVisible();
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByRole('dialog', { name: 'Delete Test' })).toHaveCount(0);

    expect(nativeDialogSeen).toBeFalsy();
  });

  test('ended class plan no longer shows its resource to students', async ({ page }) => {
    const classTitle = `Ended Class ${Date.now()}`;
    const planId = await (async () => {
      await login(page, "I'm a Teacher", TEACHER_USERNAME, TEACHER_PASSWORD);
      await expect(page.getByText('Welcome, Demo Teacher')).toBeVisible({ timeout: 30000 });

      const result = await page.evaluate(async ({ title }) => {
        const subjectsRes = await fetch('http://127.0.0.1:5050/api/teacher/subjects', {
          credentials: 'include'
        });
        const subjectsPayload = await subjectsRes.json();
        const subjectId = subjectsPayload?.data?.subjects?.[0]?._id;
        if (!subjectId) throw new Error('No subject found for teacher.');

        const today = new Date();
        const pad = (value) => String(value).padStart(2, '0');
        const scheduledDate = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;

        const createRes = await fetch('http://127.0.0.1:5050/api/teacher/class-plans', {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            subjectId,
            title,
            description: 'Should hide after end time',
            scheduledDate,
            startTime: '00:01',
            endTime: '00:02',
            resource: {
              resourceType: 'link',
              title: 'Expired Resource',
              value: 'https://example.com/expired-resource',
              source: 'text',
              keywords: 'expired'
            }
          })
        });

        const createPayload = await createRes.json();
        if (!createRes.ok) {
          throw new Error(createPayload?.message || 'Failed to create class plan.');
        }

        return createPayload?.data?.plan?.id || '';
      }, { title: classTitle });

      await page.getByRole('button', { name: 'Sign Out' }).click();
      return result;
    })();

    expect(planId).toBeTruthy();

    await login(page, "I'm a Student", STUDENT_USERNAME, STUDENT_PASSWORD);
    await expect(page.locator('[data-student-tab="dashboard"]')).toBeVisible({ timeout: 30000 });
    await page.getByText('Learning', { exact: true }).click();
    await page.locator('[data-student-tab="classes"]:visible').click();
    await expect(page.getByRole('heading', { name: "Today's Classes" })).toBeVisible();

    const endedClass = page.locator('article.stack-item', { hasText: classTitle }).first();
    await expect(endedClass).toBeVisible();
    await expect(endedClass.getByText('Class resource is no longer available after the end time.')).toBeVisible();
    await expect(endedClass.getByRole('link', { name: 'Open Link' })).toHaveCount(0);
    await expect(endedClass.getByRole('button', { name: 'View File' })).toHaveCount(0);
  });

  test('student shell buttons and mobile nav render cleanly', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium' && browserName !== 'chrome', 'mobile viewport check tuned for chromium-based browsers');

    await page.setViewportSize({ width: 390, height: 844 });
    await login(page, "I'm a Student", STUDENT_USERNAME, STUDENT_PASSWORD);
    await expect(page.locator('[data-student-tab="dashboard"]')).toBeVisible({ timeout: 30000 });
    await expect(page.locator('.main-nav .left-nav')).toBeVisible();
    await expect(page.locator('#runQaBtn')).toBeVisible();

    await page.getByText('Learning', { exact: true }).click();
    await page.locator('[data-student-tab="resources"]:visible').click();
    await expect(page.getByRole('heading', { name: 'Resources' })).toBeVisible();

    await page.getByText('Tests', { exact: true }).click();
    await page.locator('[data-student-tab="history"]:visible').click();
    await expect(page.getByRole('heading', { name: 'Test History' })).toBeVisible();

    await page.locator('[data-student-tab="accounts"]').click();
    await expect(page.getByRole('heading', { name: 'Account Settings' })).toBeVisible();
  });
});

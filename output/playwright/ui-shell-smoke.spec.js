const { test, expect } = require('@playwright/test');

const APP_URL = process.env.PLAYWRIGHT_APP_URL || 'http://127.0.0.1:3000';
const API_URL = process.env.PLAYWRIGHT_API_URL || 'http://127.0.0.1:5050';
const INSTITUTION_ID = 'LIFT-DEMO-1001';
const ADMIN_USERNAME = 'admindemo';
const ADMIN_PASSWORD = 'Admin@12345';
const TEACHER_USERNAME = 'teachdemo';
const TEACHER_PASSWORD = 'Teacher@12345';
const STUDENT_USERNAME = 'studemo';
const STUDENT_PASSWORD = 'Student@12345';

async function login(page, roleButtonName, username, password) {
  await page.context().clearCookies();
  await page.goto(APP_URL, { waitUntil: 'networkidle' });
  await page.evaluate(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });
  await page.reload({ waitUntil: 'networkidle' });
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
    await expect(page.getByRole('heading', { name: /Welcome, Demo Admin/ })).toBeVisible({ timeout: 30000 });
    await expect(page.getByRole('heading', { name: 'What Needs Action Today' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Courses Needing Attention' })).toBeVisible();
    await expect(page.getByText('Active Teachers')).toBeVisible();
    await expect(page.getByText('Active Students')).toBeVisible();

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

    await page.getByRole('button', { name: 'Branding' }).click();
    await expect(page.getByRole('heading', { name: 'Institution Branding' })).toBeVisible();
    await expect(page.getByLabel('Institute Name')).toBeVisible();
    await expect(page.getByLabel('Accent Color')).toBeVisible();
    await expect(page.getByLabel('Footer Text')).toBeVisible();
    await expect(page.getByText('White-label Panel')).toBeVisible();

    expect(nativeDialogSeen).toBeFalsy();
  });

  test('teacher shell buttons and in-app delete modals work without browser dialogs', async ({ page }) => {
    let nativeDialogSeen = false;
    page.on('dialog', async (dialog) => {
      nativeDialogSeen = true;
      await dialog.dismiss();
    });

    await login(page, "I'm a Teacher", TEACHER_USERNAME, TEACHER_PASSWORD);
    await expect(page.getByRole('heading', { name: /Welcome, Demo Teacher/ })).toBeVisible({ timeout: 30000 });
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
    await expect(page.getByLabel('Collection')).toBeVisible();
    await expect(page.getByLabel('Status')).toBeVisible();
    await expect(page.getByRole('button', { name: 'View File' }).first()).toBeVisible();
    await page.getByRole('button', { name: 'View File' }).first().click();
    await expect(page.getByRole('dialog', { name: 'Teacher PDF Viewer' })).toBeVisible();
    await expect(page.getByText('Protected view mode enabled. Download is disabled in this interface.')).toBeVisible();
    await page.getByRole('button', { name: 'Close' }).click();
    await expect(page.getByRole('dialog', { name: 'Teacher PDF Viewer' })).toHaveCount(0);

    await page.getByRole('button', { name: 'Move to Trash' }).first().click();
    await expect(page.getByText('Resource moved to trash.')).toBeVisible();
    await page.getByLabel('Status').selectOption('trashed');
    await page.getByRole('button', { name: 'Delete Forever' }).first().click();
    await expect(page.getByRole('dialog', { name: 'Delete Resource Forever' })).toBeVisible();
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByRole('dialog', { name: 'Delete Resource Forever' })).toHaveCount(0);

    await page.getByText('Assessment', { exact: true }).click();
    await expect(page.locator('[data-teacher-tab="assessment_conduct"]:visible')).toBeVisible();
    await page.locator('[data-teacher-tab="assessment_conduct"]:visible').click();
    await expect(page.getByRole('heading', { name: 'Conduct Test' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Published Tests' })).toBeVisible();
    expect(nativeDialogSeen).toBeFalsy();
  });

  test('teacher MCQ question count updates without losing typed form state', async ({ page }) => {
    await login(page, "I'm a Teacher", TEACHER_USERNAME, TEACHER_PASSWORD);
    await expect(page.getByRole('heading', { name: /Welcome, Demo Teacher/ })).toBeVisible({ timeout: 30000 });

    await page.getByText('Assessment', { exact: true }).click();
    await page.locator('[data-teacher-tab="assessment_conduct"]:visible').click();
    await expect(page.getByRole('heading', { name: 'Conduct Test' })).toBeVisible();

    const firstSubjectValue = await page.locator('#testSubjectId option:not([value=""])').first().getAttribute('value');
    expect(firstSubjectValue).toBeTruthy();

    await page.selectOption('#testSubjectId', firstSubjectValue);
    await page.fill('#testTitle', 'Playwright MCQ Stability');
    await page.fill('#testDuration', '73');
    await expect(page.locator('#testDurationHint')).toHaveText('Selected duration: 73 minutes');
    await page.selectOption('#mcqQuestionCount', '2');
    await page.fill('#objective-q-0', 'What is MS Word used for?');
    await page.fill('#objective-q-0-opt-0', 'Word processing');
    await page.fill('#objective-q-0-opt-1', 'Video editing');

    await page.selectOption('#mcqQuestionCount', '3');

    await expect(page.locator('#testTitle')).toHaveValue('Playwright MCQ Stability');
    await expect(page.locator('#objective-q-0')).toHaveValue('What is MS Word used for?');
    await expect(page.locator('#objective-q-0-opt-0')).toHaveValue('Word processing');
    await expect(page.locator('#objective-q-0-opt-1')).toHaveValue('Video editing');
    await expect(page.locator('#objective-q-2')).toBeVisible();
  });

  test('teacher published tests search, archive, restore, and loading shell work', async ({ page }) => {
    const titlePrefix = `PW Archive ${Date.now()}`;

    await page.route('**/api/teacher/tests**', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 300));
      await route.continue();
    });

    await login(page, "I'm a Teacher", TEACHER_USERNAME, TEACHER_PASSWORD);
    await expect(page.getByRole('heading', { name: /Welcome, Demo Teacher/ })).toBeVisible({ timeout: 30000 });

    await page.getByText('Assessment', { exact: true }).click();
    await page.locator('[data-teacher-tab="assessment_conduct"]:visible').click();
    await expect(page.getByText('Syncing workspace')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Published Tests' })).toBeVisible();
    await expect(page.getByLabel('Search Tests')).toBeVisible();
    await expect(page.getByLabel('Filter by Type')).toBeVisible();
    await expect(page.getByLabel('Show')).toBeVisible();

    await page.evaluate(async ({ titlePrefix, apiUrl }) => {
      const subjectRes = await fetch(`${apiUrl}/api/teacher/subjects`, {
        credentials: 'include'
      });
      const subjectPayload = await subjectRes.json();
      const subjectId = subjectPayload?.data?.subjects?.[0]?._id;
      if (!subjectId) throw new Error('No subject available for teacher.');

      for (let index = 0; index < 12; index += 1) {
        const createRes = await fetch(`${apiUrl}/api/teacher/tests`, {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            subjectId,
            title: `${titlePrefix} ${index + 1}`,
            type: 'mcq',
            durationMinutes: 5,
            audienceMode: 'all',
            questions: [
              {
                text: `Playwright archive check question ${index + 1}`,
                options: ['A', 'B', 'C', 'D'],
                correctIndex: 0
              }
            ]
          })
        });

        const payload = await createRes.json();
        if (!createRes.ok) {
          throw new Error(payload?.message || 'Failed to create test.');
        }
      }
    }, { titlePrefix, apiUrl: API_URL });

    await page.getByLabel('Search Tests').fill(titlePrefix);
    await expect(page.getByRole('cell', { name: `${titlePrefix} 12` })).toBeVisible({ timeout: 30000 });
    await expect(page.getByRole('button', { name: 'Load More Tests' })).toBeVisible();
    await page.getByRole('button', { name: 'Load More Tests' }).click();

    const allMatchingRows = page.locator('tbody tr', { hasText: titlePrefix });
    await expect(allMatchingRows).toHaveCount(12);

    const row = page.locator('tr', { hasText: `${titlePrefix} 12` }).first();
    await expect(row.getByText('Active')).toBeVisible();

    await row.getByRole('button', { name: 'Archive' }).click();
    await expect(page.getByText('Test archived.')).toBeVisible();

    await page.getByLabel('Show').selectOption('archived');
    await expect(page.getByRole('cell', { name: `${titlePrefix} 12` })).toBeVisible({ timeout: 30000 });
    const archivedRow = page.locator('tr', { hasText: `${titlePrefix} 12` }).first();
    await expect(archivedRow.getByText('Archived')).toBeVisible();

    await archivedRow.getByRole('button', { name: 'Restore' }).click();
    await expect(page.getByText('Test restored.')).toBeVisible();

    await page.getByLabel('Show').selectOption('active');
    await expect(page.getByRole('cell', { name: `${titlePrefix} 12` })).toBeVisible({ timeout: 30000 });
    const restoredRow = page.locator('tr', { hasText: `${titlePrefix} 12` }).first();
    await restoredRow.getByRole('button', { name: 'Move to Trash' }).click();
    await expect(page.getByText('Test moved to trash.')).toBeVisible();

    await page.getByLabel('Show').selectOption('trashed');
    await expect(page.getByRole('cell', { name: `${titlePrefix} 12` })).toBeVisible({ timeout: 30000 });
    const trashedRow = page.locator('tr', { hasText: `${titlePrefix} 12` }).first();
    await trashedRow.getByRole('button', { name: 'Delete Forever' }).click();
    await expect(page.getByRole('dialog', { name: 'Delete Test Forever' })).toBeVisible();
    await page.getByRole('dialog', { name: 'Delete Test Forever' }).getByRole('button', { name: 'Delete Forever' }).click();
    await expect(page.getByRole('cell', { name: `${titlePrefix} 12` })).toHaveCount(0);
  });

  test('ended class plan no longer shows its resource to students', async ({ page }) => {
    const classTitle = `Ended Class ${Date.now()}`;
    const planId = await (async () => {
      await login(page, "I'm a Teacher", TEACHER_USERNAME, TEACHER_PASSWORD);
      await expect(page.getByText('Welcome, Demo Teacher')).toBeVisible({ timeout: 30000 });

      const result = await page.evaluate(async ({ title, apiUrl }) => {
        const subjectsRes = await fetch(`${apiUrl}/api/teacher/subjects`, {
          credentials: 'include'
        });
        const subjectsPayload = await subjectsRes.json();
        const subjectId = subjectsPayload?.data?.subjects?.[0]?._id;
        if (!subjectId) throw new Error('No subject found for teacher.');

        const today = new Date();
        const pad = (value) => String(value).padStart(2, '0');
        const scheduledDate = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;

        const createRes = await fetch(`${apiUrl}/api/teacher/class-plans`, {
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
      }, { title: classTitle, apiUrl: API_URL });

      await page.getByRole('button', { name: 'Sign Out' }).click();
      return result;
    })();

    expect(planId).toBeTruthy();

    await login(page, "I'm a Student", STUDENT_USERNAME, STUDENT_PASSWORD);
    await expect(page.locator('[data-student-tab="dashboard"]')).toBeVisible({ timeout: 30000 });
    await page.getByText('Learning', { exact: true }).click();
    await page.locator('[data-student-tab="classes"]:visible').click();
    await expect(page.getByRole('heading', { name: 'Completed Classes' })).toBeVisible();

    const endedClass = page.locator('article.stack-item', { hasText: classTitle }).first();
    await expect(endedClass).toBeVisible();
    await expect(page.locator('section.panel', { has: page.getByRole('heading', { name: 'Completed Classes' }) }).getByText(classTitle)).toBeVisible();
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
    await expect(page.getByRole('heading', { name: 'Resources', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Permanent Resources' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Class Materials' })).toBeVisible();
    await expect(page.getByLabel('Collection')).toBeVisible();

    await page.getByText('Tests', { exact: true }).click();
    await page.locator('[data-student-tab="history"]:visible').click();
    await expect(page.getByRole('heading', { name: 'Test History' })).toBeVisible();

    await page.locator('[data-student-tab="accounts"]').click();
    await expect(page.getByRole('heading', { name: 'Account Settings' })).toBeVisible();
  });
});

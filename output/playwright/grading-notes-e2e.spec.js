const { test, expect } = require('@playwright/test');

const APP_URL = process.env.PLAYWRIGHT_APP_URL || 'http://127.0.0.1:3000';
const API_URL = process.env.PLAYWRIGHT_API_URL || 'http://127.0.0.1:5050';
const INSTITUTION_ID = 'LIFT-DEMO-1001';
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

test('teacher can upload notes, grade a student exam, and student sees result notification + marks', async ({ page }) => {
  const unique = Date.now();
  const noteTitle = `PW Notes ${unique}`;
  const noteBody = `Revision notes for batch ${unique}.\nFocus on shortcuts and formatting.`;
  const testTitle = `PW Manual Review ${unique}`;

  await login(page, "I'm a Teacher", TEACHER_USERNAME, TEACHER_PASSWORD);
  await expect(page.getByRole('heading', { name: /Welcome, Demo Teacher/ })).toBeVisible({ timeout: 30000 });

  const subjectId = await page.evaluate(async (apiUrl) => {
    const response = await fetch(`${apiUrl}/api/teacher/subjects`, { credentials: 'include' });
    const payload = await response.json();
    return payload?.data?.subjects?.[0]?._id || '';
  }, API_URL);
  expect(subjectId).toBeTruthy();

  await page.getByRole('button', { name: 'Upload Resources' }).click();
  await expect(page.getByRole('heading', { name: 'Upload Resource' })).toBeVisible();
  await page.selectOption('#resourceType', 'notes');
  await page.selectOption('#resourceSubjectId', subjectId);
  await page.fill('#resourceTitle', noteTitle);
  await page.fill('#resourceNotes', noteBody);
  await page.locator('#createResourceBtn').click();
  await page.waitForTimeout(1200);
  await page.fill('#teacherResourceSearch', noteTitle);
  await page.waitForTimeout(500);
  await expect(page.getByRole('cell', { name: noteTitle })).toBeVisible({ timeout: 30000 });
  await page.getByRole('button', { name: 'View Note' }).first().click();
  await expect(page.getByRole('dialog', { name: noteTitle })).toBeVisible();
  await expect(page.getByText('Focus on shortcuts and formatting.')).toBeVisible();
  await page.getByRole('button', { name: 'Close' }).click();

  const createPayload = await page.evaluate(async ({ apiUrl, subjectId, testTitle }) => {
    const createResponse = await fetch(`${apiUrl}/api/teacher/tests`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        subjectId,
        title: testTitle,
        type: 'pdf_upload',
        durationMinutes: 60,
        audienceMode: 'all',
        questionPdfUrl: 'https://example.com/questions.pdf',
        questionPdfName: 'questions.pdf',
        answerKeyPdfUrl: 'https://example.com/answer-key.pdf',
        answerKeyPdfName: 'answer-key.pdf',
        questions: [
          { text: 'Explain the difference between Save and Save As.' },
          { text: 'Write two uses of Microsoft Word.' }
        ]
      })
    });
    const createJson = await createResponse.json();
    if (!createResponse.ok) {
      throw new Error(createJson?.message || 'Failed to create teacher test');
    }
    return createJson?.data?.test?._id || createJson?.data?.test?.id || '';
  }, { apiUrl: API_URL, subjectId, testTitle });
  expect(createPayload).toBeTruthy();

  await page.getByRole('button', { name: 'Sign Out' }).click();
  await expect(page.getByText('Learn Smarter,')).toBeVisible({ timeout: 30000 });

  await login(page, "I'm a Student", STUDENT_USERNAME, STUDENT_PASSWORD);
  await expect(page.getByRole('heading', { name: /Good Day/ })).toBeVisible({ timeout: 30000 });
  await page.getByText('Learning', { exact: true }).click();
  await page.locator('[data-student-tab="resources"]:visible').click();
  await expect(page.getByRole('heading', { name: 'Resources', exact: true })).toBeVisible();
  await page.fill('#studentResourceSearch', noteTitle);
  await page.waitForTimeout(500);
  await expect(page.getByText(noteTitle)).toBeVisible({ timeout: 30000 });
  await page.getByRole('button', { name: 'View Note' }).click();
  await expect(page.getByRole('dialog', { name: noteTitle })).toBeVisible();
  await expect(page.getByText('Focus on shortcuts and formatting.')).toBeVisible();
  await page.getByRole('button', { name: 'Close' }).click();

  await page.getByText('Tests', { exact: true }).click();
  await page.locator('[data-student-tab="today"]:visible').click();
  const testCard = page.locator('article.stack-item.pending-item', { hasText: testTitle }).first();
  await expect(testCard).toBeVisible({ timeout: 30000 });
  await testCard.getByRole('button', { name: 'Start Test' }).click();
  await expect(page.locator('#submitStudentAttemptBtn')).toBeVisible({ timeout: 30000 });
  await page.fill('#long-answer-0', 'Save updates the current file. Save As creates a new copy with a new name or location.');
  await page.fill('#long-answer-1', 'Microsoft Word is used to write letters and format reports.');
  await page.getByRole('button', { name: 'Submit Test' }).click();
  await expect(page.getByText('Submitted')).toBeVisible({ timeout: 30000 });
  await page.getByRole('button', { name: 'Back' }).click();
  await expect(page.getByRole('heading', { name: "Today's Tests" })).toBeVisible({ timeout: 30000 });

  await page.getByRole('button', { name: 'Sign Out' }).click();
  await expect(page.getByText('Learn Smarter,')).toBeVisible({ timeout: 30000 });

  await login(page, "I'm a Teacher", TEACHER_USERNAME, TEACHER_PASSWORD);
  await expect(page.getByRole('heading', { name: /Welcome, Demo Teacher/ })).toBeVisible({ timeout: 30000 });
  await page.getByText('Assessment', { exact: true }).click();
  await page.locator('[data-teacher-tab="assessment_results"]:visible').click();
  await expect(page.getByRole('heading', { name: 'Assessment Results' })).toBeVisible();
  await page.fill('#teacherAssessmentQuery', 'studemo');
  await page.waitForTimeout(500);
  const resultRow = page.locator('tr', { hasText: testTitle }).first();
  await expect(resultRow).toBeVisible({ timeout: 30000 });
  await resultRow.locator('input[id^="assessment-marks-"]').fill('18');
  await resultRow.locator('input[id^="assessment-feedback-"]').fill('Good structure. Add one more real-world example next time.');
  await resultRow.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Assessment saved.')).toBeVisible({ timeout: 30000 });

  await page.getByRole('button', { name: 'Sign Out' }).click();
  await expect(page.getByText('Learn Smarter,')).toBeVisible({ timeout: 30000 });

  await login(page, "I'm a Student", STUDENT_USERNAME, STUDENT_PASSWORD);
  await expect(page.getByRole('heading', { name: /Good Day/ })).toBeVisible({ timeout: 30000 });
  await expect(page.getByRole('heading', { name: 'Results Ready' })).toBeVisible({ timeout: 30000 });
  const resultCard = page.locator('.todo-item', { hasText: testTitle }).first();
  await expect(resultCard.getByText(/Marks awarded: 18/i)).toBeVisible();
  await resultCard.getByRole('button', { name: 'Check Result' }).click();
  await expect(page.getByRole('heading', { name: 'Test History' })).toBeVisible({ timeout: 30000 });
  const historyRow = page.locator('tr', { hasText: testTitle }).first();
  await expect(historyRow.getByText('Result Published')).toBeVisible();
  await expect(historyRow.getByText('18.00 marks')).toBeVisible();
  await expect(historyRow.getByText('Good structure. Add one more real-world example next time.')).toBeVisible();
});

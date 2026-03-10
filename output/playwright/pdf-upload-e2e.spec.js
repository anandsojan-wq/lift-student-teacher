const { test, expect } = require('@playwright/test');

const APP_URL = 'http://127.0.0.1:3000';
const INSTITUTION_ID = 'LIFT-DEMO-1001';
const TEACHER_USERNAME = 'teachdemo';
const TEACHER_PASSWORD = 'Teacher@12345';
const STUDENT_USERNAME = 'studemo';
const STUDENT_PASSWORD = 'Student@12345';
const QUESTIONS_PDF = '/Users/anandsojan/Documents/Codex-Student-Teacher-Dashboard/output/playwright/pdf-upload-questions.pdf';
const ANSWER_KEY_PDF = '/Users/anandsojan/Documents/Codex-Student-Teacher-Dashboard/output/playwright/pdf-upload-answer-key.pdf';
const TEST_TITLE = `PDF Flow ${Date.now()}`;

async function login(page, role, username, password) {
  await page.goto(APP_URL, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: role }).click();
  await page.getByRole('textbox', { name: 'Institution ID' }).fill(INSTITUTION_ID);
  await page.getByRole('textbox', { name: 'Username' }).fill(username);
  await page.getByRole('textbox', { name: 'Password' }).fill(password);
  await page.getByRole('button', { name: 'Sign In' }).click();
}

test('teacher PDF upload becomes in-system student attempt without raw PDF leak', async ({ page }) => {
  await login(page, "I'm a Teacher", TEACHER_USERNAME, TEACHER_PASSWORD);
  await expect(page.getByText('Welcome, Demo Teacher')).toBeVisible({ timeout: 30000 });

  await page.getByText('Assessment').first().click();
  await page.locator('[data-teacher-tab="assessment_conduct"]:visible').click();
  await expect(page.locator('#createTestForm')).toBeVisible();

  const firstSubjectValue = await page.locator('#testSubjectId option:not([value=""])').first().getAttribute('value');
  expect(firstSubjectValue).toBeTruthy();

  await page.selectOption('#testSubjectId', firstSubjectValue);
  await page.selectOption('#testType', 'pdf_upload');
  await expect(page.locator('#testPdfQuestionsFile')).toBeVisible();
  await page.fill('#testTitle', TEST_TITLE);
  await page.setInputFiles('#testPdfQuestionsFile', QUESTIONS_PDF);
  await page.setInputFiles('#testPdfAnswerKeyFile', ANSWER_KEY_PDF);
  await page.click('#createTestBtn');
  await expect(page.getByText(TEST_TITLE)).toBeVisible({ timeout: 30000 });

  await page.getByRole('button', { name: 'Sign Out' }).click();
  await expect(page.getByText('Learn Smarter,')).toBeVisible({ timeout: 30000 });

  await login(page, "I'm a Student", STUDENT_USERNAME, STUDENT_PASSWORD);
  await expect(page.locator('[data-student-nav="today"]')).toBeVisible({ timeout: 30000 });
  await page.locator('[data-student-nav="today"]').click();
  await expect(page.getByText("Today's Tests")).toBeVisible();

  const queuePayload = await page.evaluate(async (title) => {
    const response = await fetch('http://127.0.0.1:5050/api/student/tests/queue', { credentials: 'include', cache: 'no-store' });
    const payload = await response.json();
    const all = [...(payload?.data?.today || []), ...(payload?.data?.pending || [])];
    const found = all.find((item) => item.title === title);
    if (!found) return null;
    return {
      title: found.title,
      questionPdfUrl: found.questionPdfUrl || '',
      optionCount: Array.isArray(found.questions?.[0]?.options) ? found.questions[0].options.length : 0,
      firstQuestion: found.questions?.[0]?.text || ''
    };
  }, TEST_TITLE);

  expect(queuePayload).toBeTruthy();
  expect(queuePayload.questionPdfUrl).toBe('');
  expect(queuePayload.optionCount).toBeGreaterThanOrEqual(2);
  expect(queuePayload.firstQuestion).toContain('What does CPU stand for');

  const testCard = page.locator('article.stack-item.pending-item', { hasText: TEST_TITLE }).first();
  await expect(testCard).toBeVisible({ timeout: 30000 });
  await testCard.getByRole('button', { name: 'Start Test' }).click();

  await expect(page.locator('#submitStudentAttemptBtn')).toBeVisible({ timeout: 30000 });
  await expect(page.getByText('The original uploaded PDF is not shown to students.')).toBeVisible();
  await expect(page.getByText('Question Paper (Original PDF)')).toHaveCount(0);
  await expect(page.locator('iframe[title="Question PDF"]')).toHaveCount(0);
  await expect(page.getByText('What does CPU stand for?')).toBeVisible();
  await expect(page.getByText('Central Processing Unit')).toBeVisible();
  await page.check('input[name="q-0"][value="0"]');
  await page.check('input[name="q-1"][value="1"]');
  await page.click('#submitStudentAttemptBtn');

  await expect(page.getByText('Submitted')).toBeVisible({ timeout: 30000 });
  await expect(page.getByRole('button', { name: 'View Answer Key' })).toBeVisible();
});

const { test, expect } = require('@playwright/test');
const fs = require('fs');
const os = require('os');
const path = require('path');

const APP_URL = 'http://127.0.0.1:3000';
const INSTITUTION_ID = 'LIFT-DEMO-1001';
const TEACHER_USERNAME = 'teachdemo';
const TEACHER_PASSWORD = 'Teacher@12345';
const STUDENT_USERNAME = 'studemo';
const STUDENT_PASSWORD = 'Student@12345';
const QUESTIONS_PDF = '/Users/anandsojan/Documents/Codex-Student-Teacher-Dashboard/output/playwright/pdf-upload-questions.pdf';
const ANSWER_KEY_PDF = '/Users/anandsojan/Documents/Codex-Student-Teacher-Dashboard/output/playwright/pdf-upload-answer-key.pdf';
const TEST_TITLE = `PDF Flow ${Date.now()}`;

function escapePdfText(value) {
  return String(value || '')
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
}

function createPdfWithLines(filePath, lines) {
  const startY = 780;
  const lineHeight = 20;
  const content = ['/F1 12 Tf']
    .concat(
      lines.map((line, index) => {
        const y = startY - index * lineHeight;
        return `1 0 0 1 40 ${y} Tm (${escapePdfText(line)}) Tj`;
      })
    )
    .join('\n');

  const objects = [];
  objects.push('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj');
  objects.push('2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj');
  objects.push(
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj'
  );
  objects.push(`4 0 obj\n<< /Length ${Buffer.byteLength(content, 'utf8')} >>\nstream\n${content}\nendstream\nendobj`);
  objects.push('5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj');

  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object) => {
    offsets.push(Buffer.byteLength(pdf, 'utf8'));
    pdf += `${object}\n`;
  });
  const xrefOffset = Buffer.byteLength(pdf, 'utf8');
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += '0000000000 65535 f \n';
  for (let index = 1; index <= objects.length; index += 1) {
    pdf += `${String(offsets[index]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  fs.writeFileSync(filePath, pdf);
}

async function login(page, role, username, password) {
  await page.goto(APP_URL, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: role }).click();
  await page.getByRole('textbox', { name: 'Institution ID' }).fill(INSTITUTION_ID);
  await page.getByRole('textbox', { name: 'Username' }).fill(username);
  await page.getByRole('textbox', { name: 'Password' }).fill(password);
  await page.getByRole('button', { name: 'Sign In' }).click();
}

test('teacher PDF preview ignores cover title and starts from real numbered question', async ({ page }) => {
  const tempPdfPath = path.join(os.tmpdir(), `lift-pdf-title-check-${Date.now()}.pdf`);
  createPdfWithLines(tempPdfPath, [
    'MS Office Weekly Revision Test',
    'Use the best option for each question below',
    '1. What does CPU stand for?',
    'A. Central Processing Unit',
    'B. Computer Personal Unit',
    'C. Central Print Utility',
    'D. Control Process Unit',
    '2. Which key is used to copy selected text in Windows?',
    'A. Ctrl+X',
    'B. Ctrl+C',
    'C. Ctrl+V',
    'D. Ctrl+P'
  ]);

  try {
    await login(page, "I'm a Teacher", TEACHER_USERNAME, TEACHER_PASSWORD);
    await expect(page.getByText('Welcome, Demo Teacher')).toBeVisible({ timeout: 30000 });

    await page.getByText('Assessment').first().click();
    await page.locator('[data-teacher-tab="assessment_conduct"]:visible').click();
    await expect(page.locator('#createTestForm')).toBeVisible();

    const firstSubjectValue = await page.locator('#testSubjectId option:not([value=""])').first().getAttribute('value');
    expect(firstSubjectValue).toBeTruthy();

    await page.selectOption('#testSubjectId', firstSubjectValue);
    await page.selectOption('#testType', 'pdf_upload');
    await page.fill('#testTitle', `PDF Title Filter ${Date.now()}`);
    await page.setInputFiles('#testPdfQuestionsFile', tempPdfPath);

    await expect(page.getByText('Teacher Preview')).toBeVisible();
    await expect(page.locator('.preview-question-card').first()).toContainText('What does CPU stand for?');
    await expect(page.locator('.preview-question-card').first()).not.toContainText('MS Office Weekly Revision Test');
    await expect(page.locator('.preview-question-card').first()).not.toContainText(
      'Use the best option for each question below'
    );
  } finally {
    fs.rmSync(tempPdfPath, { force: true });
  }
});

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
  await expect(page.getByText('Teacher Preview')).toBeVisible();
  await expect(page.getByText('What does CPU stand for?')).toBeVisible({ timeout: 30000 });
  await expect(page.getByText('Central Processing Unit')).toBeVisible({ timeout: 30000 });
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
  await page.getByRole('button', { name: 'View Answer Key' }).click();
  await expect(page.getByText('View-only mode. Download is disabled in this interface.')).toBeVisible();
  await expect(page.locator('iframe[title="Answer Key PDF Viewer"]')).toHaveCount(0);
  await expect(page.locator('#studentAnswerKeyCanvasRoot canvas')).toHaveCount(1, { timeout: 30000 });
});

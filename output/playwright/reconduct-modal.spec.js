const { test, expect } = require('@playwright/test');

const APP_URL = process.env.PLAYWRIGHT_APP_URL || 'http://127.0.0.1:3000';
const INSTITUTION_ID = 'LIFT-DEMO-1001';
const TEACHER_USERNAME = 'teachdemo';
const TEACHER_PASSWORD = 'Teacher@12345';

async function login(page) {
  await page.context().clearCookies();
  await page.goto(APP_URL, { waitUntil: 'networkidle' });
  await page.evaluate(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByRole('button', { name: "I'm a Teacher" }).click();
  await page.getByRole('textbox', { name: 'Institution ID' }).fill(INSTITUTION_ID);
  await page.getByRole('textbox', { name: 'Username' }).fill(TEACHER_USERNAME);
  await page.getByRole('textbox', { name: 'Password' }).fill(TEACHER_PASSWORD);
  await page.getByRole('button', { name: 'Sign In' }).click();
}

test('teacher reconduct modal shows a clear save/update action', async ({ page }) => {
  await login(page);
  await expect(page.getByRole('heading', { name: /Welcome, Demo Teacher/ })).toBeVisible({ timeout: 30000 });

  await page.getByText('Assessment', { exact: true }).click();
  await page.locator('[data-teacher-tab="assessment_conduct"]:visible').click();
  await expect(page.getByRole('heading', { name: 'Published Tests' })).toBeVisible({ timeout: 30000 });

  const reconductButton = page.locator('[data-edit-reconduct-test]').first();
  await expect(reconductButton).toBeVisible({ timeout: 30000 });
  await reconductButton.click();

  await expect(page.getByRole('dialog', { name: 'Edit and reconduct test' })).toBeVisible({ timeout: 30000 });
  await expect(page.getByRole('button', { name: 'Save & Publish Updated Test' })).toBeVisible();
  await expect(page.getByText('This will save your edits and publish a new MCQ test for the selected students.')).toBeVisible();
});

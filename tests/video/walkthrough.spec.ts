import { test, expect } from '@playwright/test';
import path from 'node:path';

// A single continuous journey, paced to be watched. Records to test-results/;
// `npm run video` copies the clip to clause-walkthrough.webm in the repo root.
// Point it at a deployment with PLAYWRIGHT_BASE_URL, or let it start a local dev
// server (needs GEMINI_API_KEY in .dev.vars for the AI panels to populate).

const SAMPLE = path.resolve('public/samples/service-agreement.pdf');
const account = { name: 'Maya Rao', email: `maya-${Date.now()}@northstar.dev`, password: 'a-strong-demo-password-42' };

test('Clause — end to end', async ({ page, context }) => {
  test.setTimeout(300_000);
  const beat = (ms = 900) => page.waitForTimeout(ms);

  await test.step('Create an account', async () => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Make room for clarity.' })).toBeVisible();
    await beat(1600);
    await page.getByLabel('Full name', { exact: true }).pressSequentially(account.name, { delay: 45 });
    await page.getByLabel('Email address').pressSequentially(account.email, { delay: 25 });
    await page.getByLabel('Password', { exact: true }).pressSequentially(account.password, { delay: 25 });
    await beat();
    await page.getByRole('button', { name: 'Create workspace', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Your document workspace.' })).toBeVisible();
    await beat(1400);
  });

  await test.step('Upload a PDF and watch the AI summary land', async () => {
    await page.getByRole('button', { name: 'Upload PDF', exact: true }).click();
    await beat();
    await page.locator('input[type=file]').setInputFiles(SAMPLE);
    await beat(1200);
    await page.getByRole('button', { name: 'Upload & understand' }).click();
    await expect(page.getByRole('heading', { name: 'service-agreement.pdf', exact: true })).toBeVisible();
    await beat();
    // client polls /process; wait for the card to leave the "analyzing" state
    await expect(page.locator('.document-card .document-status.ready')).toBeVisible({ timeout: 90_000 });
    await expect(page.locator('.document-card .card-summary p')).not.toContainText('Reading your document');
    await beat(2600);
  });

  await test.step('Open the document — summary and key facts up top', async () => {
    await page.getByRole('button', { name: 'Open service-agreement.pdf', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'service-agreement', exact: true })).toBeVisible();
    await expect(page.locator('.pdf-paper > canvas')).toBeVisible();
    await expect(page.locator('.overview-summary .markdown')).toBeVisible();
    await beat(3200);
    await page.locator('.key-facts button').first().click();
    await beat(1800);
  });

  await test.step('Ask questions — grounded, streamed, with citations', async () => {
    const ask = async (q: string) => {
      const box = page.getByRole('textbox', { name: 'Ask a question about this PDF' });
      await box.click();
      await box.pressSequentially(q, { delay: 30 });
      await beat(500);
      await box.press('Enter');
      await expect(page.locator('.chat-message.assistant').last().locator('.markdown')).toBeVisible({ timeout: 60_000 });
      await expect(page.locator('.chat-composer .send-button')).toBeEnabled({ timeout: 60_000 });
      await beat(2200);
    };
    await ask('What is the total fee and how is it paid?');
    await page.locator('.chat-message.assistant .source-chips button').first().click(); // jump to the cited page
    await beat(2400);
    await ask('And how much of that is due at signing?'); // follow-up: needs conversation memory
    await ask('Does the contract include a non-compete clause?'); // not in the document — should decline
  });

  await test.step('Find a document by meaning, not filename', async () => {
    await page.getByRole('button', { name: /Workspace|Clause/ }).first().click();
    await expect(page.getByRole('heading', { name: 'Your document workspace.' })).toBeVisible();
    await beat(1200);
    await page.getByRole('switch', { name: 'Search by meaning' }).click();
    await page.getByLabel('Search documents').pressSequentially('termination and liability terms', { delay: 35 });
    await expect(page.locator('.document-card')).toContainText('service-agreement.pdf', { timeout: 20_000 });
    await beat(2600);
    await page.getByLabel('Clear search').click();
  });

  let shareUrl = '';
  await test.step('Share a link — no account needed', async () => {
    await page.getByRole('button', { name: 'Open service-agreement.pdf', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'service-agreement', exact: true })).toBeVisible();
    await beat();
    await page.getByRole('button', { name: 'Share document', exact: true }).click();
    await page.getByLabel('Invitation name').pressSequentially('Finance review', { delay: 40 });
    await beat();
    await page.getByRole('button', { name: 'Create secure link', exact: true }).click();
    await expect(page.getByLabel('Copy this link now')).toHaveValue(/\/share#/);
    shareUrl = await page.getByLabel('Copy this link now').inputValue();
    await beat(2200);
    await page.keyboard.press('Escape');
  });

  await test.step('Open as a guest and leave a comment', async () => {
    await context.clearCookies();
    await page.goto(shareUrl);
    await expect(page.getByText('Guest access', { exact: true })).toBeVisible();
    await expect(page.locator('.pdf-paper > canvas')).toBeVisible();
    await beat(2200);
    await page.getByRole('tab', { name: /Comments/ }).click();
    await page.getByRole('textbox', { name: 'Your name for comments' }).pressSequentially('Priya Shah', { delay: 40 });
    await page.getByRole('textbox', { name: 'Write a comment', exact: true }).pressSequentially('Confirming the 40% / 30% / 30% payment split before we sign.', { delay: 20 });
    await beat();
    await page.getByRole('button', { name: 'Post', exact: true }).click();
    await expect(page.getByText('Priya Shah (guest)', { exact: true })).toBeVisible();
    await beat(2600);
  });

  await test.step('Back as the owner — revoke access', async () => {
    await page.goto('/');
    await page.getByLabel('Email address').pressSequentially(account.email, { delay: 20 });
    await page.getByLabel('Password', { exact: true }).pressSequentially(account.password, { delay: 20 });
    await page.getByRole('button', { name: 'Sign in to your workspace', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Your document workspace.' })).toBeVisible();
    await page.getByRole('button', { name: 'Open service-agreement.pdf', exact: true }).click();
    await page.getByRole('button', { name: 'Share document', exact: true }).click();
    await beat(1200);
    await page.getByRole('button', { name: 'Revoke Finance review' }).click();
    await beat(1800);
    await page.keyboard.press('Escape');
    await context.clearCookies();
    await page.goto(shareUrl);
    await expect(page.getByRole('heading', { name: 'This document is unavailable.' })).toBeVisible();
    await beat(2600);
  });
});

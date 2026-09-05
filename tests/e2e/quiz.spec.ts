import { expect, test } from "@playwright/test";

/**
 * The full mobile journey: landing → consent → quiz → result → comparison →
 * deletion. This is the flow that must never dead-end, so it is asserted
 * against a real browser rather than only at the unit level.
 */
test("an adult can complete the quiz, see the outcome, and delete it", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("DesireDNA");

  await page.getByRole("link", { name: "Discover My DesireDNA" }).click();
  await expect(page.getByRole("heading", { name: "Before we begin" })).toBeVisible();

  // Nothing may be preselected on the consent gate.
  const checkboxes = page.locator('input[type="checkbox"]');
  const count = await checkboxes.count();
  for (let index = 0; index < count; index++) await expect(checkboxes.nth(index)).not.toBeChecked();

  const begin = page.getByRole("button", { name: "Begin private quiz" });
  await expect(begin).toBeDisabled();

  // Retry until React has hydrated: a click before hydration is ignored.
  await expect(async () => {
    await page.getByLabel("I agree to all of the above.").check();
    await expect(begin).toBeEnabled({ timeout: 1000 });
  }).toPass({ timeout: 30_000 });

  await page.getByRole("button", { name: "24 hours" }).click();
  await begin.click();

  // A random alias is assigned at the start of the quiz.
  const aliasText = await page.locator("text=You are answering as").textContent();
  const alias = aliasText?.match(/as ([A-Z][a-z]+ [A-Z][a-z]+ \d{4})/)?.[1];
  expect(alias).toBeTruthy();

  // Answer everything except one question, which is skipped on purpose.
  let skipped = false;
  for (let guard = 0; guard < 60; guard++) {
    const finish = page.getByRole("button", { name: "Finish" });
    const isLast = await finish.isVisible().catch(() => false);

    if (!skipped) {
      await page.getByRole("button", { name: "Skip", exact: true }).click();
      await page.getByLabel(/I acknowledge that skipping/).check();
      await page.getByRole("button", { name: "Skip question" }).click();
      skipped = true;
      continue;
    }

    const options = page.locator("article button[aria-pressed]");
    await options.first().click();
    await (isLast ? finish : page.getByRole("button", { name: "Continue" })).click();

    if (isLast) break;
  }

  // The skip review dialog appears because one question was skipped.
  await expect(page.getByRole("heading", { name: "Answer your skipped questions?" })).toBeVisible();
  await page.getByRole("button", { name: "Show my result now" }).click();

  // The calculation sequence, then the outcome itself.
  await expect(page).toHaveURL(/\/results$/, { timeout: 60_000 });
  await expect(page.getByText("Adventure Index").first()).toBeVisible();
  await expect(page.getByText("Communication & Boundaries").first()).toBeVisible();
  await expect(page.getByText(alias as string).first()).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

  const code = await page.locator("code").first().textContent();
  expect(code).toMatch(/^DDNA-(?:[A-HJ-NP-Z2-9]{4}-){3}[A-HJ-NP-Z2-9]{4}$/);

  // Reloading must still show the outcome: it is owned by the private cookie.
  await page.reload();
  await expect(page.locator("code").first()).toHaveText(code as string);

  // An unknown partner code is refused with the single generic message.
  const compareButton = page.getByRole("button", { name: "Compare privately" });
  await expect(async () => {
    await page.getByLabel(/Enter a trusted adult/).fill("DDNA-ABCD-EFGH-JKLM-NPQR");
    await expect(compareButton).toBeEnabled({ timeout: 1000 });
  }).toPass({ timeout: 30_000 });
  await compareButton.click();
  await expect(page.locator("#code-error")).toContainText("not found or has expired");

  // Deletion is immediate and permanent.
  page.on("dialog", (dialog) => void dialog.accept());
  await page.getByRole("button", { name: "Delete profile permanently" }).click();
  await expect(page).toHaveURL("/");

  await page.goto("/results");
  await expect(page.getByRole("heading", { name: "No private result available" })).toBeVisible();
});

test("the quiz cannot be reached without confirming age and consent", async ({ page }) => {
  await page.goto("/quiz");
  await expect(page.getByRole("heading", { name: "Before we begin" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Begin private quiz" })).toBeDisabled();

  // Confirming only some of the statements is not enough.
  await page.getByLabel("I confirm that I am at least 18 years old.").check();
  await expect(page.getByRole("button", { name: "Begin private quiz" })).toBeDisabled();
});

test("comparing requires the caller to have their own profile", async ({ page }) => {
  await page.goto("/compare");
  const compare = page.getByRole("button", { name: "Compare privately" });
  await expect(async () => {
    await page.getByLabel(/Enter a trusted adult/).fill("DDNA-ABCD-EFGH-JKLM-NPQR");
    await expect(compare).toBeEnabled({ timeout: 1000 });
  }).toPass({ timeout: 30_000 });
  await compare.click();
  await expect(page.locator("#code-error")).toContainText("Complete your own quiz");
});

/** Answers every remaining question in the short test bank with one option. */
async function completeQuiz(page: import("@playwright/test").Page, optionIndex: number) {
  await page.goto("/quiz");
  const begin = page.getByRole("button", { name: "Begin private quiz" });
  await expect(async () => {
    await page.getByLabel("I agree to all of the above.").check();
    await expect(begin).toBeEnabled({ timeout: 1000 });
  }).toPass({ timeout: 30_000 });
  await begin.click();

  for (let guard = 0; guard < 60; guard++) {
    const finish = page.getByRole("button", { name: "Finish" });
    const isLast = await finish.isVisible().catch(() => false);
    const options = page.locator("article button[aria-pressed]");
    const available = await options.count();
    await options.nth(Math.min(optionIndex, available - 1)).click();
    await (isLast ? finish : page.getByRole("button", { name: "Continue" })).click();
    if (isLast) break;
  }

  await expect(page).toHaveURL(/\/results$/, { timeout: 60_000 });
  const code = await page.locator("code").first().textContent();
  return code as string;
}

test("two adults can compare codes and see mutual results only", async ({ browser }) => {
  const partnerContext = await browser.newContext();
  const partnerPage = await partnerContext.newPage();
  // Option 0 is "I have done it and love it".
  const partnerCode = await completeQuiz(partnerPage, 0);

  const ownContext = await browser.newContext();
  const ownPage = await ownContext.newPage();
  await completeQuiz(ownPage, 0);

  const compare = ownPage.getByRole("button", { name: "Compare privately" });
  await expect(async () => {
    await ownPage.getByLabel(/Enter a trusted adult/).fill(partnerCode);
    await expect(compare).toBeEnabled({ timeout: 1000 });
  }).toPass({ timeout: 30_000 });
  await compare.click();

  await expect(ownPage.getByText("shared-interest alignment")).toBeVisible({ timeout: 20_000 });
  await expect(ownPage.getByRole("heading", { name: "Strong Matches" })).toBeVisible();
  // Mutual-only is the default, so differences must stay hidden.
  await expect(ownPage.getByText("Mutual-only mode is active")).toBeVisible();
  await expect(ownPage.getByRole("heading", { name: "Boundary mismatches" })).toHaveCount(0);
  await expect(ownPage.getByText("A matching interest never replaces")).toBeVisible();

  await ownContext.close();
  await partnerContext.close();
});

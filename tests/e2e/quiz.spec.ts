import { expect, test, type Page } from "@playwright/test";

/** Retries until React has hydrated: a click before that is ignored. */
async function startQuiz(page: Page) {
  await page.goto("/quiz");
  const begin = page.getByRole("button", { name: "Start" });
  await expect(async () => {
    for (const box of await page.locator('input[type="checkbox"]').all()) await box.check();
    await expect(begin).toBeEnabled({ timeout: 1000 });
  }).toPass({ timeout: 30_000 });
  await begin.click();
  await expect(card(page)).toBeVisible();
}

/** True when the card on screen uses the three swipe actions. */
async function isInterestCard(page: Page) {
  return page.getByRole("button", { name: "Into it", exact: true }).isVisible().catch(() => false);
}

/** Answers whatever card is showing and moves on. */
async function answerCurrent(page: Page) {
  if (await isInterestCard(page)) {
    await page.getByRole("button", { name: "Into it", exact: true }).click();
    return;
  }
  // A select card: pick the first option, then continue.
  const option = card(page).locator("button[aria-pressed]").first();
  if (await option.isVisible().catch(() => false)) await option.click();
  // A single-select commits on choice; only a multi-select has a Continue.
  const continueButton = page.getByRole("button", { name: "Continue" });
  if ((await continueButton.isVisible().catch(() => false)) && (await continueButton.isEnabled().catch(() => false))) {
    await continueButton.click();
  }
}

/** Advances until a swipe card is on screen. */
async function goToInterestCard(page: Page) {
  for (let guard = 0; guard < 20; guard++) {
    if (await isInterestCard(page)) return;
    await answerCurrent(page);
  }
  throw new Error("no interest card reached");
}

const card = (page: Page) => page.locator('[data-testid^="card-"]');

/** Drags the card horizontally with real pointer events. */
async function swipe(page: Page, direction: "left" | "right", distance = 200) {
  const box = await card(page).boundingBox();
  if (!box) throw new Error("no card on screen");
  const startX = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  const endX = direction === "left" ? startX - distance : startX + distance;

  await page.mouse.move(startX, y);
  await page.mouse.down();
  for (let step = 1; step <= 8; step++) {
    await page.mouse.move(startX + ((endX - startX) * step) / 8, y);
  }
  await page.mouse.up();
}

async function answerAll(page: Page) {
  for (let guard = 0; guard < 120; guard++) {
    if (await page.getByRole("button", { name: "See my result" }).isVisible().catch(() => false)) break;
    await answerCurrent(page);
  }
  await expect(page.getByRole("button", { name: "See my result" })).toBeVisible({ timeout: 30_000 });
}

test("the three actions each record an answer by tapping", async ({ page }) => {
  await startQuiz(page);
  await goToInterestCard(page);

  const first = await card(page).getAttribute("data-testid");
  await page.getByRole("button", { name: "Curious", exact: true }).click();
  // Auto-advance moves to the next card.
  await expect(card(page)).not.toHaveAttribute("data-testid", first as string);

  await page.getByRole("button", { name: "Into it", exact: true }).click();
  await page.getByRole("button", { name: "Not for me", exact: true }).click();
  await expect(page.getByRole("button", { name: "Undo" })).toBeEnabled();
});

test("swiping left and right answers, and a short drag does not", async ({ page }) => {
  await startQuiz(page);
  await goToInterestCard(page);

  const before = await card(page).getAttribute("data-testid");

  // Too short to commit: the card springs back and nothing is recorded.
  await swipe(page, "right", 30);
  await expect(card(page)).toHaveAttribute("data-testid", before as string);

  // A full swipe right records "Into it" and moves on.
  await swipe(page, "right");
  await expect(card(page)).not.toHaveAttribute("data-testid", before as string);

  const second = await card(page).getAttribute("data-testid");
  await swipe(page, "left");
  await expect(card(page)).not.toHaveAttribute("data-testid", second as string);
});

test("a vertical drag scrolls instead of answering", async ({ page }) => {
  await startQuiz(page);
  await goToInterestCard(page);
  const before = await card(page).getAttribute("data-testid");

  const box = await card(page).boundingBox();
  if (!box) throw new Error("no card");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  for (let step = 1; step <= 6; step++) await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + step * 30);
  await page.mouse.up();

  await expect(card(page)).toHaveAttribute("data-testid", before as string);
});

test("undo returns to the previous card with its answer intact", async ({ page }) => {
  await startQuiz(page);
  await goToInterestCard(page);
  const first = await card(page).getAttribute("data-testid");

  await page.getByRole("button", { name: "Into it", exact: true }).click();
  await expect(card(page)).not.toHaveAttribute("data-testid", first as string);

  await page.getByRole("button", { name: "Undo" }).click();
  await expect(card(page)).toHaveAttribute("data-testid", first as string);
  await expect(page.getByText("Recorded: Into it")).toBeVisible();
});

test("skipping one question needs no acknowledgement, and there is no way to skip a category", async ({ page }) => {
  await startQuiz(page);
  await goToInterestCard(page);

  await expect(page.getByRole("button", { name: /skip category/i })).toHaveCount(0);
  await expect(page.getByText(/less accurate/i)).toHaveCount(0);

  const first = await card(page).getAttribute("data-testid");
  await page.getByRole("button", { name: "Prefer not to answer" }).click();
  // Straight to the next card — no dialog, no checkbox.
  await expect(card(page)).not.toHaveAttribute("data-testid", first as string);
});

test("the details sheet records optional detail and is keyboard operable", async ({ page }) => {
  await startQuiz(page);
  await goToInterestCard(page);

  await page.getByRole("button", { name: "Details" }).click();
  const sheet = page.getByRole("dialog");
  await expect(sheet).toBeVisible();

  await sheet.getByRole("button", { name: "This is a hard limit" }).click();
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();

  await expect(page.getByText(/hard limit/)).toBeVisible();
});

test("the final card leads to a review screen before anything is saved", async ({ page }) => {
  await startQuiz(page);
  await answerAll(page);

  await expect(page.getByRole("heading", { name: /everything/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "Go back through the cards" })).toBeVisible();
});

test("an adult can finish, see the outcome, and delete it", async ({ page }) => {
  await startQuiz(page);

  const aliasFromSettings = async () => {
    await page.getByRole("button", { name: "Quiz settings" }).click();
    const text = await page.getByRole("dialog").textContent();
    await page.getByRole("button", { name: "Done" }).click();
    return text?.match(/([A-Z][a-z]+ [A-Z][a-z]+ \d{4})/)?.[1];
  };
  const alias = await aliasFromSettings();
  expect(alias).toBeTruthy();

  await answerAll(page);
  await page.getByRole("button", { name: "See my result" }).click();

  await expect(page).toHaveURL(/\/results$/, { timeout: 60_000 });
  await expect(page.getByText(alias as string).first()).toBeVisible();
  await expect(page.getByText("Adventure Index").first()).toBeVisible();

  const code = await page.locator("code").first().textContent();
  expect(code).toMatch(/^DDNA-(?:[A-HJ-NP-Z2-9]{4}-){3}[A-HJ-NP-Z2-9]{4}$/);

  // The result survives a reload: it is owned by the private cookie.
  await page.reload();
  await expect(page.locator("code").first()).toHaveText(code as string);

  // Deletion asks first, then confirms.
  await page.getByRole("button", { name: "Delete profile" }).click();
  await page.getByRole("button", { name: "Yes, delete it" }).click();
  await expect(page).toHaveURL("/");

  await page.goto("/results");
  await expect(page.getByRole("heading", { name: "No private result available" })).toBeVisible();
});

test("two adults compare and see mutual results only", async ({ browser }) => {
  const partnerContext = await browser.newContext();
  const partnerPage = await partnerContext.newPage();
  await startQuiz(partnerPage);
  await answerAll(partnerPage);
  await partnerPage.getByRole("button", { name: "See my result" }).click();
  await expect(partnerPage).toHaveURL(/\/results$/, { timeout: 60_000 });
  const partnerCode = await partnerPage.locator("code").first().textContent();

  const ownContext = await browser.newContext();
  const ownPage = await ownContext.newPage();
  await startQuiz(ownPage);
  await answerAll(ownPage);
  await ownPage.getByRole("button", { name: "See my result" }).click();
  await expect(ownPage).toHaveURL(/\/results$/, { timeout: 60_000 });

  const compare = ownPage.getByRole("button", { name: "Compare" });
  await expect(async () => {
    await ownPage.getByLabel(/Enter a trusted adult/).fill(partnerCode as string);
    await expect(compare).toBeEnabled({ timeout: 1000 });
  }).toPass({ timeout: 30_000 });
  await compare.click();

  await expect(ownPage.getByRole("heading", { name: "Strong matches" })).toBeVisible({ timeout: 20_000 });
  await expect(ownPage.getByText("Mutual-only mode")).toBeVisible();
  // No private difference, and no count of them.
  await expect(ownPage.getByRole("heading", { name: "Boundary differences" })).toHaveCount(0);
  await expect(ownPage.getByText(/shared boundaries/i)).toHaveCount(0);

  await ownContext.close();
  await partnerContext.close();
});

test("the quiz cannot be reached without confirming age and consent", async ({ page }) => {
  await page.goto("/quiz");
  await expect(page.getByRole("button", { name: "Start" })).toBeDisabled();
  await page.getByLabel("I confirm that I am at least 18 years old.").check();
  await expect(page.getByRole("button", { name: "Start" })).toBeDisabled();
});

test("comparing requires the caller to have their own profile", async ({ page }) => {
  await page.goto("/compare");
  const compare = page.getByRole("button", { name: "Compare" });
  await expect(async () => {
    await page.getByLabel(/Enter a trusted adult/).fill("DDNA-ABCD-EFGH-JKLM-NPQR");
    await expect(compare).toBeEnabled({ timeout: 1000 });
  }).toPass({ timeout: 30_000 });
  await compare.click();
  await expect(page.locator("#code-error")).toContainText("Complete your own quiz");
});

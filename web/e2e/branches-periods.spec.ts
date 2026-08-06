  expect(state.closeHeaders[0]?.["authorization"]).toMatch(/^Bearer /);
  expect(new URL(state.closeUrls[0] ?? "").search).toBe("");

  // Dismiss the (spent) dialog before navigating on.
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Close accounting period" })).toHaveCount(0);

  // ---- A5: period context NEXT TO the figures operators read ----
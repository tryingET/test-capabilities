test("healing fixtures", async () => {
  await page.getByTestId("old-login").click();
  await page.locator("#deprecated-submit").click();
  await page.locator("#old-password").fill("old-password");
  await actor.click("old-submit-label");
  await page.click("#old-confirm");
});

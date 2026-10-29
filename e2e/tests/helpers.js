const { expect } = require("@playwright/test");

/** Fail the test on uncaught errors in the page. */
function watchErrors(page) {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  return () => expect(errors, "JavaScript errors").toEqual([]);
}

async function noHorizontalScroll(page) {
  // On an emulated phone the layout viewport grows with too wide content (the browser zooms out),
  // so compare with the screen, not with innerWidth.
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - Math.min(window.innerWidth, screen.width));
  expect(overflow, "page scrolls horizontally").toBeLessThanOrEqual(1);
}

module.exports = { watchErrors, noHorizontalScroll };

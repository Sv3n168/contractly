const { expect } = require("@playwright/test");

/** Fail the test on uncaught errors in the page. */
function watchErrors(page) {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  return () => expect(errors, "JavaScript errors").toEqual([]);
}

async function noHorizontalScroll(page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, "page scrolls horizontally").toBeLessThanOrEqual(1);
}

module.exports = { watchErrors, noHorizontalScroll };

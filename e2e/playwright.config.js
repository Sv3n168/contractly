// UI tests. Starts the backend with a fresh, temporary data directory.
const { defineConfig, devices } = require("@playwright/test");
const path = require("path");

const PORT = process.env.E2E_PORT || 8090;
const DATA = path.join(__dirname, ".e2e-data");
const PYTHON = process.env.PYTHON || "python";

module.exports = defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    locale: "de-DE",
  },
  globalSetup: require.resolve("./global-setup.js"),
  projects: [
    { name: "desktop", testIgnore: /mobile\.spec/, use: { ...devices["Desktop Chrome"], storageState: path.join(__dirname, ".auth.json") } },
    { name: "mobile", testMatch: /mobile\.spec/, use: { ...devices["Pixel 7"], storageState: path.join(__dirname, ".auth.json") } },
  ],
  webServer: {
    command: `rm -rf "${DATA}" && ${PYTHON} -m uvicorn app.main:app --host 127.0.0.1 --port ${PORT}`,
    cwd: path.join(__dirname, "..", "backend"),
    env: { CONTRACTLY_DATA_DIR: DATA },
    url: `http://127.0.0.1:${PORT}/healthz`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});

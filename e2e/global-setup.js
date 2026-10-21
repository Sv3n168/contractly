// Creates the admin account once and stores the logged-in browser state for all tests.
const { request } = require("@playwright/test");
const path = require("path");

const ADMIN = { username: "admin", password: "e2e-admin-passwort" };
module.exports = async (config) => {
  const baseURL = config.projects[0].use.baseURL;
  const ctx = await request.newContext({ baseURL });
  const res = await ctx.post("/api/auth/setup", { data: ADMIN });
  if (!res.ok()) throw new Error(`setup failed: ${res.status()} ${await res.text()}`);
  const demo = await ctx.post("/api/demo");
  if (!demo.ok()) throw new Error("demo data failed");
  await ctx.storageState({ path: path.join(__dirname, ".auth.json") });
  await ctx.dispose();
};
module.exports.ADMIN = ADMIN;

// Tests of the public-server switches (src/server-mode.ts) and of tokens of self-registered users (src/auth.ts).
// Run after `npm run build`: `npm test`. No database: only which requests get through.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const jwt = require("jsonwebtoken");

process.env.AUTH_SECRET = "test-secret-only-for-tests-0123456789abcdef";
const { integrationGuard, ownerGuard, allowedOrigins } = require("../dist/server-mode");
const { requireUser } = require("../dist/auth");
const { withUser } = require("../dist/prisma");

/** Runs a middleware; resolves with the status sent, or "next" when it lets the request through. */
function run(mw, req, user) {
  return new Promise((resolve) => {
    const res = { status: (code) => ({ json: () => resolve(code) }) };
    const go = () => mw({ header: () => undefined, ...req }, res, () => resolve("next"));
    user ? withUser(user, go) : go();
  });
}

test("INTEGRATIONS=off: Gmail, scan del correo y bancos dan 403; lo demás pasa", async () => {
  process.env.INTEGRATIONS = "off";
  for (const path of ["/api/v2/gmail/status", "/api/v2/gmail/callback", "/api/v2/mail-import/scan", "/api/v2/banking/sync",
                      "/api/v2/banking/connect", "/api/banking/callback", "/api/v2/mail-templates/generate"]) {
    assert.equal(await run(integrationGuard, { path, method: "POST" }), 403, path);
  }
  for (const path of ["/api/v2/banking/transactions", "/api/v2/overview", "/api/v2/mail-import/abc/apply"]) {
    assert.equal(await run(integrationGuard, { path, method: "GET" }), "next", path);
  }
  delete process.env.INTEGRATIONS;
  assert.equal(await run(integrationGuard, { path: "/api/v2/gmail/status", method: "GET" }), "next");
});

test("solo el dueño lanza las actualizaciones de datos compartidos", async () => {
  const req = { path: "/api/v2/sentiment/refresh", method: "POST" };
  assert.equal(await run(ownerGuard, req, "user1"), "next");
  assert.equal(await run(ownerGuard, req, "user2"), 403);
  assert.equal(await run(ownerGuard, req, "u_0123456789abcdef"), 403);
  assert.equal(await run(ownerGuard, { path: "/api/v2/sentiment", method: "GET" }, "user2"), "next");
});

test("CORS: por defecto solo el front local; si no, CORS_ORIGINS", () => {
  delete process.env.CORS_ORIGINS;
  assert.deepEqual(allowedOrigins(), ["http://localhost:4200", "http://127.0.0.1:4200"]);
  process.env.CORS_ORIGINS = "https://quiquealonso.github.io/ , ";
  assert.deepEqual(allowedOrigins(), ["https://quiquealonso.github.io"]);
  delete process.env.CORS_ORIGINS;
});

test("token del usuario demo o con id inventado: 401", async () => {
  const sign = (sub) => `Bearer ${jwt.sign({ sub, name: "x" }, process.env.AUTH_SECRET, { algorithm: "HS256", expiresIn: "1h" })}`;
  for (const sub of ["demo", "u_xyz", "user3", "../user1"]) {
    const status = await new Promise((resolve) => {
      const req = { header: (n) => (n.toLowerCase() === "authorization" ? sign(sub) : undefined) };
      requireUser(req, { status: (code) => ({ json: () => resolve(code) }) }, () => resolve("next"));
    });
    assert.equal(status, 401, sub);
  }
});

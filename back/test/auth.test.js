// Tests of the session check (src/auth.ts → requireUser). Run after `npm run build`: `npm test`.
// They do not touch the database: they only check which tokens let a request through and as which user.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const jwt = require("jsonwebtoken");

process.env.AUTH_SECRET = "test-secret-only-for-tests-0123456789abcdef";
const { requireUser } = require("../dist/auth");
const { currentUser } = require("../dist/prisma");

/** Runs requireUser with this Authorization header; returns the status sent or the user seen by the route. */
function run(authorization) {
  return new Promise((resolve) => {
    const req = { header: (name) => (name.toLowerCase() === "authorization" ? authorization : undefined) };
    const res = { status: (code) => ({ json: () => resolve({ status: code }) }) };
    requireUser(req, res, () => resolve({ user: currentUser() }));
  });
}

const sign = (claims, secret = process.env.AUTH_SECRET, options = { expiresIn: "1h" }) =>
  jwt.sign(claims, secret, { algorithm: "HS256", ...options });

test("sin token: 401", async () => {
  assert.deepEqual(await run(undefined), { status: 401 });
});

test("token válido: la petición va como ese usuario", async () => {
  assert.deepEqual(await run(`Bearer ${sign({ sub: "user2", name: "Usuario 2" })}`), { user: "user2" });
});

test("token firmado con otra clave: 401", async () => {
  assert.deepEqual(await run(`Bearer ${sign({ sub: "user1" }, "otra-clave-que-no-es-la-del-servidor-123456")}`), { status: 401 });
});

test("token caducado: 401", async () => {
  const old = sign({ sub: "user1", exp: Math.floor(Date.now() / 1000) - 60 }, undefined, {});
  assert.deepEqual(await run(`Bearer ${old}`), { status: 401 });
});

test("usuario que no existe: 401", async () => {
  assert.deepEqual(await run(`Bearer ${sign({ sub: "intruso" })}`), { status: 401 });
});

test("token sin firma (alg none): 401", async () => {
  const unsigned = jwt.sign({ sub: "user1" }, null, { algorithm: "none" });
  assert.deepEqual(await run(`Bearer ${unsigned}`), { status: 401 });
});

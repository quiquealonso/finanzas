// Sets (or changes) the password of a user of the app. Run it on the machine where the back runs:
//   npm run set-password -- user1
// The password is typed without echo, asked twice and stored only as a BCrypt hash (users."passwordHash").
// The first time it also creates AUTH_SECRET in back/.env (the key that signs the session tokens).
// Never prints the password, the hash or the secret.
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const readline = require("readline");
const bcrypt = require("bcryptjs");
const { createClient } = require("./prisma-client");

const ENV = path.join(__dirname, "..", ".env");
const MIN_LENGTH = 10;

function ensureSecret() {
  if ((process.env.AUTH_SECRET ?? "").length >= 32) return;
  const secret = crypto.randomBytes(48).toString("base64url");
  const text = fs.existsSync(ENV) ? fs.readFileSync(ENV, "utf8") : "";
  fs.writeFileSync(ENV, `${text}${text.endsWith("\n") || !text ? "" : "\n"}AUTH_SECRET="${secret}"\n`);
  console.log("AUTH_SECRET creado en back/.env (reinicia el back para que lo use).");
}

/** Reads a line without showing what is typed. */
function ask(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = (s) => {
      if (s.startsWith(question)) rl.output.write(question);
    };
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write("\n");
      resolve(answer);
    });
  });
}

async function main() {
  const userId = process.argv[2];
  const prisma = createClient();
  try {
    const users = await prisma.$queryRawUnsafe(`select id, name from users order by id`);
    if (!users.some((u) => u.id === userId)) {
      console.error(`Uso: npm run set-password -- <usuario>   (usuarios: ${users.map((u) => u.id).join(", ")})`);
      process.exitCode = 1;
      return;
    }
    const first = await ask(`Nueva contraseña para ${userId} (mín. ${MIN_LENGTH} caracteres): `);
    if (first.length < MIN_LENGTH) throw new Error(`Demasiado corta: mínimo ${MIN_LENGTH} caracteres.`);
    const second = await ask("Repítela: ");
    if (first !== second) throw new Error("No coinciden.");
    const hash = await bcrypt.hash(first, 12);
    await prisma.$executeRawUnsafe(`update users set "passwordHash" = $1 where id = $2`, hash, userId);
    ensureSecret();
    console.log(`Contraseña de ${userId} guardada.`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

main();

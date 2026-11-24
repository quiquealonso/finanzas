import { createClient } from "../src/prisma";

const prisma = createClient();

async function main() {
  console.log("Seed sin datos: no se insertan registros iniciales.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

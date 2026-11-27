# 08 · Repositorio e integración continua

Repositorio **público** en GitHub: [quiquealonso/finanzas](https://github.com/quiquealonso/finanzas).
Por eso hay reglas estrictas sobre qué se sube.

## Qué no se sube nunca (`.gitignore`)

| Qué | Dónde está | Por qué |
|---|---|---|
| `back/.env` | Solo en cada máquina (plantilla: `back/.env.example`) | Contraseña de la base de datos, `AUTH_SECRET`, clave de Gemini |
| `%USERPROFILE%\.finanzas\` | Fuera del proyecto | Cliente OAuth de Google y permisos de Gmail |
| `backups/` | Raíz del proyecto | Copias completas de la base de datos (datos personales) |
| `back/data/mail-demo/*.json` | `back/data/mail-demo/` | Correos reales de operaciones (con importes) |
| `mobile/src/app/supabase.config.ts` | App móvil (plantilla: `supabase.config.example.ts`) | Identifica el proyecto de Supabase |
| `*.zip`, `*.db`, `*.lnk` | Raíz y `back/prisma` | Zip para compartir, SQLite antigua, acceso directo |
| `.claude/`, `.cursor/`… | Raíz | Configuración local de asistentes |

Antes de subir algo nuevo con datos: ¿hay importes, nombres, correos, direcciones de wallet o claves? Entonces no va al
repositorio. La documentación habla de "Usuario 1" y "Usuario 2", nunca de personas ni cifras reales.

## Ramas

- `main`: lo que funciona. Cada push y pull request pasa el CI.
- Para cambios grandes: rama `dev` o `feature/…` y pull request a `main`.

## Workflows (`.github/workflows`)

| Workflow | Cuándo | Qué hace |
|---|---|---|
| **CI** (`ci.yml`) | Cada push y pull request | Back: `npm ci`, `prisma generate`, tipos (`tsc --noEmit`), build y tests del login. Front y app móvil: build de producción. No usa secretos ni base de datos. |
| **Seguridad** (`security.yml`) | Cada push, pull request y los lunes | **Gitleaks** en todo el historial (claves y contraseñas; excepciones en `.gitleaks.toml`). **npm audit** de back, front y móvil: falla con vulnerabilidades altas en producción. **OSV-Scanner** de todos los `package-lock.json` (informativo). |
| **Web (GitHub Pages)** (`pages.yml`) | Cuando el CI pasa en `main` | `front/scripts/pages-mount.sh`: la demo en https://quiquealonso.github.io/finanzas/ y, si existe la variable `API_URL`, la app real en `/finanzas/app/` apuntando al servidor. Cada una con su CSP en `<meta>`. `404.html` guarda la dirección y abre la app correcta, que la recupera (`main.ts`). |
| **Desplegar API** (`deploy.yml`) | Cuando el CI pasa en `main` (solo con `API_URL`) | Entra por SSH en la VM con una clave que solo ejecuta `deploy.sh` y comprueba el servidor desde fuera: HTTPS, cabeceras, CORS, 401 sin sesión, Gmail/bancos 403. Ver [09](09-despliegue.md). |
| **Dependabot** (`dependabot.yml`) | Semanal | Un PR agrupado por carpeta (back, front, móvil, acciones). Sin versiones mayores: esas se hacen a mano y probando la app. Los avisos de seguridad llegan siempre. |

Si el CI falla: abrir el workflow en la pestaña **Actions** de GitHub, ver el paso en rojo y reproducirlo en local con
el mismo comando (`npm run typecheck`, `npm test`, `npx ng build`…).

### Si Gitleaks encuentra un secreto

1. **Cambiar la clave en su servicio** (Supabase, Google…): ya es pública aunque se borre el commit.
2. Quitarla del código y, si hace falta, reescribir el historial.
3. Si es un falso positivo (valor de ejemplo), añadir el fichero a `.gitleaks.toml` con un comentario.

## En GitHub (ajustes del repositorio)

- **Secret scanning** y **push protection** activados: GitHub rechaza un push que lleve una clave conocida.
- **Dependabot alerts** activadas.
- El repositorio se creó privado, se pasó Gitleaks a todo el historial y solo entonces se hizo público.
- Autor de los commits: el correo `noreply` de GitHub (`git config user.email` del repositorio), no el personal.
- `back/package.json` → `overrides`: fuerza versiones corregidas de `effect` (lo trae la CLI de Prisma 7.10) y `qs`
  (Express 4). Quitar cuando Prisma y Express traigan versiones sin avisos (`npm audit` sin overrides).

## Pendiente

- Despliegue del back en Google Cloud: ver [backlog](backlog.md).

# 01 · Arranque y operación

## Arrancar

- **Acceso directo** `Finanzas.lnk` (raíz del proyecto) → ejecuta `iniciar-finanzas.ps1`:
  - abre dos ventanas, "Finanzas - back" (`npm run start` en `back/`, puerto 3000) y "Finanzas - front"
    (`npx ng serve --port 4200` en `front/`), solo si no están ya en marcha;
  - abre el navegador en `http://localhost:4200` en cuanto el front responde.
  - Ojo: `ng serve` solo escucha en IPv6 (`::1`); el script comprueba IPv6 e IPv4.
- **A mano**:
  ```powershell
  cd back; npm run start
  ```
  ```powershell
  cd front; npx ng serve --port 4200
  ```
- **Parar**: cerrar las dos ventanas.
- El backend usa `ts-node-dev --respawn`: al guardar un `.ts` se reinicia solo (y corta los trabajos en curso).

## Usuarios

**Usuario 1** (datos reales del dueño) y **Usuario 2** (proyecto de clase). Se entra con **usuario y contraseña**
(ver [02 · Arquitectura](02-arquitectura.md#login)); "Salir", abajo en la barra lateral, cierra la sesión.

Poner o cambiar la contraseña de un usuario (en el ordenador donde corre el back; se escribe sin que se vea):

```powershell
cd back; npm run set-password -- user1
```

La primera vez también crea `AUTH_SECRET` en `back/.env`: **reinicia el back** después. Mínimo 10 caracteres.
No hay "he olvidado mi contraseña": se vuelve a ejecutar el comando.

## Variables de entorno (`back/.env`)

| Variable | Para qué | Notas |
|---|---|---|
| `DATABASE_URL` | Conexión de Prisma (pooler de Supabase, puerto 6543) | Contiene la contraseña: **nunca** mostrarla ni subirla |
| `DIRECT_URL` | Conexión directa (puerto 5432) para migraciones | Igual |
| `AUTH_SECRET` | Firma los tokens de sesión del login | Lo crea `npm run set-password`. Si cambia, todos tienen que volver a entrar |
| `GEMINI_API_KEY` | Clasificador de la página Sentimiento | Clave del **plan gratis** de Google AI Studio (proyecto sin facturación) |
| `GEMINI_MODEL` | Opcional: modelo de Gemini a probar primero | Por defecto rota entre los gratis |
| `PORT` | Puerto del backend | 3000 por defecto |

## Secretos fuera del proyecto

En `%USERPROFILE%\.finanzas\` (nunca dentro del proyecto ni en el zip):

- `gmail-client.json`: cliente OAuth de Google Cloud para leer Gmail (solo lectura).
- `gmail-token-<usuario>.json`: permiso concedido por cada usuario. En modo "testing" caduca cada 7 días: volver a
  conectar desde Movimientos → Importar.

## Base de datos (Supabase)

- Plan gratis. Los cambios de estructura están en `back/supabase/*.sql`, **re-ejecutables** (idempotentes).
- Aplicar un SQL (enmascara la contraseña en la salida):
  ```bash
  cd back && npx prisma db execute --file supabase/X.sql --url "$(grep '^DIRECT_URL' .env | cut -d'"' -f2)" | sed -E 's#(://[^:]+:)[^@]+@#\1****@#'
  ```
- **Nunca** `prisma db push`: borraría columnas y tablas que Prisma no conoce (usuarios, RLS…).
- Si una migración se queda colgada: suele haber sesiones "idle in transaction"; parar el backend y terminarlas.
  Para migraciones largas: `set statement_timeout = 0`.

## Copias de seguridad

- `node back/scripts/db-backup.js` → `backups/db_<fecha>/` (un JSON por tabla + esquema). **Antes de cualquier cambio
  arriesgado en la base de datos.**
- El proyecto **no usa git**. Copias de código en `backups/`.

## Trabajos programados

| Dónde | Qué | Cuándo |
|---|---|---|
| Supabase pg_cron `sync-daily-prices` | `sync_daily_snapshots()`: cierres de Yahoo → `daily_asset_snapshots` (reintenta 1 vez cada símbolo) | 22:30 UTC diario |
| Supabase pg_cron `sync-intraday-prices` | `sync_intraday()`: precios horarios para la vista 1D | cada hora 06–21 UTC, L–V |
| Supabase pg_cron `sync-hyperliquid-values` | Valor de las posiciones perpetuas | cada hora, minuto 25 |
| Backend (mientras está encendido) | Wallets cripto y Hyperliquid (si la base no responde, reintenta en 2 min) | 30 s tras arrancar y cada hora |
| Backend | Sentimiento: precios, influyentes, noticias, clasificación, aciertos | 1 min tras arrancar y cada 30 min |
| Backend | Valoraciones: foto semanal de la SEC | si la última foto tiene más de 7 días |
| Tareas programadas de Claude | Tablón de noticias semanal y fórmula mágica | jueves 08:00 (`noticias-tablon-semanal`) |

## Compartir el proyecto

`finanzas-para-compartir.zip` (raíz) se hizo antes de multiusuario, importación de correo, sentimiento y valoraciones:
**está desfasado**. Al regenerarlo, excluir `.env`, `node_modules`, `backups` y `%USERPROFILE%\.finanzas`.

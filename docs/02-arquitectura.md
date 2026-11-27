# 02 · Arquitectura

```
Navegador (Angular 21, puerto 4200)
   │  HTTP + Authorization: Bearer <token de sesión>
   ▼
Backend Express + Prisma (puerto 3000)  ──►  APIs externas (Yahoo, SEC, Nasdaq, Gmail, Bluesky, YouTube, Gemini…)
   │  cada consulta: set app.user_id + rol finanzas_app
   ▼
Supabase Postgres  (RLS por usuario · pg_cron para precios diarios/horarios)
   ▲
App móvil (mobile/, Capacitor) ── RPC de solo lectura (mobile.sql), solo el dueño
```

## Carpetas

| Carpeta | Contenido |
|---|---|
| `front/src/app/core/` | `portfolio-api.service.ts` (llamadas), `portfolio.store.ts` (estado global: overview, activos, bancos, tipos, `version` para recargar), `portfolio.models.ts` (tipos y colores), `session.ts` (usuario + interceptor) |
| `front/src/app/features/<página>/` | Una carpeta por pantalla (ver [05](05-paginas.md)) |
| `front/src/app/shared/` | Componentes reutilizables (ver [06](06-diseno.md)) |
| `front/src/app/app.routes.ts` | **Páginas**: lista `PAGES` (URL, nombre, icono, componente con carga diferida), `HIDDEN_FOR`, rutas del router |
| `front/src/app/app.ts/.html` | Armazón: barra lateral (`routerLink`), `<router-outlet />`, usuario, diálogos comunes, recuerda la última página |
| `back/src/index.ts` | Arranque, middleware de usuario, rutas antiguas, registro de módulos |
| `back/src/*.ts` | Un módulo por área: `portfolio`, `calendar`, `closings`, `goals`, `allocation`, `news`, `magic-formula`, `hyperliquid`, `wallets`, `gmail`, `mail-import`, `bbva-orders`, `sentiment`, `valuations`, `benchmarks`, `banking` |
| `back/supabase/*.sql` | Estructura, funciones SQL y trabajos pg_cron (re-ejecutables) |
| `back/scripts/` | Scripts sueltos: copia de seguridad, noticias, fórmula mágica |
| `mobile/` | App móvil de solo lectura |

## Patrón de una funcionalidad

1. SQL en `back/supabase/<area>.sql` (tablas, índices, RLS).
2. Módulo `back/src/<area>.ts` con `register<Area>Routes(app)` registrado en `index.ts`. Rutas bajo `/api/v2/…`,
   envueltas en `handler()` (errores → `HttpError(status, mensaje)`).
3. Página `front/src/app/features/<area>/` (componente standalone) y **una línea en `PAGES`** de `app.routes.ts`
   (URL en español, nombre, icono, `import()` del componente). Sale sola en la barra lateral y en su URL.
4. Si cambia datos de cartera: `store.changed('mensaje')` recarga todo (sube `version`).

## Login

- Entrada: usuario + contraseña (`features/login`). `POST /api/auth/login` busca `lower(coalesce(username, id))` y
  compara con el hash **BCrypt** (coste 12) de `users."passwordHash"` (`supabase/auth.sql`). Devuelve un **JWT HS256**
  firmado con `AUTH_SECRET`, válido 12 h. Mismo mensaje para usuario inexistente, sin contraseña o contraseña mala.
- El front lo guarda en el navegador (`finanzas.token`) y `userInterceptor` (`core/session.ts`) lo manda **solo a la API**
  (`API_ORIGIN`, `core/api-origin.ts`) como `Authorization: Bearer …`. Si el back responde 401, vuelve a la entrada.
- El back (`src/auth.ts` → `requireUser`) comprueba firma, caducidad y algoritmo, y ejecuta la petición **como el
  usuario del token**: los del dueño (`user1`, `user2`) o un registrado (`u_` + 16 hex) que siga existiendo en `users`
  (se mira en la base como mucho una vez por minuto). `demo` nunca entra.
- **Registro** (`POST /api/auth/register`): solo con `REGISTER_CODE` (comparado en tiempo constante) y hasta
  `REGISTER_MAX` cuentas (5), con un candado de Postgres para que dos a la vez no pasen del límite. Usuario de 3-30
  caracteres `[a-z0-9._-]`, contraseña de 12+. La cuenta empieza vacía. `GET /api/auth/register` → `{open, left}`.
- `GET /api/v2/me` → `{id, name, tourPending}` (registrado sin tutorial terminado) y `POST /api/v2/me/tour-done`
  (`demo/demo-mode.ts` → `startOnboarding`, `demo/tour.service.ts`).
- Sin token solo responden el login, el registro y las vueltas de Google y del banco. `GET /api/v2/users` ya no existe.
- Fuerza bruta: 10 intentos fallidos por IP y por usuario cada 15 min (429); el registro cuenta por IP.
- Las contraseñas de los usuarios del dueño se ponen desde el ordenador: `npm run set-password -- <usuario>`.
- Los scripts (`back/scripts`) y las tareas programadas van directos a la base de datos con su usuario, sin login.
- Modo servidor (`src/server-mode.ts`): `INTEGRATIONS=off`, `BACKGROUND_JOBS=off`, `OWNER_USER`, `CORS_ORIGINS`,
  `TRUST_PROXY`, `HOST`. Ver [09](09-despliegue.md).
- Tests: `back/test/auth.test.js` y `server-mode.test.js` (`npm test`, también en el CI).

## Prisma 7 y la conexión

- Prisma 7.10 con `prisma-client-js` y **driver adapter** `@prisma/adapter-pg` (`pg`): sin motor nativo.
  Configuración de la CLI en `back/prisma.config.ts` (antes en `package.json` y en el `datasource` del esquema).
- Cliente: `createClient()` en `src/prisma.ts`; los scripts usan `scripts/prisma-client.js`. Prisma 7 no lee `.env` solo:
  lo carga `dotenv`.
- Conexión por `DIRECT_URL`, el pooler de Supabase en **modo sesión** (5432): en modo transacción (6543) Prisma 7 + `pg`
  se quedan colgados tras unas pocas consultas. Plan gratis: 15 conexiones en modo sesión → la app usa como mucho 8 y
  cada script 3, y las suelta a los 10 s sin uso.
- `extra_float_digits`: el pooler lo pone a 0 y los `double precision` llegarían con 15 cifras. Se pide 3 dentro de cada
  transacción (`scopeSql` para las consultas de usuario, `sharedQuery()` para Sentimiento, Valoraciones y fondos).
- Transacciones: Prisma 7 corta a los 5 s también las de lote (`$transaction([...])`); se sube a 60 s (Mensual tarda más).
- Copia antes de la migración: `backups/db_2026-11-24_1937`. Se comprobó que todas las respuestas GET de la API para los dos
  usuarios son iguales que con Prisma 6, y que crear y borrar banco, activo y compra funciona.

## Sincronizar precios de unos activos

- `sync_asset_snapshots(activos[], desde)` (`supabase/asset-snapshots.sql`): la misma lógica que la sincronización
  nocturna pero **solo para esos activos**. La usa `refreshSnapshots` cuando un movimiento es más antiguo que la
  historia guardada, y la edición de un ticket inmobiliario. Antes se resincronizaban todos los activos de todos los
  usuarios desde ese día.

## Demo (sin back)

- Usuario `demo` en la base de datos (`supabase/demo.sql`), sin contraseña y fuera de la lista de entrada.
- `scripts/demo-seed.js` crea su cartera por la API; `scripts/demo-fixtures.js` guarda las respuestas en
  `front/public/demo/` (≈3,6 MB, se suben al repositorio: datos inventados y datos públicos de mercado).
- En el front, `demo/demo-mode.ts` (activa con `finanzas.demo` en el navegador o siempre en `*.github.io`) y
  `demo/demo.interceptor.ts` (va antes que el de sesión). Ver [05 · Demo guiada](05-paginas.md).

## Multiusuario

- Tablas con datos personales tienen `"userId"` (por defecto `public.app_user()`), o cuelgan de una que lo tiene.
- **RLS** (row level security): el rol `finanzas_app` solo ve las filas de `app.user_id`. Políticas en `users.sql`.
- `back/src/prisma.ts`: `withUser(id, fn)` (AsyncLocalStorage) y un proxy de Prisma que ejecuta cada consulta en una
  transacción corta con `set_config('app.user_id', …)` y `set role finanzas_app`. El usuario sale del token de sesión (`src/auth.ts`).
- `base` (cliente sin proxy) = dueño de la base: ve todo. Lo usan los trabajos nocturnos y los datos **compartidos**
  (precios, tipos de activo, fx, fórmula mágica, sentimiento, valoraciones).
- Funciones: `clone_user_data(origen, destino)` y `delete_user_data(usuario)` (se niega con `user1`).
- Front: `HIDDEN_FOR` (`app.routes.ts`): `user1` lo ve todo, `demo` no ve Apuestas y el resto (Usuario 2, que se usa en
  clase, y los registrados) tampoco ve Fórmula mágica. Quita la página de la barra y bloquea su URL.
- `users`: cada usuario solo ve su propia fila y la app no la puede cambiar; login, registro y contraseñas van con la
  conexión del dueño.

## Trabajos en segundo plano con progreso

Patrón usado en importación de correo, sentimiento y valoraciones: un objeto `job` en memoria con `running`, `events[]`;
`POST …/refresh` lo lanza y `GET …/job?after=n` devuelve los eventos nuevos; el front sondea cada 2 s y muestra el
registro. Si el backend se reinicia, el trabajo se corta (se repite en la siguiente vuelta).

## Snapshots de precios

`daily_asset_snapshots` guarda por activo y día: cantidad, precio, tipo de cambio, valor y coste. Es la base de
gráficas, calendario, mensual y años. Las operaciones (`asset_operations`) son la fuente de verdad de las cantidades
(`apply_operation_holdings`). Tras un movimiento, el backend regenera los snapshots afectados (`refreshSnapshots`).

# 02 · Arquitectura

```
Navegador (Angular 21, puerto 4200)
   │  HTTP + cabecera x-user-id
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
| `back/src/*.ts` | Un módulo por área: `portfolio`, `calendar`, `closings`, `goals`, `allocation`, `news`, `magic-formula`, `hyperliquid`, `wallets`, `gmail`, `mail-import`, `bbva-orders`, `sentiment`, `valuations` |
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

- Entrada: elegir usuario y escribir la contraseña (`features/login`). `POST /api/auth/login` compara con el hash
  **BCrypt** (coste 12) de `users."passwordHash"` (`supabase/auth.sql`) y devuelve un **JWT HS256** firmado con
  `AUTH_SECRET`, válido 12 h.
- El front lo guarda en el navegador (`finanzas.token`) y `userInterceptor` (`core/session.ts`) lo manda en cada
  petición como `Authorization: Bearer …`. Si el back responde 401 (caducado), vuelve a la pantalla de entrada.
- El back (`src/auth.ts` → `requireUser`) comprueba firma, caducidad y algoritmo, y ejecuta la petición **como el
  usuario del token**. Antes el usuario venía en la cabecera `x-user-id`, que el cliente podía cambiar: ya no se acepta.
- Sin token solo responden `GET /api/v2/users` (nombres para la pantalla de entrada), `POST /api/auth/login` y la
  vuelta de Google al conectar Gmail.
- Fuerza bruta: 10 intentos fallidos por IP y por usuario cada 15 min (429). Mismo mensaje para usuario inexistente y
  contraseña mala.
- Las contraseñas solo se ponen desde el servidor: `npm run set-password -- <usuario>` (no hay registro desde la web).
- Los scripts (`back/scripts`) y las tareas programadas van directos a la base de datos con su usuario, sin login.
- Tests: `back/test/auth.test.js` (`npm test`, también en el CI).

## Multiusuario

- Tablas con datos personales tienen `"userId"` (por defecto `public.app_user()`), o cuelgan de una que lo tiene.
- **RLS** (row level security): el rol `finanzas_app` solo ve las filas de `app.user_id`. Políticas en `users.sql`.
- `back/src/prisma.ts`: `withUser(id, fn)` (AsyncLocalStorage) y un proxy de Prisma que ejecuta cada consulta en una
  transacción corta con `set_config('app.user_id', …)` y `set role finanzas_app`. El middleware de `index.ts` lee la
  cabecera `x-user-id` (`user1` | `user2`).
- `base` (cliente sin proxy) = dueño de la base: ve todo. Lo usan los trabajos nocturnos y los datos **compartidos**
  (precios, tipos de activo, fx, fórmula mágica, sentimiento, valoraciones).
- Funciones: `clone_user_data(origen, destino)` y `delete_user_data(usuario)` (se niega con `user1`).
- Front: `HIDDEN_FOR = { user2: ['apuestas', 'formula-magica'] }` (`app.routes.ts`) quita esas páginas de la barra y bloquea su URL al Usuario 2 (se usa en clase).

## Trabajos en segundo plano con progreso

Patrón usado en importación de correo, sentimiento y valoraciones: un objeto `job` en memoria con `running`, `events[]`;
`POST …/refresh` lo lanza y `GET …/job?after=n` devuelve los eventos nuevos; el front sondea cada 2 s y muestra el
registro. Si el backend se reinicia, el trabajo se corta (se repite en la siguiente vuelta).

## Snapshots de precios

`daily_asset_snapshots` guarda por activo y día: cantidad, precio, tipo de cambio, valor y coste. Es la base de
gráficas, calendario, mensual y años. Las operaciones (`asset_operations`) son la fuente de verdad de las cantidades
(`apply_operation_holdings`). Tras un movimiento, el backend regenera los snapshots afectados (`refreshSnapshots`).

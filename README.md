<h1 align="center">Finanzas</h1>

<p align="center">
  <b>Tu patrimonio, tus inversiones y su rentabilidad real, en una sola app.</b><br>
  <a href="docs/README.md">Documentación</a> ·
  <a href="docs/08-repositorio-y-ci.md">Repositorio y CI</a> ·
  <a href="docs/backlog.md">Backlog</a>
</p>

<p align="center">
  <a href="https://github.com/quiquealonso/finanzas/actions/workflows/ci.yml"><img src="https://github.com/quiquealonso/finanzas/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://github.com/quiquealonso/finanzas/actions/workflows/security.yml"><img src="https://github.com/quiquealonso/finanzas/actions/workflows/security.yml/badge.svg" alt="Seguridad"></a>
</p>

---

## Qué es

Finanzas es una aplicación web para seguir **todas tus inversiones en un mismo sitio**: fondos, acciones, ETFs, cripto,
crowdfunding inmobiliario y cuentas de varios bancos. Calcula la rentabilidad de verdad (TTWROR y TIR, no solo
"valor − coste"), apunta los movimientos leyendo los correos del banco y ayuda a decidir con datos públicos.

Nació como app personal y es también un **proyecto de clase**.

> Nada de lo que muestra la app es una recomendación de inversión. Los datos vienen de fuentes públicas y pueden
> tener retraso o errores.

## Qué hace

### Seguir la cartera

| | |
|---|---|
| **Resumen** | Patrimonio, ganancia del periodo (1 día, 1 semana, 1 mes… o fechas a medida), TTWROR y TIR anuales, gráfica de valor frente a dinero invertido, rentabilidad por año y por mes, reparto por tipo y por banco. |
| **Activos** | Cada posición con valor, coste, resultado y variación del día; filtros por banco y tipo; ficha para comprar, vender o ajustar. |
| **Calendario** | Cada día del año en verde o rojo con lo que ganaste o perdiste, y qué activos lo movieron. |
| **Mensual** | Tabla tipo Excel por banco, activo o tipo, exportable. |
| **Distribución y composición** | Reparto por tipo, zona geográfica, banco y moneda, y comparación con tu reparto objetivo. |
| **Movimientos y ventas** | Compras, ventas, aportaciones periódicas, y ganancias realizadas con criterio FIFO. |
| **Objetivos** | Metas con fecha y probabilidad de llegar (simulación Monte Carlo con tu rentabilidad y volatilidad). |

### Apuntar sin teclear

- **Importar del correo** (Gmail, solo lectura): busca las confirmaciones de cada banco, enseña lo que ha encontrado
  y lo compara con lo que ya tienes **antes de guardar nada** (nuevas, dudosas, ya las tienes).
- **Cripto**: saldos de wallets por dirección pública y posiciones de Hyperliquid.
- **Precios** cada noche y cada pocos minutos en horario de mercado.

### Decidir con datos

| | |
|---|---|
| **Perfil de riesgo** | Test de 13 preguntas (situación, actitud y experiencia, al estilo MiFID) y comparación con tu cartera real. |
| **Buscador de fondos con IA** | Eliges zonas del mundo y la IA busca entre los fondos registrados en la CNMV y fondos internacionales los 5 que mejor encajan con tu perfil. Puedes guardarlos en «Mis fondos». |
| **Sentimiento de mercado** | Lo que dicen noticias e inversores influyentes de cada empresa de un índice, clasificado por IA. |
| **Valoraciones y tesis** | 16 métricas de unas 1.900 empresas de EE. UU. (datos de la SEC), foto semanal y tus tesis de inversión. |

### Para todos

- **Varios usuarios**, cada uno con sus datos separados **en la propia base de datos** (row level security).
- **Login** con contraseña.
- **Modo claro y oscuro**, y una app móvil de consulta.

## Seguridad

- **Contraseñas** guardadas con **BCrypt**. Sesión con un **token JWT** firmado que caduca a las 12 horas.
- El usuario de cada petición sale del token firmado, nunca de algo que el navegador pueda cambiar. Y la base de datos
  solo devuelve las filas de ese usuario aunque una consulta se equivoque (**row level security** de PostgreSQL).
- **Límite de intentos** de login: 10 fallos cada 15 minutos por IP y por usuario.
- Gmail con permiso de **solo lectura**. Las credenciales de Google viven fuera del proyecto.
- **Ningún secreto en el repositorio.** Las claves están en `back/.env` (no se sube; hay una plantilla en
  `back/.env.example`), y cada push pasa **Gitleaks** por todo el historial.
- **Dependencias** revisadas en cada push y cada semana (npm audit y OSV-Scanner), con actualizaciones automáticas de
  Dependabot.

## Integración continua

Cada push y cada pull request pasa por GitHub Actions ([detalles](docs/08-repositorio-y-ci.md)):

| Workflow | Qué comprueba |
|---|---|
| **CI** | El back compila sin errores de tipos y pasa sus tests (login: tokens válidos, caducados, con otra firma, sin firma, de usuarios que no existen). El front y la app móvil compilan en modo producción. |
| **Seguridad** | Gitleaks (secretos en todo el historial), npm audit (vulnerabilidades altas en lo que llega a producción) y OSV-Scanner. También cada lunes, aunque no se toque el código. |
| **Dependabot** | Una vez por semana propone actualizar dependencias de npm y acciones de GitHub. |

## Cómo está hecho

| Parte | Tecnología |
|---|---|
| Web | Angular 21 (componentes standalone, signals, router con carga diferida) |
| API | Node.js + Express + TypeScript |
| Base de datos | PostgreSQL en Supabase, con Prisma 7 (adaptador `pg`), row level security y `pg_cron` para los precios |
| Login | BCrypt + JWT (HS256) |
| IA | Google Gemini (plan gratuito) para clasificar noticias y elegir fondos |
| Datos | CNMV, SEC (XBRL), Yahoo Finance, Google News, Bluesky, RPC públicos de blockchains |
| App móvil | Angular + Supabase |

```
finanzas/
├── back/          API (Express + Prisma): src/ un módulo por área, supabase/ el SQL, scripts/, test/
├── front/         Web (Angular): src/app/features/ una carpeta por página, app.routes.ts las páginas
├── mobile/        App móvil de consulta
├── docs/          Documentación: arquitectura, cálculos, páginas, diseño, decisiones y backlog
└── .github/       Integración continua y Dependabot
```

## Ponerla en marcha

Requisitos: Node.js 22 o superior y un proyecto de Supabase (el plan gratis basta).

1. **Variables de entorno.** Copia `back/.env.example` a `back/.env` y rellena las conexiones de Supabase.
2. **Base de datos.** Aplica los SQL de `back/supabase/` en el editor SQL de Supabase (`portfolio_v2.sql` y
   `users.sql` primero; todos se pueden volver a ejecutar). Nunca uses `prisma db push`.
3. **Dependencias.**
   ```powershell
   cd back; npm ci; npx prisma generate
   ```
   ```powershell
   cd front; npm ci
   ```
4. **Contraseña de cada usuario** (se escribe sin que se vea; la primera vez crea también `AUTH_SECRET`):
   ```powershell
   cd back; npm run set-password -- user1
   ```
5. **Arrancar** el back y el front, en dos terminales (en Windows también vale `iniciar-finanzas.ps1`):
   ```powershell
   cd back; npm run start
   ```
   ```powershell
   cd front; npx ng serve --port 4200
   ```
   Abre http://localhost:4200 y entra con tu usuario.

Opcional: `GEMINI_API_KEY` (clave gratuita de Google AI Studio, de un proyecto **sin** facturación) para Sentimiento y
el buscador de fondos, y el cliente OAuth de Gmail para importar correos ([cómo](docs/01-arranque-y-operacion.md)).

## Comprobar antes de subir

Los mismos pasos que el CI:

```powershell
cd back; npm run typecheck; npm run build; npm test
```
```powershell
cd front; npx ng build
```

## Documentación

Toda la documentación está en [`docs/`](docs/README.md):
- **Arquitectura y datos:** piezas de la app, login, multiusuario y tablas.
- **Cálculos:** cómo sale cada cifra; todas tienen que cuadrar entre sí.
- **Páginas y diseño:** qué hace cada pantalla y las reglas visuales.
- **Decisiones:** qué se decidió y por qué, con las alternativas descartadas.
- **Backlog:** lo pendiente y lo hecho.

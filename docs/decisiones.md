# Decisiones

Registro de decisiones con alternativas, para no volver a discutirlas. La más reciente arriba.
Formato: **fecha · decisión** — porqué. (Alternativas descartadas.)

## 2026-11

- **2026-11-25 · Gastos con Open Banking (Enable Banking)** — el usuario lo había descartado por desconfianza y ahora lo
  acepta. Solo se pide información de cuentas (AIS), nunca pagos; el permiso se da en el banco y se puede revocar. Enable
  Banking porque es gratis para cuentas propias (modo restringido); GoCardless/Nordigen ya no admite altas nuevas y
  Tink es de pago. Alternativas: extractos CSV/Excel a mano (sin terceros, no automático) y correos de cada pago
  (incompletos). Clasificación por reglas propias + aprendidas en vez de IA desde el principio: gratis, instantánea y
  sin mandar movimientos fuera; la IA queda para lo que sobre. Traspasos a cuentas propias e inversión se marcan
  `internal` para no contarlos como gasto. Solo movimientos contabilizados (BOOK): los pendientes cambian de referencia
  al contabilizarse y se duplicarían.

- **2026-11-25 · Móvil en pausa** — el usuario no quiere trabajar ahora la app móvil (`mobile/`) ni adaptar páginas a
  móvil. No se borra nada: el código de `mobile/` y los estilos para pantallas pequeñas que ya hay se quedan. Ver backlog.

- **2026-11-25 · Comparar solo lo invertido** — a petición del usuario: la liquidez de cada banco bajaba su
  rentabilidad sin que fuera culpa de lo que eligió. Alternativa descartada: dejarlo como el filtro del Resumen (con
  liquidez). El eje de días sale de lo invertido para no marcar "desde el …" por un día de diferencia.

- **2026-11-25 · Comparar enseña también ganancia en € y rentab. de tu dinero** — un banco salía con −90 % de TTWROR
  (meses con poco dinero en una acción que se hundió; las compras grandes llegaron después). La TTWROR es la correcta
  para comparar con un índice y se mantiene, pero sola confunde. Alternativa descartada: cambiar a Modified Dietz (no se
  puede poner al lado de un índice). Gráficas SVG con texto: ancho real medido en vez de `preserveAspectRatio="none"`,
  que estiraba las letras.

- **2026-11-25 · Comparar: ETFs en euros como índices y TTWROR para lo tuyo** — los índices "de verdad" (^GSPC…) van
  en dólares y sin dividendos; un ETF de acumulación que cotiza en euros (iShares en Xetra) da lo que habría ganado un
  inversor español, con dividendos y divisa, y Yahoo lo tiene gratis. Lo tuyo con TTWROR porque meter o sacar dinero no
  la mueve (la TIR o Modified Dietz no se pueden poner al lado de un índice). Además "con el mismo dinero" para ver la
  diferencia en euros. Cierres en memoria 6 h en vez de una tabla: son públicos, pocos (11 series) y baratos de pedir.
  Alternativas descartadas: convertir ^GSPC con EURUSD (sin dividendos), guardar en `sentiment_prices` (otro uso).
  El cálculo va en el front sobre `/api/v2/series` para reutilizar el filtro por banco/tipo y que la demo funcione sin back.

- **2026-11-25 · Electron a 42 a mano; minimatch se queda en 10** — Dependabot no propone majors, así que Electron
  se sube a mano (`electron-main.js` solo abre una ventana, sin APIs que cambien). minimatch 10.2.6 (vía Angular CLI y
  electron-builder, solo desarrollo) tiene un aviso de DoS con patrones maliciosos; el arreglo está en 11, pero `glob`
  13 pide `^10` y aquí los patrones no vienen de nadie de fuera. Se espera a que lo suban Angular CLI y glob.

- **2026-11-25 · Casillas con unidad: la caja dibuja el borde** — en el Simulador la regla global de inputs
  (`input:not([type="checkbox"]):not([type="radio"])`, más específica) pisaba `.box input`. Se sube la especificidad
  en el componente (`.box input[type="number"]`) en vez de tocar la regla global, que usan todos los formularios.

- **2026-11-25 · Plantillas de correo como datos, creadas con IA y validadas por la app** — las de MyInvestor y BBVA
  siguen en el código (BBVA lee un PDF). Las nuevas son una búsqueda y una expresión regular por campo en la base de
  datos, compartidas entre usuarios. La IA solo propone; la app las prueba con los correos reales y no se guardan si
  no los leen todos. A la IA solo va lo que el usuario elige, con su permiso explícito y sin datos personales.
  (Plantilla escrita a mano por el usuario marcando campos: más trabajo y más errores. Que la IA lea cada correo en
  cada importación: más lento, más caro y enviaría todos los correos.) El antiguo "Cargando plantillas para X… cargada"
  de los bancos sin plantilla era solo decorativo y se ha quitado.
- **2026-11-25 · Los días pasados de un activo sin cotización no se reescriben** — la sincronización (cada hora y por la
  noche) rehace los últimos 3 días; a los activos sin precio de mercado (perps de Hyperliquid) les ponía el precio de
  ese momento en los 3 días, y el resultado de la semana anterior cambiaba días después. Ahora solo se actualiza el día
  de hoy; los anteriores guardan el último precio que tuvieron ese día. Los fondos sí pueden cambiar el día siguiente:
  publican su valor liquidativo con un día de retraso (es lo correcto).
- **2026-11-25 · Simulador en dos partes** — primero una cuenta manual sencilla (una línea, interés compuesto), y aparte
  el "cálculo inteligente" con la cartera real y tres escenarios. Se descartó la versión con carteras modelo de fondos
  indexados y precios históricos de Yahoo: el usuario la quiso más simple de momento. El cálculo inteligente reutiliza
  el motor de Objetivos para que las cifras cuadren entre páginas.
- **2026-11-25 · Demo con respuestas guardadas, no con datos falsos en el código** — como Stockly y Gestor de campos
  (demo en el navegador, sin servidor), pero los datos salen de un usuario `demo` real en la base de datos: todas las
  cifras (TTWROR, calendario, series) las calcula el back de verdad y cuadran entre sí. (Reescribir los cálculos en el
  front para datos inventados: mucho código duplicado. Un usuario demo con el back público: necesita servidor.)
- **2026-11-25 · Sincronización de precios por activo** — añadir la cartera demo (operaciones desde 2024) habría
  recalculado la historia de Usuario 1 y Usuario 2. `sync_asset_snapshots` limita la resincronización a los activos tocados.
- **2026-11-25 · El tour no bloquea la página** — el foco es solo visual y el usuario puede pulsar lo que se le enseña
  (hacer el test, abrir el buscador de fondos); el tour espera o se pausa con los diálogos.
- **2026-11-24 · Ojo de privacidad en los formateadores** — un `signal` en `format.utils.ts` que leen `formatMoney` y
  compañía: toda la app se tapa sin tocar cada plantilla y se repinta sola. Se tapan también las cantidades (dicen el
  tamaño de la posición) y los ejes de las gráficas; no los porcentajes ni los precios de mercado. (Difuminar con CSS:
  habría que marcar cada cifra a mano y se puede leer con el inspector.)
- **2026-11-24 · Prisma 7 por el pooler en modo sesión** — Prisma 7 obliga a un driver adapter; con `pg` y el pooler de
  Supabase en modo transacción (6543) las consultas se quedan colgadas, en modo sesión (5432) no. Se usa `DIRECT_URL`
  con un pool pequeño (8 + 3) para no pasar de las 15 conexiones del plan gratis. Primera carga algo más lenta (abre
  conexiones con TLS); después, las páginas tardan lo mismo. (Seguir en Prisma 6: avisos de seguridad en su CLI.)
- **2026-11-24 · Repositorio público con datos fuera** — público para poder usar GitHub Pages, como PanGestion. Secretos
  (`.env`, Gmail), copias, correos reales y la configuración de Supabase del móvil quedan fuera (`.gitignore`), y la
  documentación sin cifras ni nombres reales. Se subió primero en privado y se hizo público solo con Gitleaks en verde.
- **2026-11-24 · CI como PanGestion, adaptado** — CI (tipos, build, tests) + Seguridad (Gitleaks, npm audit, OSV) +
  Dependabot. Sin base de datos en el CI: los tests no la necesitan. npm audit deja fuera la CLI de Prisma
  (`--omit=peer`): sus avisos solo se arreglan con Prisma 7 (cambio grande, al backlog). OSV informativo.
- **2026-11-24 · Login con contraseña (BCrypt + JWT)** — como PanGestion. El usuario sale del token firmado, no de una
  cabecera que el cliente pueda elegir. Contraseñas solo desde el servidor (`npm run set-password`): sin registro ni
  recuperación por correo, no hacen falta con dos usuarios. (Supabase Auth: otra dependencia y el back ya tiene su
  propia conexión; sesión con cookie: más trabajo con CORS entre :4200 y :3000.)
- **2026-11-24 · Router de Angular** — hecho el mismo día: `app.routes.ts` con `PAGES` (URL en español, carga
  diferida con `loadComponent`, `canMatch` para las páginas ocultas, título de pestaña por página). `/` abre la última
  página (la clave antigua `finanzas.page` se traduce). En el servidor hará falta que cualquier URL devuelva
  `index.html` (fallback de SPA). Antes era así: `app.ts` guarda la página en una señal `page` (y en
  localStorage) y `app.html` pinta el componente con `@switch`. Cada página sí es un componente propio en
  `features/<página>/`; lo único compartido es el armazón (barra lateral, usuario, diálogos). `app.routes.ts` existe pero
  vacío. Ventajas: simple, sin URLs que mantener, `HIDDEN_FOR` en un solo sitio. Desventajas frente al router de
  Angular (`/resumen`, `/perfil-riesgo`…): no hay URL por página (no se puede enlazar ni usar atrás/adelante del
  navegador), todas las páginas van en el mismo paquete (sin carga diferida con `loadComponent`), y ocultar páginas
  no impide entrar (con router, un `canMatch` lo bloquea).
- **2026-11-24 · Fondos guardados como foto** — se guarda el fondo con sus datos del día (`saved_funds.data`), no solo
  el ISIN: la tabla carga al instante y se ve por qué se eligió. Si se vuelve a guardar, se actualiza la foto. (Recalcular
  con el universo actual: más lento y el motivo de la IA se pierde.)
- **2026-11-24 · Buscador de fondos con CNMV + Yahoo** — CNMV es oficial, gratis y descargable (fondos españoles, cartera
  con ISIN de cada valor → zonas reales). Yahoo para ~25 fondos/ETFs internacionales. (Financial Hub, Finect,
  Morningstar: sin acceso libre o condiciones que no permiten extraer datos.)
- **2026-11-24 · Perfil de riesgo tipo MiFID** — tolerancia + conocimiento, con tope de un perfil por encima de la
  capacidad. Orientativo, no es recomendación.
- **2026-11-24 · Importación del correo en dos pasos (buscar → revisar → aplicar)** — una importación en Usuario 1 duplicó todo el año (operaciones y activos en un banco "MyInvestor" nuevo) porque la marca de "ya importado" era común a los dos usuarios y no se comparaba con lo apuntado a mano. Ahora: nada se escribe sin revisión, emparejamiento con las operaciones existentes (±10/+3 días, títulos ±1 %; dudosas hasta 60 días), bancos elegidos por el usuario de entre los suyos, marca por usuario, recuerda la última importación. Se borró lo duplicado (con copia previa).
- **2026-11-24 · Gemini rota entre modelos gratis** — los "lite" dan 503 por saturación a menudo; se prueban en orden y se queda el que responde. Si ninguno, lista de palabras y reintento en la vuelta siguiente.
- **2026-11-24 · La clave de Gemini debe ser de un proyecto sin facturación** — un proyecto con facturación pasa al plan de pago (error 402). Solo plan gratis.
- **2026-11-24 · Documentación en Markdown dentro del proyecto (`docs/`)** — viaja con el código, la leen personas y asistentes, sin servicios externos. (Notion, Google Docs.)
- **2026-11-23 · % del calendario con Modified Dietz** — el TTWROR podía tener distinto signo que los euros (−14 € y +2,8 %) y confundía. En el Resumen se mantienen los dos.
- **2026-11-23 · TTWROR y TIR del Resumen son anuales y de toda la historia** — no cambian con el periodo de la gráfica. Con menos de un año no se anualiza el TTWROR.
- **2026-11-23 · Filtros como desplegables con selección múltiple** — sustituyen a los chips (ocupaban mucho).
- **2026-11-23 · Página Valoraciones con foto semanal y métricas elegibles** — "en el momento en que se hizo la comparación". Sin IBEX. Tesis por usuario.
- **2026-11-23 · Sentimiento solo con fuentes gratis** — Bluesky, YouTube, Google News, indicadores de mercado. Influyentes elegidos por Claude. Clasificador Gemini gratis. (X de pago, StockTwits/CNN bloquean, Ollama no cabe en el servidor.)
- **2026-11-23 · Sentimiento usa tonos, nunca "compra/vende"** — y aviso fijo de "no es recomendación de inversión".
- **2026-11-23 · Subir a Google Cloud más adelante** — de momento todo en local. En el servidor: login con contraseña.
- **2026-11-23 · Usuario 2 oculta Apuestas y Fórmula mágica** — se usa en clase.
- **2026-11-23 · BBVA: las órdenes quedan pendientes de confirmar** — BBVA solo envía la orden, no la ejecución. La app estima si se ejecutó (precio y días) pero confirma el usuario.
- **2026-11-23 · Importación de correo algorítmica (sin IA)** — los correos de MyInvestor y los PDF de BBVA tienen formato fijo.
- **2026-11-23 · Dos usuarios con RLS en Postgres** — aislamiento real en la base de datos, no solo en la app. Entrada sin contraseña mientras sea local.
- **2026-11-22 · Sin Open Banking** — el usuario no quiere iniciar sesión en sus bancos a través de terceros.
- **2026-11 · Cripto: diferencias < 5 USD se acumulan** — evita avisos constantes por céntimos de staking.
- **2026-11 · Vender nunca cambia la ganancia total** — el dinero de una venta va a "Pendiente de reinvertir"; reinvertir no es dinero nuevo.
- **2026-11 · Cierres es una hoja aparte** — nunca alimenta el resto de la app.

## 2026-10

- **2026-10-18 · Coste FIFO** — criterio de Hacienda.
- **2026-10-11 · Rediseño: las operaciones son la fuente de verdad** — cantidades desde `asset_operations`; precios diarios en Supabase con pg_cron.
- **Sin git, sin base de datos de pruebas** — copias con `db-backup.js` antes de cambios arriesgados.

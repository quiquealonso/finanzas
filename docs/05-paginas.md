# 05 · Páginas

Orden de la barra lateral. Para cada página: qué hace, de dónde saca los datos, y límites o ideas conocidas.
**URLs** (router de Angular, `app.routes.ts`): `/resumen`, `/activos`, `/calendario`, `/mensual`, `/distribucion`,
`/composicion`, `/movimientos`, `/ventas`, `/inmobiliario`, `/cierres`, `/objetivos`, `/perfil-riesgo`, `/noticias`,
`/sentimiento`, `/valoraciones`, `/formula-magica`, `/apuestas`. `/` abre la última página usada; una URL desconocida
u oculta para el usuario lleva a `/resumen`. Cada página se descarga al abrirla.
Al cambiar una página, **actualiza su sección** (y la fecha).

---

## Barra lateral · `app.html` · act. 2026-11-24
- Páginas (`app.routes.ts`), **"Ocultar importes"** (ojo de privacidad, tecla H; ver [06](06-diseno.md)), "+ Nuevo
  movimiento" (tecla N), patrimonio y usuario con "Salir".

## Demo guiada · `front/src/app/demo/` · nueva 2026-11-25
- **Para quién**: alguien que entra por primera vez (p. ej. el profesor). Botón «✦ Probar la demo guiada» en la entrada,
  y la web pública de GitHub Pages (siempre en demo, no hay back ahí).
- **Datos**: cartera ficticia del usuario `demo` (fondos indexados, ETFs, acciones, cripto, oro, inmobiliario; 5 bancos;
  desde enero de 2024 con precios reales). Se guardan sus respuestas de la API en `front/public/demo/*.json` y
  `demo.interceptor.ts` contesta con ellas: **no se llama a ningún servidor**. Los cambios se aceptan y se olvidan
  (aviso «los cambios no se guardan»); el perfil de riesgo y los fondos guardados se recuerdan en el navegador.
- **Simulado**: el buscador de fondos (búsqueda real hecha antes, una por perfil, con zona Global; se reproduce paso a
  paso) y la importación del correo (4 correos de ejemplo: nueva, dudosa, dos que ya tienes).
- **Tour** (`tour-steps.ts`, 36 pasos): bienvenida «¿Eres nuevo invirtiendo?» → test de perfil (el tour espera a que
  acabes) → resultado, peso en bolsa, «Analizar mejores opciones», Mis fondos → recorrido por todas las páginas →
  ojo de privacidad, nuevo movimiento → fin (seguir explorando, repetir, salir). Foco morado sobre el elemento
  (`data-tour="…"` en las plantillas), burbuja con capítulo y progreso; la página sigue funcionando debajo; si se abre
  un diálogo, el tour se queda en pausa. Bloques grandes (tablas, calendario): si ya empiezan en la mitad de arriba
  no se desplaza nada; si no, su cabecera va arriba de la pantalla. El foco marca solo la parte visible. Se puede repetir con «Tutorial» en la barra lateral.
- En demo se oculta Apuestas. Límites: detalle de calendario desde 2025, fichas solo de las ~60 empresas más grandes,
  Noticias vacía.
- **Regenerar** (con el back en marcha): `node back/scripts/demo-seed.js --reset` y `node back/scripts/demo-fixtures.js`.

## Entrada (login) · `features/login` · act. 2026-11-25
- «✦ Probar la demo guiada» debajo de los usuarios: entra en la demo con el tutorial desde el principio.
- Elegir usuario → contraseña → «Entrar». Guarda el token de sesión (12 h) en el navegador (`finanzas.token`).
- Usuario sin contraseña: aviso con el comando `npm run set-password -- <usuario>`. Detalles en [02](02-arquitectura.md#login).

## Resumen · `features/overview` · act. 2026-11-23
- **Arriba**: filtro Banco/Tipo (desplegables con selección múltiple, compartido con Activos) + a la derecha
  TTWROR anual, TIR anual y Pendiente de reinvertir (con botones Reinvertir/Retirar). TTWROR y TIR son de toda la
  historia (o de lo filtrado), no del periodo de la gráfica.
- **Tarjeta principal**: patrimonio, debajo la ganancia del periodo elegido; en medio la ganancia total; a la derecha
  periodos 1D (por defecto), 1S, 1M, 3M, YTD, 1A, Todo y Personalizado (fechas). Gráfica valor vs. dinero invertido
  (línea discontinua = coste − realizado). Pie: hora de precios y "Actualizar ahora".
- **Rentabilidad por año**: valor al empezar, ganancia, TTWROR, rentab. de tu dinero, dinero metido, valor al acabar.
- **Rentabilidad por mes**: tabla o tarjetas; además: días ▲/▼, mejor y peor día, valor al acabar.
- **Reparto por tipo** y **Por banco**: gráfico circular + leyenda (euros, %, y ganancia por banco).
- Datos: `GET /api/v2/overview`, `/api/v2/series?banks=&types=` (filtrado), `/api/v2/intraday` (1D).
- Límite: "Pendiente de reinvertir" no se filtra.

## Activos · `features/holdings`
- KPIs arriba (valor, invertido, resultado, hoy). Filtro Banco/Tipo + buscador, agrupar por banco, sin saldo.
- "Ordenar por" (valor, resultado, %, hoy, A-Z) y ver como Tarjetas (6 por fila) o Tabla.
- Pulsar un activo: ficha con comprar, vender, ajustar, editar (ticker, región…). Botones + Banco, + Activo,
  "Sincronizar cripto" (wallets + Hyperliquid). Avisos de diferencias de wallets.

## Calendario · `features/calendar` · act. 2026-11-23
- Un calendario por mes (4 por fila), cada día en verde/rojo con € y %; columna de total semanal; selector de año.
- Mes y semana: % con el signo de los euros (Modified Dietz, ver [04](04-calculos.md#calendario)).
- Pulsar un día abre un **diálogo** con los activos que más se movieron: € , % propio y "% a la cartera".
- Datos: `GET /api/v2/calendar`, `/api/v2/calendar/:date`.

## Mensual · `features/monthly` · act. 2026-11-23
- Tabla tipo Excel. Por defecto **por banco** (también por activo y por tipo), año o todo, modo variación/valor/rentabilidad.
- Columnas: primero el resumen (valor inicial, actual, dinero metido, ganancia, TTWROR, rentab. desde compra), luego los meses.
- Filas en cebra; hover suave. Exportar a Excel (CSV).

## Distribución · `features/charts` · act. 2026-11-24
- Cuatro gráficos circulares (tipo, geográfica, banco, moneda), mitad gráfico, mitad leyenda (nombre · € · %).
- "Qué hay en cada zona": activos de cada región.
- Región: acciones por la bolsa del ticker; fondos con reparto aproximado (editable en la ficha del activo).

## Composición · `features/composition`
- Reparto objetivo (plan por tipo y producto) frente al real. ETFs de metales cuentan en "Metales preciosos".
- Datos: `allocation_targets`.

## Movimientos · `features/movements` · act. 2026-11-24
- Lista por meses (tarjetas o tabla) de compras, ventas, aportaciones, retiradas, ajustes.
- **Aportaciones periódicas**: plegadas por defecto; la cabecera dice cuántas hay activas, cuánto al mes y si hay
  meses pendientes de registrar. "+ Nueva aportación" las despliega.
- Confirmaciones (confirmar todas, descartar improbables, no se ejecutó, borrar…) en diálogo propio.
- **Importar del correo** (Gmail, solo lectura), diálogo en 3 pasos (`mail-import-dialog.component.*`):
  1. Aviso de **en qué usuario** se importa (Usuario 1 en amarillo: datos reales). "¿De dónde quieres importar
     movimientos?": casillas con los bancos del usuario (los que tienen plantilla llevan la etiqueta), y "Desde"
     (por defecto, la fecha del último correo importado; recuerda también los bancos elegidos).
  2. Búsqueda con progreso real ("Cargando plantillas para X…", correo a correo). **No escribe nada.**
  3. Revisión: cada operación como **Nueva** (marcada), **¿Ya la tienes?** (mismos títulos, fecha distinta hasta 60 días;
     sin marcar), **Ya la tienes** (mismo activo, lado y títulos, de 10 días antes a 3 después del correo) o
     **Ya importada**. Al importar: crea las marcadas y enlaza al correo las que ya tenías (no se duplican).
- **Plantillas de usuario** (2026-11-25, `template-wizard.component.ts`, back `mail-templates.ts`, tabla `mail_templates`):
  un banco sin plantilla muestra «✦ Crear plantilla». Busca en Gmail correos de ese banco que parezcan operaciones
  (solo cabecera y resumen; se puede afinar por remitente), el usuario elige 1–3 y **da su permiso** para enviarlos a
  Gemini con los datos personales tapados (nombre tras un saludo, números de cuenta, IBAN, DNI, teléfonos, correos).
  La IA propone una búsqueda de Gmail y una expresión regular por campo; la app la prueba con los correos **reales** y
  le pide corregir hasta 3 veces. Se ve qué ha leído de cada correo y solo se guarda si los lee todos. Queda para todos
  los usuarios con ese banco ("plantilla de usuario"), con quién la creó y cuántas veces se usa; solo su autor la borra.
  En la demo se explica pero no se crea (no hay correos). La cuenta "Reinversión" no sale (no es un banco).
- Plantillas: MyInvestor (confirmaciones con todo) y BBVA (órdenes en PDF → "Órdenes por confirmar", 6 por fila, con
  estimación de si se ejecutó, "Confirmar todas", "Descartar improbables"). Otros bancos: "plantilla cargada", sin correos.
- Marca de "ya importado" **por usuario** (`external_operations`, clave `userX|…`) y última importación en `mail_import_state`.
- Datos: `/api/v2/mail-import/setup|scan|:id|:id/apply`, `/api/v2/gmail/*`, `/api/v2/pending-orders`.

## Ventas · `features/realized`
- Ganancias y pérdidas al vender, criterio FIFO. Tarjetas o tabla; vista por venta y por activo.

## Inmobiliario · `features/real-estate`
- Tickets de crowdfunding (WeCity…): interés diario simple hasta el vencimiento.

## Cierres · `features/closings`
- Hoja por año: valor de cada activo a fin de mes + liquidez a mano. "Hacer cierre" guarda el mes.
- **Hoja aparte**: nunca alimenta el resto de la app. Solo activos que se tienen hoy.

## Objetivos · `features/goals` · act. 2026-11-24
- Metas con fecha. Probabilidad por Monte Carlo (2000 caminos) con rentabilidad y volatilidad de la cartera
  (histórico con tope del 15 % mezclado con referencias por tipo). Motor: `goals.engine.ts`.
- Barra "Aportación mensual" para probar escenarios: escala fija de **0 a 5.000 €/mes** (antes el máximo crecía con
  el valor y se podía mover sin fin). Debajo, marca "Tus planes · X €" con la suma de las aportaciones periódicas
  activas; pulsarla vuelve a esa cantidad. "Guardar" fija la prueba en el objetivo, "Deshacer" la quita.

## Simulador · `features/simulator` · nueva 2026-11-25
- **Simula tu inversión** (manual): aportación inicial, mensual, años y rentabilidad anual esperada (casilla + barra:
  0–500.000 €, 0–5.000 €/mes, 1–50 años, −5 a 15 %). Interés compuesto mes a mes (la aportación entra al principio del
  mes y todo crece a (1+r)^(1/12)). Una línea frente a lo aportado; caja con el total, lo aportado, la ganancia y "cada
  euro se convierte en…". Se recuerda en el navegador (`finanzas.simulator`).
- **✦ Cálculo inteligente con tu cartera**: botón que muestra un análisis paso a paso (activos y bancos, reparto,
  rentabilidad de la historia, volatilidad y peor caída, rentabilidad esperada, aportaciones periódicas, 2.000 futuros)
  con las **cifras reales** de la cartera, y luego tres escenarios (pesimista = 10 %, intermedio = 50 %, optimista = 90 %
  de los futuros) con su rentabilidad anual equivalente, frente a lo aportado. Horizonte 5–30 años. Mismos supuestos
  que Objetivos (`goals.engine.ts` → `portfolioStats`, `simulate`, `requiredReturn`). Aportación mensual = planes
  periódicos activos, o lo metido de media el último año si no hay. "Llevar estas cifras" copia valor, aportación y
  rentabilidad esperada a la simulación manual. No llama a ninguna IA: el análisis es local.
- Gráfica propia (`sim-chart.component.ts`) con tooltip por año; respeta el ojo de privacidad.
- 2026-11-25: las casillas de número se veían mal (la regla global `input:not(...)` de `styles.css` les ponía borde,
  relleno y anillo dentro de la caja). Ahora la caja dibuja el borde y el anillo; la casilla va sin borde ni flechas.

## Perfil de riesgo · `features/risk-profile` · nueva 2026-11-24
- Cuestionario de 13 preguntas (`risk-questions.ts`), una a una con animación, barra de progreso, teclas 1–5 y
  "Anterior". Tres dimensiones: **capacidad** (edad, horizonte, colchón, ingresos, peso del dinero), **tolerancia**
  (objetivo, reacción a una caída, cartera preferida, "riesgo", premio, sueño) y **conocimiento** (experiencia y una
  pregunta de prueba con acierto/fallo).
- Resultado: puntuación = 75 % tolerancia + 25 % conocimiento → 5 perfiles (Conservador, Moderado, Equilibrado,
  Dinámico, Agresivo), **nunca más de uno por encima de lo que permite la capacidad** (como los test MiFID).
  Muestra el % orientativo en bolsa del perfil y lo compara con la cartera real (acciones, ETF, fondos y cripto).
- Se guarda cada resultado por usuario (`risk_profiles`) con histórico. Orientativo, no es recomendación.
- Pendiente: presentarlo como para un cliente final (ver backlog).
- **«✦ Analizar mejores opciones»** (2026-11-24, `fund-finder-dialog.component.*`, back `fund-finder.ts`): elegir zonas
  (España, Europa, EE. UU., Japón, China, Asia-Pacífico, Emergentes, Latinoamérica, Global) → búsqueda con progreso
  visible de IA → 5 fondos con motivo. Universo `fund_universe` (mensual): CNMV (fondos españoles: rentabilidad y
  volatilidad de 4 trimestres, TER, patrimonio; zonas por el país del ISIN de cada valor en cartera) + 26 fondos/ETFs
  internacionales con precios de Yahoo. Filtro: riesgo 1–7 por volatilidad según perfil, ≥ 60 % en las zonas,
  ≥ 20 M€ y ≥ 200 partícipes. Preselección 25 por rentabilidad/riesgo y costes → Gemini elige 5 (si está saturado, los 5 mejores).
  La CNMV responde 500 a Node sin `Accept-Language` real. Sus ficheros vienen unos en UTF-8 y otros en latin1: se
  lee en UTF-8 y, si no cuadra, en latin1.
- **Guardar fondos** (2026-11-24): en los resultados, "☆ Guardar" en cada fondo y "★ Guardar los 5". Se guardan por
  usuario y perfil (`saved_funds`, foto de los datos del día). Debajo del resultado, tarjeta **★ Mis fondos**: pestañas
  por perfil (primero el tuyo, con contador), tabla con fondo (ES/INT, gestora, ISIN, motivo de la IA), zonas,
  rentabilidad 12 meses y 3 años, volatilidad, riesgo 1–7 en barras de color, gastos, patrimonio, fecha y zonas de la
  búsqueda, ficha y quitar (con confirmación). Sin fondos: aviso con el botón de analizar.
  Datos: `/api/v2/saved-funds` (GET, POST, DELETE /:id).

## Noticias · `features/news`
- Tablón semanal (jueves) de noticias de las posiciones y resumen. Lo escriben tareas programadas de Claude con los
  scripts `back/scripts/news-*.js`.

## Sentimiento · `features/sentiment` · act. 2026-11-24
- Índice elegible (S&P 500, Nasdaq 100, IBEX 35). Termómetro de miedo/codicia con histórico y explicación.
- Tono más alcista / más bajista; mapa de calor (o tabla) de todas las empresas: tono 7 días, menciones, subida 1 mes,
  "redes + precio". Pulsar una empresa: gráfico de precio y todo lo que se dijo, con acierto a 7 días.
- Pestañas: lo último de los influyentes / ranking de aciertos por fuente.
- Botón "Actualizar" con registro del trabajo. Aviso fijo: **no es recomendación de inversión**.
- Clasificador: Gemini (plan gratis, rota modelos si están saturados) o lista de palabras de respaldo.
- Datos: `/api/v2/sentiment/overview|stocks|stock/:symbol|feed|sources|refresh|job`.
- Límites: IBEX sin noticias de redes en inglés; Google a veces saturado (503) → lista de palabras y reintento.

## Valoraciones y tesis · `features/valuations` · act. 2026-11-23
- Foto semanal de 16 métricas de ~1.900 empresas de EE. UU. (> 1.000 M$). Selector de índice y de fecha de foto.
- Chips para elegir métricas → columnas + **puntuación** (percentil medio). Celdas coloreadas por percentil; fila de medianas.
- Pulsar una empresa: todas las métricas con percentil, evolución en cada foto y **mi tesis** (postura, texto,
  precio objetivo; guarda el precio al escribirla). "Mis tesis" arriba con cambio desde entonces.
- Sin IBEX (no hay fundamentales gratis de empresas españolas). Bancos sin EV/EBITDA.
- Datos: `/api/v2/valuations`, `/valuations/company/:symbol`, `/valuations/refresh|job`, `/api/v2/theses`.

## Fórmula mágica · `features/magic-formula` · oculta a Usuario 2
- Ranking de Greenblatt (ROC + rentabilidad por beneficios), semanal (jueves). Script `back/scripts/magic-formula.js`.

## Apuestas · `features/betting` · oculta a Usuario 2
- Casas de apuestas por año: depósitos, retiradas, neto.

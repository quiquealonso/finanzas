# 04 · Cálculos

**Regla de oro: todas las cifras de resultado de la app salen de la misma serie diaria y deben cuadrar entre sí**
(Calendario = suma de días; mes del Resumen = suma de sus días; Mensual y años coinciden con el Resumen). Si una cifra
no cuadra con otra, es un fallo.

## Ganancia ("resultado")

- **Ganancia de un día** (por activo) = Δ(valor − coste) + realizado ese día. Implementado en `perAssetDay`
  (`back/src/calendar.ts`). Comprar, vender o meter dinero **no** es ganancia; solo el movimiento de precios.
- El primer día que se tiene un activo solo cuenta si fue una compra real (no un saldo inicial "opening").
- Días con cantidad > 0 y valor 0 (sin precio) se ignoran.
- **Serie diaria** (`portfolioSeries`, `back/src/portfolio.ts`): por día `{value, cost, realized, result, opening}`.
  `result` es la ganancia acumulada. Acepta filtro de activos (bancos/tipos).
- **Ganancia de un periodo** = `result(fin) − result(día antes del inicio)`.

## Dinero metido

- Flujo de un día = Δvalor − ganancia del día (lo que entró o salió a valor de mercado).
- **Saldos iniciales** (`opening`: posiciones que ya se tenían antes de empezar a registrar) cuentan como valor al
  empezar, no como dinero metido.
- **Reinversión**: las ventas van por defecto a la cuenta "Pendiente de reinvertir" (activo LIQUID en el banco
  "Reinversión"). Vender, reinvertir o retirar **nunca** cambia la ganancia total. Las reinversiones no son dinero nuevo.

## Rentabilidades

| Nombre en la app | Fórmula | Cuándo se usa | Ojo |
|---|---|---|---|
| **TTWROR** (rentabilidad ponderada en el tiempo) | Encadena el % de cada día: Π(1 + ganancia_d / (valor_{d−1} + flujo_d⁺)) − 1 | Comparar con un índice; tablas de años y meses; Mensual (encadenado mes a mes) | Puede tener **distinto signo que los euros** (ganar con poco dinero dentro y perder con mucho) |
| **TTWROR anual** | (1 + TTWROR total)^(365/días) − 1 | Arriba en el Resumen | Con menos de un año no se anualiza: pone "TTWROR desde el …" |
| **TIR** (XIRR) | Tasa anual que iguala a 0 los flujos (valor inicial y aportaciones como entradas, valor final como salida). Bisección | Arriba en el Resumen | Null con menos de 90 días |
| **Rentab. de tu dinero** (Modified Dietz) | ganancia / (valor inicial + Σ aportación × fracción del periodo que estuvo dentro) | Tablas de años y meses; % de meses y semanas del **Calendario** | Siempre con el signo de los euros |
| **% "Todo"** | ganancia / (valor inicial + dinero metido) | Periodo "Todo" del Resumen | Modified Dietz se infla en periodos largos con aportaciones grandes y tardías |
| **Ganancia total %** | (P&L + realizado) / (coste − realizado) | Resumen, Activos | Sobre el dinero metido neto |
| **Rentab. desde compra** | valor / coste − 1 por posición | Mensual | No es del periodo |

## Comparar

- **Lo tuyo**: TTWROR diaria (la misma fórmula que el Resumen) sobre la serie de toda la cartera, de un banco o de un
  tipo (`/api/v2/series`, liquidez incluida, igual que el filtro del Resumen). Debe cuadrar con el TTWROR del Resumen.
- **Índice**: cierre en euros del ETF de acumulación (dividendos y divisa incluidos); fines de semana y festivos con el
  último cierre. 60/40 = 60 % MSCI World + 40 % bonos globales, reequilibrada cada día.
- Todas las curvas empiezan en 0 % el día antes del periodo. Un banco o tipo sin dinero al empezar cuenta desde el día
  antes de tener dinero, y su "vs." usa el índice desde ese mismo día.
- **Anual** = (1 + total)^(365/días) − 1, solo con ≥ 365 días. **Volatilidad** = desviación de las rentabilidades
  semanales (contadas hacia atrás desde el último día) × √52, con ≥ 8 semanas. **Peor caída** = mínimo de valor/máximo − 1.
- **Mismo dinero**: el valor al empezar compra índice ese día; cada flujo (Δvalor − ganancia del día) compra o vende
  índice al cierre de su día (nunca por debajo de 0 participaciones). Lo tendrías = participaciones × último cierre.
- Código: `front/src/app/features/compare/compare.engine.ts`.

## Calendario

- Día: ganancia y % del día (backend: ganancia / valor del día anterior).
- Mes y semana: % = Modified Dietz con los días de ese tramo (mismo signo que los euros).
- Detalle de un día: "+0,73 % a la cartera" = aportación de ese activo al % del día (`ganancia_activo / ganancia_día × %_día`); la suma de todos = % del día.

## Precios y divisas

- Cierres de Yahoo; libras en peniques (GBp) y rands en céntimos (ZAc) se convierten a la unidad.
- Splits: los precios de Yahoo están ajustados; las operaciones importadas se ajustan con el factor de split (p. ej. Amper 1:25 el 2026-07-20).
- Activos sin cotización (perps, precio manual): cada día guarda el precio que tenía ese día; la sincronización solo
  cambia el de hoy (`daily_snapshots.sql`, `asset-snapshots.sql`). Los de Yahoo se rehacen los últimos 3 días.
- Cripto en wallets: diferencias < 5 USD se acumulan y se apuntan al llegar a 5 USD; ≤ 2 % se ajustan solas.
- Préstamos (Mintos): precio estimado desde `yield_anchors` (interés simple).

## Sentimiento

- **Tono de una empresa (−1 a +1)**, últimos 7 días: Σ(tono × confianza × peso_fuente × 0,5^(edad_días/2)) / Σ(confianza × peso_fuente × decaimiento). Con < 2 menciones: "Pocos datos".
- **Peso de la fuente**: 0,5 + 1,5 × (aciertos + 1)/(evaluadas + 2) → entre 0,5 y 2 (1,25 sin historial).
- **Acierto**: tono alcista y la empresa batió a su índice (SPY o ^IBEX) en los 7 días siguientes, o bajista y lo hizo peor.
- **Termómetro (0–100)**: media de los indicadores disponibles, cada uno en 0–100: VIX (35 → 0, 12 → 100), amplitud (% de empresas sobre su media de 200 sesiones), tendencia (índice vs. media 200: +10 % → 100), tono social ((s+1)×50, si hay ≥ 5 menciones), Fear & Greed cripto, funding BTC (+30 %/año → 100). < 25 miedo extremo · < 45 miedo · ≤ 55 neutral · ≤ 75 codicia · más, codicia extrema.

## Valoraciones

- Cuentas de resultados (ventas, EBIT, beneficio): últimos 12 meses = 4 trimestres seguidos (el 4.º trimestre fiscal = año − 3 trimestres). Crecimiento = 12 meses vs. los 12 anteriores.
- Flujo de caja, capex, dividendos, amortizaciones: último año fiscal (la SEC los publica acumulados en el año).
- EV = capitalización + deuda − caja. EBITDA = EBIT + amortizaciones.
- **Puntuación** = media de los percentiles (0–1, en la dirección buena de cada métrica) de las métricas elegidas, dentro de la lista filtrada. Una métrica sin dato cuenta como percentil 0,25. Hace falta al menos la mitad de las métricas.

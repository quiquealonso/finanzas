# 03 · Datos

Base de datos Postgres en Supabase. Modelo Prisma en `back/prisma/schema.prisma` (solo las tablas originales); el resto
se crea con los SQL de `back/supabase/` y se consulta con SQL directo (`$queryRawUnsafe`).

**Ámbito**: *usuario* = filas por usuario con RLS; *compartida* = igual para todos (datos de mercado).

## Cartera (núcleo)

| Tabla | Ámbito | Qué guarda |
|---|---|---|
| `banks` | usuario | Bancos/plataformas (BBVA, MyInvestor, Cripto, Reinversión…) |
| `asset_types` | compartida | Tipos: LIQUID, STOCK, ETF, FUND, CRYPTO, REAL_ESTATE, METAL, LOANS |
| `assets` | usuario | Activos: banco, tipo, moneda, ticker de Yahoo (`marketSymbol`), cantidad, coste, precio actual, reparto geográfico (`regions` JSON) |
| `asset_operations` | usuario (vía activo) | **Fuente de verdad** de cantidades: buy, sell, deposit, withdraw, transfer, adjust, opening. Coste FIFO |
| `transfers` | usuario | Venta → compra enlazadas |
| `daily_asset_snapshots` | usuario (vía activo) | Por activo y día: cantidad, precio, fx, valor, coste. Base de gráficas y cálculos |
| `intraday_asset_prices` | usuario (vía activo) | Precios horarios (vista 1D) |
| `price_sync_runs` | compartida | Cada sincronización de precios: activos OK, con error y mensajes |
| `fx_rates` | compartida | Tipos de cambio EUR↔USD/GBP |
| `recurring_contributions` | usuario (vía activo) | Aportaciones periódicas a fondos |
| `real_estate_details` | usuario (vía activo) | Crowdfunding inmobiliario: importe, plazo, rentabilidad esperada |
| `yield_anchors` | usuario (vía activo) | Plataformas de préstamos (Mintos): precio por unidad y tasa desde una fecha |
| `asset_price_history`, `asset_price_sync_logs`, `monthly/weekly_portfolio_snapshots` | usuario | Históricos antiguos (anteriores al rediseño) |

## Funcionalidades

| Tabla | Ámbito | SQL | Qué guarda |
|---|---|---|---|
| `users` | compartida | users.sql | user1, user2 |
| `closing_sections`, `closing_rows` | usuario | closings.sql | Hoja de cierres mensuales |
| `goals` | usuario | goals.sql | Objetivos de patrimonio |
| `allocation_targets` | usuario | allocation.sql | Reparto objetivo (Composición) |
| `news_items`, `news_digests` | usuario | news.sql | Tablón de noticias y resumen semanal |
| `magic_formula_runs`, `magic_formula_picks` | compartida | magic-formula.sql | Ranking semanal de Greenblatt |
| `perp_accounts`, `perp_positions`, `perp_costs` | usuario | perps.sql | Hyperliquid (perpetuos) |
| `external_operations` | usuario | perps.sql | Deduplicación de operaciones importadas (source + externalId): Hyperliquid, wallets, correo |
| `wallet_accounts`, `wallet_tokens`, `wallet_balances` | usuario | wallets.sql | Wallets cripto por dirección pública |
| `pending_orders` | usuario | pending-orders.sql | Órdenes de BBVA leídas del correo, por confirmar |
| `risk_profiles` | usuario | risk-profile.sql | Resultados del test de perfil de riesgo (respuestas, dimensiones, perfil) |
| `mail_templates` | compartida | mail-templates.sql | Plantillas de correo creadas por usuarios: búsqueda de Gmail y expresión regular por campo; autor y usos |
| `saved_funds` | usuario | saved-funds.sql | Fondos guardados de «Analizar mejores opciones», uno por fondo y perfil (foto de los datos) |
| `mail_import_state` | usuario | mail-import.sql | Última importación del correo (fecha, último correo, bancos elegidos) |
| `bank_links` | usuario | banking.sql | Permisos de Open Banking (sesión de Enable Banking, banco, válido hasta, última lectura, error) |
| `bank_accounts` | usuario | banking.sql | Cuentas de cada permiso: nombre, IBAN, saldo; `accountKey` (IBAN) las mantiene al renovar el permiso |
| `bank_transactions` | usuario | banking.sql | Movimientos (importe con signo, concepto, contraparte, categoría y quién la puso, `internal` = traspaso/inversión) |
| `bank_transactions."invStatus"`, `"invOperationId"` | usuario | banking.sql | Inversión detectada: revisada (`done`, con la operación de la cartera) o `ignored` |
| `spend_rules` | usuario | banking.sql | Reglas aprendidas: texto → categoría |
| `betting_houses`, `betting_transactions` | usuario | (Prisma) | Apuestas (oculto a user2) |

## Sentimiento (compartidas)

| Tabla | Qué guarda |
|---|---|
| `sentiment_universe` | Empresas de cada índice (sp500, nasdaq100, ibex35), sector, última búsqueda de noticias |
| `sentiment_funds` | Índices usados últimamente (el trabajo solo procesa esos) |
| `sentiment_prices` | Cierres diarios de un año de cada empresa, benchmarks (SPY, QQQ, ^IBEX) y ^VIX |
| `sentiment_sources` | Influyentes (curados) y medios de noticias |
| `sentiment_posts` | Cada publicación/vídeo/titular, quién lo clasificó (gemini/lexicon) y tono sobre el mercado |
| `sentiment_mentions` | Empresa mencionada: tono, confianza, motivo y resultado a 1/7/30 días (acierto) |
| `market_metrics` | Indicadores diarios: Fear & Greed cripto, funding BTC |

## Valoraciones

| Tabla | Ámbito | Qué guarda |
|---|---|---|
| `valuation_runs` | compartida | Una foto semanal (fecha, trimestre de los datos) |
| `valuation_rows` | compartida | Por empresa: precio, capitalización, `metrics` (16 métricas) y `raw` (cifras de origen) |
| `investment_theses` | usuario | Tesis de inversión: postura, texto, precio objetivo, precio al escribirla |

## Funciones SQL útiles

| Función | Qué hace |
|---|---|
| `sync_daily_snapshots(desde)` | Precios diarios de Yahoo → snapshots (pg_cron) |
| `apply_operation_holdings(activo, desde)` | Recalcula cantidades desde las operaciones |
| `yahoo_daily_closes(símbolo, desde)` | Lee cierres de Yahoo desde Postgres |
| `clone_user_data(a, b)` / `delete_user_data(u)` | Copiar / vaciar un usuario |
| `mobile_*()` | API de solo lectura para la app móvil |

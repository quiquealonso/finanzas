# 07 · Fuentes externas

Regla: **solo fuentes gratis y públicas**, con un nombre de cliente genérico (sin datos personales en las peticiones).
Si una web bloquea a los clientes automáticos (Cloudflare, "Just a moment…"), **no se esquiva**: se descarta.

## En uso

| Fuente | Para qué | Límites / notas |
|---|---|---|
| Yahoo Finance (`query1/2.finance.yahoo.com`) | Precios diarios e intradía, búsqueda por ISIN, splits, VIX | Sin clave. A veces timeout puntual (se reintenta) |
| SEC XBRL frames (`data.sec.gov`) | Fundamentales de EE. UU. (Valoraciones, Fórmula mágica) | 10 peticiones/s como máximo; User-Agent genérico |
| SEC `company_tickers.json` | CIK ↔ ticker | — |
| Nasdaq (`api.nasdaq.com`) | Precio, capitalización y sector de cotizadas de EE. UU.; lista del Nasdaq 100 | — |
| Wikipedia | Lista del S&P 500 e IBEX 35 | Se recarga cada 7 días |
| Google News RSS | Noticias por empresa (Sentimiento) y tablón (Noticias) | Rotación por empresas para no saturar |
| Bluesky (`public.api.bsky.app`) | Publicaciones de influyentes (perfil por perfil) | La búsqueda general pide login: no se usa |
| YouTube RSS por canal | Títulos y descripciones de vídeos | Sin clave |
| alternative.me | Fear & Greed de cripto | — |
| Hyperliquid API | Perpetuos del usuario y funding de BTC | — |
| RPC públicos (Solana, Sui GraphQL, EVM) | Saldos de wallets por dirección pública | Sui JSON-RPC público obsoleto → GraphQL |
| Gmail API (OAuth, `gmail.readonly`) | Importar operaciones de MyInvestor y órdenes de BBVA | Solo lectura. Token caduca cada 7 días (app en "testing"). PDFs de BBVA se leen con `pdftotext` y no se guardan |
| Gemini API (Google AI Studio, plan gratis) | Clasificar publicaciones en Sentimiento | Clave de un proyecto **sin facturación**. Modelos antiguos no disponibles para claves nuevas. Saturación (503) frecuente → rota modelos y usa la lista de palabras |

## Descartadas (y por qué)

| Fuente | Motivo |
|---|---|
| X / Twitter API | De pago |
| StockTwits | Bloqueo antibots de Cloudflare |
| CNN Fear & Greed | Bloquea clientes automáticos (418) |
| Reddit | Bloquea sin clave; necesitaría que el usuario cree una app gratis (pendiente de decidir) |
| Open Banking (Enable Banking…) | El usuario no quiere dar acceso a sus bancos a terceros |
| Modelo local (Ollama) | El servidor previsto (e2-micro, 1 GB) no puede; en el PC sí, pero se eligió Gemini gratis |
| Fundamentales de empresas españolas | No hay fuente gratis |
| AAII (encuesta de sentimiento) | Excel binario; no se ha integrado todavía |

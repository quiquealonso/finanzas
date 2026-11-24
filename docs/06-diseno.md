# 06 · Diseño

Estilo sobrio, denso de datos, claro y oscuro (sigue al sistema). Fuente Inter; números con cifras tabulares
(`.num`). Todo en `front/src/styles.css`.

## Colores (variables CSS)

| Variable | Uso |
|---|---|
| `--bg`, `--surface`, `--surface-2`, `--surface-hover` | Fondo, tarjetas, zonas secundarias, hover |
| `--border`, `--border-strong` | Bordes |
| `--text`, `--text-2`, `--text-3` | Texto principal, secundario, tenue |
| `--accent`, `--accent-soft`, `--accent-text` | Azul de acción y selección |
| `--up`, `--up-soft` / `--down`, `--down-soft` | Ganancia (verde) / pérdida (naranja-rojo) |
| `--warn-soft`, `--warn-text` | Avisos |
| `--t-stock`, `--t-fund`, `--t-etf`, `--t-crypto`, `--t-liquid`, `--t-real`, `--t-metal`, `--t-loans` | Color fijo de cada tipo de activo (`TYPE_COLORS`) |

Nunca colores sueltos para ganancia/pérdida: usar `signClass()` de `format.utils.ts` o `--up`/`--down`.

## Clases globales

`.page`, `.page-head`, `.card`, `.card-head`, `.btn` (`.primary`, `.sm`, `.link`, `.danger`), `.seg` (botones
segmentados), `.tiles`/`.tile` (tarjetas), `.table-wrap`, `.notice`, `.dialog-backdrop`/`.dialog`, `.muted`,
`.faint`, `.small`, `.num`, `.row`, `.spacer`.

## Componentes compartidos (`front/src/app/shared/`)

| Componente | Para qué | Dónde se usa |
|---|---|---|
| `app-asset-filter` | Desplegables Banco y Tipo con selección múltiple + hueco a la derecha (`filterAside`) | Resumen, Activos |
| `app-multi-select` | Desplegable con casillas ("Todos" = ninguno elegido) | Filtro de activos (reutilizable) |
| `app-view-toggle` | "Ver: Tarjetas / Tabla", recuerda la elección por página | Activos, Movimientos, Ventas, meses del Resumen, Sentimiento, Valoraciones |
| `app-donut-chart` | Gráfico circular + leyenda en una línea (nombre · € · %), hover resalta | Distribución, Resumen |
| `ConfirmService` + `app-confirm-dialog` | Confirmaciones dentro de la app: `if (!(await confirmDialog.ask('¿Borrar…?'))) return;` (botón rojo si empieza por Borrar/Eliminar; `title`/`ok` opcionales) | Todas las páginas |
| `app-line-chart` | Gráfica de valor vs. coste con tooltip en € | Resumen |
| `app-sunburst` | Gráfico de anillos por niveles | Composición |
| `format.utils.ts` | `formatMoney`, `formatMoney0`, `formatSignedMoney`, `formatSignedPercent`, `formatDay`, `formatMonth`, `signClass` | Todas |

## Reglas acordadas con el usuario

- **Tarjetas o tabla** en todas las listas, con el selector `app-view-toggle` junto a "Ordenar por".
- **6 tarjetas por fila** en pantalla normal (menos al estrechar). Tarjetas de activos sin cambio del día.
- **Filtros** como desplegables con selección múltiple, no como chips (decidido 2026-11-23).
- **KPIs arriba, filtros debajo** en páginas de lista.
- **Detalles en diálogo** (p. ej. un día del calendario), no desplegados arriba de la página.
- **Nunca alertas del navegador** (`confirm()`, `alert()`): siempre `ConfirmService` (decidido 2026-11-24).
- **Lo que se consulta poco va plegado** (p. ej. aportaciones periódicas, una vez al mes), con un resumen en la cabecera
  y aviso si hay algo pendiente; el estado abierto/cerrado se recuerda.
- **Gráficos circulares mitad y mitad** con la tabla al lado; los euros con el mismo peso que el nombre.
- **Tablas largas**: cebra marcada y hover que solo oscurece un poco (sin colores llamativos).
- **No mostrar controles que no hacen nada** (se quitó "Color por" del calendario).
- Los % de un periodo deben llevar el **mismo signo que los euros** cuando se muestran juntos (o explicar por qué no).
- Barra lateral: Resumen, Activos, Calendario, Mensual, Distribución, Composición, Movimientos, Ventas, Inmobiliario,
  Cierres, Objetivos, Perfil de riesgo, Noticias, Sentimiento, Valoraciones, Fórmula mágica, Apuestas; al final el ojo
  ("Ocultar importes").
- **Ojo de privacidad** (barra lateral, "Ocultar importes", tecla **H**): tapa con `•••••` todo valor nominal (euros,
  dólares, títulos/unidades, ejes de las gráficas) y deja a la vista porcentajes y precios de mercado. Se recuerda en el
  navegador (`finanzas.privacy`). **Regla para código nuevo**: todo importe o cantidad de la cartera se pinta con
  `formatMoney`, `formatMoney0`, `formatSignedMoney` o `formatQty` (`shared/format.utils.ts`), o comprueba
  `privacy()` y usa `maskMoney()`/`MASK`. Nunca un número suelto con "€". Los datos públicos (precio de una acción,
  patrimonio de un fondo, ejemplos del test de riesgo) no se tapan.
- Textos cortos y en español; explicaciones largas en `title` (tooltip) o en un "¿Cómo funciona?".
- Páginas de análisis de mercado: aviso visible **"No es una recomendación de inversión"**; tonos (alcista/bajista), nunca "compra/vende".

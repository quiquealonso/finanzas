# Backend + Prisma

Backend Express con base de datos SQLite gestionada por Prisma.

## Comandos

- `npm install`
- `npm run prisma:generate`
- `npm run prisma:migrate -- --name init_finanzas`
- `npm start`

## Esquema de datos

Definido en `prisma/schema.prisma`.

Entidades principales:

- `Bank`: entidades bancarias.
- `Asset`: activos por banco (`LIQUID`, `FUND`, `STOCK`) con moneda (`EUR` o `USD`).
- `Transfer`: operacion enlazada de venta + compra entre activos.
- `FxRate`: tipo de cambio diario entre monedas.
- `MonthlyPortfolioSnapshot`: resumen mensual agregado.

## Regla de moneda

- Cada activo guarda metricas en su moneda local (`...Local`) para calcular su rentabilidad individual.
- El conjunto global y mensual se guarda/calcula en EUR (`...Eur`).
- Para activos en USD, se usa `FxRate` y/o los campos `sourceFxToEur` / `targetFxToEur` en cada `Transfer` para conversion a EUR.

Esta separacion permite que la rentabilidad de un activo se vea en su moneda original y que los agregados globales sean comparables en euros.


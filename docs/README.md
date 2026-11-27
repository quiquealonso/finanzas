# Documentación de Finanzas

App personal de inversiones (y proyecto de clase): patrimonio, rentabilidad, movimientos, calendario de
ganancias, sentimiento de mercado y valoraciones. Angular 21 + Express/Prisma + Supabase (Postgres).

Esta carpeta es la fuente de verdad del proyecto. **Léela antes de cambiar nada** (personas y asistentes de IA).

## Índice

| Documento | Para qué sirve |
|---|---|
| [01 · Arranque y operación](01-arranque-y-operacion.md) | Arrancar la app, variables de entorno, secretos, copias de seguridad, migraciones SQL |
| [02 · Arquitectura](02-arquitectura.md) | Piezas, flujo de datos, multiusuario, trabajos programados |
| [03 · Datos](03-datos.md) | Tablas de la base de datos, agrupadas por función |
| [04 · Cálculos](04-calculos.md) | Cómo se calcula cada cifra (ganancia, TTWROR, TIR, Modified Dietz…). Todas deben cuadrar entre sí |
| [05 · Páginas](05-paginas.md) | Qué hace cada pantalla, de dónde saca los datos y sus límites conocidos |
| [06 · Diseño](06-diseno.md) | Colores, componentes compartidos y reglas visuales acordadas |
| [07 · Fuentes externas](07-fuentes-externas.md) | APIs y webs de las que se leen datos, sus límites y las descartadas |
| [08 · Repositorio y CI](08-repositorio-y-ci.md) | Qué no se sube nunca, ramas, workflows de GitHub Actions, qué hacer si falla |
| [09 · Despliegue](09-despliegue.md) | Servidor público (VM + Pages): capas de seguridad, montarlo, registro, despublicar |
| [Decisiones](decisiones.md) | Registro de decisiones con su porqué (para no repetir discusiones) |
| [Backlog](backlog.md) | Ideas, fallos y peticiones pendientes: **el bucle de retroalimentación** |

## Cómo usar esta documentación para mejorar rápido

1. **Algo no te gusta o se te ocurre una idea** → apúntalo en [backlog.md](backlog.md) con la plantilla (página, qué
   pasa, qué esperas). Una línea basta.
2. **Antes de pedir un cambio** → dile al asistente "mira el backlog, punto X". Así trabaja con el contexto completo.
3. **Cuando se hace un cambio** → el que lo hace actualiza el documento de la página afectada (05), y si fue una
   decisión con alternativas, la apunta en [decisiones.md](decisiones.md). El punto del backlog pasa a "Hecho" con la fecha.
4. **Reglas de diseño nuevas** (p. ej. "6 tarjetas por fila") → van a [06-diseno.md](06-diseno.md), para que se
   apliquen en todas las páginas y no solo en la que se pidió.

Convenciones: textos de la app en español; código, comentarios y nombres en inglés; fechas ISO (2026-11-24).

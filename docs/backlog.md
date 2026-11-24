# Backlog

El bucle de retroalimentación: todo lo que se te ocurra o no te guste, aquí. Una línea basta.
Al pedir un cambio: "mira el backlog, punto X". Al terminarlo se mueve a **Hecho** con la fecha.

**Plantilla**

```
- [ ] (Página) Qué pasa o qué quiero — por qué / ejemplo. Prioridad: alta | media | baja
```

## Fallos

- [ ] (Años, Resumen) 2026 sale inflado en Usuario 1: activos sin operaciones tenían coste pero valor 0 en los snapshots de 2025. Aplazado por el usuario. Prioridad: media
- [ ] (Valoraciones) Exxon (XOM) no aparece: cambió de registro en la SEC (nuevo CIK sin historial). Prioridad: baja
- [ ] (Sentimiento) Gemini a menudo saturado (503): mucho texto se queda con la lista de palabras hasta la siguiente vuelta. Vigilar. Prioridad: media

## Ideas y peticiones

- [ ] (Repositorio) GitHub Pages: web de presentación y la app (necesita el back desplegado). Prioridad: media
- [ ] (Presentación) Diseñar la app como para un cliente final (portada, onboarding, perfil de riesgo al empezar…). Prioridad: media

- [ ] (Servidor) Subir la app a Google Cloud (VM e2-micro); el login ya está hecho. Prioridad: alta (proyecto de clase)
- [ ] (Compartir) Regenerar `finanzas-para-compartir.zip` con lo nuevo (multiusuario, correo, sentimiento, valoraciones). Prioridad: media
- [ ] (Móvil) Adaptar la app móvil a dos usuarios. Prioridad: baja
- [ ] (Movimientos) Importar WeCity desde el correo (solo hay correos de "Ingreso recibido" y amortizaciones). Prioridad: baja
- [ ] (Sentimiento) Reddit: requiere que el usuario cree una app gratis en reddit.com/prefs/apps. Prioridad: baja
- [ ] (Sentimiento) Encuesta AAII como indicador del termómetro. Prioridad: baja
- [ ] (Resumen) "Pendiente de reinvertir" no se filtra por banco/tipo. Prioridad: baja
- [ ] (Apuestas, Getquin) Decidir en 2027 si se borran "Binance" y "Binance - Cash" (se perdería su resultado realizado). Prioridad: baja

## Hecho

- [x] 2026-11-24 · (Toda la app) Ojo de privacidad en la barra lateral: oculta importes y cantidades, deja los %.
- [x] 2026-11-24 · (Back) Prisma 7.10 con adaptador `pg`, `prisma.config.ts`, conexión en modo sesión. Respuestas de la API idénticas.
- [x] 2026-11-24 · (Repositorio) Git + GitHub público, CI, Seguridad (Gitleaks, npm audit, OSV), Dependabot, README.
- [x] 2026-11-24 · (Toda la app) Login con contraseña (BCrypt + JWT), `npm run set-password`.
- [x] 2026-11-24 · (Dependencias) Angular 21.2.26, adm-zip 0.6.1, express/body-parser: sin vulnerabilidades altas en producción.
- [x] 2026-11-24 · (Toda la app) Router de Angular: URL por página, atrás/adelante, carga diferida, páginas ocultas bloqueadas.
- [x] 2026-11-24 · (Perfil de riesgo) Test de 13 preguntas, «Analizar mejores opciones» por zonas con IA, y «Mis fondos» guardados por perfil.

- [x] 2026-11-24 · (Objetivos) Barra de aportación acotada a 0–5.000 € con marca de "Tus planes".

- [x] 2026-11-24 · (Toda la app) Alertas del navegador sustituidas por un diálogo propio (13 confirmaciones).
- [x] 2026-11-24 · (Movimientos) Aportaciones periódicas plegables.

- [x] 2026-11-24 · (Movimientos) Importar del correo duplicaba en Usuario 1 → rehecho: elegir bancos, plantillas, revisión antes de guardar, emparejar con lo que ya hay, marca por usuario, recordar última importación.

- [x] 2026-11-24 · (Distribución, Resumen) Gráficos mitad y mitad, euros como columna.
- [x] 2026-11-24 · (Arranque) El navegador tardaba 2 min en abrirse (comprobaba IPv4 y `ng serve` escucha en IPv6).
- [x] 2026-11-24 · (Backend) Si Supabase no responde al arrancar, wallets/Hyperliquid reintentan en 2 min.
- [x] 2026-11-23 · (Resumen) Filtros desplegables, 1D por defecto, TTWROR/TIR anuales arriba, meses en tarjetas, gráficos circulares, sin lista de activos.
- [x] 2026-11-23 · (Calendario) Detalle en diálogo, sin "Color por", % coherentes con los euros.
- [x] 2026-11-23 · (Mensual) Por banco por defecto, resumen antes que los meses, hover suave.
- [x] 2026-11-23 · (Precios) Reintento automático cuando Yahoo no responde a un símbolo.
- [x] 2026-11-23 · Páginas Sentimiento y Valoraciones y tesis.

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

- [ ] (Gastos) Conectar BBVA y Trade Republic de verdad: el usuario crea la aplicación en Enable Banking y pone la clave. Prioridad: alta
- [ ] (Gastos) Trade Republic manda por Open Banking movimientos sin texto: lo nuevo queda en «Otros» hasta importar otro extracto. Buscar otra fuente (¿correo de cada pago?). Prioridad: media
- [ ] (Gastos) **Pendiente, recordar al usuario** · Más categorías y reglas (el usuario lo deja para más adelante): compras de valores y cripto desde la
  cuenta corriente deberían contar como inversión; recibo mensual de la tarjeta; pagos por PayPal con el comercio
  detrás; ocio online. Prioridad: media
- [ ] (Gastos) **Pendiente, recordar al usuario** · MyInvestor con cuenta de crédito pignorada. Bloqueo: la página de
  Open Banking de MyInvestor (redirección, beta) corta la contraseña a 15 caracteres → el usuario la cambiará. Luego:
  enlazar en Enable Banking **las dos cuentas** (corriente y crédito), conectar desde Gastos y revisar enseguida (la
  primera hora da todo el historial). Reglas: traspaso corriente → crédito es interno; las compras de fondos salen de
  la de crédito (inversión, enlazar con el correo); el saldo del crédito es deuda, no efectivo («Crédito dispuesto»).
  Preguntas abiertas: ¿la deuda resta en el patrimonio del Resumen?; ¿el traspaso es siempre del mismo importe que la
  compra o agrupa varias? Respaldo: correos de MyInvestor de transferencias y traspasos (cargo/abono por traspaso,
  transferencia inmediata/SEPA). Prioridad: alta
- [ ] (Gastos) Clasificar con IA (datos tapados) lo que quede en «Otros»; lectura automática diaria; presupuestos por categoría. Prioridad: media
- [ ] (Resumen) "Pendiente de reinvertir" suma toda la liquidez (cuentas de los bancos incluidas), no solo la cuenta de
  reinversión. ¿Debería ser solo lo que queda de las ventas? Prioridad: media
- [ ] (Presentación) Diseñar la app como para un cliente final (portada, onboarding, perfil de riesgo al empezar…). Prioridad: media

- [ ] (Servidor) Montar la VM y Supabase siguiendo [09 · Despliegue](09-despliegue.md) (lo hace el usuario con sus cuentas); el código y los workflows ya están. Prioridad: alta (proyecto de clase)
- [ ] (Servidor) Despublicar después de la defensa ([09](09-despliegue.md#despublicar-después-de-la-defensa)). Prioridad: alta
- [ ] (Compartir) Regenerar `finanzas-para-compartir.zip` con lo nuevo (multiusuario, correo, sentimiento, valoraciones). Prioridad: media
- [ ] (Móvil) **En pausa por decisión del usuario (2026-11-25)**: no se toca la app móvil (`mobile/`) ni se adapta la web a móvil. Cuando se retome: adaptar la app móvil a dos usuarios. Prioridad: en pausa
- [ ] (Movimientos) Importar WeCity desde el correo (solo hay correos de "Ingreso recibido" y amortizaciones). Prioridad: baja
- [ ] (Sentimiento) Reddit: requiere que el usuario cree una app gratis en reddit.com/prefs/apps. Prioridad: baja
- [ ] (Sentimiento) Encuesta AAII como indicador del termómetro. Prioridad: baja
- [ ] (Resumen) "Pendiente de reinvertir" no se filtra por banco/tipo. Prioridad: baja
- [ ] (Apuestas, Getquin) Decidir en 2027 si se borran "Binance" y "Binance - Cash" (se perdería su resultado realizado). Prioridad: baja

## Hecho

- [x] 2026-11-27 · (Entrada) Cuenta recién registrada: el tutorial sale en cada acceso (sobre la demo) hasta que lo termina o lo salta.
- [x] 2026-11-27 · (Toda la app) Barra lateral agrupada (Cartera, Rendimiento, Dinero, Planificar, Mercado) y con desplazamiento propio.
- [x] 2026-11-27 · (Servidor) API publicada en una VM de Google Cloud (`us-central1`, Docker + Caddy) con despliegue automático desde `main`.
- [x] 2026-11-27 · (Servidor) Preparar la subida: registro con código y máximo 5 cuentas, Gmail y bancos apagados en el servidor, solo el dueño refresca datos compartidos, CORS cerrado, `users` solo con la propia fila, Docker + Caddy + workflows de despliegue y Pages con demo y app real.
- [x] 2026-11-26 · (Movimientos) Inversiones detectadas en las cuentas del banco, listas para apuntar en la cartera (o enlazar si ya están).
- [x] 2026-11-26 · (Gastos) «No usar» una cuenta de un banco (BBVA tiene dos y solo se quiere una).
- [x] 2026-11-26 · (Gastos) Importar extracto PDF de Trade Republic: historia desde la apertura y texto para los movimientos de Open Banking.
- [x] 2026-11-26 · (Web) Política de privacidad y términos de uso en GitHub Pages (para Enable Banking).
- [x] 2026-11-25 · (Gastos) Nueva página tipo Fintonic: BBVA y Trade Republic por Open Banking, categorías, ahorro, recibos.
- [x] 2026-11-25 · (Comparar) Solo lo invertido, sin liquidez; tarjetas de «¿Y si lo hubieras metido en un índice?» rehechas.
- [x] 2026-11-25 · (Comparar, Simulador) Letras y fechas de las gráficas estiradas; eje con números raros; ganancia en € y rentab. de tu dinero en Comparar.
- [x] 2026-11-25 · (Comparar) Nueva página: cartera, banco o tipo de activo frente a los índices más conocidos.
- [x] 2026-11-25 · (Dependencias) Electron 41 → 42.11.18: cierra 8 avisos de Dependabot (1 alto).
- [x] 2026-11-25 · (Simulador) Las casillas de número se veían mal: la regla global de inputs pisaba la caja.
- [x] 2026-11-25 · (Movimientos) Plantillas de correo reales para cualquier banco: «✦ Crear plantilla» con IA, validadas con tus correos y compartidas.
- [x] 2026-11-25 · (Demo) El tour abría Calendario, Movimientos, Noticias, Valoraciones y Fórmula mágica desplazados; cada página nueva empieza arriba.
- [x] 2026-11-25 · (Calendario, Resumen) El resultado de la semana anterior cambiaba: los perps tomaban el precio actual en los últimos 3 días.
- [x] 2026-11-25 · (Simulador) Página nueva: simulación manual con interés compuesto y cálculo inteligente con escenarios de la cartera.
- [x] 2026-11-25 · (Toda la app) Demo guiada con tutorial de 36 pasos, empezando por el test de perfil; publicada en GitHub Pages.
- [x] 2026-11-25 · (Perfil de riesgo) Nombres de fondos de la CNMV con "&amp;" → "&".
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

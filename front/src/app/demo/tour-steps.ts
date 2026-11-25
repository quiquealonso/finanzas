/**
 * The guided tour of the demo, in order. Each step can open a page (route), point at an element marked with
 * data-tour="…" in the templates (target; none = a card in the middle) and wait until something appears (waitFor,
 * e.g. the result of the risk test) before going on by itself.
 */
export type TourAction = { label: string; goto: string; primary?: boolean };
export type TourStep = {
  id: string;
  chapter: string;
  route?: string;
  target?: string;
  title: string;
  text: string;
  /** CSS selector: the tour waits (small banner) until it exists, then goes to the next step. */
  waitFor?: string;
  /** Own buttons instead of Atrás / Siguiente ("next", "end", "leave", "restart" or the id of a step). */
  actions?: TourAction[];
};

export const TOUR: TourStep[] = [
  {
    id: 'welcome', chapter: 'Bienvenida',
    title: '¡Hola! Esto es Finanzas',
    text: 'Una app para seguir todas tus inversiones en un sitio y saber cuánto ganas de verdad. Estás en la demo: '
      + 'una cartera de ejemplo, inventada, para probarlo todo sin miedo. Nada de lo que hagas se guarda.<br><br>'
      + '<strong>¿Eres nuevo invirtiendo?</strong>',
    actions: [
      { label: 'Sí: quiero saber mi perfil', goto: 'risk-start', primary: true },
      { label: 'Ya invierto: enséñame la app', goto: 'journey' },
    ],
  },

  // ---------------------------------------------------------------- 1. risk profile
  {
    id: 'risk-start', chapter: 'Tu perfil', route: '/perfil-riesgo', target: 'risk-start',
    title: 'Primero, tu perfil de inversor',
    text: 'Antes de invertir conviene saber cuánto riesgo puedes y quieres asumir. Son 13 preguntas cortas sobre tu '
      + 'situación, tu actitud ante las caídas y tu experiencia. Pulsa <strong>Empezar</strong> y contesta con calma: '
      + 'el tutorial sigue solo cuando acabes.',
    waitFor: '[data-tour="risk-result"]',
  },
  {
    id: 'risk-result', chapter: 'Tu perfil', route: '/perfil-riesgo', target: 'risk-result',
    title: 'Tu resultado',
    text: 'Uno de cinco perfiles, de Conservador a Agresivo, con una puntuación de 0 a 100. Mira las tres barras: tu '
      + '<strong>capacidad</strong> para asumir pérdidas manda. Aunque te guste el riesgo, si tu situación no lo '
      + 'permite, el perfil no sube más de un escalón (como en los test de los bancos).',
  },
  {
    id: 'risk-equity', chapter: 'Tu perfil', route: '/perfil-riesgo', target: 'risk-equity',
    title: '¿Cuánto en bolsa?',
    text: 'La franja de color es el peso orientativo en bolsa y activos de riesgo para tu perfil. La raya es la cartera '
      + 'de ejemplo: así ves si va más arriesgada o más prudente de lo que te conviene.',
  },
  {
    id: 'risk-ai', chapter: 'Tu perfil', route: '/perfil-riesgo', target: 'risk-ai',
    title: 'Los fondos que encajan contigo, con IA',
    text: 'Pulsa <strong>✦ Analizar mejores opciones</strong>, elige las zonas del mundo (España, Europa, EE. UU.…) '
      + 'y verás cómo la IA filtra miles de fondos de la CNMV y elige 5 para tu perfil, explicando por qué. '
      + 'Guarda los que te gusten con ☆. Cuando cierres la ventana, pulsa Siguiente.',
  },
  {
    id: 'risk-funds', chapter: 'Tu perfil', route: '/perfil-riesgo', target: 'risk-funds',
    title: 'Mis fondos',
    text: 'Aquí quedan los fondos que guardes, separados por perfil: rentabilidad, volatilidad, riesgo de 1 a 7, '
      + 'gastos y el enlace a su ficha oficial. Recuerda: es orientativo, <strong>no es una recomendación de inversión</strong>.',
  },

  // ---------------------------------------------------------------- 2. the app with the example portfolio
  {
    id: 'journey', chapter: 'La app', route: '/resumen',
    title: 'Ahora, la app por dentro',
    text: 'Vamos a recorrer la app con una cartera de ejemplo: fondos indexados, ETFs, acciones, cripto, oro y un '
      + 'proyecto inmobiliario, en cinco bancos, desde enero de 2024. Todos los precios son reales.',
  },
  {
    id: 'sidebar', chapter: 'La app', route: '/resumen', target: 'sidebar',
    title: 'El menú',
    text: 'Cada página tiene su sitio aquí, de lo más general (Resumen) a lo más concreto. Las páginas de análisis de '
      + 'mercado están al final.',
  },
  {
    id: 'ov-hero', chapter: 'Resumen', route: '/resumen', target: 'ov-hero',
    title: 'Tu patrimonio',
    text: 'Lo que vale todo hoy y, debajo, cuánto has ganado en el periodo elegido: <strong>1D</strong> (hoy, hora a '
      + 'hora), 1S, 1M, 3M, en lo que va de año, 1A, todo o las fechas que quieras. La línea discontinua es el dinero '
      + 'que has metido: la distancia entre las dos es tu ganancia.',
  },
  {
    id: 'ov-filter', chapter: 'Resumen', route: '/resumen', target: 'ov-filter',
    title: 'Filtros y rentabilidad de verdad',
    text: 'Filtra por banco o tipo de activo. A la derecha, dos formas de medir: <strong>TTWROR</strong> (lo bien que '
      + 'lo hacen tus inversiones, sin contar cuándo metes dinero; sirve para compararte con un índice) y '
      + '<strong>TIR</strong> (lo que gana tu dinero teniendo en cuenta cuándo lo metiste). "Pendiente de reinvertir" es '
      + 'lo que te pagaron las ventas.',
  },
  {
    id: 'ov-years', chapter: 'Resumen', route: '/resumen', target: 'ov-years',
    title: 'Año a año',
    text: 'Con qué valor empezó cada año, cuánto ganaste, cuánto dinero nuevo metiste y con cuánto acabó. Las ganancias '
      + 'nunca se mezclan con las aportaciones.',
  },
  {
    id: 'ov-months', chapter: 'Resumen', route: '/resumen', target: 'ov-months',
    title: 'Mes a mes',
    text: 'Lo mismo por meses, en tabla o en tarjetas: días en verde y en rojo, el mejor y el peor día.',
  },
  {
    id: 'ov-split', chapter: 'Resumen', route: '/resumen', target: 'ov-split',
    title: '¿Dónde está tu dinero?',
    text: 'Reparto por tipo de activo y por banco. Pasa el ratón por el gráfico para ver cada parte.',
  },
  {
    id: 'hold-kpis', chapter: 'Activos', route: '/activos', target: 'hold-kpis',
    title: 'Activos',
    text: 'Cada inversión por separado. Arriba, el total: valor, invertido, resultado (incluido lo ya ganado vendiendo) '
      + 'y lo que se ha movido hoy.',
  },
  {
    id: 'hold-list', chapter: 'Activos', route: '/activos', target: 'hold-list',
    title: 'La ficha de cada activo',
    text: 'Pulsa cualquier activo para abrir su ficha: precio, ganancia, y botones para <strong>comprar, vender o '
      + 'ajustar</strong>. Puedes verlos en tarjetas o en tabla, agrupados por banco y ordenados como quieras.',
  },
  {
    id: 'cal-months', chapter: 'Calendario', route: '/calendario', target: 'cal-months',
    title: 'Calendario de ganancias',
    text: 'Cada día del año en verde o rojo según lo que ganó o perdió la cartera, y el total de cada semana y mes. '
      + 'Pulsa un día para ver qué activos lo movieron.',
  },
  {
    id: 'monthly-sheet', chapter: 'Mensual', route: '/mensual', target: 'monthly-sheet',
    title: 'Mensual, como un Excel',
    text: 'Una fila por banco (o por activo, o por tipo) y una columna por mes. Primero el resumen: valor al empezar, '
      + 'ahora, dinero metido, ganancia y rentabilidad. Se puede exportar a Excel.',
  },
  {
    id: 'charts-grid', chapter: 'Distribución', route: '/distribucion', target: 'charts-grid',
    title: 'Distribución',
    text: 'Cómo se reparte el patrimonio por tipo, zona del mundo, banco y moneda. Útil para ver si estás demasiado '
      + 'concentrado en algo.',
  },
  {
    id: 'comp-chart', chapter: 'Composición', route: '/composicion', target: 'comp-chart',
    title: 'Tu plan frente a la realidad',
    text: 'Decide qué porcentaje quieres de cada tipo de activo y compáralo con lo que tienes. Abajo te dice cuánto '
      + 'comprar de cada cosa para volver al plan.',
  },
  {
    id: 'cmp-chart', chapter: 'Comparar', route: '/comparar', target: 'cmp-chart',
    title: '¿Lo haces mejor que un índice?',
    text: 'Tu cartera frente al S&amp;P 500, el MSCI World y otros índices, medidos igual. Arriba puedes comparar '
      + '<strong>por banco</strong> o <strong>por tipo de activo</strong>, y abajo ves cuánto tendrías si hubieras '
      + 'metido el mismo dinero en el índice.',
  },
  {
    id: 'mov-import', chapter: 'Movimientos', route: '/movimientos', target: 'mov-import',
    title: 'Apuntar sin teclear',
    text: '<strong>Importar del correo</strong> lee los correos de confirmación de tu bróker (solo lectura), te enseña '
      + 'lo que encuentra y lo compara con lo que ya tienes antes de guardar nada. Pruébalo: en la demo hay correos de ejemplo.',
  },
  {
    id: 'mov-plans', chapter: 'Movimientos', route: '/movimientos', target: 'mov-plans',
    title: 'Aportaciones periódicas',
    text: 'Si inviertes lo mismo cada mes, apúntalo una vez como plan y la app te avisa de los meses que faltan por registrar.',
  },
  {
    id: 'mov-list', chapter: 'Movimientos', route: '/movimientos', target: 'mov-list',
    title: 'Todos los movimientos',
    text: 'Compras, ventas, ingresos y retiradas, por meses. Se pueden editar o borrar.',
  },
  {
    id: 'realized-kpis', chapter: 'Ventas', route: '/ventas', target: 'realized-kpis',
    title: 'Ventas',
    text: 'Lo que has ganado o perdido al vender, con el criterio de Hacienda (FIFO: se venden primero los títulos '
      + 'más antiguos). Útil para la declaración de la renta.',
  },
  {
    id: 're-calendar', chapter: 'Inmobiliario', route: '/inmobiliario', target: 're-calendar',
    title: 'Inmobiliario',
    text: 'Proyectos de crowdfunding inmobiliario: el interés que van generando día a día y cuándo vence cada uno.',
  },
  {
    id: 'closings-sheet', chapter: 'Cierres', route: '/cierres', target: 'closings-sheet',
    title: 'Cierres de mes',
    text: 'Una hoja aparte para apuntar a fin de mes cuánto valía cada cosa, como mucha gente hace en un Excel. '
      + '"Hacer cierre" la rellena sola.',
  },
  {
    id: 'goals-list', chapter: 'Objetivos', route: '/objetivos', target: 'goals-list',
    title: 'Objetivos',
    text: 'Pon una meta con fecha (la entrada de un piso, jubilarte…) y la app simula miles de futuros posibles con la '
      + 'rentabilidad y el riesgo de tu cartera para decirte qué probabilidad tienes de llegar.',
  },
  {
    id: 'goals-slider', chapter: 'Objetivos', route: '/objetivos', target: 'goals-slider',
    title: '¿Y si aporto más?',
    text: 'Mueve la barra para probar otra aportación mensual y ver al momento cómo cambia la probabilidad.',
  },
  {
    id: 'sim-manual', chapter: 'Simulador', route: '/simulador', target: 'sim-manual',
    title: 'Simula tu inversión',
    text: 'Haz tus cuentas: pon lo que tienes, lo que aportarás cada mes, los años y la rentabilidad que esperas, y verás '
      + 'cuánto tendrías con interés compuesto. Mueve las barras y mira cómo cambia la línea.',
  },
  {
    id: 'sim-smart', chapter: 'Simulador', route: '/simulador', target: 'sim-smart',
    title: 'Cálculo inteligente',
    text: 'Pulsa <strong>✦ Calcular con mi cartera</strong>: la app analiza lo que tienes de verdad (valor, tipos de activo, '
      + 'rentabilidad, riesgo y aportaciones) y simula miles de futuros. Verás tres escenarios: pesimista, intermedio y optimista.',
  },
  {
    id: 'news', chapter: 'Noticias', route: '/noticias',
    title: 'Noticias',
    text: 'Cada semana, un resumen de las noticias de las empresas y fondos que tienes. En la demo está vacío: se '
      + 'escribe con tus posiciones reales.',
  },
  {
    id: 'sent-gauge', chapter: 'Mercado', route: '/sentimiento', target: 'sent-gauge',
    title: 'Sentimiento de mercado',
    text: 'Un termómetro de miedo y codicia hecho a partir de noticias y de lo que publican inversores conocidos, '
      + 'clasificado por IA, empresa a empresa del S&P 500, el Nasdaq 100 o el IBEX 35.',
  },
  {
    id: 'sent-map', chapter: 'Mercado', route: '/sentimiento', target: 'sent-map',
    title: 'Empresa a empresa',
    text: 'Pulsa una empresa para ver todo lo que se ha dicho de ella y si el que lo dijo acertó a 7 días.',
  },
  {
    id: 'val-metrics', chapter: 'Mercado', route: '/valoraciones', target: 'val-metrics',
    title: 'Valoraciones',
    text: 'Una foto semanal de 16 métricas (PER, ROE, deuda…) de unas 1.900 empresas de EE. UU., con datos oficiales '
      + 'de la SEC. Elige las métricas que te importan y la app puntúa cada empresa.',
  },
  {
    id: 'val-table', chapter: 'Mercado', route: '/valoraciones', target: 'val-table',
    title: 'Tus tesis de inversión',
    text: 'Pulsa una empresa de la lista para ver todas sus métricas y su evolución, y escribe tu tesis: por qué la comprarías o no, con un precio objetivo. La app guarda el precio de '
      + 'ese día para que veas con el tiempo si acertaste.',
  },
  {
    id: 'magic-table', chapter: 'Mercado', route: '/formula-magica', target: 'magic-table',
    title: 'Fórmula mágica',
    text: 'El ranking clásico de Joel Greenblatt: empresas buenas (alta rentabilidad del capital) a buen precio, '
      + 'recalculado cada semana.',
  },
  {
    id: 'privacy', chapter: 'Extras', route: '/resumen', target: 'privacy',
    title: 'Ojo de privacidad',
    text: '¿Vas a enseñar la pantalla? Pulsa aquí (o la tecla <strong>H</strong>) y se tapan todos los importes; los '
      + 'porcentajes siguen a la vista.',
  },
  {
    id: 'new-movement', chapter: 'Extras', route: '/resumen', target: 'new-movement',
    title: 'Apuntar algo nuevo',
    text: 'Desde cualquier página: compra, venta, ingreso, retirada o traspaso. Atajo: tecla <strong>N</strong>.',
  },
  {
    id: 'end', chapter: 'Fin',
    title: '¡Ya conoces Finanzas!',
    text: 'Sigue explorando la demo todo lo que quieras: pulsa, filtra, abre fichas. Nada se guarda. Puedes repetir '
      + 'el tutorial cuando quieras desde el menú.',
    actions: [
      { label: 'Seguir explorando', goto: 'end', primary: true },
      { label: 'Repetir el tutorial', goto: 'restart' },
      { label: 'Salir de la demo', goto: 'leave' },
    ],
  },
];

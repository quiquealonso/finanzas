/**
 * Investor risk profile questionnaire, in the spirit of the bank suitability tests (MiFID): three dimensions.
 *   - capacity: how much loss the person can afford (age, horizon, savings cushion, income, weight of the money).
 *   - tolerance: how much loss they are willing to live with (goal, reaction to falls, preferred portfolio…).
 *   - knowledge: experience and basic understanding.
 * Each option has points (0..4). The result is the tolerance and knowledge mix, never above what the capacity allows
 * (one profile above it at most): someone brave without a cushion is not "aggressive".
 * Indicative and educational, never investment advice.
 */

export type Dimension = 'capacity' | 'tolerance' | 'knowledge';
export type RiskOption = { id: string; label: string; hint?: string; emoji: string; points: number; correct?: boolean };
export type RiskQuestion = {
  id: string; dimension: Dimension; title: string; help?: string; options: RiskOption[];
  /** Options drawn as small portfolio ranges (best and worst year) instead of plain cards. */
  ranges?: Record<string, { up: number; down: number }>;
};

export const QUESTIONS: RiskQuestion[] = [
  {
    id: 'age', dimension: 'capacity', title: '¿En qué etapa de la vida estás?',
    help: 'Cuanto más tiempo por delante, más margen para recuperarse de un mal año.',
    options: [
      { id: 'u30', label: 'Menos de 30 años', emoji: '🌱', points: 4 },
      { id: '30-44', label: 'Entre 30 y 44', emoji: '🌿', points: 3 },
      { id: '45-59', label: 'Entre 45 y 59', emoji: '🌳', points: 2 },
      { id: '60+', label: '60 o más', emoji: '🍂', points: 1 },
    ],
  },
  {
    id: 'horizon', dimension: 'capacity', title: '¿Cuándo crees que vas a necesitar este dinero?',
    options: [
      { id: 'lt1', label: 'En menos de un año', emoji: '⏱️', points: 0 },
      { id: '1-3', label: 'En 1 a 3 años', emoji: '📅', points: 1 },
      { id: '3-7', label: 'En 3 a 7 años', emoji: '🗓️', points: 2 },
      { id: '7-15', label: 'En 7 a 15 años', emoji: '🧭', points: 3 },
      { id: 'gt15', label: 'Dentro de más de 15 años', emoji: '🏔️', points: 4 },
    ],
  },
  {
    id: 'goal', dimension: 'tolerance', title: '¿Qué esperas de tus inversiones?',
    options: [
      { id: 'protect', label: 'Que no pierdan valor', hint: 'Lo primero es no perder', emoji: '🛡️', points: 0 },
      { id: 'beat', label: 'Ganar algo más que la inflación', hint: 'Sin grandes sustos', emoji: '🐢', points: 1 },
      { id: 'balance', label: 'Un equilibrio entre crecer y estar tranquilo', emoji: '⚖️', points: 2 },
      { id: 'grow', label: 'Que crezcan bastante con los años', hint: 'Acepto altibajos', emoji: '📈', points: 3 },
      { id: 'max', label: 'El máximo crecimiento posible', hint: 'Aunque haya años muy malos', emoji: '🚀', points: 4 },
    ],
  },
  {
    id: 'cushion', dimension: 'capacity', title: 'Sin contar lo invertido, ¿cuánto tiempo podrías cubrir tus gastos con tus ahorros?',
    help: 'El colchón para imprevistos: el paro, una avería, una reforma…',
    options: [
      { id: 'none', label: 'No tengo colchón', emoji: '😬', points: 0 },
      { id: 'lt3', label: 'Menos de 3 meses', emoji: '🪫', points: 1 },
      { id: '3-6', label: 'De 3 a 6 meses', emoji: '🔋', points: 2 },
      { id: '6-12', label: 'De 6 a 12 meses', emoji: '🛟', points: 3 },
      { id: 'gt12', label: 'Más de un año', emoji: '🏦', points: 4 },
    ],
  },
  {
    id: 'income', dimension: 'capacity', title: '¿Cómo son tus ingresos?',
    options: [
      { id: 'unstable', label: 'Inestables o inexistentes', emoji: '🌧️', points: 0 },
      { id: 'variable', label: 'Algo variables', emoji: '⛅', points: 1 },
      { id: 'stable', label: 'Estables', emoji: '☀️', points: 3 },
      { id: 'several', label: 'Estables y de varias fuentes', emoji: '🌞', points: 4 },
    ],
  },
  {
    id: 'weight', dimension: 'capacity', title: '¿Qué parte de todo tu patrimonio es este dinero que inviertes?',
    help: 'Contando casa, ahorros y todo lo demás.',
    options: [
      { id: 'gt75', label: 'Casi todo (más del 75 %)', emoji: '🧺', points: 0 },
      { id: '50-75', label: 'Más de la mitad', emoji: '🥧', points: 1 },
      { id: '25-50', label: 'Entre un cuarto y la mitad', emoji: '🍰', points: 2 },
      { id: '10-25', label: 'Entre un 10 y un 25 %', emoji: '🧁', points: 3 },
      { id: 'lt10', label: 'Menos del 10 %', emoji: '🍒', points: 4 },
    ],
  },
  {
    id: 'experience', dimension: 'knowledge', title: '¿Con qué has invertido alguna vez?',
    options: [
      { id: 'never', label: 'Nunca he invertido', emoji: '🐣', points: 0 },
      { id: 'deposits', label: 'Depósitos o productos garantizados', emoji: '💶', points: 1 },
      { id: 'funds', label: 'Fondos o ETFs', emoji: '🧺', points: 2 },
      { id: 'stocks', label: 'Acciones de empresas', emoji: '🏢', points: 3 },
      { id: 'complex', label: 'Cripto, derivados o apalancamiento', emoji: '🎢', points: 4 },
    ],
  },
  {
    id: 'quiz', dimension: 'knowledge', title: 'Una pequeña prueba: si algo que vale 100 € cae un 50 %, ¿cuánto tiene que subir para volver a 100 €?',
    help: 'Sin presión: es para ver cuánto conoces cómo se mueven las inversiones.',
    options: [
      { id: '50', label: 'Un 50 %', emoji: '🤔', points: 0 },
      { id: '75', label: 'Un 75 %', emoji: '🧐', points: 1 },
      { id: '100', label: 'Un 100 %', emoji: '💡', points: 4, correct: true },
      { id: 'dk', label: 'No lo sé', emoji: '🤷', points: 0 },
    ],
  },
  {
    id: 'drop', dimension: 'tolerance', title: 'Inviertes 10.000 € y en un mes valen 8.000 €. ¿Qué haces?',
    options: [
      { id: 'sell-all', label: 'Lo vendo todo antes de perder más', emoji: '🏃', points: 0 },
      { id: 'sell-part', label: 'Vendo una parte', emoji: '✂️', points: 1 },
      { id: 'wait', label: 'No hago nada y espero', emoji: '🧘', points: 3 },
      { id: 'buy', label: 'Compro más: está más barato', emoji: '🛒', points: 4 },
    ],
  },
  {
    id: 'portfolio', dimension: 'tolerance', title: '¿Con cuál de estas carteras te quedarías?',
    help: 'Lo que podrían ganar en un buen año y perder en uno malo, invirtiendo 10.000 €.',
    options: [
      { id: 'a', label: 'Cartera A', emoji: '🟢', points: 0 },
      { id: 'b', label: 'Cartera B', emoji: '🟡', points: 1 },
      { id: 'c', label: 'Cartera C', emoji: '🟠', points: 3 },
      { id: 'd', label: 'Cartera D', emoji: '🔴', points: 4 },
    ],
    ranges: { a: { up: 300, down: -100 }, b: { up: 900, down: -700 }, c: { up: 1800, down: -2000 }, d: { up: 3500, down: -4000 } },
  },
  {
    id: 'word', dimension: 'tolerance', title: 'Cuando oyes la palabra «riesgo», ¿qué te viene a la cabeza?',
    options: [
      { id: 'loss', label: 'Pérdida', emoji: '📉', points: 0 },
      { id: 'uncertainty', label: 'Incertidumbre', emoji: '🌫️', points: 1 },
      { id: 'opportunity', label: 'Oportunidad', emoji: '🔑', points: 3 },
      { id: 'thrill', label: 'Emoción', emoji: '⚡', points: 4 },
    ],
  },
  {
    id: 'bet', dimension: 'tolerance', title: 'Te ofrecen elegir uno de estos premios. ¿Cuál escoges?',
    options: [
      { id: 'sure', label: '1.000 € seguros', emoji: '💰', points: 0 },
      { id: 'half', label: '50 % de ganar 2.500 €', hint: 'Y 50 % de nada', emoji: '🎲', points: 2 },
      { id: 'quarter', label: '20 % de ganar 10.000 €', hint: 'Y 80 % de nada', emoji: '🎰', points: 4 },
    ],
  },
  {
    id: 'sleep', dimension: 'tolerance', title: 'Si tus inversiones cayeran un 25 % en un año, ¿cómo dormirías?',
    options: [
      { id: 'awful', label: 'Fatal, no podría soportarlo', emoji: '😱', points: 0 },
      { id: 'restless', label: 'Inquieto, lo miraría a menudo', emoji: '😟', points: 1 },
      { id: 'ok', label: 'Bien, si sé que es temporal', emoji: '🙂', points: 3 },
      { id: 'calm', label: 'Como un bebé', emoji: '😴', points: 4 },
    ],
  },
];

export type ProfileId = 'conservador' | 'moderado' | 'equilibrado' | 'dinamico' | 'agresivo';
export const PROFILES: Array<{
  id: ProfileId; name: string; emoji: string; color: string; summary: string; equity: [number, number];
}> = [
  { id: 'conservador', name: 'Conservador', emoji: '🛡️', color: '#0ea5e9', equity: [0, 20],
    summary: 'Lo primero para ti es no perder. Te encajan productos estables aunque rindan poco: liquidez, depósitos, renta fija corta.' },
  { id: 'moderado', name: 'Moderado', emoji: '🐢', color: '#14b8a6', equity: [20, 40],
    summary: 'Aceptas pequeñas caídas a cambio de ganar algo más que la inflación. Mayoría de renta fija con algo de bolsa.' },
  { id: 'equilibrado', name: 'Equilibrado', emoji: '⚖️', color: '#22c55e', equity: [40, 60],
    summary: 'Buscas crecer sin perder el sueño. Mitad bolsa, mitad activos tranquilos, y paciencia en los años malos.' },
  { id: 'dinamico', name: 'Dinámico', emoji: '📈', color: '#f59e0b', equity: [60, 80],
    summary: 'Priorizas el crecimiento a largo plazo y llevas bien los altibajos. Mayoría de bolsa con un colchón estable.' },
  { id: 'agresivo', name: 'Agresivo', emoji: '🚀', color: '#ef4444', equity: [80, 100],
    summary: 'Buscas el máximo crecimiento y aceptas caídas fuertes. Casi todo en bolsa u otros activos volátiles, con mucho horizonte.' },
];

export type RiskResult = { capacity: number; tolerance: number; knowledge: number; score: number; profile: ProfileId; capped: boolean };

/** 0..100 of each dimension, the mixed score and the profile (capped by the capacity). */
export function scoreAnswers(answers: Record<string, string>): RiskResult {
  const dim = (d: Dimension) => {
    const qs = QUESTIONS.filter((q) => q.dimension === d);
    const max = qs.reduce((s, q) => s + Math.max(...q.options.map((o) => o.points)), 0);
    const got = qs.reduce((s, q) => s + (q.options.find((o) => o.id === answers[q.id])?.points ?? 0), 0);
    return max ? Math.round((got / max) * 100) : 0;
  };
  const capacity = dim('capacity'), tolerance = dim('tolerance'), knowledge = dim('knowledge');
  // What the person is willing to take, a little moved by what they know.
  const score = Math.round(tolerance * 0.75 + knowledge * 0.25);
  const level = (v: number) => Math.min(4, Math.floor(v / 20));
  const wanted = level(score);
  // Never more than one profile above what the capacity allows.
  const allowed = Math.min(4, level(capacity) + 1);
  const final = Math.min(wanted, allowed);
  return { capacity, tolerance, knowledge, score, profile: PROFILES[final].id, capped: final < wanted };
}

/**
 * Mail import in the demo: invented confirmation e-mails of MyInvestor for the demo portfolio, so the guided tour can
 * show the whole flow (templates, review with "Nueva", "¿Ya la tienes?", "Ya la tienes"). Nothing is read from Gmail.
 */
export const MAIL_EVENTS = [
  'Usuario: Demo. Banco elegido: MyInvestor.',
  'Cargando plantillas para MyInvestor…',
  'Plantilla de MyInvestor: confirmaciones de operaciones de valores y fondos.',
  'Buscando correos de MyInvestor desde el 1 oct 2026…',
  'Correo 1 de 4: suscripción de Vanguard Global Stock Index',
  'Correo 2 de 4: suscripción de Vanguard US 500 Stock Index',
  'Correo 3 de 4: suscripción de Vanguard Global Stock Index',
  'Correo 4 de 4: suscripción de Vanguard US 500 Stock Index',
  'Comparando con tus operaciones…',
  'Listo: 4 operaciones encontradas. Revísalas antes de importar.',
];

/** Four operations: two you already have, one new and one doubtful (same units, other date). */
export function mailCandidates(setup: any, overview: any): any[] {
  const bank = (setup?.banks ?? []).find((b: any) => b.template) ?? { id: 'demo-bank', name: 'MyInvestor' };
  const price = (name: string) => (overview?.assets ?? []).find((a: any) => a.name === name)?.priceLocal ?? 100;
  const op = (key: string, date: string, name: string, amount: number, status: string, note: string, suggest = true) => {
    const p = price(name);
    return {
      key, template: 'myinvestor', bankId: bank.id, bankName: bank.name, type: 'operation', kind: 'buy', date, name,
      quantity: Math.round((amount / p) * 1e6) / 1e6, price: Math.round(p * 100) / 100, currency: 'EUR', amount,
      status, note, assetName: name, suggest,
    };
  };
  return [
    op('demo-1', '2026-11-05', 'Vanguard Global Stock Index', 300, 'exists', 'Ya la tienes: misma fecha, mismo activo y títulos.'),
    op('demo-2', '2026-11-05', 'Vanguard US 500 Stock Index', 150, 'exists', 'Ya la tienes: misma fecha, mismo activo y títulos.'),
    op('demo-3', '2026-11-20', 'Vanguard Global Stock Index', 1000, 'new', 'Nueva: no la tienes apuntada.'),
    op('demo-4', '2026-10-09', 'Vanguard US 500 Stock Index', 150, 'maybe', '¿Ya la tienes? Hay una compra igual el 5 oct.', false),
  ];
}

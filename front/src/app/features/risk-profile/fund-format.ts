/** A fund as the finder returns it (back/src/fund-finder.ts → Pick) and as it is saved (saved_funds.data). */
export type FundPick = {
  isin: string; name: string; manager: string | null; category: string | null; source: string; regions: Record<string, number>;
  ret1y: number | null; ret3y: number | null; vol: number | null; risk: number | null; ter: number | null; aum: number | null; reason: string;
};

export type SavedFund = { id: string; isin: string; profile: string; zones: string[]; data: FundPick; createdAt: string };

export const ZONES: Array<{ id: string; name: string; flag: string; hint: string }> = [
  { id: 'ES', name: 'España', flag: '🇪🇸', hint: 'Empresas y deuda españolas' },
  { id: 'EU', name: 'Europa', flag: '🇪🇺', hint: 'Zona euro, Reino Unido, Suiza, nórdicos' },
  { id: 'US', name: 'EE. UU.', flag: '🇺🇸', hint: 'Y Canadá' },
  { id: 'JP', name: 'Japón', flag: '🇯🇵', hint: '' },
  { id: 'CN', name: 'China', flag: '🇨🇳', hint: 'Con Hong Kong' },
  { id: 'APAC', name: 'Asia-Pacífico', flag: '🌏', hint: 'Australia, Singapur, Nueva Zelanda' },
  { id: 'EM', name: 'Emergentes', flag: '🌍', hint: 'India, Corea, Taiwán, Sudáfrica…' },
  { id: 'LATAM', name: 'Latinoamérica', flag: '🌎', hint: 'Brasil, México, Chile…' },
  { id: 'GLOBAL', name: 'Global', flag: '🌐', hint: 'Fondos repartidos por todo el mundo' },
];

/** Signed percentage ("+12,3 %"); d = 2 prints without sign (costs). */
export function pct(v: number | null, d = 1): string {
  return v == null ? '—' : `${v >= 0 && d !== 2 ? '+' : ''}${(v * 100).toFixed(d).replace('.', ',')} %`;
}

export function plain(v: number | null, d = 1): string {
  return v == null ? '—' : `${(v * 100).toFixed(d).replace('.', ',')} %`;
}

export function money(v: number | null): string {
  if (v == null) return '—';
  return v >= 1e9 ? `${(v / 1e9).toFixed(1).replace('.', ',')} mil M€` : `${Math.round(v / 1e6).toLocaleString('es-ES')} M€`;
}

/** Main regions of a fund, by name with their weight (flags do not render on Windows). */
export function regionFlags(r: Record<string, number>): string {
  const list = Object.entries(r ?? {}).sort((a, b) => b[1] - a[1]).filter(([, v]) => v >= 0.1).slice(0, 3);
  if (!list.length) return 'Global';
  return list.map(([k, v]) => `${ZONES.find((z) => z.id === k)?.name ?? k} ${Math.round(v * 100)} %`).join(' · ');
}

export function zoneFlags(ids: string[]): string {
  return ids.map((id) => ZONES.find((z) => z.id === id)?.name ?? id).join(', ');
}

/** Official page of the fund: CNMV for Spanish funds, Yahoo lookup for the rest. */
export function fundLink(p: Pick<FundPick, 'isin' | 'source'>): string {
  return p.source === 'cnmv'
    ? `https://www.cnmv.es/portal/Consultas/IIC/Fondo.aspx?isin=${p.isin}`
    : `https://finance.yahoo.com/lookup?s=${p.isin}`;
}

import { Express } from "express";
import { currentUser, DEFAULT_USER, prisma, USERS, withUser } from "./prisma";
import { createMovement, fxOn, handler, HttpError, madridToday, num, refreshSnapshots, round } from "./portfolio";

// On-chain spot wallets (Solana, Sui, EVM chains) read with public addresses, no keys. See supabase/wallets.sql.
// The sync stores every balance, maps tokens to assets and brings the asset quantity in line with the chain:
// differences up to AUTO_PCT are adjusted on their own (staking rewards, gas); bigger ones wait for the user.

const SOURCE = "wallet";
/** Differences up to this share of the position are adjusted automatically. */
const AUTO_PCT = 0.02;
/** Unmapped tokens worth less than this (USD) are dust or spam and are not shown. */
const MIN_USD = 1;
/**
 * Differences worth less than this (USD) are neither shown nor booked: staking rewards keep coming in, so SOL always
 * differs a bit. They build up until they reach it, then go through the normal rules (auto up to AUTO_PCT).
 */
const MIN_DIFF_USD = 5;

const SOLANA_RPC = "https://api.mainnet-beta.solana.com";
const SUI_GRAPHQL = "https://graphql.mainnet.sui.io/graphql";
const EVM_RPC: Record<string, string> = {
  bsc: "https://bsc-dataseed.binance.org",
  ethereum: "https://ethereum-rpc.publicnode.com",
  arbitrum: "https://arb1.arbitrum.io/rpc",
  base: "https://mainnet.base.org",
};
const TOKEN_PROGRAMS = ["TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"];

type Balance = { token: string; amount: number; staked?: number; symbol?: string; name?: string; decimals?: number; usdPrice?: number | null };

async function rpc(url: string, method: string, params: unknown[]): Promise<any> {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  if (!res.ok) throw new Error(`${method}: HTTP ${res.status}`);
  const body: any = await res.json();
  if (body.error) throw new Error(`${method}: ${body.error.message ?? JSON.stringify(body.error)}`);
  return body.result;
}

/** SOL (wallet + stake accounts) and every SPL token with a balance. Names and prices from Jupiter. */
async function solanaBalances(address: string): Promise<Balance[]> {
  const lamports = (await rpc(SOLANA_RPC, "getBalance", [address])).value as number;
  // Stake accounts whose withdrawer is this wallet (offset 44 of the stake account data).
  const stakes: any[] = await rpc(SOLANA_RPC, "getProgramAccounts", [
    "Stake11111111111111111111111111111111111111",
    { encoding: "jsonParsed", filters: [{ memcmp: { offset: 44, bytes: address } }] },
  ]);
  const staked = stakes.reduce((s, a) => s + a.account.lamports, 0) / 1e9;
  const out: Balance[] = [{ token: "native", amount: lamports / 1e9 + staked, staked, symbol: "SOL", decimals: 9 }];
  const byMint = new Map<string, Balance>();
  for (const programId of TOKEN_PROGRAMS) {
    const accounts = (await rpc(SOLANA_RPC, "getTokenAccountsByOwner", [address, { programId }, { encoding: "jsonParsed" }])).value as any[];
    for (const a of accounts) {
      const info = a.account.data.parsed.info;
      const amount = Number(info.tokenAmount.uiAmountString);
      if (!(amount > 0)) continue;
      const prev = byMint.get(info.mint);
      byMint.set(info.mint, { token: info.mint, amount: (prev?.amount ?? 0) + amount, decimals: info.tokenAmount.decimals });
    }
  }
  const mints = [...byMint.keys()];
  for (let i = 0; i < mints.length; i += 50) {
    try {
      const res = await fetch(`https://lite-api.jup.ag/tokens/v2/search?query=${mints.slice(i, i + 50).join(",")}`);
      if (res.ok) for (const t of (await res.json()) as any[]) {
        const b = byMint.get(t.id);
        if (b) Object.assign(b, { symbol: t.symbol, name: t.name, usdPrice: t.usdPrice ?? null });
      }
    } catch { /* names and prices are only informative */ }
  }
  return [...out, ...byMint.values()];
}

/** Every coin of a Sui address (GraphQL: the public JSON-RPC is gone). */
async function suiBalances(address: string): Promise<Balance[]> {
  const query = `{ address(address: "${address}") { balances(first: 50) { nodes { coinType { repr } totalBalance } } } }`;
  const res = await fetch(SUI_GRAPHQL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query }) });
  if (!res.ok) throw new Error(`Sui GraphQL: HTTP ${res.status}`);
  const body: any = await res.json();
  if (body.errors) throw new Error(`Sui GraphQL: ${body.errors[0]?.message}`);
  const known: Array<{ token: string; decimals: number | null }> = await prisma.$queryRawUnsafe(
    `select token, decimals from wallet_tokens where chain = 'sui'`
  );
  const decimals = new Map(known.map((k) => [k.token, k.decimals]));
  return (body.data?.address?.balances?.nodes ?? [])
    .filter((n: any) => BigInt(n.totalBalance) > 0n)
    .map((n: any) => {
      const token = n.coinType.repr as string;
      const d = decimals.get(token) ?? 9; // most Sui coins use 9
      return { token, amount: Number(BigInt(n.totalBalance)) / 10 ** d, decimals: d, symbol: token.split("::").pop() };
    });
}

/** Native coin plus the ERC-20 tokens already listed for the chain (EVM has no keyless "all tokens" call). */
async function evmBalances(chain: string, address: string): Promise<Balance[]> {
  const url = EVM_RPC[chain];
  const native = Number(BigInt(await rpc(url, "eth_getBalance", [address, "latest"]))) / 1e18;
  const out: Balance[] = [{ token: "native", amount: native, decimals: 18 }];
  const tokens: Array<{ token: string; decimals: number | null }> = await prisma.$queryRawUnsafe(
    `select token, decimals from wallet_tokens where chain = $1 and token <> 'native'`, chain
  );
  const data = "0x70a08231" + address.toLowerCase().replace("0x", "").padStart(64, "0"); // balanceOf(address)
  for (const t of tokens) {
    const raw = BigInt(await rpc(url, "eth_call", [{ to: t.token, data }, "latest"]));
    const d = t.decimals ?? 18;
    out.push({ token: t.token, amount: Number((raw * 1_000_000n) / 10n ** BigInt(d)) / 1e6, decimals: d });
  }
  return out;
}

type Diff = { chain: string; token: string; symbol: string | null; assetId: string; assetName: string; onChain: number; inApp: number; diff: number; diffEur: number; tiny: boolean };

/** Reads every wallet, stores the balances and adjusts the small differences. */
export async function syncWallets(): Promise<{ adjusted: Diff[]; pending: Diff[]; errors: string[] }> {
  const accounts: Array<{ chain: string; address: string }> = await prisma.$queryRawUnsafe(`select chain, address from wallet_accounts order by chain`);
  const errors: string[] = [];
  for (const a of accounts) {
    try {
      const balances = a.chain === "solana" ? await solanaBalances(a.address)
        : a.chain === "sui" ? await suiBalances(a.address)
        : await evmBalances(a.chain, a.address);
      await prisma.$executeRawUnsafe(`delete from wallet_balances where chain = $1 and address = $2`, a.chain, a.address);
      for (const b of balances) {
        await prisma.$executeRawUnsafe(
          `insert into wallet_tokens (chain, token, symbol, name, decimals) values ($1, $2, $3, $4, $5)
           on conflict (chain, token) do update set symbol = coalesce(wallet_tokens.symbol, excluded.symbol),
                  name = coalesce(wallet_tokens.name, excluded.name), decimals = coalesce(wallet_tokens.decimals, excluded.decimals)`,
          a.chain, b.token, b.symbol ?? null, b.name ?? null, b.decimals ?? null
        );
        await prisma.$executeRawUnsafe(
          `insert into wallet_balances (chain, address, token, amount, staked, "usdPrice") values ($1, $2, $3, $4, $5, $6)`,
          a.chain, a.address, b.token, b.amount, b.staked ?? 0, b.usdPrice ?? null
        );
      }
      await prisma.$executeRawUnsafe(`update wallet_accounts set "lastSyncAt" = now(), "lastError" = null where chain = $1 and address = $2`, a.chain, a.address);
    } catch (e: any) {
      const msg = String(e?.message ?? e);
      errors.push(`${a.chain}: ${msg}`);
      await prisma.$executeRawUnsafe(`update wallet_accounts set "lastError" = $3 where chain = $1 and address = $2`, a.chain, a.address, msg);
    }
  }

  const diffs = await walletDiffs();
  const adjusted: Diff[] = [], pending: Diff[] = [];
  for (const d of diffs) {
    // Under MIN_DIFF_USD nothing is written: staking rewards build up and are booked in one adjustment once they
    // reach it, instead of a tiny "Ajuste" every day.
    if (d.tiny) continue;
    const small = d.inApp > 0 && Math.abs(d.diff) <= d.inApp * AUTO_PCT;
    if (small) {
      await adjustTo(d, "Ajuste automático (saldo de la wallet)");
      adjusted.push(d);
    } else {
      pending.push(d);
    }
  }
  return { adjusted, pending, errors };
}

/** Mapped tokens whose on-chain amount (summed over wallets) differs from the asset quantity. */
async function walletDiffs(): Promise<Diff[]> {
  const rows: Array<{ chain: string; token: string; symbol: string | null; assetId: string; assetName: string; onChain: unknown; inApp: unknown; priceEur: unknown }> =
    await prisma.$queryRawUnsafe(
      `select t.chain, t.token, t.symbol, a.id as "assetId", a.name as "assetName",
              coalesce(sum(b.amount), 0) as "onChain", a.quantity as "inApp", a."marketPriceEur" as "priceEur"
         from wallet_tokens t
         join assets a on a.id = t."assetId"
         left join wallet_balances b on b.chain = t.chain and b.token = t.token
        where exists (select 1 from wallet_accounts w where w.chain = t.chain and w."lastError" is null)
        group by t.chain, t.token, t.symbol, a.id, a.name, a.quantity, a."marketPriceEur"`
    );
  // fxOn gives euros per dollar.
  const minDiffEur = MIN_DIFF_USD * (await fxOn("USD", madridToday()).catch(() => 0.9));
  return rows
    .map(({ priceEur, ...r }) => {
      const diff = round(num(r.onChain) - num(r.inApp), 9);
      const diffEur = round(Math.abs(diff) * num(priceEur), 2);
      // Without a price the value is unknown: always shown.
      return { ...r, onChain: round(num(r.onChain), 9), inApp: round(num(r.inApp), 9), diff, diffEur, tiny: num(priceEur) > 0 && diffEur < minDiffEur };
    })
    // Below a millionth of the position (or of a unit) it is rounding, not a change.
    .filter((r) => Math.abs(r.diff) > Math.max(1e-6, r.inApp * 1e-6));
}

/** Sets the asset quantity to the on-chain amount with an "adjust" operation, once per token and day. */
async function adjustTo(d: Diff, note: string): Promise<void> {
  const day = madridToday();
  const externalId = `${d.chain}:${d.token}:${day}`;
  const done: unknown[] = await prisma.$queryRawUnsafe(
    `select 1 from external_operations where source = $1 and "externalId" = $2`, SOURCE, externalId
  );
  if (done.length) return;
  const result = await createMovement({ kind: "adjust", assetId: d.assetId, quantity: d.onChain, date: day, note });
  const ops: Array<{ id: string }> = await prisma.$queryRawUnsafe(`select id from asset_operations where "groupId" = $1`, result.groupId);
  for (const op of ops) {
    await prisma.$executeRawUnsafe(
      `insert into external_operations (source, "externalId", "operationId", "assetId") values ($1, $2, $3, $4) on conflict do nothing`,
      SOURCE, externalId, op.id, d.assetId
    );
  }
  await refreshSnapshots(result.assetIds, result.day);
}

const running = new Map<string, Promise<Awaited<ReturnType<typeof syncWallets>>>>();
/** Syncs the wallets of the current user; concurrent calls of the same user share the run. */
export function syncWalletsOnce() {
  const user = currentUser() ?? DEFAULT_USER;
  let run = running.get(user);
  if (!run) {
    run = syncWallets().finally(() => running.delete(user));
    running.set(user, run);
  }
  return run;
}

export function registerWalletRoutes(app: Express): void {
  app.post("/api/v2/wallets/sync", handler(async (_req, res) => {
    res.json(await syncWalletsOnce());
  }));

  // Wallets, differences waiting for the user and tokens with value not linked to any asset.
  app.get("/api/v2/wallets", handler(async (_req, res) => {
    const accounts = await prisma.$queryRawUnsafe(`select chain, address, "lastSyncAt", "lastError" from wallet_accounts order by chain`);
    // Differences worth less than MIN_DIFF_USD wait (not shown) until they build up to it.
    const pending = (await walletDiffs()).filter((d) => !d.tiny);
    const unmapped = await prisma.$queryRawUnsafe(
      `select b.chain, b.token, t.symbol, t.name, sum(b.amount)::float as amount, max(b."usdPrice")::float as "usdPrice",
              (sum(b.amount) * max(b."usdPrice"))::float as "usdValue"
         from wallet_balances b join wallet_tokens t on t.chain = b.chain and t.token = b.token
        where t."assetId" is null and not t.ignored
        group by b.chain, b.token, t.symbol, t.name
       having b.token = 'native' or sum(b.amount) * max(b."usdPrice") >= $1
        order by 7 desc nulls last`,
      MIN_USD
    );
    res.json({ accounts, pending, unmapped });
  }));

  // Applies one pending difference: the asset takes the on-chain amount.
  app.post("/api/v2/wallets/apply", handler(async (req, res) => {
    const d = (await walletDiffs()).find((x) => x.chain === req.body?.chain && x.token === req.body?.token);
    if (!d) throw new HttpError(404, "No hay diferencia pendiente para ese token.");
    await adjustTo(d, "Ajuste al saldo de la wallet");
    res.json({ ok: true });
  }));

  // Links a token to an asset (or ignores it). assetId "new" creates a crypto asset with the token symbol.
  app.post("/api/v2/wallets/map", handler(async (req, res) => {
    const chain = String(req.body?.chain ?? ""), token = String(req.body?.token ?? "");
    if (req.body?.ignore) {
      await prisma.$executeRawUnsafe(`update wallet_tokens set ignored = true where chain = $1 and token = $2`, chain, token);
      res.json({ ok: true });
      return;
    }
    let assetId = String(req.body?.assetId ?? "");
    if (assetId === "new") {
      const t: Array<{ symbol: string | null; bankId: string }> = await prisma.$queryRawUnsafe(
        `select t.symbol, w."bankId" from wallet_tokens t join wallet_accounts w on w.chain = t.chain where t.chain = $1 and t.token = $2 limit 1`,
        chain, token
      );
      if (!t[0]) throw new HttpError(404, "Token no encontrado.");
      const type = await prisma.assetTypeEntity.findUnique({ where: { code: "CRYPTO" } });
      const symbol = String(req.body?.symbol ?? "").trim();
      const asset = await prisma.asset.create({
        data: {
          bankId: t[0].bankId, name: String(req.body?.name ?? t[0].symbol ?? token).trim(), currency: "USD", assetTypeId: type!.id,
          marketSymbol: symbol || null, marketProvider: symbol ? "yahoo" : null, regions: { CRYPTO: 100 }
        }
      });
      assetId = asset.id;
    }
    await prisma.$executeRawUnsafe(`update wallet_tokens set "assetId" = $3, ignored = false where chain = $1 and token = $2`, chain, token, assetId);
    res.json({ ok: true, assetId });
  }));

  // While the backend runs, read the wallets every hour.
  // If the database can't be reached (network not ready yet, Supabase pooler down for a moment), try again in
  // 2 minutes instead of waiting for the next hour, and log one short line instead of the whole Prisma message.
  let retry: ReturnType<typeof setTimeout> | null = null;
  const tick = async () => {
    for (const user of USERS) {
      try {
        await withUser(user, () => syncWalletsOnce());
      } catch (e: any) {
        const msg = String(e?.message ?? e);
        if (/Can't reach database server|Timed out fetching a new connection/.test(msg)) {
          console.error(`Wallet sync (${user}): base de datos no disponible, se reintenta en 2 minutos`);
          if (!retry) retry = setTimeout(() => { retry = null; void tick(); }, 2 * 60_000);
          return;
        }
        console.error(`Wallet sync (${user}):`, msg);
      }
    }
  };
  setTimeout(tick, 30_000);
  setInterval(tick, 60 * 60_000);
}

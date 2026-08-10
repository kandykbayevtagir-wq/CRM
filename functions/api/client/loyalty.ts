import { forbidden, getSessionUser, isClient, unauthorized } from "../../_lib/auth";
import type { CrmEnv } from "../../_lib/env";
import { json } from "../../_lib/http";

export const onRequestGet: PagesFunction<CrmEnv> = async ({ request, env }) => {
  const user = await getSessionUser(request, env.DB);
  if (!user) return unauthorized();
  if (!isClient(user)) return forbidden();
  if (!user.clientId) return json({ ok: true, account: { pointsBalance: 0, lifetimePoints: 0 }, transactions: [] });
  const [account, transactions] = await Promise.all([
    env.DB.prepare("SELECT points_balance AS pointsBalance, lifetime_points AS lifetimePoints FROM loyalty_accounts WHERE client_id = ?").bind(user.clientId).first<{ pointsBalance: number; lifetimePoints: number }>(),
    env.DB.prepare("SELECT id, points, kind, description, created_at AS createdAt FROM loyalty_transactions WHERE client_id = ? ORDER BY created_at DESC LIMIT 50").bind(user.clientId).all(),
  ]);
  return json({ ok: true, account: account ?? { pointsBalance: 0, lifetimePoints: 0 }, transactions: transactions.results ?? [] });
};

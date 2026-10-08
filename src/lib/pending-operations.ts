export type PendingOperation = { actorId:string; key:string; path:string; fingerprint:string; createdAt:string };
const storageKey='pmk_pending_operations_v1';
let actorId='';
export const operationPaths: Record<string,string> = {
  '/api/finance':'expense:create','/api/rent':'rent:create','/api/utilities':'utility:create',
  '/api/payroll/adjustment':'payroll:adjustment','/api/payments':'payment:create','/api/payments/refund':'payment:refund',
};
export function setOperationActor(id:string) { actorId=id; }
function readOperations(): PendingOperation[] {
  try {
    const value:unknown=JSON.parse(window.localStorage.getItem(storageKey) || '[]');
    if (!Array.isArray(value)) return [];
    return value.filter((v):v is PendingOperation=>v && typeof v==='object' && typeof v.actorId==='string'
      && typeof v.key==='string' && typeof v.fingerprint==='string' && typeof v.createdAt==='string'
      && typeof v.path==='string' && Object.hasOwn(operationPaths,v.path));
  } catch { return []; }
}
export function pendingOperations(id=actorId): PendingOperation[] { return readOperations().filter(v=>v.actorId===id); }
function canonical(value:unknown):unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value==='object') return Object.fromEntries(Object.entries(value).filter(([key])=>key!=='idempotencyKey').sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,v])=>[k,canonical(v)]));
  return value;
}
export async function rememberOperation(path:string,body:Record<string,unknown>) {
  if (!actorId || !operationPaths[path]) return null;
  const ownerId=actorId;
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(canonical(body))));
  const fingerprint=Array.from(new Uint8Array(digest),v=>v.toString(16).padStart(2,'0')).join('');
  if(ownerId!==actorId) throw new Error('Пользователь изменился. Повторите вход перед сохранением операции.');
  const all=readOperations();
  const entries=all.filter(v=>v.actorId===ownerId);
  const previous=entries.find(v=>v.path===path && v.fingerprint===fingerprint);
  if (previous) return previous;
  if (entries.length>=100) throw new Error('Проверьте незавершённые операции перед созданием новых.');
  const operation={actorId,key:typeof body.idempotencyKey==='string'?body.idempotencyKey:crypto.randomUUID(),path,fingerprint,createdAt:new Date().toISOString()};
  try { window.localStorage.setItem(storageKey,JSON.stringify([...all,operation])); }
  catch { throw new Error('Не удалось сохранить ключ операции. Разрешите локальное хранилище и повторите.'); }
  window.dispatchEvent(new Event('crm:pending-operations'));
  return operation;
}
export function forgetOperation(key:string) {
  try { window.localStorage.setItem(storageKey,JSON.stringify(readOperations().filter(v=>v.actorId!==actorId || v.key!==key))); }
  catch { return; }
  window.dispatchEvent(new Event('crm:pending-operations'));
}

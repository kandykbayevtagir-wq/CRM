"use client";
import Link from 'next/link';
import { useEffect,useState } from 'react';
import { apiFetch,dispatchCrmEvent } from '@/lib/api-client';
import { forgetOperation,pendingOperations,type PendingOperation } from '@/lib/pending-operations';
import { Button } from '@/components/ui';

export function PendingOperations({actorId}:{actorId:string}) {
  const [items,setItems]=useState<PendingOperation[]>([]); const [notice,setNotice]=useState(''); const [busy,setBusy]=useState(false);
  useEffect(()=>{ const update=()=>setItems(pendingOperations(actorId)); update();
    window.addEventListener('crm:pending-operations',update); window.addEventListener('storage',update);
    return ()=>{window.removeEventListener('crm:pending-operations',update);window.removeEventListener('storage',update);};
  },[actorId]);
  async function check() {
    setBusy(true);setNotice('');let committed=0;
    try {
      for(const item of items) {
        const status=await apiFetch<{state:string}>('/api/mutation-status?'+new URLSearchParams({path:item.path,key:item.key}));
        if(status.state==='COMMITTED') {forgetOperation(item.key);committed++;}
      }
      setNotice(committed?`Подтверждено сохранённых операций: ${committed}. Остальные требуют проверки.`:'Квитанции пока не найдены. Если повторяете форму, используйте те же данные — исходный ключ восстановится автоматически.');
      if(committed) dispatchCrmEvent('crm:data-changed');
    } catch(error) {setNotice(error instanceof Error?error.message:'Не удалось проверить операции');}
    finally {setBusy(false);}
  }
  if(!items.length && !notice) return null;
  return <section className="pending-operations notice notice-info" role="status"><div><strong>{items.length?`Проверка операций: ${items.length}`:'Результат проверен'}</strong><p>{notice || 'После потери связи результат может быть уже сохранён. Проверьте его перед созданием новой операции.'}</p></div>{items.length?<><Button variant="secondary" loading={busy} onClick={()=>void check()}>Проверить результат</Button><Link href="/finance" className="button button-ghost">Открыть журнал</Link></>:<Button variant="ghost" onClick={()=>setNotice('')}>Закрыть</Button>}</section>;
}

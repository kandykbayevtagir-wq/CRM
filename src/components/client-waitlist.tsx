"use client";
import { useState } from 'react';
import { apiFetch,dispatchCrmEvent } from '@/lib/api-client';
import { useApi } from '@/lib/use-api';
import { formatDateTime } from '@/lib/format';
import { Button,SectionCard } from '@/components/ui';
import { ErrorState } from '@/components/data-state';
type Waiter={id:string;status:string;serviceName:string;branchName:string;employeeName:string;holdId:string|null;startsAt:string;expiresAt:string;serviceId:string;branchId:string;employeeId:string;appointmentId:string|null};
export function ClientWaitlist() {
  const {data,error,reload}=useApi<{items:Waiter[]}>('/api/client/waitlist',undefined,{refreshInterval:30000});
  const [busy,setBusy]=useState('');const [notice,setNotice]=useState('');
  async function act(item:Waiter,action:string) {
    if(busy) return;
    setBusy(item.id);setNotice('');
    try {
      if(action==='accept') await apiFetch('/api/client/appointments',{method:'POST',body:{serviceId:item.serviceId,branchId:item.branchId,employeeId:item.employeeId,startsAt:item.startsAt,appointmentId:item.appointmentId || '',holdId:item.holdId,idempotencyKey:'hold-'+item.holdId}});
      else await apiFetch('/api/client/waitlist',{method:'PATCH',body:{id:item.id,action}});
      setNotice(action==='accept'?'Время подтверждено. Запись сохранена.':action==='cancel'?'Заявка отменена.':'Предложение отклонено. Продолжим искать другое время.');
      dispatchCrmEvent('crm:data-changed');await reload();
    } catch(e) {setNotice(e instanceof Error?e.message:'Не удалось обработать предложение');await reload();}
    finally {setBusy('');}
  }
  if(error) return <ErrorState message={error} onRetry={reload}/>;
  if(!data?.items.length && !notice) return null;
  return <section id="waitlist"><SectionCard title="Лист ожидания" subtitle="Предложения действуют 10 минут; подтверждение защищено от двойной записи">{notice?<p className="notice notice-info" role="status">{notice}</p>:null}<div className="client-appointment-list">{data?.items.map(item=>{
    const available=Boolean(item.holdId && Date.parse(item.expiresAt)>Date.now());
    return <article className="client-appointment-card" key={item.id}><strong>{item.serviceName || 'Приём'} · {item.branchName || 'Центр'}</strong><p>{available?`${formatDateTime(item.startsAt)} · ${item.employeeName}`:'Ищем подходящее свободное время'}</p>{available?<><small>Подтвердите до {formatDateTime(item.expiresAt)}</small><div className="client-appointment-actions"><Button loading={busy===item.id} disabled={Boolean(busy)} onClick={()=>void act(item,'accept')}>Подтвердить время</Button><Button variant="secondary" disabled={Boolean(busy)} onClick={()=>void act(item,'decline')}>Другое время</Button></div></>:null}<Button variant="ghost" disabled={Boolean(busy)} onClick={()=>void act(item,'cancel')}>Отменить ожидание</Button></article>;
  })}</div></SectionCard></section>;
}

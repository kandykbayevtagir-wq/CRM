type Source={key:string;table:string;foreignKey:string;amount:string;date:string;status:string;kind:string;direction:string};
const sources:Source[]=[
  {key:'payment',table:'payments',foreignKey:'payment_id',amount:'amount',date:'paid_at',status:"s.payment_status='POSTED'",kind:'PAYMENT',direction:'INCOME'},
  {key:'payroll',table:'payroll_periods',foreignKey:'payroll_period_id',amount:'total_amount',date:'closed_at',status:"s.status='CLOSED'",kind:'SALARY',direction:'EXPENSE'},
  {key:'rent',table:'rent_payments',foreignKey:'rent_payment_id',amount:'amount',date:'paid_at',status:"s.status='PAID'",kind:'RENT',direction:'EXPENSE'},
  {key:'utility',table:'utility_payments',foreignKey:'utility_payment_id',amount:'amount',date:'paid_at',status:"s.status='PAID'",kind:'UTILITIES',direction:'EXPENSE'},
  {key:'expense',table:'expenses',foreignKey:'expense_id',amount:'amount',date:'occurred_at',status:"s.status='PAID'",kind:'EXPENSE',direction:'EXPENSE'},
];

/** Record-level checks catch compensating errors that aggregate totals cannot. */
export async function reconciliationIssues(db:D1Database) {
  const parts=sources.flatMap(s=>{
    const date=s.key==='payroll'?"julianday(s.period_end,'-1 second')":['rent','utility'].includes(s.key)?'julianday(COALESCE(s.paid_at,s.due_date))':`julianday(s.${s.date})`;
    return [
    `SELECT '${s.key}' AS kind,s.id AS sourceId,MIN(l.id) AS ledgerId,'SOURCE_MISMATCH' AS code,
      s.${s.amount} AS sourceAmount,COALESCE(SUM(l.amount),0) AS ledgerAmount
      FROM ${s.table} s LEFT JOIN financial_transactions l ON l.${s.foreignKey}=s.id
        AND l.kind='${s.kind}' AND l.status='POSTED'
      WHERE ${s.status} GROUP BY s.id HAVING COUNT(l.id)<>1 OR
        abs(round(s.${s.amount}*100)-round(COALESCE(SUM(l.amount),0)*100))>0 OR
        SUM(CASE WHEN l.direction<>'${s.direction}' OR julianday(l.occurred_at) IS NOT ${date}
          ${s.key==='payment'?'OR l.appointment_id IS NOT s.appointment_id':''} THEN 1 ELSE 0 END)>0`,
    `SELECT '${s.key}' AS kind,l.${s.foreignKey} AS sourceId,l.id AS ledgerId,'ORPHAN_LEDGER' AS code,0 AS sourceAmount,l.amount AS ledgerAmount
      FROM financial_transactions l LEFT JOIN ${s.table} s ON s.id=l.${s.foreignKey}
      WHERE l.status='POSTED' AND l.kind='${s.kind}'
        AND (s.id IS NULL OR NOT (${s.status}))`,
  ];});
  parts.push(`SELECT 'refund' AS kind,MIN(s.id) AS sourceId,MIN(l.id) AS ledgerId,'REFUND_MISMATCH' AS code,
    SUM(s.amount) AS sourceAmount,COALESCE(MAX(l.total),0) AS ledgerAmount FROM payment_adjustments s
    LEFT JOIN (SELECT payment_id,round(amount*100) AS cents,julianday(occurred_at) AS at,
      COUNT(*) AS n,SUM(amount) AS total,MIN(id) AS id FROM financial_transactions WHERE kind='REFUND' AND status='POSTED' AND direction='INCOME'
      GROUP BY payment_id,round(amount*100),julianday(occurred_at)) l
      ON l.payment_id=s.payment_id AND l.cents=round(s.amount*100) AND l.at=julianday(s.occurred_at)
    WHERE s.kind='REFUND' GROUP BY s.payment_id,round(s.amount*100),julianday(s.occurred_at)
    HAVING COUNT(s.id)<>COALESCE(MAX(l.n),0) OR abs(round(SUM(s.amount)*100)-round(COALESCE(MAX(l.total),0)*100))>0`);
  parts.push(`SELECT 'refund' AS kind,l.payment_id AS sourceId,l.id AS ledgerId,'ORPHAN_REFUND' AS code,0 AS sourceAmount,l.amount AS ledgerAmount
    FROM financial_transactions l WHERE l.kind='REFUND' AND l.status='POSTED' AND (l.direction<>'INCOME' OR NOT EXISTS(
      SELECT 1 FROM payment_adjustments s WHERE s.kind='REFUND' AND s.payment_id=l.payment_id
        AND round(s.amount*100)=round(l.amount*100) AND julianday(s.occurred_at)=julianday(l.occurred_at)))`);
  type Issue={kind:string;sourceId:string|null;ledgerId:string|null;code:string;sourceAmount:number;ledgerAmount:number};
  const issues:Issue[]=[];let issueCount=0;
  // Workerd deliberately limits compound SELECT terms more tightly than desktop SQLite.
  for(let offset=0;offset<parts.length;offset+=4) {
    const query=parts.slice(offset,offset+4).join(' UNION ALL ');
    const count=await db.prepare('SELECT COUNT(*) AS count FROM ('+query+')').first<{count:number}>();
    const rows=await db.prepare('SELECT * FROM ('+query+') ORDER BY kind,sourceId,ledgerId LIMIT 100').all<Issue>();
    issueCount+=count?.count ?? 0;issues.push(...(rows.results ?? []));
  }
  issues.sort((a,b)=>(a.kind+(a.sourceId || '')+(a.ledgerId || '')).localeCompare(b.kind+(b.sourceId || '')+(b.ledgerId || '')));
  return {issueCount,issues:issues.slice(0,100)};
}

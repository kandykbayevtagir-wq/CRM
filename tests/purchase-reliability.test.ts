import {beforeEach,afterEach,it,expect} from 'vitest';
import type {DatabaseSync} from 'node:sqlite';
import {seed,testDatabase,requestContext} from './d1';
import {onRequestPost as receive} from '../functions/api/purchases/[id]/receive';
let db:D1Database;let sqlite:DatabaseSync;
beforeEach(()=>{({db,sqlite}=testDatabase());seed(sqlite);
 sqlite.exec(`INSERT INTO products(id,name,sku,unit,purchase_price,sale_price,min_stock,optimal_stock,is_active) VALUES('p','Material','P','unit',100,0,0,0,1);
 INSERT INTO purchases(id,branch_id,order_date,status,total_amount,created_by) VALUES('purchase','branch','2030-01-01','ORDERED',2000,'owner');
 INSERT INTO purchase_items(id,purchase_id,product_id,ordered_quantity,received_quantity,unit_cost)
 VALUES('one','purchase','p',10,0,100),('two','purchase','p',10,0,100);`);
});
afterEach(()=>sqlite.close());
async function concurrent(sql:string){
 const {context}=await requestContext(db,'/api/purchases/purchase/receive','POST',{items:[{purchaseItemId:'one',quantity:10},{purchaseItemId:'two',quantity:10}],idempotencyKey:'receipt'},'owner',{id:'purchase'});
 context.env.DB={prepare:db.prepare.bind(db),async batch(statements:D1PreparedStatement[]){sqlite.exec(sql);return db.batch(statements);}} as D1Database;
 return await receive(context) as Response;
}
it('cannot receive or resurrect a purchase cancelled immediately before the atomic write',async()=>{
 expect((await concurrent("UPDATE purchases SET status='CANCELLED' WHERE id='purchase'")).status).toBe(409);
 expect(sqlite.prepare('SELECT COUNT(*) AS n FROM stock_movements').get()?.n).toBe(0);
 expect(sqlite.prepare('SELECT status FROM purchases').get()?.status).toBe('CANCELLED');
});
it('rolls back every new line when another receipt consumed one of the requested remainders',async()=>{
 expect((await concurrent("UPDATE purchase_items SET received_quantity=10 WHERE id='two'")).status).toBe(409);
 expect(sqlite.prepare('SELECT COUNT(*) AS n FROM stock_movements').get()?.n).toBe(0);
 expect(sqlite.prepare("SELECT received_quantity AS n FROM purchase_items WHERE id='one'").get()?.n).toBe(0);
 expect(sqlite.prepare('SELECT COUNT(*) AS n FROM audit_logs').get()?.n).toBe(0);
});

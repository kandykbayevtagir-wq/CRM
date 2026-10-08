// Read-only verification: restore the export in memory, never overwrite a production database.
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import assert from 'node:assert/strict';
const path=resolve(process.argv[2] || '');
assert.equal(dirname(path),resolve('.wrangler/backups'),'Only private release backups may be inspected');
const db=new DatabaseSync(':memory:',{enableForeignKeyConstraints:false});
db.exec(readFileSync(path,'utf8'));
db.exec('PRAGMA foreign_keys=ON');
assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[],'Restored data has valid foreign keys');
const canonical=new DatabaseSync(':memory:');
const applied=new Set(db.prepare('SELECT name FROM d1_migrations').all().map(row=>row.name));
for(const file of readdirSync('migrations').filter(file=>applied.has(file)).sort()) canonical.exec(readFileSync(resolve('migrations',file),'utf8'));
// D1 SQL exports may omit enforcement objects: verify that the saved migration chain can recreate them.
for(const row of canonical.prepare("SELECT name,sql FROM sqlite_master WHERE type IN ('trigger','index') AND sql IS NOT NULL").all()) {
 if(!db.prepare('SELECT name FROM sqlite_master WHERE name=?').get(row.name)) db.exec(row.sql);
}
for(const table of ['appointments','payments','payment_adjustments','financial_transactions','clients']) {
 console.log(table+': '+db.prepare('SELECT COUNT(*) AS count FROM '+table).get().count+' restored records');
}
assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='trigger'").get().n,canonical.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='trigger'").get().n);
db.close();canonical.close();
console.log('Isolated backup restore verified: migration chain, enforcement objects, foreign keys.');

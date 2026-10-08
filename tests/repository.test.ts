import {describe,it,expect} from 'vitest';
import {readFileSync,readdirSync} from 'node:fs';
import {APP_VERSION} from '../src/lib/release';
const read=(path:string)=>readFileSync(path,'utf8');
describe('repository hardening invariants',()=>{
 it('keeps package, lockfile and runtime versions consistent and proprietary',()=>{
  const pkg=JSON.parse(read('package.json'));const lock=JSON.parse(read('package-lock.json'));
  expect(pkg.private).toBe(true);expect(pkg.license).toBe('UNLICENSED');
  expect(pkg.version).toBe(APP_VERSION);expect(lock.version).toBe(APP_VERSION);expect(lock.packages[''].version).toBe(APP_VERSION);
 });
 it('pins every workflow Action to an immutable commit with a release comment',()=>{
  for(const file of readdirSync('.github/workflows')) for(const line of read('.github/workflows/'+file).split('\n')) {
    if(/^\s*-?\s*uses:/.test(line)) expect(line).toMatch(/@[a-f0-9]{40}\s+# v\d+\.\d+\.\d+\s*$/);
  }
 });
 it('retains required quality steps and real-runtime/browser checks',()=>{
  const quality=read('.github/workflows/quality.yml');
  for(const command of ['npm ci','npm audit --omit=dev --audit-level=high','npm run db:generate','npm run db:validate','npm run typecheck','npm run lint','npm test','npm run build:pages','npm run qa:api','npm run qa:ui']) expect(quality).toContain(command);
 });
 it('keeps all production Workers private and automation token-free',()=>{
  for(const name of ['notifications','automation','delivery']) {
    const config=JSON.parse(read('wrangler.'+name+'.jsonc'));expect(config.workers_dev).toBe(false);expect(config.preview_urls).toBe(false);
    expect(config.routes ?? []).toHaveLength(0);
  }
  expect(read('wrangler.automation.jsonc')).not.toContain('TELEGRAM_BOT_TOKEN');
  expect(read('workers/automation.ts')).not.toContain('TELEGRAM_BOT_TOKEN');
 });
 it('keeps main review/check enforcement without permanent bypass',()=>{
  const rules=JSON.parse(read('.github/rulesets/main.json'));
  expect(rules.enforcement).toBe('active');expect(rules.bypass_actors).toEqual([]);
  expect(rules.conditions.ref_name.include).toEqual(['refs/heads/main']);
  expect(rules.rules.map((r:{type:string})=>r.type)).toEqual(expect.arrayContaining(['deletion','non_fast_forward','pull_request','required_status_checks']));
  expect(rules.rules.find((r:{type:string})=>r.type==='pull_request').parameters.required_approving_review_count).toBe(1);
 });
 it('documents schedule and public-access limitations without permissive licensing',()=>{
  expect(read('LICENSE')).toContain('All Rights Reserved.');expect(read('README.md')).toContain('## License');
  expect(read('README.md')).toContain('PRIVATE');expect(read('README.md')).toContain('not guaranteed to execute at an exact minute');
  expect(read('.github/workflows/production-monitor.yml')).toContain('2-57/5 * * * *');
 });
});

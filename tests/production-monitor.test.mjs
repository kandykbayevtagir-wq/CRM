import {describe,it,expect,vi} from 'vitest';
import {checkProduction,monitoringOrigin,probe} from '../scripts/check-production.mjs';
/* global Response */
describe('read-only production monitor',()=>{
  const healthy={ok:true,database:'ok',background:'ok',automation:'ok',delivery:'ok',version:'0.9.1'};
  const options=fetchImpl=>({fetchImpl,wait:vi.fn(async()=>{}),report:vi.fn(),timeoutMs:100});
  it('checks health and readiness with GET, no auth and no redirects',async()=>{
    const fetch=vi.fn(async()=>Response.json(healthy));
    expect((await checkProduction('https://crm.test',options(fetch))).ok).toBe(true);
    expect(fetch.mock.calls.map(([url])=>url)).toEqual(['https://crm.test/api/health','https://crm.test/api/readiness']);
    expect(fetch.mock.calls[0][1]).toMatchObject({method:'GET',redirect:'manual',cache:'no-store',headers:{accept:'application/json'}});
  });
  it('retries a transient error and then succeeds',async()=>{
    const fetch=vi.fn().mockRejectedValueOnce(new Error('secret')).mockResolvedValue(Response.json(healthy));
    const o=options(fetch);expect((await probe('https://crm.test','/api/health',o)).ok).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(2);expect(o.wait).toHaveBeenCalledWith(1000);
  });
  it('fails persistent errors but still checks both endpoints',async()=>{
    const fetch=vi.fn(async()=>Response.json({ok:false},{status:503}));const o=options(fetch);
    expect((await checkProduction('https://crm.test',o)).ok).toBe(false);expect(fetch).toHaveBeenCalledTimes(6);
  });
  it('never logs arbitrary JSON or raw exception secrets',async()=>{
    const o=options(vi.fn(async()=>Response.json({ok:false,token:'DO_NOT_PRINT',error:'DO_NOT_PRINT',version:'DO_NOT_PRINT',database:'error'},{status:503})));
    await probe('https://crm.test','/api/health',o);
    expect(JSON.stringify(o.report.mock.calls)).not.toContain('DO_NOT_PRINT');
    expect(JSON.stringify(o.report.mock.calls)).toContain('database');
  });
  it('rejects HTTP 200 with an unhealthy payload',async()=>{
    expect((await probe('https://crm.test','/api/readiness',options(async()=>Response.json({ok:false})))).ok).toBe(false);
  });
  it('does not accept staging-disabled workers as healthy production readiness',async()=>{
    expect((await probe('https://crm.test','/api/readiness',options(async()=>Response.json({...healthy,background:'disabled',automation:'disabled'})))).ok).toBe(false);
  });
  it('rejects malformed JSON',async()=>{
    expect((await probe('https://crm.test','/api/health',options(async()=>new Response('not-json')))).code).toBe('INVALID_JSON');
  });
  it('times out a hung fetch without hanging the workflow',async()=>{
    const o={...options(()=>new Promise(()=>{})),timeoutMs:5,attempts:1};
    expect((await probe('https://crm.test','/api/health',o)).code).toBe('TIMEOUT');
  });
  it('times out a hung response body as well',async()=>{
    const o={...options(async()=>({ok:true,json:()=>new Promise(()=>{})})),timeoutMs:5,attempts:1};
    expect((await probe('https://crm.test','/api/health',o)).code).toBe('TIMEOUT');
  });
  it.each(['https://user:password@crm.test','http://crm.test','https://crm.test?token=secret','https://crm.test/api'])('rejects unsafe origin %s',url=>{
    expect(()=>monitoringOrigin(url)).toThrow();
  });
});

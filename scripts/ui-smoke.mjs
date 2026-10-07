import { createRequire } from "node:module";
import { mkdir } from "node:fs/promises";
import assert from "node:assert/strict";
import { URL } from "node:url";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const browser = await chromium.launch({ headless: true, channel: "chrome" });
await mkdir(".wrangler/qa", {recursive:true});
const user = {id:"owner",telegramId:"100",name:"Владелец центра",role:"OWNER",clientId:null,notificationsAllowed:1};
const items = ["SCHEDULED","IN_PROGRESS","COMPLETED"].map((status,index)=>({
  id:"visit-"+index,revision:0,clientId:"client-"+index,clientName:["Айгерим Садыкова","Анна Иванова","Мария Петрова"][index],
  clientPhone:"77001234567",startsAt:"2030-01-07T0"+(4+index)+":00:00Z",endsAt:"2030-01-07T0"+(5+index)+":00:00Z",
  status,amount:18000,paidAmount:status==="COMPLETED"?18000:0,serviceName:"Подологическая обработка",employeeName:"Диана",branchName:"Центр",
}));
try {
  for(const viewport of [{width:1440,height:1000},{width:390,height:844}]) {
    const context=await browser.newContext({viewport});
    const page=await context.newPage();
    const errors=[];
    page.on("pageerror",error=>errors.push(error.message));
    await page.route("https://telegram.org/**",route=>route.fulfill({status:200,contentType:"application/javascript",body:""}));
    await page.route("**/api/**",async route=>{
      const path=new URL(route.request().url()).pathname;
      const body=path==="/api/auth/me"?{ok:true,user}:path==="/api/settings"?{ok:true,settings:{brandName:"podologymk",timezone:"Asia/Almaty"},branches:[{id:"branch",name:"Центр",isActive:1}]}:path==="/api/notifications"?{ok:true,unreadCount:0,items:[]}:path==="/api/operations"?{ok:true,date:"2030-01-07",timezone:"Asia/Almaty",items,queue:[{status:"PENDING",count:2}],failures:[],worker:{status:"OK",completedAt:"2030-01-07"},workerStale:false,overdueBalances:{count:1}}:{ok:true,items:[]};
      await route.fulfill({status:200,contentType:"application/json",body:JSON.stringify(body)});
    });
    await page.goto(process.env.CRM_PREVIEW_URL || "http://localhost:8788/today");
    await page.getByText("Айгерим Садыкова",{exact:true}).waitFor();
    await page.screenshot({path:".wrangler/qa/today-"+viewport.width+".png",fullPage:true});
    // eslint-disable-next-line no-undef
    const overflowing=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1);
    assert.equal(overflowing,false,"Layout overflows at "+viewport.width);
    await page.getByRole("button",{name:"Принять оплату",exact:true}).first().click();
    await page.getByRole("dialog").waitFor();
    await page.getByRole("spinbutton").fill("9000");
    await page.getByRole("button",{name:"Провести оплату",exact:true}).click();
    await page.getByText("Оплата проведена",{exact:true}).waitFor();
    assert.deepEqual(errors,[]);
    await context.close();
    console.log("UI verified: "+viewport.width+"px; payment dialog; no runtime errors or overflow");
  }
} finally { await browser.close(); }

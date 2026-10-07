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
      const body=path==="/api/auth/me"?{ok:true,user}:path==="/api/settings"?{ok:true,settings:{brandName:"podologymk",timezone:"Asia/Almaty"},branches:[{id:"branch",name:"Центр",isActive:1}]}:path==="/api/notifications"?{ok:true,unreadCount:0,items:[]}:path==="/api/operations"?{ok:true,date:"2030-01-07",timezone:"Asia/Almaty",items,queue:[{status:"PENDING",count:2}],failures:[],waitlist:[{id:"waiting-client",clientName:"Айдана Жумабаева",phone:"77001234567",serviceName:"Подология",branchName:"Центр",preferredDate:"2030-01-07"}],worker:{status:"OK",completedAt:"2030-01-07"},workerStale:false,overdueBalances:{count:1}}:{ok:true,items:[]};
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
    await page.getByRole("button",{name:"Закрыть заявку",exact:true}).click();
    await page.getByText("Заявка закрыта",{exact:true}).waitFor();
    assert.deepEqual(errors,[]);
    await context.close();
    console.log("UI verified: "+viewport.width+"px; payment dialog; no runtime errors or overflow");
  }
  for(const viewport of [{width:1440,height:1000},{width:390,height:844}]) {
    const context=await browser.newContext({viewport});
    const page=await context.newPage();
    const errors=[]; const writes=[];
    page.on("pageerror",error=>errors.push(error.message));
    const client={...user,id:"client-user",role:"CLIENT",clientId:"client",name:"Айгерим Садыкова",phone:"77001234567"};
    const profile={id:"client",fullName:client.name,phone:client.phone,email:"client@example.test"};
    const branch={id:"branch",name:"Центр",address:"Улица, 1",phone:"+7 700 111 22 33",isActive:1};
    const service={id:"service",name:"Подологическая обработка",category:"Подология",price:18000,durationMinutes:60,isActive:1};
    const slot={startsAt:"2030-01-07T04:00:00Z",endsAt:"2030-01-07T05:00:00Z",employeeId:"employee",employeeName:"Диана",branchId:"branch",branchName:"Центр",serviceId:"service",price:18000};
    await page.route("https://telegram.org/**",route=>route.fulfill({status:200,contentType:"application/javascript",body:""}));
    await page.route("**/api/**",async route=>{
      const request=route.request(); const path=new URL(request.url()).pathname;
      if(request.method()==="POST") writes.push({path,body:request.postDataJSON()});
      const body=path==="/api/auth/me"?{ok:true,user:client}:
        path==="/api/client/profile"?{ok:true,user:client,profile,consents:[]}:
        path==="/api/client/catalog"?{ok:true,user:client,profile,branches:[branch],services:[service]}:
        path==="/api/client/availability"?{ok:true,items:[slot],next:null}:
        path==="/api/client/appointments"? request.method()==="POST"?{ok:true,id:"visit",changed:false}:{ok:true,items:[{id:"visit",...slot,amount:18000,status:"SCHEDULED",serviceName:service.name,canCancel:true,checkInToken:"CODE"}]}:
        path==="/api/client/loyalty"?{ok:true,account:{pointsBalance:10,lifetimePoints:10},transactions:[]}:{ok:true,items:[]};
      await route.fulfill({status:200,contentType:"application/json",body:JSON.stringify(body)});
    });
    const base=process.env.CRM_PREVIEW_ORIGIN || "http://localhost:8788";
    await page.goto(base+"/client/profile");
    await page.getByRole("button",{name:"Изменить",exact:true}).click();
    await page.locator('input[type="tel"]').fill("87007654321");
    await page.getByRole("button",{name:"Сохранить",exact:true}).click();
    await page.getByText("Профиль сохранён",{exact:true}).waitFor();
    assert.equal(writes.find(item=>item.path==="/api/client/profile").body.phone.replace(/\D/g,""),"77007654321");
    await page.getByRole("button",{name:"Связаться с центром"}).click();
    await page.getByRole("dialog").waitFor();
    assert.equal(await page.getByRole("link",{name:"+7 700 111 22 33",exact:true}).getAttribute("href"),"tel:+77001112233");
    await page.keyboard.press("Escape");
    await page.goto(base+"/client/book");
    await page.getByRole("button",{name:/Подологическая обработка/}).click();
    await page.getByRole("button",{name:/Центр/}).click();
    await page.locator(".slot-button").first().click();
    await page.screenshot({path:".wrangler/qa/client-book-"+viewport.width+".png",fullPage:true});
    // eslint-disable-next-line no-undef
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
    await page.getByRole("button",{name:"Подтвердить запись",exact:true}).click();
    await page.getByRole("heading",{name:"Запись подтверждена",exact:true}).waitFor();
    assert.ok(writes.find(item=>item.path==="/api/client/appointments").body.idempotencyKey);
    await page.goto(base+"/client/appointments");
    assert.equal(await page.getByRole("link",{name:"В календарь",exact:true}).getAttribute("href"),"/api/client/calendar?appointmentId=visit");
    assert.deepEqual(errors,[]);
    await context.close();
    console.log("Client UI verified: "+viewport.width+"px; phone, profile, contacts, booking, calendar; no runtime errors or overflow");
  }
} finally { await browser.close(); }

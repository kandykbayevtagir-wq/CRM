import { describe, expect, it } from "vitest";
import { csvValue } from "../src/lib/format-csv";
import { localDayRange, validShift } from "../src/lib/appointments/schedule";
import { calculateAvailableWorkingMinutes } from "../functions/_lib/working-time";
import { visitCalendar } from "../src/lib/calendar";
import { validateRequestOrigin } from "../functions/_lib/security";
import { readJson } from "../functions/_lib/http";
import { validateTelegramInitData } from "../functions/_lib/telegram";

describe("boundary validation", () => {
  it("rejects cross-site writes but accepts Telegram same-origin requests", () => {
    expect(() => validateRequestOrigin(new Request("https://crm.test/api/payments",{method:"POST",headers:{origin:"https://evil.test"}}))).toThrow();
    expect(() => validateRequestOrigin(new Request("https://crm.test/api/payments",{method:"POST",headers:{origin:"https://crm.test"}}))).not.toThrow();
  });
  it("rejects invalid JSON, array bodies, wrong content type and oversized streams", async () => {
    for(const body of ["null","[]","{"]) await expect(readJson(new Request("https://crm.test",{method:"POST",headers:{"content-type":"application/json"},body}))).rejects.toThrow();
    await expect(readJson(new Request("https://crm.test",{method:"POST",body:"{}"}))).rejects.toThrow();
    await expect(readJson(new Request("https://crm.test",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({value:"x".repeat(131073)})}))).rejects.toThrow();
  });
  it("does not export spreadsheet formulas as executable cells", () => {
    for(const value of ["=SUM(A1:A3)","\t+123","\u0000@command"," -1+2"]) expect(csvValue(value)).toMatch(/^'/);
    expect(csvValue(-10)).toBe("-10");
    expect(csvValue('a,"b"')).toBe('"a,""b"""');
  });
  it("verifies Telegram HMAC and rejects tampering, stale dates and duplicate keys", async () => {
    const token="test-token";
    const authDate=String(Math.floor(Date.now()/1000));
    const params=new URLSearchParams({auth_date:authDate,user:JSON.stringify({id:200,first_name:"Клиент"})});
    const hmac=async(key:BufferSource|string,value:string) => {
      const input=typeof key==="string"?new TextEncoder().encode(key):key;
      const cryptoKey=await crypto.subtle.importKey("raw",input,{name:"HMAC",hash:"SHA-256"},false,["sign"]);
      return await crypto.subtle.sign("HMAC",cryptoKey,new TextEncoder().encode(value));
    };
    const secret=await hmac("WebAppData",token);
    const signature=await hmac(secret,[...params].sort(([a],[b])=>a.localeCompare(b)).map(([key,value])=>key+"="+value).join("\n"));
    params.set("hash",Buffer.from(signature).toString("hex"));
    expect((await validateTelegramInitData(params.toString(),token))?.user?.id).toBe(200);
    expect(await validateTelegramInitData(params.toString()+"&user=x",token)).toBeNull();
    params.set("user",'{"id":300}'); expect(await validateTelegramInitData(params.toString(),token)).toBeNull();
    params.set("auth_date","1"); expect(await validateTelegramInitData(params.toString(),token)).toBeNull();
  });
});
describe("time and calendar", () => {
  it("uses the centre's local day and DST-aware day boundaries", () => {
    expect(localDayRange("2030-01-07","Asia/Almaty")).toEqual({from:"2030-01-06T19:00:00.000Z",to:"2030-01-07T19:00:00.000Z"});
    const range=localDayRange("2026-03-29","Europe/Berlin");
    expect((Date.parse(range.to)-Date.parse(range.from))/3600000).toBe(23);
  });
  it("does not double-subtract overlapping absences and lunch breaks", () => {
    const shift={employeeId:"e",dayOfWeek:1,startsTime:"09:00",endsTime:"18:00",breakStartTime:"12:00",breakEndTime:"13:00"};
    const absence={employeeId:"e",startsAt:"2030-01-07T06:00:00Z",endsAt:"2030-01-07T09:00:00Z"};
    const minutes=calculateAvailableWorkingMinutes([shift],[absence,absence],new Date("2030-01-06T19:00:00Z"),new Date("2030-01-07T19:00:00Z"),"Asia/Almaty");
    expect(minutes).toBe(360);
    expect(calculateAvailableWorkingMinutes([shift],[],new Date("2030-01-06T19:00:00Z"),new Date("2030-01-07T19:00:00Z"),"Asia/Almaty",{startTime:"10:00",endTime:"17:00",workingDays:"1"})).toBe(360);
    expect(calculateAvailableWorkingMinutes([shift],[],new Date("2030-01-06T19:00:00Z"),new Date("2030-01-07T19:00:00Z"),"Asia/Almaty",{workingDays:"2"})).toBe(0);
    expect(validShift("09:00","18:00","08:00","10:00")).toBe(false);
  });
  it("escapes and folds calendar text without injecting extra events", () => {
    const calendar=visitCalendar({id:"visit",startsAt:"2030-01-07T04:00:00Z",endsAt:"2030-01-07T05:00:00Z",serviceName:"Длинная услуга ".repeat(20),branchName:"Центр",address:"Улица; 1\nBEGIN:VEVENT"});
    expect(calendar.split("\r\n").filter(line=>line==="BEGIN:VEVENT")).toHaveLength(1);
    for(const line of calendar.split("\r\n")) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
  });
});

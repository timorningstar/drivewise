import{test}from'node:test'
import assert from'node:assert/strict'
import{createRequire}from'node:module'
import{diagnosticBookingClosed as closed}from'./diagnostic-cutoff.js'
import{diagnosticAvailability as available}from'./diagnostic-availability.js'
const server=createRequire(import.meta.url)('../testing/functions/diagnostic-cutoff.js').diagnosticBookingClosed
test('Friday cutoff is exact in Indiana, including DST, other weekdays and year boundary; client/server agree',()=>{
 for(const [date,time,result]of[
 ['2026-11-30','2026-11-27T20:59:59Z',false],['2026-11-30','2026-11-27T21:00:00Z',true],
 ['2026-11-30','2026-11-30T15:00:00Z',true],['2026-12-07','2026-11-27T21:00:00Z',false],
 ['2026-07-06','2026-07-03T19:59:59Z',false],['2026-07-06','2026-07-03T20:00:00Z',true],
 ['2027-01-04','2027-01-01T21:00:00Z',true],['2026-12-02','2026-11-27T21:00:00Z',true],
 ['2026-12-04','2026-11-27T21:00:00Z',true]]){
 assert.equal(closed(date,new Date(time)),result);assert.equal(server(date,new Date(time)),result);
 }
})
test('new appointment defaults past closed week at cutoff even when all its slots are free',()=>{
 const settings={diagnosticDay:1,diagnosticTimes:['15:30','15:50']};
 assert.equal(available([],settings,'new',new Date('2026-11-27T20:59:59Z'))[0].date,'2026-11-30');
 assert.equal(available([],settings,'new',new Date('2026-11-27T21:00:00Z'))[0].date,'2026-12-07');
})

import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
import {sendQuery} from '../lib/tracked-send.js';
test('approved owner removal sends only ep position 4 with stable deduplication and system sender',async()=>{
 const html=readFileSync(new URL('../selax-owner-remove.html',import.meta.url),'utf8');
 const calls=[];
 const d=new JSDOM(html,{url:'https://fixture.invalid',runScripts:'dangerously',beforeParse(w){w.fetch=async(url,opt)=>{calls.push({url,...JSON.parse(opt.body)});return {ok:true,json:async()=>({ok:true,results:[{sms_id:'fixture'}]})};};}});
 assert.equal(calls.length,0);
 const b=d.window.document.querySelector('#query');b.click();b.click();await new Promise(r=>setTimeout(r,10));
 assert.equal(calls.length,1);assert.equal(calls[0].url,'/api/send-sms');assert.deepEqual(calls[0].to,['+420602783619']);assert.equal(calls[0].text,'**pin0000*01*ep*4*');
 assert.equal(calls[0].historyId,'selax-remove-owner4-20260919-01');assert.equal(calls[0].action,undefined);
 const q=sendQuery({login:'fixture',password:'fixture',number:calls[0].to[0],message:calls[0].text,id:calls[0].historyId});
 assert.equal(q.get('sender_id'),'0');assert.equal(q.get('message'),'**pin0000*01*ep*4*');assert.match(d.window.document.querySelector('#result').textContent,/fixture/);d.window.close();
});

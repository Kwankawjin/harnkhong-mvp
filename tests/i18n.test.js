import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {messages, translate, formatSatang, bahtInput} from '../src/i18n.js';
import {parseBaht} from '../src/domain.js';
import {ORDER_TRANSITIONS,DISPUTE_REASONS} from '../src/orders.js';

test('ข้อความสองภาษาครบและตัวแปรในข้อความตรงกัน', () => {
  assert.deepEqual(Object.keys(messages.th).sort(), Object.keys(messages.en).sort());
  for(const key of Object.keys(messages.th)) {
    assert.ok(messages.th[key].trim() && messages.en[key].trim(), key);
    const placeholders=text=>[...text.matchAll(/\{(\w+)\}/g)].map(match=>match[1]).sort();
    assert.deepEqual(placeholders(messages.th[key]), placeholders(messages.en[key]), key);
  }
  const source=readFileSync(new URL('../src/app.js',import.meta.url),'utf8');
  for(const match of source.matchAll(/\bt\((?:'([^']*)'|"([^"]*)")\s*(?=[,)])/g)) {
    const key=match[1]??match[2];
    assert.ok(Object.hasOwn(messages.en,key),key);
  }
  for(const file of ['domain','orders','prototype']) {
    const domain=readFileSync(new URL(`../src/${file}.js`,import.meta.url),'utf8');
    for(const match of domain.matchAll(/fail\('([^']+)'/g)) assert.ok(Object.hasOwn(messages.en,match[1]),match[1]);
  }
  for(const status of Object.keys(ORDER_TRANSITIONS)) assert.ok(messages.th['orderStatus_'+status]&&messages.en['orderStatus_'+status],status);
  for(const reason of DISPUTE_REASONS) assert.ok(messages.th['disputeReason_'+reason]&&messages.en['disputeReason_'+reason],reason);
  for(const status of ['unpaid','payment_reported','verification_pending','verified']) assert.ok(messages.th['paymentStatus_'+status]&&messages.en['paymentStatus_'+status],status);
  const orders=readFileSync(new URL('../src/orders.js',import.meta.url),'utf8');
  for(const match of orders.matchAll(/event\([^\n]*?,'([a-z_]+)'/g)) assert.ok(messages.en['orderEvent_'+match[1]],match[1]);
});

test('แทรกชื่อที่ผู้ใช้กรอกโดยไม่แปลหรือแทนที่ซ้ำ', () => {
  assert.equal(translate('en','เข้าสู่ระบบสำเร็จ! ยินดีต้อนรับ {name}',{name:'<b>ส่ง {name}</b>'}), 'Logged in! Welcome, <b>ส่ง {name}</b>');
  assert.equal(translate('unknown','ส่ง'), 'ส่ง');
  assert.equal(translate('en','ข้อความที่ไม่ได้กำหนด'), 'ข้อความที่ไม่ได้กำหนด');
  assert.match(translate('en','invalidSatang'), /whole satang/);
});

test('แสดงบาทและสตางค์ตรงจำนวนเต็มทุกขอบเขตทั้ง TH และ EN', () => {
  for(const amount of [0,1,29,99,100,101,13334,Number.MAX_SAFE_INTEGER-1,Number.MAX_SAFE_INTEGER]) {
    for(const locale of ['th','en']) {
      const formatted=formatSatang(amount,locale);
      const digits=formatted.replace(/[^0-9.]/g,'');
      assert.equal(digits,bahtInput(amount));
      assert.equal(parseBaht(digits),amount);
      assert.match(formatted, /฿|THB/);
    }
  }
  assert.match(formatSatang(Number.MAX_SAFE_INTEGER,'en'),/90,071,992,547,409\.91/);
  for(const amount of [-1,0.5,NaN,Infinity,Number.MAX_SAFE_INTEGER+1]) {
    assert.throws(()=>formatSatang(amount), {code:'invalidSatang'});
    assert.throws(()=>bahtInput(amount), {code:'invalidSatang'});
  }
});

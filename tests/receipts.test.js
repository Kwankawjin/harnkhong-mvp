import test from "node:test";
import assert from "node:assert/strict";
import { receiptState, receiptDone, autoReceiptAt, autoReceiptDaysLeft, AUTO_RECEIPT_DAYS } from "../src/domain.js";

const shippedAt = "2026-11-01T10:00:00.000Z";
const at = (days) => new Date(new Date(shippedAt).getTime() + days * 86_400_000);

test("ยังไม่ส่งของ นาฬิกายังไม่เริ่ม เงินยังไม่ปล่อย", () => {
  assert.equal(receiptState({ now: at(30) }), "waiting_shipment");
  assert.equal(receiptDone("waiting_shipment"), false);
});

test("ส่งของแล้ว ภายใน 7 วันยังรอผู้ซื้อ ครบ 7 วันยืนยันอัตโนมัติ", () => {
  assert.equal(AUTO_RECEIPT_DAYS, 7);
  assert.equal(receiptState({ shippedAt, now: at(6.99) }), "shipped");
  assert.equal(receiptState({ shippedAt, now: at(7) }), "auto_received");
  assert.equal(receiptDone("auto_received"), true);
  assert.equal(autoReceiptAt(shippedAt), "2026-11-08T10:00:00.000Z");
  assert.equal(autoReceiptDaysLeft(shippedAt, at(0)), 7);
  assert.equal(autoReceiptDaysLeft(shippedAt, at(6.5)), 1);
  assert.equal(autoReceiptDaysLeft(shippedAt, at(9)), 0);
});

test("แจ้งปัญหาแล้ว เงินถูกพักไว้ ไม่ยืนยันอัตโนมัติแม้เกิน 7 วัน", () => {
  assert.equal(receiptState({ shippedAt, dispute: { status: "open" }, now: at(30) }), "disputed");
  assert.equal(receiptState({ dispute: { status: "open" } }), "disputed");
  assert.equal(receiptDone("disputed"), false);
});

test("แอดมินตัดสิน: ปล่อยเงินให้ผู้ขาย หรือคืนเงินผู้ซื้อ และผู้ซื้อกดได้รับของชนะทุกกรณี", () => {
  assert.equal(receiptState({ shippedAt, dispute: { status: "released" }, now: at(1) }), "received");
  assert.equal(receiptState({ shippedAt, dispute: { status: "refunded" }, now: at(30) }), "refunded");
  assert.equal(receiptDone("refunded"), false);
  assert.equal(receiptState({ received: true, dispute: { status: "open" } }), "received");
});

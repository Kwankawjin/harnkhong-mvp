# Request Marketplace — Phase 1 (Database & Audit)

Flow: **Request → Offer → Accept → Reservation → Join (ระบบกลุ่มเดิม)**

Migration: `supabase/migrations/20261121130000_request_marketplace.sql`
Tests: `supabase/tests/request_marketplace.sql` (`supabase/tests/local/run.sh supabase/tests/request_marketplace.sql`)

## ผล audit ระบบเดิม (จาก migrations ใน repo)

| เรื่อง | ของจริงในระบบ |
| --- | --- |
| เจ้าของกลุ่ม | `groups.owner_id` (→ `auth.users`) |
| ที่นั่ง | `groups.capacity` (2–20) เทียบกับจำนวนแถวใน `group_members`, 1 บัญชี = 1 ที่นั่ง |
| ราคาต่อที่นั่ง | `pricing_mode = 'seat_v3'` คำนวณด้วย `private.seat_amounts` (กลุ่มใหม่ทุกกลุ่มเป็นแบบนี้) |
| รอบบิล | `groups.billing_mode` = `one_time` / `monthly` (ไม่มี yearly) |
| กลุ่มเปิดรับ | `status <> 'cancelled'`, `closed_at is null`, `details.closesAt` ยังไม่ผ่าน |
| การเข้าร่วม | `private.join_group` ล็อกแถว group (`for update`), กลุ่มแบบ link ต้องมี invite token |
| การจ่ายเงิน | `group_payment_reports` / `group_cycle_members` + แอดมินตรวจสลิป (ไม่แตะ) |
| `products.id` | เป็น `text` ไม่ใช่ uuid และแต่ละกลุ่มสร้าง product ของตัวเอง |
| แอดมิน | `private.is_admin()` จาก `app_metadata.role` |

ยังไม่ได้เทียบกับ schema ของ Supabase ตัวจริง (migration drift) ต้องเช็คก่อน apply

## ตารางใหม่

`hk_requests`, `hk_request_offers`, `hk_group_reservations`, `hk_request_events` (append-only), `hk_request_notifications`

- ฝั่ง client **อ่านได้อย่างเดียว** (RLS) การเขียนทุกอย่างทำผ่าน RPC ด้านล่าง
- Guest เห็นเฉพาะ request ที่ `open` และยังไม่หมดอายุ / ข้อเสนอเห็นเฉพาะ host กับเจ้าของ request / แจ้งเตือนเห็นเฉพาะเจ้าของ / แอดมินเห็นทั้งหมด
- `hk_request_notifications` ถูกเพิ่มเข้า `supabase_realtime`

## RPC (สำหรับ Phase 2–4)

| RPC | ใคร | ทำอะไร |
| --- | --- | --- |
| `hk_create_request(title, category, budget_max_satang, billing_cycle, description, budget_min_satang, product_id, expires_in_days)` | Requester | สร้างประกาศ (1–30 วัน, เปิดค้างได้ไม่เกิน 10 อัน) |
| `hk_update_request(id, title, description, budget_max, budget_min)` | Requester | แก้ได้เฉพาะตอน open และยังไม่มีข้อเสนอค้าง |
| `hk_cancel_request(id)` | Requester | ยกเลิก + ยกเลิกข้อเสนอและที่นั่งที่จองไว้ |
| `hk_my_offerable_groups(request_id)` | Host | กลุ่มของฉัน + ที่ว่าง + ราคา + เหตุผลถ้าเสนอไม่ได้ |
| `hk_submit_offer(request_id, group_id, message)` | Host | ส่งข้อเสนอ ราคาคิดจากกลุ่มเอง เก็บใน `group_snapshot` |
| `hk_withdraw_offer(offer_id)` | Host | ถอน (ถ้าถูกยอมรับแล้ว จะคืนที่นั่งและเปิด request ใหม่) |
| `hk_reject_offer(offer_id)` | Requester | ปฏิเสธ |
| `hk_accept_offer(offer_id)` | Requester | ล็อก → ตรวจที่นั่ง → จอง 24 ชม. → offer `accepted`, request `matched`, ข้อเสนออื่นถูก `rejected` |
| `hk_join_reserved_group(reservation_id, request_key)` | Requester | เข้ากลุ่มผ่าน `private.join_group` เดิม → reservation `confirmed`, offer/request `completed` |
| `hk_mark_notifications_read(ids)` | ทุกคน | อ่านแจ้งเตือน |
| `hk_sync()` | ทุกคน | ทำให้รายการที่หมดเวลาเปลี่ยนเป็นหมดอายุ (เรียกก่อนโหลดหน้า) |

## สิ่งที่ต่างจากสเปก (ตั้งใจ)

1. **เงินเป็น satang (`bigint`)** เหมือนทั้งระบบ ไม่ใช้ `numeric`
2. **ราคาข้อเสนอ Host กรอกเองไม่ได้** ระบบใช้ราคาที่นั่งถัดไปของกลุ่ม เพราะขั้นตอนจ่ายเงินเดิมเก็บเงินตามราคาที่นั่งของกลุ่ม ถ้าให้เสนอราคาอื่น สมาชิกจะต้องจ่ายไม่ตรงกับที่ตกลงไว้ ตอนกดยอมรับ ถ้าราคากลุ่มสูงขึ้นกว่าที่เสนอ ระบบจะปฏิเสธ (`offer_price_changed`)
3. **`seats_needed` = 1** เพราะ 1 บัญชีนั่งได้ 1 ที่ใน `group_members` (คอลัมน์มีไว้แล้ว ค่อยขยายทีหลัง)
4. **รอบบิล = `monthly` / `one_time`** เพราะกลุ่มยังไม่รองรับ yearly
5. **จับคู่บริการด้วยหมวดหมู่** (+ `product_id` ถ้ามี) และรอบบิลต้องตรงกัน เพราะแต่ละกลุ่มสร้าง product แยก
6. **เสนอได้เฉพาะกลุ่ม `seat_v3`** (กลุ่มเก่า `per_member_v2` ราคาขยับตามจำนวนคน)
7. **Completed = เข้ากลุ่มสำเร็จ** การจ่ายเงินหลังจากนั้นใช้ flow เดิมของกลุ่ม (แอดมินตรวจสลิป) ระบบนี้ไม่เปลี่ยนสถานะการจ่ายเงินใดๆ
8. **หมดอายุแบบ lazy** (ไม่มี scheduler ในโปรเจกต์) ทุก RPC และ `hk_sync()` จะเคลียร์รายการที่หมดเวลาก่อนทำงาน เวลา: ข้อเสนอ 72 ชม., จองที่นั่ง 24 ชม.

## จุดที่แตะระบบเดิม (2 trigger, เพิ่มอย่างเดียว)

- `group_members` before insert: ห้ามคนอื่นเข้ากลุ่มไปนั่งที่ที่ถูกจองไว้ (`full_group`)
- `groups` before delete / ยกเลิก / ปิดกลุ่ม: ยกเลิกข้อเสนอและที่นั่งที่จองไว้ แล้วแจ้ง requester

## ทดสอบแล้ว

- `request_marketplace.sql`: สิทธิ์ (insert/update ตรงถูกปฏิเสธ, คนนอกไม่เห็นข้อเสนอ, guest ไม่เห็นข้อเสนอ), เสนอให้ประกาศตัวเองไม่ได้, ใช้กลุ่มคนอื่นไม่ได้, เกินงบไม่ได้, เสนอซ้ำไม่ได้, ยอมรับได้ข้อเดียว, ที่นั่งที่จองไว้กันคนอื่น join, join ผ่าน flow เดิมและจ่ายตามราคาที่เสนอ, กลุ่ม link-only, ถอนหลังยอมรับ, จองหมดเวลาแล้วคืนที่นั่ง, ลบกลุ่ม, request หมดอายุ, ยกเลิก request, แจ้งเตือน
- กดยอมรับพร้อมกัน 2 session ที่นั่งเหลือ 1: สำเร็จ 1, อีกอันได้ `full_group`
- `billing.sql` ของเดิมยังผ่าน

## ยังไม่ได้ทำ / ข้อควรรู้

- ยังไม่มี UI (Phase 2–4)
- ลำดับล็อกตอนลบกลุ่ม (group → request) สวนกับตอนยอมรับ (request → group) ถ้าเกิดพร้อมกันพอดี Postgres จะยกเลิกอันหนึ่ง (deadlock detected) ให้ลองใหม่ได้ ไม่ทำให้ข้อมูลเสีย
- แจ้งเตือน "ใกล้หมดอายุ" ต้องใช้ scheduler ยังไม่ได้ทำ

---

# Phase 2 — Requester Experience

| หน้า | ทำอะไร |
| --- | --- |
| `/explore` | เพิ่มแท็บ Marketplace: **กลุ่มที่เปิดหาร** / **กำลังหากลุ่ม** |
| `/requests` | รวมประกาศที่เปิดอยู่ ค้นหา กรองหมวดหมู่ ปุ่ม “โพสต์หาของหาร” |
| `/requests/new` | Wizard 3 ขั้น: เลือกบริการ+ชื่อ+รายละเอียด → รอบบิล/งบ/ระยะเวลา (3/7/14 วัน) → Preview → Publish Request |
| `/requests/:id` | รายละเอียด, สถานะ, งบ, เวลาที่เหลือ เจ้าของเห็นข้อเสนอที่ได้รับ + ปุ่มแก้ไข/ยกเลิก คนอื่นเห็นปุ่ม “Make an Offer · เร็ว ๆ นี้” (Phase 3) |
| `/requests/:id/edit` | แก้ชื่อ รายละเอียด งบ (ได้เฉพาะตอนเปิดและยังไม่มีข้อเสนอ) |
| `/my-requests` | แท็บ ทั้งหมด / รอข้อเสนอ / มีข้อเสนอ / เสร็จสิ้น |

ทางเข้า: เมนู “สร้างกลุ่มหารของ” → “โพสต์หาของหาร”, เมนูมือถือ, ทางลัดในหน้าบัญชี “ประกาศหากลุ่ม”

## โค้ด

- `src/requests.js` — กติกาฝั่ง requester (ตรวจ input, สร้าง/แก้/ยกเลิก, หมดอายุ, สถานะ “มีข้อเสนอ” ที่คำนวณเอา) ตรงกับ RPC ใน migration
- `src/supabase-requests.js` — อ่านตาราง `hk_*` และเรียก `hk_create_request` / `hk_update_request` / `hk_cancel_request` / `hk_sync`
- `src/request-marketplace.js` + `src/requests.css` — หน้าจอทั้งหมด (app.js แค่ต่อ route, ปุ่ม, event)
- Test mode (`VITE_TEST_MODE=1`): ข้อมูลอยู่ใน `localStorage` และมีประกาศตัวอย่าง 3 อันจากผู้ทดสอบ B/C

## ทดสอบแล้ว

- `tests/requests.test.js` 8 ข้อ
- Playwright บน iPhone 13 และเดสก์ท็อป: แท็บ, ค้นหา, wizard (validation, ย้อนกลับแล้วค่าไม่หาย), escape HTML ในรายละเอียด, แก้ไข, My Requests, มุมมองของผู้ทดสอบคนอื่น, ยกเลิก, ไม่มี horizontal scroll, ไม่มี console error, dark mode
- โหมด Supabase จริงยังไม่ได้ลองกับ PostgREST (ยังไม่ได้ apply migration) ทดสอบเฉพาะ RPC ในระดับ SQL

---

# Phase 3 — Host Experience

| หน้า | ทำอะไร |
| --- | --- |
| `/requests/:id` | คนที่ไม่ใช่เจ้าของประกาศเห็นปุ่ม **Make an Offer** และเห็นข้อเสนอของตัวเองบนประกาศนั้น (ถอนได้) |
| `/requests/:id/offer` | เลือกกลุ่มของฉัน: แสดงที่นั่งว่าง ราคาต่อที่นั่ง รอบบิล กลุ่มที่เสนอไม่ได้จะกดไม่ได้และบอกเหตุผล ราคาที่เสนอ = ราคาที่นั่งถัดไปของกลุ่ม (ล็อกใน snapshot) + ข้อความถึงผู้หาของ |
| `/my-offers` | แท็บ ทั้งหมด / รอพิจารณา / ยอมรับแล้ว / ปิดแล้ว พร้อมปุ่มถอนข้อเสนอ |
| หน้าแรก | ส่วนใหม่ **กำลังหากลุ่ม (Request Marketplace)**: การ์ด Find a Group / Make an Offer + ประกาศล่าสุด 3 อัน |

เหตุผลที่เสนอไม่ได้: กลุ่มไม่เปิดรับ, รอบบิลไม่ตรง, หมวดหมู่ไม่ตรง, ผู้หากลุ่มอยู่ในกลุ่มแล้ว, ที่นั่งเต็ม, ราคาเกินงบ, เคยเสนอกลุ่มนี้แล้ว (ตรงกับ `hk_my_offerable_groups`)

ข้อเสนอหมดอายุใน 72 ชม. หรือพร้อมประกาศ แล้วแต่อันไหนถึงก่อน ถอนได้เฉพาะตอนรอพิจารณา (การถอนหลังถูกยอมรับมาใน Phase 4 พร้อมการคืนที่นั่ง) ถอนแล้วเสนอใหม่ด้วยกลุ่มเดิมได้

Test mode: ผู้ทดสอบ A มีกลุ่ม “YouTube Premium Family” (฿43.17/เดือน) และ B มี “Google One 2TB ครอบครัว” (฿60/เดือน) ไว้ลองเสนอให้ประกาศตัวอย่างของ B และ C

## ทดสอบแล้ว

- `tests/requests.test.js` เพิ่ม 5 ข้อ (รวม 13): ราคาที่นั่ง, เหตุผลที่เสนอไม่ได้, ส่ง/ซ้ำ/ของตัวเอง/กลุ่มคนอื่น/ข้อความยาว, อายุข้อเสนอ, ถอนและเสนอใหม่, แท็บ My Offers
- Playwright มือถือ + เดสก์ท็อป: หน้าแรก, A เสนอให้ B, เสนอซ้ำไม่ได้, My Offers, ถอน, เสนอใหม่, B เห็นข้อเสนอ + แจ้งเตือน, ข้อความถูก escape, B เสนอให้ C, กลุ่มหมวดไม่ตรงกดไม่ได้, C เสนอให้ประกาศตัวเองไม่ได้, ไม่มี console error / horizontal scroll

---

# Phase 4 — Matching

Request → Offer → **Accept → Reservation → Join (flow กลุ่มเดิม)**

| ขั้น | ใคร | เกิดอะไรขึ้น |
| --- | --- | --- |
| ยอมรับ | Requester | ตรวจกลุ่มอีกรอบ (เจ้าของ, ยังเปิด, ยังไม่เป็นสมาชิก, มีที่ว่างที่ไม่มีใครจอง, ราคาไม่สูงกว่าที่เสนอ) → จองที่นั่ง 24 ชม. → ข้อเสนอนี้ `accepted`, ข้อเสนออื่น `rejected`, ประกาศ `matched` |
| ปฏิเสธ | Requester | ข้อเสนอ `rejected` ประกาศยังเปิดอยู่ |
| เข้าร่วมกลุ่ม | Requester | ใช้ join ของกลุ่มเดิม (Supabase: `hk_join_reserved_group` → `private.join_group`, กลุ่ม link-only ใช้ได้) → จอง `confirmed`, ข้อเสนอ/ประกาศ `completed` → พาไปหน้ากลุ่ม |
| จ่ายเงิน | Requester | ขั้นตอนเดิมของกลุ่ม: ยืนยันยอด → แจ้งโอน/สลิป → แอดมินตรวจ ระบบนี้ไม่เปลี่ยนสถานะการจ่ายเงิน |
| จองหมดเวลา | ระบบ | ที่นั่งคืน, ข้อเสนอ `cancelled`, ประกาศกลับเป็น `open` (หรือ `expired`), แจ้งทั้งสองฝ่าย |
| ถอนหลังถูกยอมรับ | Host | ที่นั่งคืน ประกาศกลับเป็น `open` แจ้ง requester |

ป้องกันจองเกิน: ที่นั่งที่จองไว้นับว่าถูกใช้แล้วทั้งตอนยอมรับและตอนคนอื่นกด join ปกติ (Supabase: trigger บน `group_members` + ล็อกแถว group; test mode: ตรวจใน `reservedSeatBlocks` ก่อน join)

สถานะ Completed = เข้ากลุ่มสำเร็จ ส่วนการจ่ายเงินดูที่หน้ากลุ่มตามเดิม (ตามที่ตกลงไว้ใน Phase 1)

## ทดสอบแล้ว

- `tests/requests.test.js` เพิ่ม 7 ข้อ (รวม 20): ยอมรับ/จอง/ปฏิเสธอันอื่น, ตรวจกลุ่มซ้ำตอนยอมรับ (เต็ม, ปิด, ราคาขึ้น, เป็นสมาชิกแล้ว), ที่นั่งสุดท้ายจองซ้ำไม่ได้ + join ปกติโดนกัน, ปฏิเสธ, เข้าร่วมแล้ว completed, จองหมดเวลา, Host ถอนหลังยอมรับ
- SQL `supabase/tests/request_marketplace.sql` ยังผ่าน (รวมการกดยอมรับพร้อมกันจาก 2 session ใน Phase 1)
- Playwright มือถือ + เดสก์ท็อป: A โพสต์ → B เสนอ → A ยอมรับ (เห็นแผงจองที่นั่ง) → B เห็น “ที่นั่งถูกจองไว้” → A เข้าร่วม → ไปหน้ากลุ่มและเป็นสมาชิก → ประกาศ “เข้าร่วมสำเร็จ” → B ได้แจ้งเตือน, B ปฏิเสธข้อเสนอ, Host ถอนหลังยอมรับ, จองหมดเวลาแล้วประกาศเปิดใหม่ ไม่มี console error

---

# Phase 5 — Polish & Testing

## แจ้งเตือน

- โหมด Supabase: `hk_request_notifications` ขึ้นที่กระดิ่งและหน้า `/notifications` ในแท็บใหม่ **ประกาศหากลุ่ม** (test mode ใช้แจ้งเตือนเดิมของแอปและเข้าแท็บเดียวกัน)
- Realtime: subscribe `postgres_changes` (INSERT, `user_id=eq.<ฉัน>`) ตอนล็อกอิน → มี toast, รีเฟรชกระดิ่ง และล้าง cache หน้าประกาศให้โหลดใหม่ ยกเลิกตอนออกจากระบบ
- กด “อ่านแล้ว” ส่ง `hk_mark_notifications_read` ไปที่เซิร์ฟเวอร์ด้วย

## UI ให้เข้าธีมเว็บ

หน้าใหม่ทั้งหมดเปลี่ยนมาใช้ชิ้นส่วนเดิมของเว็บแทนของที่ทำขึ้นเอง:

| หน้า | ใช้ของเดิม |
| --- | --- |
| `/requests` | `page-heading`, `search-bar`, `filter-carousel`, `section-header` แบบหน้า `/explore` |
| `/requests/new`, `/edit`, `/offer` | `create-group-layout`, `form-panel`, `create-stepper`, `create-form-section`, `category-option`, `product-type-picker`, `create-group-summary` (สรุปด้านขวาอัปเดตตามที่พิมพ์) แบบหน้าสร้างกลุ่ม |
| `/requests/:id` | `breadcrumb`, `group-detail`, `group-identity-card`, `members-card`, `summary-card` แบบหน้ากลุ่ม |
| `/my-requests`, `/my-offers` | `note-tabs` แบบหน้าแจ้งเตือน |
| การ์ดประกาศ | กล่องราคา `opportunity-price` แบบการ์ดกลุ่ม |

เอาออก: hero “NEW FEATURE”, หัวข้อ “MARKETPLACE”, “Step 1 / 3”, ชิปหมวดหมู่ที่มีอีโมจิ, ปุ่มภาษาอังกฤษ (“Publish Request” → “โพสต์ประกาศ”, “Make an Offer” → “เสนอกลุ่มของคุณ”)

## ทดสอบแล้ว

- SQL: เพิ่มเช็คสิทธิ์ (guest เรียก RPC/อ่านการจองไม่ได้, อ่านแจ้งเตือนของคนอื่นไม่ได้, เขียน event/แจ้งเตือนตรงไม่ได้)
- Playwright ทุก flow (Phase 2–4) บน iPhone 13 + เดสก์ท็อปผ่านหลังเปลี่ยน UI, ไม่มี console error
- ไม่มีจอเลื่อนซ้ายขวาในทุกหน้าใหม่บน iPhone SE / iPhone 13 / Pixel 7
- โหมดมืดใช้ token เดิมของธีม

# ก่อนขึ้น production

1. ตรวจ migration drift: ฐานข้อมูลจริงบันทึกไว้ 16 migration แต่ repo มี 49 ต้องเทียบ schema จริงก่อน
2. Apply `20261121120000_safe_image_sources.sql` และ `20261121130000_request_marketplace.sql`
3. เปิด Realtime ให้ตาราง `hk_request_notifications` (migration เพิ่มให้ถ้ามี publication `supabase_realtime`)
4. ลองครบ flow ด้วย 2 บัญชีจริงบน preview ที่ต่อ Supabase จริง
5. ถ้าไม่ apply migration ก่อน merge หน้าประกาศจะขึ้นว่า “ระบบประกาศหากลุ่มยังไม่ได้เปิดในฐานข้อมูลนี้” (ส่วนอื่นของเว็บใช้ได้ปกติ)

# แจ้งเตือนบนมือถือ (Web Push)

หน้า **การแจ้งเตือน** มีการ์ด "รับแจ้งเตือนบนมือถือ" ให้กดเปิด เมื่อเปิดแล้ว แจ้งเตือนจะเด้งขึ้นหน้าจอล็อกและศูนย์แจ้งเตือนเหมือนแอปทั่วไป แม้ไม่ได้เปิดเว็บอยู่

## อะไรบ้างที่เด้ง

| เหตุการณ์ | ใครได้รับ |
| --- | --- |
| ครบกำหนดชำระพรุ่งนี้ / วันนี้ / เลยกำหนด (09:05 น. ทุกวัน) | สมาชิกที่ยังไม่ส่งสลิป (ไม่รวมเจ้าของกลุ่ม) |
| รอบรายเดือนเริ่ม / ยืนยันครบ / จ่ายครบ / ปิด | สมาชิกทุกคนในกลุ่ม |
| มีคนเข้าร่วมหรือออกจากกลุ่ม | สมาชิกคนอื่นในกลุ่ม |
| ข้อความแชตกลุ่ม | สมาชิกคนอื่นในกลุ่ม (รวมเป็นแจ้งเตือนเดียวต่อกลุ่ม) |
| แอดมินยืนยันสลิป / สลิปไม่ผ่าน | เจ้าของสลิป |
| แอดมินโอนเงินให้เจ้าของกลุ่ม | เจ้าของกลุ่ม |
| ข้อเสนอ/ประกาศหากลุ่ม (ทุกแบบที่มีในหน้าแจ้งเตือน) | คนที่เกี่ยวข้อง |
| ประกาศจากระบบที่แอดมินเขียน | ทุกคนที่เปิดแจ้งเตือน |

## วิธีเปิด (ผู้ใช้)

- **iPhone / iPad** (iOS 16.4+): เปิดเว็บใน Safari → ปุ่มแชร์ → **เพิ่มไปยังหน้าจอโฮม** → เปิดจากไอคอน → หน้าการแจ้งเตือน → **เปิดแจ้งเตือน** → อนุญาต
- **Android / คอม**: หน้าการแจ้งเตือน → **เปิดแจ้งเตือน** → อนุญาต

## ตั้งค่าครั้งแรก (เจ้าของระบบ)

ทำงานอย่างไร: เบราว์เซอร์บันทึกเครื่องไว้ใน `push_subscriptions` → trigger ในฐานข้อมูลใส่แจ้งเตือนลง `private.push_outbox` → ปลุก Edge Function `push-send` (ผ่าน pg_net) → ฟังก์ชันส่งด้วยคีย์ VAPID ส่วน pg_cron ส่งเตือนยอดค้างทุกเช้าและลองส่งซ้ำทุกนาที

1. **Database → Extensions**: เปิด `pg_net` และ `pg_cron`
2. รัน migration `supabase/migrations/20261127090000_web_push_notifications.sql` (`supabase db push` หรือวางใน SQL Editor)
3. ตั้ง secrets ของ Edge Function (Dashboard → Edge Functions → Secrets หรือ CLI):
   ```bash
   supabase secrets set VAPID_PUBLIC_KEY=<ค่า VITE_VAPID_PUBLIC_KEY ใน .env.production> \
     VAPID_PRIVATE_KEY=<private key> VAPID_SUBJECT=mailto:harnkhong@gmail.com PUSH_CRON_SECRET=<สุ่มยาวๆ>
   ```
4. Deploy ฟังก์ชัน: `supabase functions deploy push-send --no-verify-jwt`
5. บอกฐานข้อมูลว่าเรียกฟังก์ชันที่ไหน (SQL Editor):
   ```sql
   select vault.create_secret('https://<project-ref>.supabase.co/functions/v1/push-send', 'push_function_url');
   select vault.create_secret('<PUSH_CRON_SECRET เดียวกับข้อ 3>', 'push_cron_secret');
   ```
6. ถ้าเปิด pg_cron หลังรัน migration ให้รันบล็อก `do $$ ... cron.schedule ... $$` ท้ายไฟล์ migration ซ้ำอีกครั้ง
7. Deploy เว็บใหม่ (คีย์สาธารณะ `VITE_VAPID_PUBLIC_KEY` อยู่ใน `.env.production` แล้ว ถ้า Vercel ตั้ง env แยกไว้ให้เพิ่มค่านี้ด้วย)

ทดสอบ: เปิดแจ้งเตือนในหน้าการแจ้งเตือน แล้วกด **ทดสอบ** ควรเด้งภายในไม่กี่วินาที

ถ้าเปลี่ยนคีย์ VAPID ทุกเครื่องต้องกดเปิดแจ้งเตือนใหม่

## ไฟล์

- `public/sw.js` service worker รับ push และเปิดหน้าที่เกี่ยวข้องเมื่อแตะ
- `public/manifest.webmanifest`, `public/icon-*.png` ทำให้ติดตั้งลงหน้าจอโฮมได้
- `src/push.js` ขอสิทธิ์ บันทึก/ลบเครื่อง ส่งทดสอบ
- `supabase/functions/push-send/` ส่งแจ้งเตือนจริง ลบเครื่องที่เลิกใช้ (404/410) ออกเอง
- ทดสอบ SQL: `supabase/tests/local/run.sh supabase/tests/push.sql`

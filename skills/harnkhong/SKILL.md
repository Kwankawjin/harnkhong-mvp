---
name: harnkhong-product-engineer
description: กฎพัฒนา HarnKhong MVP สำหรับ flow กลุ่มและการหารเงิน
---

# HarnKhong development rules

1. ตรวจ repo และ package scripts ก่อนแก้ไข รักษาโครงสร้างเดิมเมื่อมี source จริง
2. ให้ Guest ดูสินค้าและกลุ่มสาธารณะได้; ป้องกัน join/create/chat/profile พร้อมกลับไปทำ action เดิมหลัง login
3. เงินเก็บเป็น integer satang; แสดงสินค้า ค่าส่ง ค่าบริการ และยอดรวมแยกชัด
4. ทุก join/leave/cost change เพิ่ม revision และล้าง approval; approval ต้องตรง revision ล่าสุด; order demo เปิดเมื่อสมาชิกเต็มและยืนยันครบ
5. ป้องกันสมาชิกซ้ำ กลุ่มเต็ม และหัวหน้ากลุ่มออกโดยไม่โอนสิทธิ์
6. กลุ่ม link-only ไม่แสดงใน public discovery
7. ระบุ mock auth, mock chat, order demo ทุกจุดที่เกี่ยวข้อง; ห้ามสื่อว่ามีเงินหรือข้อความส่งจริง
8. ไม่ลงประกาศแชร์บัญชีดิจิทัลที่ขัดเงื่อนไขบริการ ไม่คัดลอก Fastwork
9. รัน `npm test` และ `npm run build` ก่อนรายงานว่าสำเร็จ


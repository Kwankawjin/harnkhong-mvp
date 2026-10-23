# Research — ตรวจสอบ 23 ตุลาคม 2026

| แหล่งจริง | สิ่งที่ตรวจพบ | ผลต่อ HarnKhong / ข้อจำกัด |
| --- | --- | --- |
| [Fastwork หน้าแรก](https://fastwork.co/) | มีช่องค้นหาและหมวดหมู่บริการพร้อมทางเข้าสู่ระบบ | ให้ Guest สำรวจและค้นหาก่อนล็อกอิน; ตรวจหน้าเว็บสาธารณะ ไม่ได้ทดสอบแอปมือถือหรือ flow login/chat จริง |
| [Fastwork หมวดหมู่](https://fastwork.co/categories) | แยกบริการหลายหมวดและมีช่องค้นหา | ใช้หมวดสั้น ๆ กับ search ใน Explore แต่ไม่คัดลอกหน้าตา ไอคอน รูป หรือข้อความ |
| [Fastwork About](https://fastwork.com/about) | อธิบาย marketplace ฝั่งผู้ซื้อและผู้ขาย รวมถึงการติดต่อและ checkout ของแพลตฟอร์มเขา | HarnKhong แยก product detail, seller profile, chat, order demo; ไม่อ้างว่ามีระบบคุ้มครองหรือชำระเงินจริง |
| [MDN Notification.requestPermission](https://developer.mozilla.org/en-US/docs/Web/API/Notification/requestPermission_static) | API การขอสิทธิ์แจ้งเตือนมีเงื่อนไขของเบราว์เซอร์และบริบทผู้ใช้ | ไม่ขอ Push ตอนเปิดเว็บ ใช้ in-app notifications; ยังไม่ติดตั้ง service worker หรือ Push |
| [Apple Web Push](https://developer.apple.com/documentation/usernotifications/sending-web-push-notifications-in-web-apps-and-browsers) | เอกสารอธิบาย web push บนระบบ Apple แต่หน้าเว็บต้องใช้ JavaScript ในเครื่องมืออ่าน | บันทึกเป็นข้อจำกัดที่ต้องทดสอบจริงก่อนเปิด Push บน mobile web |
| [Spotify Premium Family TH](https://www.spotify.com/th-en/family/) | ระบุสมาชิก Family ต้องอยู่ที่อยู่เดียวกัน | ไม่ใช้ตัวอย่าง Spotify/Netflix หรือแชร์บัญชีดิจิทัลเป็นสินค้าของเดโม |

## Product reasoning

การคำนวณและ revision approval เป็นกติกาที่ออกแบบสำหรับ HarnKhong ตามโจทย์ผู้ใช้ ไม่ใช่คุณสมบัติที่อ้างว่าค้นพบจาก Fastwork การแบ่งเงิน 400 บาท / 3 คนใช้ `[133.34, 133.33, 133.33]` และผลรวมเท่ากับ 400 บาทเสมอ

ข้อมูล UI จากแชต ChatGPT โปรเจกต์ “หารของ” และภาพใน Build Kit เป็นข้อมูลที่ผู้ใช้ให้มา ไม่ใช่งานวิจัยภายนอก ภาพอ้างอิงมีตัวอย่างบริการดิจิทัล จึงปรับเป็นตัวอย่างสินค้าที่แบ่งซื้อได้ตามปกติ

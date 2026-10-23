# Design system

## แนวคิด

หน้าจอสำหรับทำงานให้เสร็จเร็ว: ราคา/คน จำนวนสมาชิก และที่ว่างเด่นกว่าคำโฆษณา ใช้อินโฟกราฟิกที่ผู้ใช้แนบเป็น moodboard: โทนน้ำเงิน การ์ดสีขาว ขั้นตอนสั้น และตัวละครเป็นมิตร ภาพประกอบหน้าแรกสร้างใหม่สำหรับโปรเจกต์นี้ ไม่ใช้โลโก้หรือภาพจากบริการในอินโฟกราฟิก

## Tokens

| ชื่อ | สี | ใช้ |
| --- | --- | --- |
| Navy | `#08366B` | heading, ข้อความสำคัญ |
| Blue | `#0868D8` | ปุ่มหลัก, ลิงก์, active nav |
| Turquoise | `#19B6B7` | progress, จุดเน้นการหาร |
| Light blue | `#EAF6FF` | hero และข้อมูลประกอบ |
| Ink | `#123760` | ข้อความหลัก |
| Background | `#F5FAFF` | พื้นหลังแอป |

ตัวอักษร IBM Plex Sans Thai; มี fallback sans-serif. ระยะการ์ด 15px, ปุ่มขั้นต่ำ 46px, focus ring 3px. จอมือถือใช้ bottom navigation 5 รายการ; desktop ใช้ top navigation. หน้าแรกมีแถบ 3 ขั้นตอนและช่องค้นหา; ภาพสินค้าอื่นใช้กราฟิก CSS ที่สร้างในโปรเจกต์ ภาพประกอบต้นฉบับเก็บใน `public/images/harnkhong-friends.png`

## Components

`listingCard`, `groupCard`, `title`, `art`, `button` และ token CSS ใช้ซ้ำในหลายหน้า สถานะสำคัญคือ empty, awaiting approval, approved, ready, disabled order, toast success/error

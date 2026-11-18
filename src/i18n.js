Warning: truncated output (original token count: 37205)
Total output lines: 1722

import { assertSatang } from "./domain.js";

// Thai source text is the key for UI copy; stored/user-entered content is never translated.
const labels = {
  "กำลังโหลดกลุ่มจาก Supabase": "Loading groups from Supabase",
  โหลดกลุ่มไม่สำเร็จ: "Unable to load groups",
  "แชตกลุ่มยังซิงก์ไม่ได้ กรุณาตรวจสอบการตั้งค่าฐานข้อมูล":
    "Group chat could not sync. Check the database setup.",
  "ไม่พบตาราง group_messages ใน Supabase กรุณาเชื่อมโปรเจกต์แล้วรัน npx supabase db push":
    "The group_messages table is missing from Supabase. Link the project and run npx supabase db push.",
  "บัญชีนี้ไม่มีสิทธิ์อ่านแชตกลุ่ม กรุณาตรวจสอบการเป็นสมาชิกและนโยบาย RLS":
    "This account cannot read group chat. Check membership and the RLS policies.",
  "Supabase ยังไม่พบความสัมพันธ์โปรไฟล์ผู้ส่ง กรุณา reload schema cache":
    "Supabase cannot find the sender profile relationship. Reload the schema cache.",
  ลองอีกครั้ง: "Try again",
  คำเชิญเข้าร่วมกลุ่ม: "Group invitation",
  เข้าสู่ระบบเพื่อดูรายละเอียดและเข้าร่วมกลุ่มจากลิงก์เชิญ:
    "Sign in to view and join this invited group.",
  "คำสั่งซื้อของกลุ่มนี้ยังไม่เชื่อมระบบร่วมกัน จึงยังสร้างคำสั่งซื้อหรือแจ้งชำระไม่ได้":
    "Orders are not shared for Supabase groups yet. Creating orders and reporting payment are disabled.",
  ยอดกลุ่มพร้อมแล้ว: "Group totals are confirmed",
  ขั้นตอนคำสั่งซื้อยังไม่เชื่อม: "The order step is not connected yet",
  "กลุ่มนี้ใช้ Supabase แต่คำสั่งซื้อและการชำระเงินยังเป็นเดโม จึงยังเปิดขั้นตอนนี้ไม่ได้":
    "This group uses Supabase, but orders and payments are still demo only, so this step is unavailable.",
  "รายการสินค้าและราคามาจาก Supabase; รูปกลุ่มและสินค้าเพิ่มเองยังไม่รองรับในโหมดนี้":
    "Products and prices come from Supabase. Group photos and custom products are not supported in this mode.",
  "ยังไม่ได้เปิดใช้ Google OAuth": "Google OAuth is not enabled.",
  คำเชิญไม่ถูกต้องหรือหมดอายุ: "This invitation is invalid or expired.",
  กลุ่มเต็มแล้ว: "This group is full.",
  "ยอดมีการเปลี่ยน กรุณาโหลดข้อมูลล่าสุด":
    "The group changed. Reload the latest information.",
  คุณเป็นสมาชิกกลุ่มนี้แล้ว: "You are already a group member.",
  หัวหน้ากลุ่มต้องโอนสิทธิ์ก่อนออก:
    "The owner must transfer leadership before leaving.",
  เฉพาะหัวหน้ากลุ่มแก้ไขค่าใช้จ่ายได้: "Only the group owner can change costs.",
  เฉพาะหัวหน้ากลุ่มโอนสิทธิ์ได้:
    "Only the group owner can transfer leadership.",
  ลบห้อง: "Delete group",
  เตะออก: "Remove",
  "ยืนยันเตะสมาชิก {name} ออกจากห้อง?": "Remove {name} from this group?",
  ไม่พบกลุ่ม: "Group not found",
  คัดลอกลิงก์ไม่สำเร็จ: "Could not copy the invitation link",
  "ยืนยันลบห้อง {name}?": "Delete group {name}?",
  ยืนยันลบห้อง: "Confirm delete group",
  "คุณแน่ใจหรือไม่ว่าต้องการลบห้องนี้? ข้อมูลห้องจะถูกลบออกจากระบบอย่างถาวร":
    "Are you sure you want to delete this group? The group data will be permanently removed.",
  ห้องที่จะลบ: "Group to delete",
  จำนวนสมาชิก: "Members",
  สิ่งที่ควรรู้ก่อนลบห้อง: "Important notes before deleting",
  ห้องนี้จะถูกปิดและนำออกจากรายการค้นหาทันที:
    "This group will be closed and removed from listings immediately.",
  สมาชิกทุกคนในห้องจะได้รับแจ้งเตือนว่าห้องถูกลบ:
    "All members in the group will be notified that the group was deleted.",
  ประวัติการแชตและคำยืนยันยอดของห้องนี้จะไม่สามารถกู้คืนได้:
    "Chat history and approvals for this group cannot be recovered.",
  ห้องถูกลบ: "Group deleted",
  "เจ้าของห้องได้ทำการลบห้อง {name}": "The room owner deleted group {name}",
  "ยืนยันลบห้อง {name}? ลบได้เฉพาะห้องที่ไม่มีสมาชิกคนอื่นอยู่":
    "Delete {name}? You can delete a group only when no other members are in it.",
  "นำสมาชิกออกจากห้องแล้ว ยอดและการยืนยันถูกอัปเดต":
    "Member removed. Totals and approvals have been updated.",
  ลบห้องแล้ว: "Group deleted",
  ลบห้องได้เฉพาะเมื่อไม่มีสมาชิกคนอื่นอยู่:
    "A group can be deleted only when no other members are in it.",
  "ฐานข้อมูลยังไม่มีระบบจัดการห้อง กรุณารัน migration ล่าสุดของ Supabase":
    "The database is missing group management functions. Apply the latest Supabase migration.",
  "ฐานข้อมูลยังใช้กติกาเตะสมาชิกเวอร์ชันเก่า กรุณารัน migration ล่าสุดของ Supabase":
    "The database still has the old member removal rule. Apply the latest Supabase migration.",
  "ยืนยันเตะสมาชิก {name} ออกจากห้อง?": "Remove {name} from this group?",
  "ยืนยันลบห้อง {name}? ลบได้เฉพาะห้องที่ไม่มีสมาชิกคนอื่นอยู่":
    "Delete {name}? You can delete a group only when no other members are in it.",
  "นำสมาชิกออกจากห้องแล้ว ยอดและการยืนยันถูกอัปเดต":
    "Member removed. Totals and approvals have been updated.",
  ยอดรวมเกินขอบเขตที่รองรับ: "The group total exceeds the supported amount.",
  "ข้อมูลยอดจากฐานข้อมูลไม่ตรงกับสูตรแอป กรุณาติดต่อผู้ดูแล":
    "The database total does not match the app calculation. Contact the administrator.",
  "เชื่อมต่อ Supabase ไม่สำเร็จ กรุณาตรวจอินเทอร์เน็ตแล้วลองอีกครั้ง":
    "Could not connect to Supabase. Check your internet connection and try again.",
  มีสมาชิกเข้าร่วม: "A member joined",
  มีสมาชิกออกจากกลุ่ม: "A member left",
  มีการเปลี่ยนค่าใช้จ่าย: "Costs changed",
  มีการโอนหัวหน้ากลุ่ม: "Leadership transferred",
  ยืนยันยอดแล้ว: "Amount confirmed",
  มีการอัปเดตกลุ่ม: "Group updated",
  แชตกับผู้ขายยังเป็นเดโมในเครื่องนี้: "Seller chat is still a local demo.",
  ยินดีต้อนรับกลับ: "Welcome back",
  สร้างบัญชีของคุณ: "Create your account",
  เข้าสู่ระบบเดโมเพื่อไปต่อกับกลุ่มของคุณ:
    "Sign in to continue with your group in this demo.",
  สมัครเสร็จแล้วไปกรอกที่อยู่สำหรับเดโม:
    "Create an account, then add your demo address.",
  "ดำเนินการด้วย Google (จำลอง)": "Continue with Google (demo)",
  หรือใช้อีเมล: "Or use email",
  "ยังไม่มีบัญชี?": "New here?",
  "ขั้นตอนที่ 2 จาก 2": "Step 2 of 2",
  "เลือกของที่ชอบ แล้วชวนเพื่อนมาหารด้วยกัน":
    "Find something you like and share it with friends.",
  "บัญชีทดลอง · ไม่มีการยืนยันตัวตนจริง":
    "Demo account · No real identity verification",
  "เริ่มต้นด้วยกันได้ง่าย ๆ": "A simple start, together",
  "เดโมเท่านั้น ไม่เก็บรหัสผ่าน ไม่เชื่อม Google หรือฐานข้อมูล":
    "Demo only. Passwords are not stored. No Google or database connection.",
  "ใช้ข้อมูลตัวอย่างเท่านั้น ข้อมูลบันทึกในเบราว์เซอร์นี้":
    "Use sample details only. Data stays in this browser.",
  "เลขบัตรประชาชน (ไม่บังคับ ใช้ข้อมูลจำลองเท่านั้น)":
    "National ID (optional, sample data only)",
  กลับไปแก้ข้อมูลบัญชี: "Back to account details",
  รูปกลุ่ม: "Group photos",
  เพิ่มรูป: "Add photos",
  "เพิ่มได้สูงสุด 4 รูป · JPG, PNG, WebP ไม่เกิน 5 MB ต่อรูป · เก็บในเครื่อง":
    "Up to 4 photos · JPG, PNG, WebP, max 5 MB each · Stored locally",
  "เพิ่มรูปได้สูงสุด 4 รูป": "You can add up to 4 photos.",
  "ดูรูปที่ {number}": "View photo {number}",
  "ลบรูปที่ {number}": "Remove photo {number}",
  "รูปแรกเป็นภาพปก แตะรูปย่อเพื่อเลือกภาพปก":
    "The first photo is the cover. Select a thumbnail to make it the cover.",
  "กำลังเตรียมรูป กรุณารอสักครู่": "Preparing photos. Please wait.",
  "รูปพร้อมแล้ว กดบันทึกเพื่อเก็บในเครื่อง":
    "Photos are ready. Save to keep them locally.",
  รูปจะบันทึกพร้อมกลุ่ม: "Photos will be saved with the group.",
  "รูปพร้อมแล้ว จะบันทึกพร้อมกลุ่ม":
    "Photos are ready and will be saved with the group.",
  "เพิ่มได้สูงสุด 4 รูป · JPG, PNG, WebP ไม่เกิน 5 MB ต่อรูป · รูปจะบันทึกพร้อมกลุ่ม":
    "Add up to 4 photos · JPG, PNG, or WebP, up to 5 MB each · Photos are saved with the group.",
  เลือกหมวดหมู่: "Choose categories",
  "เลือกอย่างน้อย 1 หมวดหมู่": "Choose at least one category.",
  "นำหมวดหมู่ออก {category}": "Remove the {category} category",
  "ชื่อหมวดหมู่ต้องไม่เกิน 60 ตัวอักษร":
    "Category names must be 60 characters or fewer.",
  ยอดส่วนแบ่งที่ยืนยัน: "Confirmed group share",
  "{count} กลุ่ม · ยังไม่ใช่ยอดชำระเงินจริง": "{count} groups · not a payment",
  ยอดยืนยันกลุ่มและคำสั่งซื้อเดโม: "Confirmed group totals and demo orders",
  "พื้นที่ในเครื่องไม่พอ ข้อมูลเดิมยังอยู่ กรุณาลดจำนวนรูปแล้วลองใหม่":
    "Local storage is full. Existing data is intact. Remove some photos and try again.",
  แก้ไขโปรไฟล์: "Edit profile",
  "หน้าโปรไฟล์ของฉัน": "My profile",
  "ข้อมูลที่แสดงบนบัตรสมาชิกของคุณ": "Details shown on your member badge",
  "กลับไปบัญชีของฉัน": "Back to my account",
  "บัตรโปรไฟล์คล้องสาย": "Hanging profile badge",
  "แตะหรือกด Enter ที่บัตรเพื่อพลิกดูอีกด้าน":
    "Tap or press Enter on the badge to flip it over.",
  "โปรไฟล์สมาชิก": "Member profile",
  "เข้าสู่ระบบเพื่อดูโปรไฟล์สมาชิกในกลุ่ม":
    "Log in to view a group member’s profile.",
  "เรตโปรไฟล์": "Profile rating",
  "ยังไม่มีรีวิว": "No reviews yet",
  "คะแนนจะแสดงเมื่อมีรีวิวจากผู้ใช้":
    "Your rating will appear after you receive a review.",
  "ยังไม่ได้เพิ่มคำแนะนำตัว": "No bio added yet.",
  "สถานะสมาชิก": "Membership",
  "สมาชิก HarnKhong": "HarnKhong member",
  "แตะบัตรเพื่อพลิกกลับ": "Tap the badge to flip it back.",
  "เพิ่มคำแนะนำตัวได้จากปุ่มแก้ไขโปรไฟล์":
    "Add a bio using the Edit profile button.",
  ปรับข้อมูลที่แสดงในบัญชีเดโมของคุณ:
    "Update the details shown on your demo account.",
  แก้ไขชื่อและข้อมูลแนะนำตัว: "Edit your name and bio.",
  "ยืนยันตัวตนด้วย Supabase Auth": "Identity is verified with Supabase Auth.",
  เข้าสู่ระบบเพื่อไปต่อกับกลุ่มของคุณ: "Sign in to continue to your groups.",
  สมัครแล้วตรวจอีเมลเพื่อยืนยันบัญชี:
    "Sign up, then check your email to confirm your account.",
  ที่อยู่ส่วนนี้เห็นได้เฉพาะคุณ: "Only you can access this address.",
  "รหัสผ่านจัดการโดย Supabase Auth": "Passwords are handled by Supabase Auth.",
  "ดำเนินการด้วย Google": "Continue with Google",
  "บัญชี Supabase Auth": "Supabase Auth account",
  "ยังไม่ได้เปิดใช้ Google OAuth": "Google OAuth is not enabled yet.",
  สมาชิก: "Member",
  จัดการโปรไฟล์และกลุ่มของคุณ: "Manage your profile and groups.",
  "โปรไฟล์ ที่อยู่ และกลุ่มใช้ Supabase":
    "Profiles, addresses, and groups use Supabase.",
  "กลุ่มและการยืนยันยอดใช้ข้อมูลร่วมกันผ่าน Supabase; คำสั่งซื้อและการชำระเงินยังไม่เปิดใช้ในโหมดนี้":
    "Groups and amount confirmations are shared through Supabase. Orders and payments are not enabled in this mode.",
  ออกจากระบบ: "Sign out",
  ตรวจอีเมลเพื่อยืนยันบัญชีก่อนเข้าสู่ระบบ:
    "Check your email to confirm your account before signing in.",
  รหัสผ่านและการยืนยันรหัสผ่านไม่ตรงกัน:
    "Password and confirmation do not match.",
  อีเมลหรือรหัสผ่านไม่ถูกต้อง: "Email or password is incorrect.",
  "อีเมลนี้มีบัญชีแล้ว กรุณาเข้าสู่ระบบ":
    "An account already exists for this email. Please sign in.",
  กรุณายืนยันอีเมลก่อนเข้าสู่ระบบ:
    "Please confirm your email before signing in.",
  "รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร":
    "Password must be at least 8 characters.",
  "โปรดเข้าสู่ระบบด้วย Google ผ่านปุ่ม Supabase Auth":
    "Use the Google sign-in button for Supabase Auth.",
  "ยังไม่ได้ตั้งค่า Supabase": "Supabase is not configured.",
  "เกิดข้อผิดพลาด กรุณาลองใหม่": "Something went wrong. Please try again.",
  ตั้งค่าบัญชี: "Account settings",
  "บัญชีจำลอง · เก็บข้อมูลในเบราว์เซอร์นี้":
    "Demo account · Data stays in this browser",
  บัญชีนี้เป็นตัวจำลอง: "This is a demo account",
  "ไม่มีการยืนยันตัวตนจริง ข้อมูลเดโมบันทึกในเบราว์เซอร์นี้เท่านั้น":
    "There is no real identity verification. Demo data stays in this browser.",
  กลุ่มที่เข้าร่วม: "Groups joined",
  กลุ่ม: "Group",
  รายการ: "items",
  คำสั่งซื้อเดโม: "Demo orders",
  ยอดรอแจ้งชำระ: "Awaiting payment report",
  เดโมเท่านั้น: "Demo only",
  ยอดยืนยันเดโมแล้ว: "Demo amount verified",
  สรุปยอดของฉัน: "My summary",
  ภาพรวมคำสั่งซื้อเดโมจากทุกกลุ่ม: "Demo order overview across groups",
  ดูกลุ่มของฉัน: "View my groups",
  รอแจ้งชำระ: "To report",
  รอตรวจยอดเดโม: "Awaiting demo review",
  ยืนยันยอดเดโมแล้ว: "Verified in demo",
  เครื่องมือทดสอบบัญชี: "Account test tools",
  รายการคำสั่งซ…27205 tokens truncated…ลังจัดเตรียมสินค้าเพื่อส่งมอบให้บริษัทขนส่ง:
    "Seller is preparing items for courier pickup",
  กำลังจัดส่งพัสดุ: "Package in transit",
  พัสดุกำลังจัดส่ง: "Package being delivered",
  "พัสดุถูกส่งมอบให้ {carrier} เรียบร้อยแล้ว (เลขพัสดุ: {trackingNumber})":
    "Package handed over to {carrier} (Tracking: {trackingNumber})",
  คำสั่งซื้อสำเร็จแล้ว: "Order completed",
  ยกเลิกแล้ว: "Cancelled",
  "เหตุผล ถูกยกเลิกโดยระบบแล้ว": "Reason: Cancelled by system",
  "โปรดรีวิวสินค้าก่อนวันที่ {date} และรับคะแนนพิเศษ":
    "Please review items before {date} to earn reward points",
  "รอชำระเงิน / ยืนยันยอด": "Pending payment / verification",
  รอสมาชิกในกลุ่มแจ้งชำระและตรวจยอดเดโม:
    "Waiting for group members to report payment and verify",
  ชำระเงินเรียบร้อย: "Payment secured",
  ผู้ขายเตรียมพัสดุ: "Seller preparing",
  ขนส่งรับพัสดุ: "Carrier picked up",
  กำลังนำส่งพัสดุ: "Out for delivery",
  พัสดุจัดส่งสำเร็จ: "Delivered successfully",
  เลขพัสดุ: "Tracking number",
  คัดลอกเลขพัสดุ: "Copy tracking number",
  "คัดลอกแล้ว!": "Copied!",
  เปิดเว็บตรวจสอบสถานะขนส่ง: "Open carrier tracking",
  ที่อยู่จัดส่งพัสดุ: "Delivery recipient address",
  ไทม์ไลน์การเดินทางของพัสดุ: "Shipment tracking timeline",
  เลือกบริษัทขนส่ง: "Select courier",
  บันทึกข้อมูลการจัดส่งพัสดุ: "Save parcel shipping details",
  กรอกเลขพัสดุ: "Enter tracking number",
  "ลิงก์เว็บขนส่ง (อัตโนมัติหรือระบุเอง)":
    "Courier tracking URL (auto or custom)",
  คัดลอก: "Copy",
  ติดตามพัสดุ: "Track parcel",
  ดูคำสั่งซื้อ: "View order",
  ที่อยู่ตัวแทนรับพัสดุประจำกลุ่ม: "Group delivery destination address",
  เบอร์ติดต่อ: "Phone",
  สถานะขนส่งล่าสุด: "Latest shipping status",
  "พัสดุส่งถึงผู้รับเรียบร้อยแล้ว มีผู้รับลงชื่อรับของ":
    "Package delivered and received by recipient",
  พนักงานขนส่งกำลังนำจ่ายพัสดุให้คุณ:
    "Courier rider is on the way to deliver your parcel",
  พัสดุถึงศูนย์กระจายสินค้าปลายทาง: "Package arrived at sorting facility",
  บริษัทขนส่งเข้ารับพัสดุจากร้านค้าแล้ว:
    "Carrier picked up package from seller",
  ผู้ขายบรรจุสินค้าลงกล่องและออกหมายเลขพัสดุ:
    "Seller packed goods and created shipping label",
  ผู้ขายกำลังจัดเตรียมสินค้าลงกล่อง:
    "Seller is packing items into delivery box",
  "สินค้าจริง (Physical)": "Physical goods",
  ขนส่ง: "Carrier",
  สำหรับผู้ขาย: "For seller",
  ผู้ขายจะกรอกหมายเลขพัสดุและบริษัทขนส่งเมื่อจัดส่งสินค้า:
    "The seller will provide tracking details upon dispatch.",
});
const orderThai = {
  orderStatus_waiting_for_members: "รอสมาชิกครบ",
  orderStatus_pending_payment: "รอแจ้งชำระ / ตรวจยอดเดโม",
  orderStatus_payment_secured: "ตรวจยอดครบแล้ว (จำลองเท่านั้น)",
  orderStatus_preparing_order: "กำลังเตรียมสินค้า (เดโม)",
  orderStatus_shipped: "จัดส่งแล้ว (เดโม ยังไม่ตรวจสอบ)",
  orderStatus_delivered: "ยืนยันรับสินค้าแล้ว (เดโม)",
  orderStatus_inspection_period: "ระยะตรวจรับ (เดโม)",
  orderStatus_completed: "เสร็จสิ้น (เดโม)",
  orderStatus_disputed: "มีข้อพิพาท",
  orderStatus_refunded: "บันทึกผลคืนเงินแล้ว (จำลองเท่านั้น)",
  paymentStatus_unpaid: "ยังไม่แจ้งชำระ",
  paymentStatus_payment_reported: "แจ้งชำระแล้ว · ยังไม่ตรวจสอบ",
  paymentStatus_verification_pending: "รอตรวจยอด (เดโม)",
  paymentStatus_verified: "ตรวจยอดแล้ว (จำลอง ไม่ได้ตรวจธนาคาร)",
  disputeReason_not_received: "ยังไม่ได้รับสินค้า",
  disputeReason_not_as_described: "สินค้าไม่ตรงรายละเอียด",
  disputeReason_missing_items: "สินค้าขาดหรือไม่ถูกต้อง",
  disputeReason_shipping_problem: "ปัญหาการจัดส่ง",
  disputeReason_payment_disagreement: "ข้อโต้แย้งเรื่องการชำระ",
  disputeReason_other: "อื่น ๆ",
  disputeStatus_open: "เปิดเรื่อง",
  disputeStatus_resolution_proposed: "รอผู้รายงานยอมรับ",
  disputeStatus_resolved: "ยอมรับผลร่วมกันแล้ว",
  resolution_resume: "กลับไปทำงานต่อจากสถานะเดิม",
  resolution_refund: "บันทึกผลคืนเงินจำลอง",
  proposal_pending: "รอตอบ",
  proposal_accepted: "ยอมรับแล้ว",
  proposal_rejected: "ไม่ยอมรับ",
  orderEvent_order_created: "สร้างคำสั่งซื้อเดโม",
  orderEvent_membership_completed: "ตรวจสมาชิกครบและยืนยันยอดรอบล่าสุดแล้ว",
  orderEvent_order_status_changed: "เปลี่ยนสถานะคำสั่งซื้อ",
  orderEvent_payment_reported: "แจ้งชำระจำลอง",
  orderEvent_payment_status_changed: "เปลี่ยนสถานะการชำระจำลอง",
  orderEvent_shipment_updated: "แก้ไขข้อมูลจัดส่งที่กรอกเอง",
  orderEvent_inspection_started: "เริ่มระยะตรวจรับ",
  orderEvent_inspection_ended: "สิ้นสุดระยะตรวจรับ",
  orderEvent_order_completed: "จบคำสั่งซื้อเดโม ไม่มีการปล่อยเงินจริง",
  orderEvent_dispute_opened: "เปิดข้อพิพาท",
  orderEvent_resolution_proposed: "ผู้ขายเสนอผลลัพธ์",
  orderEvent_resolution_rejected: "ผู้รายงานปฏิเสธข้อเสนอ",
  orderEvent_dispute_resolved: "ผู้รายงานยอมรับข้อเสนอของผู้ขาย",
  orderEvent_refund_recorded: "บันทึกผลคืนเงินจำลอง",
  orderEvent_legacy_order_imported: "นำเข้าคำสั่งซื้อเก่า ไม่ถือว่าเคยชำระเงิน",
};

const errors = {
  prototypeInvalidEmail: [
    "กรุณากรอกอีเมลที่ถูกต้อง รับอีเมลทั่วไป",
    "Enter a valid email address. Any email provider is supported.",
  ],
  prototypeInvalidProfile: [
    "กรอกชื่อไม่เกิน 70 ตัวอักษร และแนะนำตัวไม่เกิน 160 ตัวอักษร",
    "Enter a name of up to 70 characters and a bio of up to 160 characters.",
  ],
  prototypeInvalidImage: [
    "เลือกไฟล์ JPG, PNG หรือ WebP ที่อ่านได้ ขนาดไม่เกิน 5 MB",
    "Choose a readable JPG, PNG or WebP image up to 5 MB.",
  ],
  prototypeImageTooLarge: [
    "รูปยังมีขนาดใหญ่เกินไป กรุณาเลือกรูปที่เล็กลง",
    "This image is still too large. Please choose a smaller image.",
  ],
  invalidId: [
    "รหัสต้องเป็นข้อความไม่ว่างและไม่มีช่องว่างหัวท้าย",
    "IDs must be non-empty text with no leading or trailing whitespace.",
  ],
  invalidCapacity: [
    "จำนวนสมาชิกต้องอยู่ระหว่าง 2–6 คน",
    "Group size must be an integer between 2 and 6.",
  ],
  invalidSatang: [
    "จำนวนเงินต้องเป็นสตางค์จำนวนเต็มที่ไม่ติดลบและไม่เกินขอบเขตที่รองรับ",
    "Amounts and totals must be non-negative whole satang within the supported safe-integer range.",
  ],
  invalidBaht: [
    "ระบุจำนวนบาทไม่ติดลบและทศนิยมไม่เกิน 2 ตำแหน่ง",
    "Enter a non-negative baht amount with at most two decimal places.",
  ],
  invalidName: ["กรุณาตั้งชื่อกลุ่ม", "Please enter a group name."],
  invalidVisibility: [
    "กรุณาเลือกกลุ่มสาธารณะหรือเฉพาะลิงก์",
    "Choose public or link-only visibility.",
  ],
  invalidMembers: [
    "ต้องมีสมาชิกอย่างน้อย 1 คนและไม่ซ้ำกัน",
    "At least one member is required, with no duplicate IDs.",
  ],
  cancelledGroup: ["กลุ่มนี้ยกเลิกแล้ว", "This group has been cancelled."],
  alreadyMember: [
    "คุณเป็นสมาชิกกลุ่มนี้แล้ว",
    "You are already a member of this group.",
  ],
  fullGroup: ["กลุ่มนี้เต็มแล้ว", "This group is full."],
  notMember: ["คุณไม่ได้อยู่ในกลุ่มนี้", "You are not a member of this group."],
  ownerMustTransfer: [
    "หัวหน้ากลุ่มต้องโอนสิทธิ์ก่อนออก",
    "The group leader must transfer leadership before leaving.",
  ],
  invalidTransfer: [
    "โอนหัวหน้ากลุ่มไม่ได้",
    "Cannot transfer group leadership.",
  ],
  ownerOnly: [
    "เฉพาะหัวหน้ากลุ่มแก้ไขค่าใช้จ่ายได้",
    "Only the group leader can change costs.",
  ],
  approvalMemberOnly: [
    "เฉพาะสมาชิกยืนยันยอดได้",
    "Only members can approve shares.",
  ],
  staleRevision: [
    "ยอดนี้ล้าสมัย กรุณาดูยอดล่าสุด",
    "This revision is out of date. Please review the latest shares.",
  ],
  orderedGroupLocked: [
    "กลุ่มมีคำสั่งซื้อแล้ว เปลี่ยนสมาชิก ค่าใช้จ่าย หรือหัวหน้าไม่ได้",
    "An order already exists. Membership, costs and leadership are locked.",
  ],
  orderUnauthorized: [
    "คุณไม่มีสิทธิ์ดำเนินการนี้",
    "You are not authorized to perform this action.",
  ],
  orderInvalidTransition: [
    "เปลี่ยนสถานะไม่ได้ กรุณาทำตามลำดับคำสั่งซื้อ",
    "Invalid status transition. Follow the order workflow.",
  ],
  orderDisputeUnresolved: [
    "ข้อพิพาทยังไม่ยุติ จึงดำเนินคำสั่งซื้อหรือจบรายการไม่ได้",
    "An unresolved dispute blocks order progress and completion.",
  ],
  orderRefundRequired: [
    "ต้องมีบันทึกผลคืนเงินจำลองก่อนเปลี่ยนสถานะ",
    "A recorded simulated refund outcome is required.",
  ],
  orderNotReady: [
    "ต้องมีสมาชิกครบและยืนยันยอดรอบล่าสุดทุกคน",
    "The group must be full and everyone must approve the latest revision.",
  ],
  orderAlreadyExists: [
    "กลุ่มนี้มีคำสั่งซื้อแล้ว",
    "This group already has an order.",
  ],
  orderInvalidDetails: [
    "กรุณากรอกข้อมูลที่จำเป็นให้ถูกต้องและไม่เกินความยาวที่กำหนด",
    "Provide valid required details within the length limits.",
  ],
  orderInvalidInspection: [
    "ระยะตรวจรับเดโมต้องเป็นจำนวนเต็ม 1–720 ชั่วโมง",
    "The demo inspection period must be 1–720 whole hours.",
  ],
  orderInvalidPaymentTransition: [
    "เปลี่ยนสถานะชำระไม่ได้ ต้องแจ้งชำระและรับเรื่องตรวจยอดตามลำดับ",
    "Invalid payment transition. Reporting and pending verification must come first.",
  ],
  orderPaymentPending: [
    "ยังรอแจ้งชำระหรือตรวจยอดเดโมให้ครบ ไม่ใช่การตรวจสอบธนาคาร",
    "Payment reporting or demo verification is still pending. This is not bank verification.",
  ],
  orderInspectionActive: [
    "ยังไม่หมดระยะตรวจรับเดโม กรุณารีเฟรชหลังครบกำหนด",
    "The demo inspection period has not ended. Refresh after the deadline.",
  ],
  orderInvalidTracking: [
    "กรอกเลขติดตามหรือลิงก์ http/https ที่ถูกต้อง ห้ามใส่ข้อมูลล็อกอินในลิงก์",
    "Provide a tracking number or valid http/https URL without embedded login details.",
  ],
  orderInvalidResolution: [
    "ข้อเสนอหรือคำตอบไม่ถูกต้อง หรือเรื่องนี้เปลี่ยนไปแล้ว",
    "Invalid or outdated dispute resolution proposal or response.",
  ],
};

Object.assign(labels, {
  สินค้าของฉัน: "My listings",
  แก้ไขสินค้า: "Edit listing",
  แก้ไขประกาศสินค้า: "Edit listing",
  ลบสินค้า: "Delete listing",
  "Boost 24 ชั่วโมง": "Boost for 24 hours",
  "Boost ทดลอง 24 ชั่วโมง": "Try a 24 hour Boost",
  "Boost แล้ว · เหลือ {hours} ชม.": "Boosted · {hours}h left",
  Boost: "Boost",
  "ยืนยันลบประกาศ {title}?": "Delete listing {title}?",
  ลบประกาศแล้ว: "Listing deleted",
  แก้ไขได้เฉพาะประกาศของคุณ: "You can only edit your own listings.",
  ลบได้เฉพาะประกาศของคุณ: "You can only delete your own listings.",
  "Boost ได้เฉพาะประกาศของคุณ": "You can only boost your own listings.",
  "Boost ทดลองแล้ว แสดงเด่น 24 ชั่วโมง": "Demo Boost applied for 24 hours.",
  บันทึกการแก้ไข: "Save changes",
  บันทึกการแก้ไขแล้ว: "Changes saved",
  "ยังไม่ได้ Boost": "Not boosted",
  แดชบอร์ดผู้ขาย: "Seller dashboard",
  จัดการประกาศขายและโปรโมทสินค้า: "Manage and promote your listings.",
  เข้าสู่ระบบเพื่อจัดการประกาศของคุณ: "Sign in to manage your listings.",
  ลงขายสินค้าใหม่: "Create a listing",
  ดูประกาศ: "View listing",
  ยังไม่มีประกาศสินค้า: "You have no listings yet.",
  ลงประกาศสินค้าแรกของคุณเพื่อเริ่มขายในตลาดมือสอง:
    "Create your first listing in the secondhand marketplace.",
  ลงขายสินค้า: "Create listing",
  "ฟีเจอร์ Boost ยังไม่พร้อม กรุณารัน migration ตลาดมือสองล่าสุดของ Supabase":
    "Boost is not enabled yet. Apply the latest secondhand marketplace migration in Supabase.",
  "ลบประกาศไม่สำเร็จ ตรวจสอบสิทธิ์ผู้ขายแล้วลองอีกครั้ง":
    "Could not delete this listing. Check seller permissions and try again.",
  "ค่าส่งสินค้า (บาท)": "Shipping fee (THB)",
  คิดค่าส่งหนึ่งครั้งต่อคำสั่งซื้อ: "Shipping is charged once per order.",
  "รับสินค้าเอง · ไม่มีค่าส่ง": "Pickup · No shipping fee",
  "จัดส่ง · ค่าส่ง {amount}": "Shipping · {amount}",
  ค่าสินค้า: "Items",
  ค่าจัดส่ง: "Shipping fee",
});

export const messages = {
  th: {
    ...Object.fromEntries(Object.keys(labels).map((key) => [key, key])),
    ...orderThai,
    ...Object.fromEntries(
      Object.entries(errors).map(([key, text]) => [key, text[0]]),
    ),
  },
  en: {
    ...labels,
    ...Object.fromEntries(
      Object.entries(errors).map(([key, text]) => [key, text[1]]),
    ),
  },
};
export function translate(locale, key, values = {}) {
  const text = messages[locale]?.[key] ?? messages.th[key] ?? key;
  return text.replace(/\{(\w+)\}/g, (match, name) =>
    Object.hasOwn(values, name) ? String(values[name]) : match,
  );
}
export function formatSatang(amount, locale = "th") {
  assertSatang(amount);
  return new Intl.NumberFormat(locale === "en" ? "en-GB" : "th-TH", {
    style: "currency",
    currency: "THB",
  })
    .formatToParts(Math.floor(amount / 100))
    .map((part) =>
      part.type === "fraction"
        ? String(amount % 100).padStart(2, "0")
        : part.value,
    )
    .join("");
}
export function bahtInput(amount) {
  assertSatang(amount);
  return `${Math.floor(amount / 100)}.${String(amount % 100).padStart(2, "0")}`;
}


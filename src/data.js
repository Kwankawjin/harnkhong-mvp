export const sellers = [
  {id:'s1',name:'ร้านบ้านแบ่งปัน',intro:'ของใช้คุณภาพสำหรับซื้อร่วมกัน',initials:'บป'},
  {id:'s2',name:'สตูดิโอพร้อมพิมพ์',intro:'งานพิมพ์สำหรับทีมและชมรม',initials:'พพ'}
];
export const listings = [
  {id:'p1',title:'เซ็ตกระดาษ A4 5 รีม',category:'เครื่องเขียน',kind:'สินค้า',price:64500,sellerId:'s1',art:'paper',mark:'A4',description:'กระดาษ A4 สำหรับทีมเรียนหรือสำนักงาน แพ็ก 5 รีม แบ่งรับตามจำนวนสมาชิก',terms:'รับของร่วมกันที่จุดนัดหมายภายในกรุงเทพฯ หรือคุยกับร้านเพื่อจัดส่งแยก'},
  {id:'p2',title:'กล่องข้าวรักษ์โลก 50 ใบ',category:'ของใช้',kind:'สินค้า',price:89000,sellerId:'s1',art:'box',mark:'50',description:'กล่องอาหารกระดาษพร้อมฝา สำหรับกิจกรรมและงานกลุ่ม',terms:'สินค้าเป็นแพ็กเดียว สมาชิกตกลงการแบ่งรับกันในกลุ่ม'},
  {id:'p3',title:'โปสเตอร์งานชมรม 20 แผ่น',category:'งานพิมพ์',kind:'บริการ',price:120000,sellerId:'s2',art:'print',mark:'20',description:'พิมพ์โปสเตอร์สีสำหรับกิจกรรมชมรมจากไฟล์ที่ลูกค้าจัดเตรียม',terms:'ส่งไฟล์ที่มีสิทธิ์ใช้งานให้ร้านก่อนผลิตจริง เงื่อนไขงานพิมพ์ยืนยันกับผู้ขายอีกครั้ง'},
  {id:'p4',title:'ชุดอุปกรณ์ทำความสะอาด',category:'ของใช้',kind:'สินค้า',price:56000,sellerId:'s1',art:'clean',mark:'SET',description:'ชุดของใช้ส่วนกลางสำหรับหอพักหรือออฟฟิศขนาดเล็ก',terms:'สินค้าเป็นชุดเดียว กรุณาตกลงการรับของร่วมกัน'}
];
export const initialGroups = [
  {id:'g1',listingId:'p1',name:'ทีมอ่านสอบปลายเทอม',ownerId:'demo-owner',visibility:'public',capacity:4,members:['demo-owner','demo-may','demo-nan'],costs:{product:64500,delivery:4000,mode:'per_member_v2'},revision:1,approvals:{},status:'awaiting_approval',history:[{revision:1,reason:'สร้างกลุ่ม',at:'2026-10-23T00:00:00.000Z'}]},
  {id:'g2',listingId:'p2',name:'หารกล่องข้าวงานอีเวนต์',ownerId:'demo-owner',visibility:'public',capacity:5,members:['demo-owner','demo-may'],costs:{product:89000,delivery:0,mode:'per_member_v2'},revision:1,approvals:{},status:'awaiting_approval',history:[{revision:1,reason:'สร้างกลุ่ม',at:'2026-10-23T00:00:00.000Z'}]},
  {id:'g3',listingId:'p3',name:'โปสเตอร์ชมรม',ownerId:'demo-nan',visibility:'link',capacity:3,members:['demo-nan','demo-may'],costs:{product:120000,delivery:0,mode:'per_member_v2'},revision:1,approvals:{},status:'awaiting_approval',history:[{revision:1,reason:'สร้างกลุ่ม',at:'2026-10-23T00:00:00.000Z'}]}
];
export const demoNames = {'demo-owner':'ต้น (หัวหน้ากลุ่ม)','demo-may':'เมย์','demo-nan':'แนน'};
export function initialState() { return {user:null,role:'member',groups:initialGroups,customListings:[],notifications:[],conversations:{},orders:[]}; }

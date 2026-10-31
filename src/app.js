import './style.css';
import QRCode from 'qrcode';
import {demoAccount,editProfile,readLocalImage,isLocalImage,MAX_GROUP_IMAGES} from './prototype.js';
import {listings as seedListings, sellers, demoNames, initialState} from './data.js';
import {assertCapacity, createGroup, costBreakdown, totalCost, shares, joinGroup, leaveGroup, approve, changeCosts, parseBaht, allApproved, transferOwner} from './domain.js';
import {messages, translate, formatSatang, bahtInput} from './i18n.js';
import {supabase, supabaseConfigured, googleAuthAvailable, refreshAuthProviders, loadAuthenticatedUser, saveAuthenticatedAddress} from './supabase.js';
import {createAuthSessionSync} from './auth-session.js';
import {loadSupabaseGroups, resolveSupabaseInvite, createSupabaseGroup, joinSupabaseGroup, leaveSupabaseGroup, approveSupabaseGroup, changeSupabaseDelivery, transferSupabaseGroup, removeSupabaseGroupMember, deleteSupabaseGroup, getSupabaseInvite} from './supabase-groups.js';
import {createOrder,activateOrder,migrateOrders,lockOrderedGroups,orderPermissions,reportPayment,updatePayment,transitionOrder,updateShipment,openDispute,proposeResolution,respondToResolution,DISPUTE_REASONS,sellerIdFor,assertListingSeller} from './orders.js';

const LOCALE_KEY='harnkhong-locale';
let locale='th';
try { if(localStorage.getItem(LOCALE_KEY)==='en')locale='en'; } catch { /* Keep Thai when storage is unavailable. */ }
const THEME_KEY='harnkhong-theme';
let theme='light';
try { if(localStorage.getItem(THEME_KEY)==='dark')theme='dark'; } catch { /* Keep the light theme when storage is unavailable. */ }
let mobileMenuOpen=false;
let heroHeadlineTimeout=null;
let heroHeadlineIndex=0;
let heroHeadlineAnimation=null;
let heroHeadlineResizeHandler=null;
function startHeroHeadlineLoop(){
  clearTimeout(heroHeadlineTimeout);
  heroHeadlineAnimation?.cancel();
  heroHeadlineAnimation=null;
  if(heroHeadlineResizeHandler)window.removeEventListener('resize',heroHeadlineResizeHandler);
  const visible=document.querySelector('[data-text-loop]');
  if(!visible)return;
  let phrases=[];
  try{phrases=JSON.parse(visible.dataset.textLoop||'[]');}catch{return;}
  if(phrases.length<2)return;
  const reduceMotion=matchMedia('(prefers-reduced-motion: reduce)').matches;
  const accessible=document.querySelector('[data-headline-accessible]');
  const staticText=visible.dataset.staticText||'';
  const current=visible.querySelector('.headline-rotator-current');
  const windowElement=visible.querySelector('.headline-rotator-window');
  const measure=visible.querySelector('.headline-rotator-measure');
  const staticElement=visible.querySelector('.hero-headline-static');
  const cursor=visible.querySelector('.headline-rotator-cursor');
  const heading=visible.closest('h1');
  heroHeadlineResizeHandler=()=>{
    if(!heading||!staticElement||!windowElement||!measure)return;
    const headingWidth=window.innerWidth>=960?window.innerWidth-32:heading.clientWidth;
    const available=Math.max(80,headingWidth-staticElement.getBoundingClientRect().width-(cursor?.offsetWidth||0)-12);
    windowElement.style.maxWidth=`${available}px`;
    measure.style.maxWidth=`${available}px`;
  };
  heroHeadlineResizeHandler();
  window.addEventListener('resize',heroHeadlineResizeHandler,{passive:true});
  const cycle=async()=>{
    heroHeadlineIndex=(heroHeadlineIndex+1)%phrases.length;
    const phrase=phrases[heroHeadlineIndex];
    if(!current||!windowElement||!measure)return;
    if(reduceMotion){
      current.textContent=phrase;
      if(accessible)accessible.textContent=`${staticText} ${phrase}`;
      heroHeadlineTimeout=setTimeout(cycle,3000);
      return;
    }
    const previousWidth=windowElement.getBoundingClientRect().width;
    heroHeadlineAnimation=windowElement.animate(
      [{width:`${previousWidth}px`,opacity:1},{width:'0px',opacity:0}],
      {duration:220,easing:'ease-in',fill:'forwards'}
    );
    await heroHeadlineAnimation.finished.catch(()=>{});
    if(!visible.isConnected)return;
    heroHeadlineAnimation.cancel();
    current.textContent=phrase;
    const reservedText=measure.textContent;
    measure.textContent=phrase;
    const nextWidth=measure.getBoundingClientRect().width+4;
    measure.textContent=reservedText;
    windowElement.style.width='0px';
    windowElement.style.opacity='0';
    windowElement.getBoundingClientRect();
    heroHeadlineAnimation=windowElement.animate(
      [{width:'0px',opacity:0},{width:`${nextWidth}px`,opacity:1}],
      {duration:580,easing:'cubic-bezier(0.16,1,0.3,1)',fill:'forwards'}
    );
    await heroHeadlineAnimation.finished.catch(()=>{});
    if(!visible.isConnected)return;
    heroHeadlineAnimation.cancel();
    windowElement.style.width='auto';
    windowElement.style.opacity='1';
    if(accessible)accessible.textContent=`${staticText} ${phrase}`;
    heroHeadlineTimeout=setTimeout(cycle,2200);
  };
  heroHeadlineTimeout=setTimeout(cycle,3000);
}
const t=(key,values)=>translate(locale,key,values);
const errorMessage=error=>messages[locale][error.code]??error.message??t('เกิดข้อผิดพลาด กรุณาลองใหม่');

const KEY='harnkhong-demo-v1';
let state;
try { state={...initialState(),...JSON.parse(localStorage.getItem(KEY)||'{}')}; } catch { state=initialState(); }
if(supabaseConfigured)state={...state,user:null,profiles:{},groups:[],remoteListings:[],remoteSellers:[],customListings:[],orders:[],notifications:[],conversations:{}};
const save=(next=state)=>{
  state=next;
  if(supabaseConfigured)return;
  localStorage.setItem(KEY,JSON.stringify(next));
};
const restoredOrders=migrateOrders(state.orders,state.groups,[...seedListings,...state.customListings]);
const restoredGroups=lockOrderedGroups(state.groups,restoredOrders).map(g=>{
  if(g.orderId||g.costs?.mode==='per_member_v2')return g;
  return {...g,costs:{product:g.costs.product,delivery:g.costs.delivery,mode:'per_member_v2'},revision:g.revision+1,approvals:{},status:'awaiting_approval',history:[...g.history,{revision:g.revision+1,reason:'ปรับวิธีคิดค่าส่งและค่าธรรมเนียม',at:new Date().toISOString()}]};
});
if(restoredOrders.some((o,i)=>o!==state.orders[i])||restoredGroups.some((g,i)=>g!==state.groups[i])) {
  // Keep the original stored data if upgrading cannot be saved.
  try {save({...state,orders:restoredOrders,groups:restoredGroups});} catch {state={...state,orders:restoredOrders,groups:restoredGroups};}
}
const listings=()=>supabaseConfigured?state.remoteListings:[...seedListings,...state.customListings];
const listing=id=>listings().find(x=>x.id===id);
const seller=id=>(supabaseConfigured?state.remoteSellers:sellers).find(x=>x.id===id)||{id,name:t('ร้านตัวอย่าง'),intro:t("ผู้ขายในโหมดเดโม"),initials:'DE'};
const group=id=>state.groups.find(x=>x.id===id);
const name=id=>id===state.user?.id?state.user.name:(state.profiles?.[id]?.name||demoNames[id]||t("สมาชิกเดโม"));
const money=n=>formatSatang(n,locale);
const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const icon=(id,size=22)=>`<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><use href="#i-${id}"/></svg>`;
const icons=`<svg xmlns="http://www.w3.org/2000/svg" style="position:absolute;width:0;height:0;overflow:hidden"><symbol id="i-eye" viewBox="0 0 24 24"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></symbol><symbol id="i-home" viewBox="0 0 24 24"><path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z"/><path d="M9 21v-7h6v7"/></symbol><symbol id="i-search" viewBox="0 0 24 24"><circle cx="10.8" cy="10.8" r="7"/><path d="m16 16 5 5"/></symbol><symbol id="i-users" viewBox="0 0 24 24"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></symbol><symbol id="i-edit" viewBox="0 0 24 24"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></symbol><symbol id="i-trash" viewBox="0 0 24 24"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></symbol><symbol id="i-info" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></symbol><symbol id="i-alert-circle" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12.01" y1="16" y2="16"/></symbol><symbol id="i-chat" viewBox="0 0 24 24"><path d="M4 4h16v13H8l-4 3z"/><path d="M8 9h8M8 13h5"/></symbol><symbol id="i-user" viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></symbol><symbol id="i-bell" viewBox="0 0 24 24"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 8-3 9h18c0-1-3-2-3-9ZM10 21h4"/></symbol><symbol id="i-arrow" viewBox="0 0 24 24"><path d="M5 12h14m-6-6 6 6-6 6"/></symbol><symbol id="i-check" viewBox="0 0 24 24"><path d="m5 12 4 4L19 6"/></symbol><symbol id="i-plus" viewBox="0 0 24 24"><path d="M12 4v16M4 12h16"/></symbol><symbol id="i-back" viewBox="0 0 24 24"><path d="m14 5-7 7 7 7"/></symbol><symbol id="i-lock" viewBox="0 0 24 24"><rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></symbol><symbol id="i-link" viewBox="0 0 24 24"><path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-2 2M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l2-2"/></symbol><symbol id="i-shield" viewBox="0 0 24 24"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></symbol><symbol id="i-sparkles" viewBox="0 0 24 24"><path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3L12 3z"/></symbol><symbol id="i-calc" viewBox="0 0 24 24"><rect x="4" y="2" width="16" height="20" rx="2"/><line x1="8" y1="6" x2="16" y2="6"/><line x1="16" y1="14" x2="16" y2="18"/><path d="M16 10h.01M12 10h.01M8 10h.01M12 14h.01M8 14h.01M12 18h.01M8 18h.01"/></symbol><symbol id="i-trending" viewBox="0 0 24 24"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></symbol><symbol id="i-fire" viewBox="0 0 24 24"><path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/></symbol></svg>`;
const a=(href,label,cls='')=>`<a href="${href}" data-link class="${cls}">${label}</a>`;
function go(path){if(location.pathname==='/groups/create'&&path.split('?')[0]!=='/groups/create'){groupImages=[];selectedCreateCategories=[];}history.pushState({},'',path);render();window.scrollTo(0,0);}
let authModalActive = false;
let mockupCurrentStep = 1;
let tempSignupData = {};
let groupImages=[];
let selectedCreateCategories=[];
let imagesLoading=false;
let profileAvatar='';
let avatarLoading=false;
let groupsLoading=supabaseConfigured;
let groupsError=null;
let syncSupabaseSession=async()=>{};
let authSessionSync=null;
let activeSupabaseSession=null;

function isAuthRequired(href) {
  if (!href) return false;
  const path = href.split('?')[0];
  if (['/my-groups', '/my-orders', '/chat', '/profile', '/notifications', '/groups/create', '/seller/dashboard', '/seller/products/new'].includes(path)) {
    return true;
  }
  if (/^\/chat\/[^/]+$/.test(path)) return true;
  if (/^\/groups\/[^/]+\/join$/.test(path)) return true;
  if (/^\/orders\/[^/]+$/.test(path)) return true;
  return false;
}

function openAuthModal(step = 1) {
  mockupCurrentStep = step;
  authModalActive = true;
  render();
}

function closeAuthModal() {
  authModalActive = false;
  tempSignupData={};
  if (isAuthRequired(location.pathname)) {
    go('/');
  } else {
    render();
  }
}

function setMockupStep(step, triggerElement=null) {
  if(step===3&&!tempSignupData.email)step=2;
  mockupCurrentStep=step;
  const root=triggerElement?.closest('.auth-switch');
  (root?[root]:document.querySelectorAll('.auth-switch')).forEach(panel=>{
    panel.classList.toggle('is-signup',step!==1);
    panel.querySelectorAll('.mockup-screen').forEach((screen,index)=>{
      screen.hidden=index+1!==step;
      screen.classList.toggle('active',index+1===step);
    });
    panel.querySelector('.mockup-screen.active h2')?.focus();
  });
}
function fillMockupDemo() {
  const values={'mockup-login-email':'somchai.demo@example.com','mockup-login-pw':'Password123!',
    'mockup-signup-name':'สมชาย ใจดี','mockup-signup-email':'somchai.demo@example.com','mockup-signup-pw':'Password123!','mockup-signup-confirm-pw':'Password123!',
    'mockup-id-card':'','mockup-house-no':'128/45','mockup-village-no':'3','mockup-province':'กรุงเทพมหานคร','mockup-district':'ปทุมวัน',
    'mockup-subdistrict':'ลุมพินี','mockup-alley':'ซอยร่วมฤดี','mockup-road':'เพลินจิต','mockup-postal-code':'10330','mockup-phone':'089-123-4567'};
  Object.entries(values).forEach(([id,value])=>{const el=document.getElementById(id);if(el)el.value=value;});
  alertMessage(t('กรอกข้อมูลตัวอย่างใน Mockup เรียบร้อยแล้ว'));
}
function finishAuth(user) {
  if(supabaseConfigured)state={...state,user};
  else save({...state,user,profiles:{...state.profiles,[user.id]:user}});
  tempSignupData={};authModalActive=false;mockupCurrentStep=1;
  const back=sessionStorage.getItem('harn-return')||'/';sessionStorage.removeItem('harn-return');
  go(['/login','/register'].includes(back.split('?')[0])?'/':back);
  alertMessage(t('เข้าสู่ระบบสำเร็จ! ยินดีต้อนรับ {name}',{name:user.name}));
}
function renderPhoneMockup(initialStep=1,isModal=true) {
  if(!isModal&&authModalActive)return '';
  mockupCurrentStep=initialStep;
  const step=initialStep===3&&!tempSignupData.email?2:initialStep;
  const input=(id,label,type='text',extra='')=>`<label>${label}<span class="auth-input"><input id="${id}" type="${type}" required ${extra}/>${type==='password'?`<button type="button" data-action="toggle-mockup-pw" data-target="${id}" aria-label="${t('แสดงหรือซ่อนรหัสผ่าน')}">${icon('eye',17)}</button>`:''}</span></label>`;
  const google=supabaseConfigured?`${googleAuthAvailable?`<button type="button" class="button google-button full" data-action="supabase-google"><b aria-hidden="true">G</b> ${t('ดำเนินการด้วย Google')}</button>`:`<button type="button" class="button google-button full" disabled><b aria-hidden="true">G</b> ${t('ยังไม่ได้เปิดใช้ Google OAuth')}</button>`}<div class="auth-divider"><span>${t('หรือใช้อีเมล')}</span></div>`:`<button type="button" class="button google-button full" data-action="mockup-social" data-provider="Google"><b aria-hidden="true">G</b> ${t('ดำเนินการด้วย Google (จำลอง)')}</button><div class="auth-divider"><span>${t('หรือใช้อีเมล')}</span></div>`;
  const addressFields=[['house-no','บ้านเลขที่',true],['village-no','หมู่',false],['province','จังหวัด',true],['district','อำเภอ',true],['subdistrict','ตำบล',true],['alley','ซอย',false],['road','ถนน',false],['postal-code','รหัสไปรษณีย์',true],['phone','เบอร์มือถือ',true]];
  return `<div class="auth-switch ${step!==1?'is-signup':''}">
    ${isModal?`<button class="dialog-close" type="button" data-action="close-auth" aria-label="${t('ปิดหน้าต่าง')}">✕</button>`:''}
    <aside class="auth-welcome"><span class="auth-wordmark">Harn<span>Khong</span></span><div><h2>${t('หารของด้วยกัน')}</h2><p>${t('เลือกของที่ชอบ แล้วชวนเพื่อนมาหารด้วยกัน')}</p><span class="auth-welcome-line"></span><p>${t(supabaseConfigured?'ยืนยันตัวตนด้วย Supabase Auth':'บัญชีทดลอง · ไม่มีการยืนยันตัวตนจริง')}</p></div><span>${t('เริ่มต้นด้วยกันได้ง่าย ๆ')}</span></aside>
    <div class="auth-forms">
      <section class="mockup-screen ${step===1?'active':''}" ${step!==1?'hidden':''}>
        <h2 tabindex="-1">${t('ยินดีต้อนรับกลับ')}</h2><p>${t(supabaseConfigured?'เข้าสู่ระบบเพื่อไปต่อกับกลุ่มของคุณ':'เข้าสู่ระบบเดโมเพื่อไปต่อกับกลุ่มของคุณ')}</p>${google}
        <form id="mockup-login-form" class="auth-form">
          ${input('mockup-login-email',t('อีเมล'),'email','autocomplete="email" maxlength="254"')}
          ${input('mockup-login-pw',t('รหัสผ่าน'),'password','autocomplete="current-password"')}
          <button class="button primary full" type="submit">${t('เข้าสู่ระบบ')}</button>
        </form><p class="auth-switch-prompt">${t('ยังไม่มีบัญชี?')} <button type="button" data-action="mockup-step" data-step="2">${t('สมัครสมาชิก')}</button></p>
      </section>
      <section class="mockup-screen ${step===2?'active':''}" ${step!==2?'hidden':''}>
        <h2 tabindex="-1">${t('สร้างบัญชีของคุณ')}</h2><p>${t(supabaseConfigured?'สมัครแล้วตรวจอีเมลเพื่อยืนยันบัญชี':'สมัครเสร็จแล้วไปกรอกที่อยู่สำหรับเดโม')}</p>${google}
        <form id="mockup-signup-form" class="auth-form">
          ${input('mockup-signup-name',t('ชื่อ'),'text','autocomplete="name" maxlength="70"')}
          ${input('mockup-signup-email',t('อีเมล'),'email','autocomplete="email" maxlength="254"')}
          ${input('mockup-signup-pw',t('รหัสผ่าน'),'password','autocomplete="new-password" minlength="8"')}
          ${input('mockup-signup-confirm-pw',t('ยืนยันรหัสผ่าน'),'password','autocomplete="new-password"')}
          <button class="button primary full" type="submit">${t('ต่อไป (กรอกที่อยู่)')} ${icon('arrow',18)}</button>
        </form><p class="auth-switch-prompt">${t('มีบัญชีอยู่แล้ว?')} <button type="button" data-action="mockup-step" data-step="1">${t('เข้าสู่ระบบ')}</button></p>
      </section>
      <section class="mockup-screen ${step===3?'active':''}" ${step!==3?'hidden':''}>
        <small>${t('ขั้นตอนที่ 2 จาก 2')}</small><h2 tabindex="-1">${t('กรอกที่อยู่')}</h2><p>${t(supabaseConfigured?'ที่อยู่ส่วนนี้เห็นได้เฉพาะคุณ':'ใช้ข้อมูลตัวอย่างเท่านั้น ข้อมูลบันทึกในเบราว์เซอร์นี้')}</p>
        <form id="mockup-address-form" class="auth-form"><div class="form-grid">${addressFields.map(([id,label,required])=>`<label>${t(label)}<input id="mockup-${id}" ${required?'required':''} ${id==='phone'?'type="tel" maxlength="12" pattern="[0-9 -]{9,12}" autocomplete="tel"':id==='postal-code'?'inputmode="numeric" pattern="[0-9]{5}" maxlength="5" autocomplete="postal-code"':'maxlength="100"'}/></label>`).join('')}</div>${supabaseConfigured?'':`<label>${t('เลขบัตรประชาชน (ไม่บังคับ ใช้ข้อมูลจำลองเท่านั้น)')}<input id="mockup-id-card" maxlength="17" inputmode="numeric" autocomplete="off"/></label>`}<button class="button primary full" type="submit">${t('ยืนยันข้อมูล')}</button><button class="button subtle full" type="button" data-action="mockup-step" data-step="2">${t('กลับไปแก้ข้อมูลบัญชี')}</button></form>
      </section>
      <footer class="auth-demo-note"><span>${t(supabaseConfigured?'รหัสผ่านจัดการโดย Supabase Auth':'เดโมเท่านั้น ไม่เก็บรหัสผ่าน ไม่เชื่อม Google หรือฐานข้อมูล')}</span>${supabaseConfigured?'':`<button type="button" data-action="mockup-autofill">${t('ข้อมูลตัวอย่าง')}</button>`}</footer>
    </div>
  </div>`;
}

function requireAuth(path){
  if(!state.user){
    sessionStorage.setItem('harn-return', path);
    return false;
  }
  if(supabaseConfigured&&!state.user.address){
    sessionStorage.setItem('harn-return',path);
    tempSignupData=state.user;mockupCurrentStep=3;
    return false;
  }
  return true;
}

function authRequiredView(title = t("เข้าสู่ระบบเพื่อดำเนินการต่อ"), desc = t("หน้านี้ต้องการการเข้าสู่ระบบเพื่อใช้งาน")) {
  return `
    <div class="auth-required-container">
      <div class="auth-required-header">
        <span class="auth-lock-badge">${icon('lock', 24)}</span>
        <h1>${escape(title)}</h1>
        <p>${escape(desc)}</p>
      </div>
      <div class="auth-page-wrapper" style="padding-top:0;">
        ${renderPhoneMockup(supabaseConfigured&&state.user&&!state.user.address?3:1, false)}
      </div>
      <div class="auth-return-center">
        <a href="/" data-link class="auth-return-link">← ${t("กลับสู่หน้าหลัก HarnKhong")}</a>
      </div>
    </div>
  `;
}
function notice(title,body,href='/notifications',recipient=state.user?.id){if(!recipient)return;state.notifications.unshift({id:crypto.randomUUID(),recipient,title,body,href,read:false,at:new Date().toISOString()});save();}
function updateGroup(next){state.groups=state.groups.map(g=>g.id===next.id?next:g);save();}
const orderFor=id=>state.orders.find(o=>o.groupId===id);
function updateOrder(next){
  const orders=state.orders.some(o=>o.id===next.id)?state.orders.map(o=>o.id===next.id?next:o):[...state.orders,next];
  const last=next.history.at(-1),recipients=[...new Set([...next.members,...(next.sellerId==='s1'?['demo-seller']:next.sellerId==='s2'?['demo-seller-s2']:[])])];
  const notifications=recipients.map(recipient=>({id:crypto.randomUUID(),recipient,title:t('orderEvent_'+last.type),body:orderStatus(next.status)+' · '+t('จำลองเท่านั้น'),href:`/orders/${next.groupId}`,read:false,at:last.at}));
  save({...state,orders,groups:lockOrderedGroups(state.groups,orders),notifications:[...notifications,...state.notifications]});
}
function orderChanged(next,feedback){
  updateOrder(next);
  render();
  alertMessage(feedback);
}
const dateTime=at=>at?new Date(at).toLocaleString(locale==='en'?'en-GB':'th-TH'):t('ไม่ทราบเวลาเดิม');
const actorName=id=>id===state.user?.id?state.user.name:state.profiles?.[id]?.name||demoNames[id]||(id==='demo-seller'?seller('s1').name:id==='demo-seller-s2'?seller('s2').name:id||t('ระบบนำเข้าข้อมูลเดิม'));
const orderStatus=status=>t('orderStatus_'+status);
const paymentStatus=status=>t('paymentStatus_'+status);
function alertMessage(msg){
  const dialog=document.querySelector('dialog[open]');
  if(dialog){
    const target=dialog.querySelector('.mockup-screen.active')||dialog.querySelector('form')||dialog;
    let feedback=target.querySelector('[data-dialog-feedback]');
    if(!feedback){feedback=document.createElement('p');feedback.dataset.dialogFeedback='';feedback.className='dialog-feedback';feedback.setAttribute('role','alert');target.append(feedback);}
    feedback.textContent=msg;feedback.scrollIntoView({block:'nearest'});return;
  }
  document.querySelector('#toast').textContent=msg;document.querySelector('#toast').classList.add('show');setTimeout(()=>document.querySelector('#toast')?.classList.remove('show'),3500);
}
const title=(heading,sub='')=>`<div class="page-heading"><h1>${heading}</h1>${sub?`<p>${sub}</p>`:''}</div>`;
const art=item=>`<div class="product-art ${escape(item.art)}"><span>${escape(item.mark)}</span><small>${escape(t(item.category))}</small></div>`;
function gallery(images=[],editable=false) {
  images=images.filter(isLocalImage);
  if(!images.length)return '';
  return `<div class="group-gallery ${editable?'editable':''}" aria-label="${t('รูปกลุ่ม')}"><div class="gallery-main"><img src="${images[0]}" alt="${t('รูปกลุ่ม')} 1"/><span class="gallery-counter">1 / ${images.length}</span></div><div class="gallery-thumbnails">${images.map((image,index)=>`<div><button type="button" data-action="gallery-select" data-index="${index}" ${editable?'data-editable="true"':''} aria-label="${t('ดูรูปที่ {number}',{number:index+1})}" aria-pressed="${index===0}"><img src="${image}" alt=""/></button>${editable?`<button class="image-remove" type="button" data-action="image-remove" data-index="${index}" aria-label="${t('ลบรูปที่ {number}',{number:index+1})}">✕</button>`:''}</div>`).join('')}</div>${editable?`<small>${t('รูปแรกเป็นภาพปก แตะรูปย่อเพื่อเลือกภาพปก')}</small>`:''}</div>`;
}
function profileDialog() {
  const user=state.user;
  return `<dialog id="profile-dialog" class="profile-dialog" aria-labelledby="profile-dialog-title"><form id="profile-form" class="auth-form"><header><div><h2 id="profile-dialog-title">${t('แก้ไขโปรไฟล์')}</h2><p>${t(supabaseConfigured?'แก้ไขชื่อและข้อมูลแนะนำตัว':'ปรับข้อมูลที่แสดงในบัญชีเดโมของคุณ')}</p></div><button type="button" class="dialog-close" data-action="close-dialog" aria-label="${t('ปิดหน้าต่าง')}">✕</button></header>${supabaseConfigured?'':`<div class="profile-cover"></div><div class="profile-avatar-editor"><span class="avatar large" id="profile-avatar-preview">${isLocalImage(user.avatar)?`<img src="${user.avatar}" alt=""/>`:escape(user.name.slice(0,1))}</span><label class="button outline">${t('เปลี่ยนรูป')}<input id="profile-avatar" type="file" accept="image/jpeg,image/png,image/webp"/></label><button class="button subtle" type="button" data-action="avatar-remove">${t('ลบรูป')}</button></div><p id="avatar-status" role="status"></p><p class="field-help">${t('JPG, PNG, WebP ไม่เกิน 5 MB · บันทึกเฉพาะในเครื่อง')}</p>`}<label>${t('ชื่อ')}<input name="name" value="${escape(user.name)}" maxlength="70" required autocomplete="name"/></label><label>${t('อีเมล')}<input name="email" type="email" value="${escape(user.email||'')}" maxlength="254" autocomplete="email" ${supabaseConfigured?'readonly':''}/></label><label>${t('เกี่ยวกับฉัน')}<textarea name="bio" maxlength="160" rows="3">${escape(user.bio||'')}</textarea></label><small id="bio-counter">${(user.bio||'').length} / 160</small><footer class="dialog-footer"><button type="button" class="button outline" data-action="close-dialog">${t('ยกเลิก')}</button><button type="submit" class="button primary">${t('บันทึกการเปลี่ยนแปลง')}</button></footer></form></dialog>`;
}
const demoReference=()=>`REF-${new Date().toISOString().replace(/[-:TZ.]/g,'').slice(0,14)}-${crypto.randomUUID().slice(0,4).toUpperCase()}`;
const demoAcceptUrl=(reference,amount)=>{const url=new URL('/demo-accept',location.origin);url.searchParams.set('ref',reference);url.searchParams.set('amount',String(amount));return url;};
function paymentDialog(order,reference) {
  const amount=order.payments[state.user.id].amountSatang;
  return `<dialog id="payment-dialog" class="payment-dialog share-approval-dialog" aria-labelledby="payment-title"><div class="payment-head"><span class="chip">${t('จำลองเท่านั้น')}</span><button type="button" class="dialog-close" data-action="close-dialog" aria-label="${t('ปิดหน้าต่าง')}">✕</button></div><h2 id="payment-title">${t('สแกน QR เพื่อยืนยันยอด')}</h2><p>${t('สแกนด้วยโทรศัพท์เพื่อตรวจสอบและยอมรับยอด')}</p><div class="demo-qr"><img id="payment-qr" data-reference="${escape(reference)}" data-amount="${amount}" alt="${t('QR สำหรับยอมรับยอดจำลอง')}"/></div><div class="approval-amount-panel"><small>${t('ยอดชำระจำลอง')}</small><strong class="payment-amount">${money(amount)}</strong></div><div class="demo-expiry-box"><span>${t('กรุณายอมรับภายใน')}<b>5 ${t('ชั่วโมง')}</b></span><strong class="demo-countdown">05 : 00 : 00</strong></div><div class="demo-reference-row"><span>${t('รหัสอ้างอิง')}</span><b>${escape(reference)}</b></div><div class="demo-only-note">${t('การยืนยันนี้เป็นการยอมรับจำนวนเงินจำลองเท่านั้น ไม่มีการชำระหรือเก็บเงินจริง')}</div></dialog>`;
}
function shareApprovalDialog(amount,reference) {
  return `<dialog id="share-approval-dialog" class="payment-dialog share-approval-dialog" aria-labelledby="share-approval-title"><div class="payment-head"><span class="chip">${t('จำลองเท่านั้น')}</span><button type="button" class="dialog-close" data-action="close-dialog" aria-label="${t('ปิดหน้าต่าง')}">✕</button></div><h2 id="share-approval-title">${t('สแกน QR เพื่อยอมรับยอด')}</h2><p>${t('สแกนด้วยโทรศัพท์เพื่อยืนยันยอด')}</p><div class="demo-qr"><img id="share-approval-qr" alt="${t('QR สำหรับยอมรับยอดจำลอง')}"/></div><div class="approval-amount-panel"><small>${t('ยอดที่ยืนยัน')}</small><strong class="payment-amount">${money(amount)}</strong></div><div class="demo-expiry-box"><span>${t('กรุณายอมรับภายใน')}<b>5 ${t('ชั่วโมง')}</b></span><strong class="demo-countdown">05 : 00 : 00</strong></div><div class="demo-reference-row"><span>${t('รหัสอ้างอิง')}</span><b>${escape(reference)}</b></div><div class="demo-only-note">${t('การยืนยันนี้เป็นการยอมรับจำนวนเงินจำลองเท่านั้น ไม่มีการชำระหรือเก็บเงินจริง')}</div></dialog>`;
}
function demoApprovalPage(success=false){
  const params=new URLSearchParams(location.search),reference=(params.get('ref')||'').slice(0,80),amount=Number(params.get('amount'));
  if(!reference||!Number.isSafeInteger(amount)||amount<0)return `<section class="demo-approval-page"><div class="demo-approval-card"><span class="chip">${t('จำลองเท่านั้น')}</span><h1>${t('QR ไม่ถูกต้อง')}</h1>${a('/explore',t('กลับหน้าหลัก'),'button primary full')}</div></section>`;
  let acceptedRecord=null;try{acceptedRecord=JSON.parse(localStorage.getItem(`harnkhong-demo-acceptance:${reference}`)||'null');}catch{/* Treat unavailable storage as not yet accepted. */}
  success=success&&acceptedRecord?.amount===amount;
  const acceptedAt=Number(acceptedRecord?.acceptedAt);const acceptedDate=success&&Number.isFinite(acceptedAt)?new Date(acceptedAt).toLocaleString(locale==='en'?'en-GB':'th-TH'):'—';
  return `<section class="demo-approval-page ${success?'is-success':''}"><article class="demo-approval-card"><span class="chip">${t('ยืนยันยอด (จำลอง)')}</span>${success?`<div class="approval-success-icon" aria-hidden="true">✓</div><h1>${t('ยอมรับยอดสำเร็จ!')}</h1><p>${t('บันทึกการยอมรับยอดจำลองเรียบร้อยแล้ว')}</p>`:`<h1>${t('ตรวจสอบยอดก่อนยอมรับ')}</h1><p>${t('โปรดตรวจสอบจำนวนเงินก่อนกดยอมรับ')}</p>`}<div class="approval-amount-panel"><small>${t('ยอดที่ยืนยัน')}</small><strong class="payment-amount">${money(amount)}</strong></div>${success?`<div class="demo-success-details"><div><span>${t('รหัสอ้างอิง')}</span><b>${escape(reference)}</b></div><div><span>${t('วันที่และเวลา')}</span><b>${escape(acceptedDate)}</b></div><div><span>${t('ช่องทาง')}</span><b>QR Demo</b></div><div><span>${t('สถานะ')}</span><b class="demo-success-status">● ${t('สำเร็จ')}</b></div></div>`:`<small>${t('รหัสอ้างอิง')}: ${escape(reference)}</small>`}<p class="demo-approval-notice">${t('การยอมรับนี้เป็นการจำลองเท่านั้น ไม่มีการชำระหรือเก็บเงินจริง')}</p>${success?a('/',`${icon('home',18)} ${t('กลับหน้าหลัก')}`,'button outline full'):`<button type="button" class="button primary full" data-action="accept-demo-amount" data-ref="${escape(reference)}" data-amount="${amount}">${t('ยอมรับยอดนี้')}</button>`}</article></section>`;
}
function leaveGroupDialog(g, currentShare) {
  return `<dialog id="leave-group-dialog" class="leave-group-dialog" aria-labelledby="leave-group-title">
    <div class="leave-modal-inner">
      <div class="leave-modal-head">
        <div class="leave-modal-badge" aria-hidden="true">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
            <polyline points="16 17 21 12 16 7"/>
            <line x1="21" y1="12" x2="9" y2="12"/>
          </svg>
        </div>
        <button type="button" class="dialog-close" data-action="close-dialog" aria-label="${t('ปิดหน้าต่าง')}">✕</button>
      </div>

      <h2 id="leave-group-title" class="leave-modal-title">${t('ยืนยันออกจากกลุ่ม')}</h2>
      <p class="leave-modal-subtitle">${t('คุณแน่ใจหรือไม่ว่าต้องการออกจากกลุ่มนี้?')}</p>

      <div class="leave-group-preview">
        <div class="leave-group-meta">
          <small>${t('กลุ่ม')}</small>
          <strong title="${escape(g.name)}">${escape(g.name)}</strong>
        </div>
        <div class="leave-group-share-box">
          <small>${t('ยอดส่วนแบ่งของคุณ')}</small>
          <strong>${money(currentShare)}</strong>
        </div>
      </div>

      <div class="leave-impact-box">
        <div class="leave-impact-title">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/>
            <line x1="12" y1="9" x2="12" y2="13"/>
            <line x1="12" y1="17" x2="12.01" y2="17"/>
          </svg>
          <span>${t('สิ่งที่ควรรู้ก่อนออกจากกลุ่ม')}</span>
        </div>
        <ul class="leave-impact-list">
          <li>${t('สมาชิกที่เหลือจะต้องยืนยันยอดใหม่ เนื่องจากยอดหารจะถูกคำนวณใหม่')}</li>
          <li>${t('คำยืนยันยอดรอบล่าสุดของคุณจะถูกยกเลิกทันที')}</li>
          <li>${t('หากออกจากกลุ่มแล้ว ต้องการกลับเข้ากลุ่มใหม่ จะต้องรอให้มีที่ว่าง')}</li>
        </ul>
      </div>

      <div class="leave-modal-actions">
        <button type="button" class="button outline" data-action="close-dialog">${t('ยกเลิก')}</button>
        <button type="button" class="button danger" data-action="confirm-leave" data-id="${g.id}">${t('ออกจากกลุ่ม')}</button>
      </div>
    </div>
  </dialog>`;
}
function transferGroupDialog(g) {
  const members=g.members.filter(userId=>userId!==state.user?.id);
  const options=members.map(userId=>`<option value="${escape(userId)}">${escape(name(userId))}</option>`).join('');
  return `<dialog id="transfer-group-dialog" class="payment-dialog" aria-labelledby="transfer-group-title"><div class="payment-head"><span class="chip">${t('โอนหัวหน้ากลุ่ม')}</span><button type="button" class="dialog-close" data-action="close-dialog" aria-label="${t('ปิดหน้าต่าง')}">✕</button></div><h2 id="transfer-group-title">${t('เลือกหัวหน้ากลุ่มคนใหม่')}</h2><p>${t('สมาชิกใหม่จะได้รับสิทธิ์จัดการกลุ่มแทนคุณ')}</p><form id="transfer-group-form" data-id="${escape(g.id)}"><label>${t('สมาชิก')}<select name="memberId" required>${options}</select></label><footer class="dialog-footer"><button type="button" class="button outline" data-action="close-dialog">${t('ยกเลิก')}</button><button type="submit" class="button primary">${t('ยืนยันโอนสิทธิ์')}</button></footer></form></dialog>`;
}
function listingCard(p){
  const groups = state.groups.filter(g => g.listingId === p.id && g.visibility === 'public' && g.status !== 'cancelled' && g.members.length < g.capacity && !g.orderId);
  const g = groups[0];
  const destination = g ? `/groups/${g.id}` : `/products/${p.id}`;
  const s = seller(p.sellerId);
  return `
    <article class="listing-card">
      <div class="card-media-wrapper">
        ${a(destination, art(p), 'art-link')}
        <div class="card-floating-badge">
          <span class="chip-kind">${escape(t(p.kind))}</span>
          <span class="chip-cat">${escape(t(p.category))}</span>
        </div>
        ${groups.length ? `<span class="chip-live-groups">${icon('users', 13)} ${t('เปิดรับ {count} กลุ่ม',{count:groups.length})}</span>` : `<span class="chip-new-group">${icon('sparkles', 13)} ${t("เปิดกลุ่มแรก")}</span>`}
      </div>
      <div class="listing-copy">
        <div class="seller-store-line">
          <span class="seller-store-dot"></span>
          ${a(`/shops/${p.sellerId}`, `<b>${escape(s.name)}</b>`)}
        </div>
        ${a(destination, `<h3 class="listing-title">${escape(p.title)}</h3>`)}
        <p class="listing-desc">${escape(p.description)}</p>
        <div class="listing-pricing-box">
          <div class="price-full">
            <small>${t("ราคารวมเต็ม")}</small>
            <span>${money(p.price)}</span>
          </div>
          <div class="price-split">
            <small>${g ? (g.members.includes(state.user?.id) ? t('ยอดปัจจุบันของคุณ') : t("ถ้าคุณเข้าร่วมตอนนี้")) : t("ประมาณเมื่อหาร 4 คน")}</small>
            <strong>${money(g ? (g.members.includes(state.user?.id) ? shares(g)[state.user.id] : Math.ceil(totalCost(g.costs,Math.min(g.capacity,g.members.length+1)) / Math.min(g.capacity,g.members.length+1))) : Math.ceil(p.price / 4))}<small> ${t("/คน")}</small></strong>
          </div>
        </div>
        ${g ? `
          <div class="listing-group-preview">
            ${icon('users', 14)}
            <span>${t('กลุ่ม “{name}” ว่างอีก {count} ที่',{name:escape(g.name),count:'<b>'+(g.capacity-g.members.length)+'</b>'})}</span>
          </div>
        ` : `
          <div class="listing-group-preview empty-preview">
            ${icon('sparkles', 14)}
            <span>${t("ยังไม่มีกลุ่ม แตะเพื่อเปิดกลุ่มหารคนแรก")}</span>
          </div>
        `}
        <div class="listing-card-actions">
          ${a(destination, `${g?t("ดูกลุ่มและเข้าร่วม"):t("ดูรายละเอียดและกลุ่ม")} ${icon('arrow', 16)}`, 'button outline full flow-button')}
        </div>
      </div>
    </article>
  `;
}

function groupCard(g){
  const p=listing(g.listingId);
  if(!p)return '';
  const category=g.category||p.category;
  const categories=g.categories?.length?g.categories:[category];
  const remaining=Math.max(0,g.capacity-g.members.length);
  const open=remaining>0&&!g.orderId&&g.status!=='cancelled';
  const isMember=g.members.includes(state.user?.id);
  const nowCount=g.members.length+(open&&!isMember?1:0);
  const now=isMember?shares(g)[state.user.id]:Math.ceil(totalCost(g.costs,nowCount)/nowCount);
  const full=Math.ceil(totalCost(g.costs,g.capacity)/g.capacity);
  const destination=`/groups/${g.id}`;
  return `<article class="opportunity-card">
    <div class="opportunity-media">${a(destination,isLocalImage(g.images?.[0])?`<img src="${g.images[0]}" alt="${escape(g.name)}" loading="lazy"/>`:art({...p,category}),'opportunity-art-link')}</div>
    <div class="opportunity-content">
      <div class="opportunity-topline"><span class="opportunity-category">${categories.slice(0,2).map(item=>escape(t(item))).join(' · ')}${categories.length>2?` +${categories.length-2}`:''}</span><span class="opportunity-spots ${open?'':'is-closed'}">${open?t('ว่าง {count} ที่',{count:remaining}):t('ปิดรับสมาชิก')}</span></div>
      ${a(destination,`<h3>${escape(g.name)}</h3>`,'opportunity-title')}
      <p class="opportunity-group-name">${t('หมวดหมู่')}: ${escape(t(category))}</p>
      <div class="opportunity-price"><div><small>${isMember?t('ยอดปัจจุบันของคุณ'):open?t('ถ้าคุณเข้าร่วมตอนนี้'):t('ประมาณต่อคนปัจจุบัน')}</small><strong>${money(now)} <span>${t('/คน')}</span></strong></div><div><small>${t('เมื่อครบ {count} คน',{count:g.capacity})}</small><b>${money(full)} ${t('/คน')}</b></div></div>
      <div class="opportunity-members"><span>${icon('users',17)} ${t('สมาชิก {count} / {capacity} คน',{count:g.members.length,capacity:g.capacity})}</span><div class="opportunity-track" role="progressbar" aria-label="${t('ความคืบหน้า')}" aria-valuemin="0" aria-valuemax="${g.capacity}" aria-valuenow="${g.members.length}"><span style="width:${g.members.length/g.capacity*100}%"></span></div></div>
      <p class="opportunity-leader">${icon('user',16)} ${t('หัวหน้ากลุ่ม')}: ${escape(name(g.ownerId).replace(/\s*\(หัวหน้ากลุ่ม\)$/,''))}</p>
      <p class="opportunity-terms">${icon('check',16)} ${t('ยืนยันยอดก่อนสั่งซื้อ')}</p>
      <div class="opportunity-actions">${a(destination,open&&!isMember?t('ดูรายละเอียดกลุ่ม'):t('ดูกลุ่ม'),`button opportunity-view ${open&&!isMember?'primary':'outline'}`)}${isMember?a(`/groups/${g.id}/chat`,`${icon('chat',17)} ${t('แชทกลุ่ม')}`,'opportunity-chat'):''}${(open||isMember||g.ownerId===state.user?.id)?`<button type="button" class="opportunity-share" data-action="copy-link" data-id="${escape(g.id)}" aria-label="${t('คัดลอกลิงก์เชิญ')}">${icon('link',17)} ${t('ชวนเพื่อน')}</button>`:''}</div>
    </div>
  </article>`;
}

const CATEGORIES_LIST = [
  { name: 'ทั้งหมด', symbol: '✳' },
  { name: 'แอปพลิเคชันและเว็บไซต์', symbol: '🌐' },
  { name: 'เสื้อผ้าและแฟชั่น', symbol: '👗' },
  { name: 'เครื่องสำอางและความงาม', symbol: '💄' },
  { name: 'อาหารและเครื่องดื่ม', symbol: '🍱' },
  { name: 'ของใช้ทั่วไป', symbol: '🧼' },
  { name: 'สินค้าดิจิทัล', symbol: '💾' },
  { name: 'อุปกรณ์อิเล็กทรอนิกส์และไอที', symbol: '💻' },
  { name: 'สินค้าขายส่ง', symbol: '📦' },
  { name: 'บริการทั่วไป', symbol: '🛠️' },
  { name: 'อื่น ๆ (ระบุชื่อเอง)', symbol: '✨' }
];
const CATEGORY_NAMES = CATEGORIES_LIST.map(c => c.name);
const CREATE_CATEGORY_NAMES = CATEGORY_NAMES.filter(name => name !== 'ทั้งหมด');
const CATEGORY_PHOTOS = {
  'ทั้งหมด':'all',
  'แอปพลิเคชันและเว็บไซต์':'apps',
  'เสื้อผ้าและแฟชั่น':'fashion',
  'เครื่องสำอางและความงาม':'beauty',
  'อาหารและเครื่องดื่ม':'food',
  'ของใช้ทั่วไป':'home',
  'สินค้าดิจิทัล':'digital',
  'อุปกรณ์อิเล็กทรอนิกส์และไอที':'electronics',
  'สินค้าขายส่ง':'wholesale',
  'บริการทั่วไป':'services',
  'อื่น ๆ (ระบุชื่อเอง)':'other'
};

function home(){
  const activeGroups = state.groups.filter(g => g.visibility === 'public' && g.status !== 'cancelled' && !g.orderId && g.members.length < g.capacity);
  const categoriesList = CATEGORIES_LIST.filter(c => [
    'แอปพลิเคชันและเว็บไซต์',
    'เสื้อผ้าและแฟชั่น',
    'เครื่องสำอางและความงาม',
    'อาหารและเครื่องดื่ม',
    'อุปกรณ์อิเล็กทรอนิกส์และไอที',
    'สินค้าขายส่ง',
    'บริการทั่วไป'
  ].includes(c.name));
  const headlines=[
    t('ของดี ๆ ให้คุ้มกว่าเดิม!'),
    t('แพ็กเกจ แชร์ความคุ้ม!'),
    t('ง่าย จ่ายชัด ทุกยอดโปร่งใส!')
  ];
  const activeHeadlineIndex=heroHeadlineIndex%headlines.length;
  const currentHeadline=headlines[activeHeadlineIndex];
  const widestHeadline=headlines.reduce((longest,phrase)=>phrase.length>longest.length?phrase:longest,headlines[0]);

  return `
    <section class="hero home-hero">
      <div class="hero-text">
        <h1><span class="sr-only" data-headline-accessible>${t('หาร')} ${currentHeadline}</span><span class="dynamic-headline headline-loop" aria-hidden="true" data-text-loop="${escape(JSON.stringify(headlines))}" data-static-text="${t('หาร')}"><span class="hero-headline-static">${t('หาร')}</span><span class="headline-rotator-slot"><span class="headline-rotator-measure">${widestHeadline}</span><span class="headline-rotator-window"><span class="headline-rotator-highlight"></span><span class="headline-rotator-current">${currentHeadline}</span><span class="headline-rotator-cursor"></span></span></span></span></h1>
        <p>${t("ชวนเพื่อนเปิดกลุ่มซื้อสินค้าราคาส่ง ของใช้จำเป็น หรือแพ็กเกจสุดคุ้ม คำนวณเศษสตางค์เป๊ะ เห็นยอดโปร่งใสก่อนตกลงสั่งซื้อจริง")}</p>

        <form class="hero-search" id="search-form">
          <span>${icon('search', 20)}</span>
          <input name="q" placeholder="${t("ค้นหาแอป, เสื้อผ้า, เครื่องสำอาง, อาหาร...")}" aria-label="${t("ค้นหาสินค้าหรือบริการ")}"/>
          <button type="submit">${t("ค้นหา")}</button>
        </form>

        <div class="hero-quick-tags">
          <span>${t("ค้นหายอดนิยม:")}</span>
          <button type="button" class="hero-tag" data-action="quick-search" data-category="แอปพลิเคชันและเว็บไซต์" data-query="แอปพลิเคชันและเว็บไซต์">${t("🌐 แอปพลิเคชันและเว็บไซต์")}</button>
          <button type="button" class="hero-tag" data-action="quick-search" data-category="เสื้อผ้าและแฟชั่น" data-query="เสื้อผ้าและแฟชั่น">${t("👗 เสื้อผ้าและแฟชั่น")}</button>
          <button type="button" class="hero-tag" data-action="quick-search" data-category="เครื่องสำอางและความงาม" data-query="เครื่องสำอางและความงาม">${t("💄 เครื่องสำอางและความงาม")}</button>
          <button type="button" class="hero-tag" data-action="quick-search" data-category="อาหารและเครื่องดื่ม" data-query="อาหารและเครื่องดื่ม">${t("🍱 อาหารและเครื่องดื่ม")}</button>
        </div>

        <div class="hero-points">
          <span>${icon('shield', 16)} ${t("ตรวจสอบยอดก่อนยืนยัน")}</span>
          <span>${icon('calc', 16)} ${t("คำนวณเศษสตางค์เป๊ะ")}</span>
          <span>${icon('users', 16)} ${t("มีกลุ่มพร้อมเข้าร่วม")}</span>
        </div>
      </div>

      <div class="hero-visual">
        <div class="hero-halo"></div>
        <img src="/images/harnkhong-friends.png" alt="${t("เพื่อนสามคนกำลังแบ่งซื้อกระดาษ กล่องข้าว และถุงผ้า")}"/>
        <div class="hero-mini">
          <span class="live-dot"></span>
          <div>
            <b>${t("กลุ่มกำลังเปิดรับ")}</b>
            <small>${t('{count} กลุ่มพร้อมให้ร่วมประหยัด',{count:activeGroups.length})}</small>
          </div>
        </div>
      </div>
    </section>

    <section class="section home-open-groups">
      <div class="section-header"><div><h2>${t('กลุ่มที่เข้าร่วมได้ตอนนี้')}</h2><p>${t('เห็นยอดหลังคุณเข้าร่วม จำนวนที่ว่าง และเงื่อนไขก่อนตัดสินใจ')}</p></div>${a('/explore',`${t('ดูกลุ่มทั้งหมด')} ${icon('arrow',16)}`,'text-link')}</div>
      ${activeGroups.length?`<div class="group-grid home-open-groups-grid">${activeGroups.slice(0,3).map(groupCard).join('')}</div>`:`<div class="empty"><h3>${t('ยังไม่มีกลุ่มที่เปิดรับ')}</h3>${a('/explore',t('สำรวจรายการ'),'button outline')}</div>`}
    </section>

    <div class="flow-strip">
      <div class="flow-card">
        <span class="flow-badge">1</span>
        <div class="flow-card-copy">
          <strong>${t('เลือกกลุ่มที่เปิดรับ')}</strong>
          <p>${t('ดูสมาชิก ที่ว่าง และยอดที่ต้องจ่ายของแต่ละกลุ่ม')}</p>
        </div>
      </div>
      <div class="flow-card">
        <span class="flow-badge">2</span>
        <div class="flow-card-copy">
          <strong>${t("รวมกลุ่มแชร์ค่าใช้จ่าย")}</strong>
          <p>${t("เข้าร่วมกลุ่มที่เปิดรับ หรือตั้งกลุ่มใหม่แล้วชวนเพื่อนง่ายๆ")}</p>
        </div>
      </div>
      <div class="flow-card">
        <span class="flow-badge">3</span>
        <div class="flow-card-copy">
          <strong>${t("ยืนยันยอดโปร่งใส")}</strong>
          <p>${t("ตรวจสอบส่วนแบ่งและค่าส่งชัดเจน สมาชิกทุกคนกดยืนยันก่อนสั่ง")}</p>
        </div>
      </div>
    </div>

    <section class="section category-section">
      <div class="category-panel">
        <div class="section-header">
          <div>
            <h2>${t("อยากหารอะไรวันนี้?")}</h2>
            <p>${t("เลือกหมวดหมู่ที่ใช่ แล้วดูว่ามีกลุ่มไหนกำลังเปิดรับอยู่")}</p>
          </div>
        </div>
        <div class="categories category-bento">
          ${categoriesList.map(c => {
            const count = c.name === 'ทั้งหมด' ? activeGroups.length : activeGroups.filter(g => {
              const groupCategories=g.categories?.length?g.categories:[g.category||listing(g.listingId)?.category];
              return c.name==='อื่น ๆ (ระบุชื่อเอง)'?groupCategories.some(groupCategory=>!CREATE_CATEGORY_NAMES.includes(groupCategory)):groupCategories.includes(c.name);
            }).length;
            const photo=CATEGORY_PHOTOS[c.name]||'other';
            return a(`/explore?category=${encodeURIComponent(c.name)}`, `
              <img class="category-photo" src="/images/categories/${photo}.jpg" alt="" loading="lazy" decoding="async" aria-hidden="true"/>
              <span class="category-symbol" aria-hidden="true">${c.symbol}</span>
              <span class="category-copy"><strong>${t(c.name)}</strong><span class="category-count">${t('{count} กลุ่ม',{count})}</span></span>
            `, `category category--${photo}`);
          }).join('')}
        </div>
      </div>
    </section>

    <section class="features-section">
      <div class="features-header">
        <span class="features-kicker">${t("ทำไมต้องหารของ")}</span>
        <h2>${t("ทำไมต้องหารของด้วย HarnKhong?")}</h2>
        <p>${t("หมดปัญหาการทวงเงิน คิดเลขไม่ลงตัว หรือไม่แน่ใจเรื่องค่าจัดส่ง")}</p>
      </div>
      <div class="features-grid">
        <div class="feature-card">
          <div class="feature-icon-box">${icon('calc', 26)}</div>
          <h3>${t("คำนวณแฟร์ถึงเศษสตางค์")}</h3>
          <p>${t("ระบบกระจายเศษสตางค์และค่าจัดส่งตามลำดับสมาชิกอย่างเป็นธรรม ตรวจสอบได้ทุกขั้นตอน")}</p>
        </div>
        <div class="feature-card">
          <div class="feature-icon-box">${icon('shield', 26)}</div>
          <h3>${t("อนุมัติรอบยอดก่อนสั่งจริง")}</h3>
          <p>${t("หากมีการเปลี่ยนแปลงค่าส่งหรือจำนวนคน ทุกคนในกลุ่มต้องกดยืนยันยอดรอบล่าสุดก่อนสั่งซื้อเดโม")}</p>
        </div>
        <div class="feature-card">
          <div class="feature-icon-box">${icon('trending', 26)}</div>
          <h3>${t("เห็นยอดก่อนตัดสินใจ")}</h3>
          <p>${t("ซื้อของในราคาส่งหรือแพ็กคุ้มค่าร่วมกับผู้อื่น โดยไม่ต้องซื้อมาเก็บไว้คนเดียวเกินความจำเป็น")}</p>
        </div>
      </div>
    </section>

    <section class="cta-section">
      <div class="cta-banner">
        <div class="cta-copy">
          <h2>${t("พร้อมเริ่มหารของชิ้นแรกแล้วหรือยัง?")}</h2>
          <p>${t("เปิดกลุ่มของคุณใน 1 นาที ชวนเพื่อนมาช่วยกันประหยัด หรือเลือกเข้าร่วมกลุ่มที่กำลังเปิดรับอยู่ตอนนี้")}</p>
        </div>
        <div class="cta-actions">
          ${a('/groups/create', `${icon('plus', 18)} ${t("สร้างกลุ่มใหม่")}`, 'button primary')}
          ${a('/explore', t("สำรวจรายการ"), 'button outline')}
        </div>
      </div>
    </section>
  `;
}
function explore(){
  const params=new URLSearchParams(location.search),q=(params.get('q')||'').trim(),category=params.get('category')||'ทั้งหมด',requestedPage=Math.max(1,Number.parseInt(params.get('page')||'1',10)||1);
  const matches=g=>{const p=listing(g.listingId),groupCategories=g.categories?.length?g.categories:[g.category||p?.category||''],isOther=category==='อื่น ๆ (ระบุชื่อเอง)'&&groupCategories.some(groupCategory=>!CREATE_CATEGORY_NAMES.includes(groupCategory));return (category==='ทั้งหมด'||groupCategories.includes(category)||isOther)&&(`${g.name} ${groupCategories.join(' ')}`).toLowerCase().includes(q.toLowerCase());};
  const openGroups=state.groups.filter(g=>g.visibility==='public'&&g.status!=='cancelled'&&!g.orderId&&g.members.length<g.capacity&&matches(g));
  const pageSize=6,pageCount=Math.ceil(openGroups.length/pageSize),page=Math.min(requestedPage,Math.max(1,pageCount)),pageGroups=openGroups.slice((page-1)*pageSize,page*pageSize);
  const pageHref=nextPage=>{const next=new URLSearchParams();if(q)next.set('q',q);if(category!=='ทั้งหมด')next.set('category',category);if(nextPage>1)next.set('page',String(nextPage));const query=next.toString();return `/explore${query?`?${query}`:''}`;};
  const pageItems=pageCount<=5?Array.from({length:pageCount},(_,index)=>index+1):[1,...new Set([page-1,page,page+1].filter(number=>number>1&&number<pageCount)),pageCount].sort((a,b)=>a-b);
  const pagination=pageCount>1?`<nav class="pagination" aria-label="${t('การแบ่งหน้า')}"><button type="button" class="pagination-control" data-page="${page-1}" ${page===1?'disabled':''}>${t('ก่อนหน้า')}</button>${pageItems.map((number,index)=>`${index&&number-pageItems[index-1]>1?'<span class="pagination-ellipsis" aria-hidden="true">…</span>':''}${a(pageHref(number),String(number),`pagination-number${number===page?' active':''}`)}`).join('')}<button type="button" class="pagination-control" data-page="${page+1}" ${page===pageCount?'disabled':''}>${t('ถัดไป')}</button></nav>`:'';
  return `<div class="explore-page">
    ${title(t('เข้ากลุ่มที่ใช่ จ่ายในราคาที่ชัดเจน'),t('ดูราคาหลังคุณเข้าร่วม จำนวนที่ว่าง และเงื่อนไขก่อนตัดสินใจ'))}
    <form class="search-bar" id="search-form"><span>${icon('search')}</span><input type="hidden" name="category" value="${escape(category)}"/><input name="q" value="${escape(q)}" placeholder="${t('ค้นหาสินค้าหรือชื่อกลุ่ม')}" aria-label="${t('ค้นหา')}"/><button type="submit">${t('ค้นหากลุ่ม')}</button></form>
    <div class="filter-carousel"><button type="button" class="filter-scroll-button filter-scroll-prev" data-action="scroll-filter" data-direction="prev" aria-label="${t('เลื่อนหมวดหมู่ไปซ้าย')}" hidden><span aria-hidden="true">‹</span></button><nav class="filter-row" aria-label="${t('หมวดหมู่')}">${CATEGORY_NAMES.map(x=>a('/explore?category='+encodeURIComponent(x)+(q?'&q='+encodeURIComponent(q):''),t(x),'filter '+(category===x?'active':''))).join('')}</nav><button type="button" class="filter-scroll-button filter-scroll-next" data-action="scroll-filter" data-direction="next" aria-label="${t('เลื่อนหมวดหมู่ไปขวา')}" hidden><span aria-hidden="true">›</span></button></div>
    <section aria-labelledby="open-groups-heading"><div class="section-header"><div><h2 id="open-groups-heading">${t('กลุ่มที่เข้าร่วมได้')} <small>${t('{count} กลุ่ม',{count:openGroups.length})}</small></h2><p>${t('ยอดเป็นประมาณการก่อนเข้าร่วม และจะคำนวณใหม่เมื่อจำนวนสมาชิกเปลี่ยน')}</p></div></div>
      ${openGroups.length?`<div class="group-grid">${pageGroups.map(groupCard).join('')}</div>${pagination}`:`<div class="empty"><h3>${t('ยังไม่มีกลุ่มที่เปิดรับ')}</h3><p>${t('ลองค้นหาชื่อกลุ่มหรือหมวดอื่น')}</p>${a('/explore',t('ดูทั้งหมด'),'button outline')}</div>`}
    </section>
  </div>`;
}
function legacyProductRoute(id) {
  if(!listing(id))return notFound();
  const groups=state.groups.filter(g=>g.listingId===id&&g.status!=='cancelled'&&(g.visibility==='public'||g.members.includes(state.user?.id)));
  const target=groups.find(g=>!g.orderId&&g.members.length<g.capacity)||groups[0];
  if(target){history.replaceState({},'',`/groups/${target.id}`);return groupPage(target.id);}
  return `<div class="empty"><h1>${t('ยังไม่มีกลุ่มสำหรับรายการนี้')}</h1><p>${t('เลือกกลุ่มที่เปิดรับอยู่จากหน้าสำรวจได้เลย')}</p>${a('/explore',t('สำรวจกลุ่ม'),'button primary')}</div>`;
}
function groupPage(id) {
  const g = group(id);
  if (!g) {
    if(supabaseConfigured&&new URLSearchParams(location.search).has('invite')){
      if(state.user)return `<div class="empty"><h1>${t('คำเชิญไม่ถูกต้องหรือหมดอายุ')}</h1>${a('/explore',t('สำรวจกลุ่ม'),'button outline')}</div>`;
      sessionStorage.setItem('harn-return',location.pathname+location.search);
      return authRequiredView(t('คำเชิญเข้าร่วมกลุ่ม'),t('เข้าสู่ระบบเพื่อดูรายละเอียดและเข้าร่วมกลุ่มจากลิงก์เชิญ'));
    }
    return notFound();
  }
  const p = listing(g.listingId);
  if (!p) return notFound();
  const groupCategory=g.category||p.category;
  const groupCategories=g.categories?.length?g.categories:[groupCategory];
  const costs = costBreakdown(g.costs,g.members.length);
  const sum = costs.total;
  const alloc = shares(g);
  const me = state.user?.id;
  const isMember = g.members.includes(me);
  const isOwner = g.ownerId === me;
  const locked = !!g.orderId;
  const full = g.members.length === g.capacity;
  const approved = g.approvals[me] === g.revision;
  const remaining = g.capacity - g.members.length;
  const estimateCount=g.members.length+(isMember||full?0:1);
  const estimate = Math.ceil(totalCost(g.costs,estimateCount) / estimateCount);
  const fullEstimate = Math.ceil(totalCost(g.costs,g.capacity) / g.capacity);
  const status = locked ? t('ปิดรับสมาชิก') : full ? (allApproved(g) ? (supabaseConfigured?t('ยอดกลุ่มพร้อมแล้ว'):t('พร้อมสรุปคำสั่งซื้อ')) : t('รอยืนยันยอด')) : t('กำลังเปิดรับสมาชิก');
  const actions = `
    ${!isMember && !full && !locked ? a(`/groups/${id}/join`, `<span>${t('เข้าร่วมกลุ่ม')}</span><span class="btn-arrow">${icon('arrow', 18)}</span>`, 'button primary full summary-action-btn') : ''}
    ${isMember && !approved && !locked ? `<button class="button primary full summary-action-btn" data-action="approve" data-id="${id}" data-revision="${g.revision}"><span>${t('ยืนยันยอด {amount}', {amount: money(alloc[me])})}</span><span class="btn-arrow">${icon('arrow', 18)}</span></button>` : ''}
    ${isMember && approved ? `<div class="success-line">${icon('check', 18)} ${t('คุณยืนยันยอดรอบนี้แล้ว')}</div>` : ''}
    ${isMember?a(`/groups/${id}/chat`, `<span class="summary-btn-left">${icon('chat', 19)} <span>${t('แชทกลุ่ม')}</span></span><span class="btn-arrow">${icon('arrow', 18)}</span>`, 'button outline full summary-action-btn'):''}
    ${isMember && !isOwner && !locked ? `<button class="button danger-soft full summary-action-btn" data-action="leave" data-id="${id}"><span class="summary-btn-left">${icon('back', 19)} <span>${t('ออกจากกลุ่ม')}</span></span><span class="btn-arrow">${icon('arrow', 18)}</span></button>` : ''}
    ${isOwner && !locked ? `<button class="button outline full summary-action-btn" data-action="edit-costs" data-id="${id}"><span class="summary-btn-left">${icon('edit', 19)} <span>${t('แก้ไขค่าส่งต่อคน')}</span></span><span class="btn-arrow">${icon('arrow', 18)}</span></button><button class="button danger-soft full summary-action-btn" data-action="delete-group" data-id="${id}"><span class="summary-btn-left">${icon('trash', 19)} <span>${t('ลบห้อง')}</span></span><span class="btn-arrow">${icon('arrow', 18)}</span></button>` : ''}
    ${isOwner&&!locked ? `<button class="button outline full summary-action-btn" data-action="copy-link" data-id="${id}"><span class="summary-btn-left">${icon('link', 18)} <span>${t('คัดลอกลิงก์เชิญ')}</span></span><span class="btn-arrow">${icon('arrow', 18)}</span></button>` : ''}
    ${locked ? `<div class="summary-info-box"><span class="info-icon">${icon('info', 22)}</span><span class="info-divider"></span><span>${t('กลุ่มถูกล็อกตามยอดคำสั่งซื้อเดโมแล้ว')}</span></div>` : ''}
    ${isMember&&!supabaseConfigured ? a(`/orders/${id}`, `<span class="summary-btn-left">${icon('calc', 19)} <span>${t('ดูสรุปคำสั่งซื้อเดโม')}</span></span><span class="btn-arrow">${icon('arrow', 18)}</span>`, 'button subtle full summary-action-btn') : ''}
    ${isMember&&supabaseConfigured ? `<div class="summary-info-box"><span class="info-icon">${icon('info', 22)}</span><span class="info-divider"></span><span>${t('คำสั่งซื้อของกลุ่มนี้ยังไม่เชื่อมระบบร่วมกัน จึงยังสร้างคำสั่งซื้อหรือแจ้งชำระไม่ได้')}</span></div>` : ''}
  `;
  return `<div class="group-page">
    <nav class="breadcrumb product-breadcrumb" aria-label="${t('เส้นทางนำทาง')}">
      ${a('/explore', t('สำรวจ'))}<span aria-hidden="true">/</span>
      <span aria-current="page">${escape(g.name)}</span>
    </nav>
    <div class="group-detail">
      <main class="group-detail-main">
        <section class="group-identity-card" aria-labelledby="group-title">
          <div class="group-heading-line"><div><h1 id="group-title">${escape(g.name)}</h1><p>${t('หมวดหมู่')}: ${groupCategories.map(category=>escape(t(category))).join(' · ')}</p></div><span class="group-state ${full ? 'is-full' : 'is-open'}">${status}</span></div>
          <div class="group-product-strip">
            <div class="group-product-art" role="img" aria-label="${escape(t(groupCategory))}">${art({...p,category:groupCategory})}</div>
            <div class="group-product-copy"><span>${t('สินค้าในกลุ่ม')}</span><strong>${escape(g.name)}</strong><small>${escape(t(groupCategory))}</small></div>
            <div class="group-product-price"><span>${t('ราคาสินค้า')}</span><strong>${money(g.costs.product)}</strong></div>
          </div>
          <div class="group-identity-footer"><span class="chip">${g.visibility === 'link' ? t('เฉพาะผู้มีลิงก์') : t('กลุ่มสาธารณะ')}</span>${g.images?.length ? gallery(g.images) : ''}</div>
        </section>
        <section class="members-card group-members-card" aria-labelledby="members-heading">
          <div class="group-section-head"><div><h2 id="members-heading">${t('สมาชิก {count} / {capacity} คน', {count: g.members.length, capacity: g.capacity})}</h2><p>${status}</p></div><strong>${remaining ? t('ว่าง {count} ที่', {count: remaining}) : t('สมาชิกครบแล้ว')}</strong></div>
          <div class="progress" role="progressbar" aria-label="${t('ความคืบหน้า')}" aria-valuemin="0" aria-valuemax="${g.capacity}" aria-valuenow="${g.members.length}"><span style="width:${g.members.length / g.capacity * 100}%"></span></div>
          <div class="group-member-list">${g.members.map(memberId => `<div class="group-member-row"><span class="avatar small">${escape(name(memberId).slice(0, 1))}</span><div class="group-member-name"><strong>${escape(name(memberId))}</strong>${memberId === g.ownerId && !name(memberId).includes('หัวหน้ากลุ่ม') ? `<small>${t('หัวหน้ากลุ่ม')}</small>` : ''}</div><span class="member-approval ${g.approvals[memberId] === g.revision ? 'approved' : ''}">${g.approvals[memberId] === g.revision ? t('ยืนยันแล้ว') : t('รอยืนยัน')}</span><b>${money(alloc[memberId])}</b>${isOwner&&!locked&&memberId!==me?`<button class="button danger-soft" data-action="kick-member" data-id="${id}" data-member="${memberId}">${t('เตะออก')}</button>`:''}</div>`).join('')}
            ${remaining ? `<div class="group-open-row"><span class="avatar small">${icon('plus', 18)}</span><div><strong>${t('ยังว่างอีก {count} ที่', {count: remaining})}</strong><small>${t('รอสมาชิกเข้าร่วม')}</small></div>${!isMember && !locked ? a(`/groups/${id}/join`, t('เข้าร่วมกลุ่ม'), 'button outline') : ''}</div>` : ''}
          </div>
        </section>
        <section class="cost-card group-cost-card" aria-labelledby="cost-heading"><h2 id="cost-heading">${t('ค่าใช้จ่ายรอบที่ {revision}', {revision: g.revision})}</h2><div><span>${t('ราคาสินค้า')}</span><b>${money(costs.product)}</b></div><div><span>${costs.deliveryPerMember===null?t('ค่าส่ง'):t('ค่าส่ง {amount} × {count} คน',{amount:money(costs.deliveryPerMember),count:g.members.length})}</span><b>${money(costs.delivery)}</b></div><div><span>${costs.deliveryPerMember===null?t('ค่าบริการ'):t('ค่าธรรมเนียมแอป 2%')}</span><b>${money(costs.service)}</b></div><div class="total"><span>${t('รวมทั้งหมด')}</span><b>${money(sum)}</b></div><p>${t('หารตามจำนวนสมาชิกปัจจุบัน เศษสตางค์จัดสรรตามลำดับที่เข้ากลุ่ม')}</p></section>
        <details class="group-history"><summary>${t('ประวัติการเปลี่ยนยอด')}</summary>${g.history.slice().reverse().map(h => `<p>${t('รอบ {revision}', {revision: h.revision})} · ${escape(t(h.reason))}</p>`).join('')}</details>
      </main>
      <aside class="group-detail-aside"><div class="summary-card sticky"><small>${isMember ? t('ยอดที่คุณต้องยืนยัน') : full || locked ? t('ประมาณต่อคนปัจจุบัน') : t('ยอดประมาณเมื่อเข้าร่วม')}</small><strong>${money(isMember ? alloc[me] : estimate)}</strong>${!full?`<div class="summary-future-price"><span>${t('เมื่อครบ {count} คน',{count:g.capacity})}</span><b>${money(fullEstimate)} <small>${t('/คน')}</small></b></div>`:''}<p>${isMember ? t('ยอดรอบที่ {revision}', {revision: g.revision}) + (approved ? t(' · คุณยืนยันแล้ว') : t(' · กรุณาตรวจสอบก่อนยืนยัน')) : full || locked ? t('กลุ่มนี้ยังไม่เปิดรับสมาชิกใหม่') : t('ยอดจะคำนวณใหม่เมื่อคุณเข้าร่วม และสมาชิกทุกคนต้องยืนยันอีกครั้ง')}</p>${actions}${!full ? `<p class="warning summary-warning"><span class="warning-icon">${icon('alert-circle', 20)}</span><span>${t('ยังสั่งซื้อไม่ได้จนกว่าสมาชิกจะครบและยืนยันยอดทุกคน')}</span></p>` : !allApproved(g) ? `<p class="warning summary-warning"><span class="warning-icon">${icon('alert-circle', 20)}</span><span>${t('รอสมาชิกทุกคนยืนยันยอดรอบล่าสุด')}</span></p>` : ''}</div>
      <section class="group-product-details" aria-labelledby="product-details-heading"><h2 id="product-details-heading">${t('รายละเอียดสินค้า')}</h2><p>${escape(g.name)}</p><p>${groupCategories.map(category=>escape(t(category))).join(' · ')}</p><small>${supabaseConfigured?t('แชตกับผู้ขายยังเป็นเดโมในเครื่องนี้'):t('ยอดที่เห็นเป็นตัวอย่างจากข้อมูลจำลอง กรุณาตกลงรายละเอียดกับผู้ขายก่อนสั่งซื้อจริง')}</small></section>
      </aside>
    </div>
  </div>`;
}
function joinPage(id){
  const g=group(id);if(!g){
    if(supabaseConfigured&&new URLSearchParams(location.search).has('invite')){
      if(!state.user){sessionStorage.setItem('harn-return',location.pathname+location.search);return authRequiredView(t('ยืนยันการเข้าร่วมกลุ่ม'),t('เข้าสู่ระบบเพื่อดูรายละเอียดและเข้าร่วมกลุ่มจากลิงก์เชิญ'));}
      return `<div class="empty"><h1>${t('คำเชิญไม่ถูกต้องหรือหมดอายุ')}</h1>${a('/explore',t('สำรวจกลุ่ม'),'button outline')}</div>`;
    }
    return notFound();
  }
  if(!requireAuth(`/groups/${id}/join`))return authRequiredView(t('ยืนยันการเข้าร่วมกลุ่ม'),t('เข้าสู่ระบบก่อนเพื่อเข้าร่วมกลุ่มและยืนยันยอด'));
  if(g.members.includes(state.user.id))return `<div class="empty"><h1>${t('คุณอยู่ในกลุ่มนี้แล้ว')}</h1>${a(`/groups/${id}`,t('ดูกลุ่ม'),'button primary')}</div>`;
  if(g.members.length>=g.capacity)return `<div class="empty"><h1>${t('กลุ่มนี้เต็มแล้ว')}</h1>${a(`/groups/${id}`,t('ดูกลุ่ม'),'button secondary')}</div>`;
  const count=g.members.length+1,costs=costBreakdown(g.costs,count),estimate=Math.ceil(costs.total/count);
  return `${title(t('ยืนยันการเข้าร่วม'),escape(g.name))}<div class="narrow"><div class="cost-card"><h2>${escape(g.name)}</h2><div><span>${t('ราคาสินค้า')}</span><b>${money(costs.product)}</b></div><div><span>${costs.deliveryPerMember===null?t('ค่าส่ง'):t('ค่าส่ง {amount} × {count} คน',{amount:money(costs.deliveryPerMember),count})}</span><b>${money(costs.delivery)}</b></div><div><span>${costs.deliveryPerMember===null?t('ค่าบริการ'):t('ค่าธรรมเนียมแอป 2%')}</span><b>${money(costs.service)}</b></div><div class="total"><span>${t('ยอดประมาณของคุณ')}</span><b>${money(estimate)}</b></div></div><div class="info-box">${t('เมื่อเข้าร่วม ระบบจะคำนวณยอดใหม่และให้สมาชิกทุกคน รวมถึงคุณ ยืนยันยอดรอบใหม่อีกครั้ง ยังไม่มีการเก็บเงินจริง')}</div><button class="button primary full" data-action="join" data-id="${id}">${t('ยืนยันเข้าร่วมกลุ่ม')}</button>${a(`/groups/${id}`,t('กลับไปดูกลุ่ม'),'button outline full')}</div>`;
}
function createPage(){
  if(!requireAuth(location.pathname+location.search))return authRequiredView(t('สร้างกลุ่มหารใหม่'),t('กำหนดจำนวนคนและค่าใช้จ่ายให้ชัดก่อนชวนเพื่อน'));
  const params=new URLSearchParams(location.search),requested=params.get('product'),allListings=listings(),requestedListing=allListings.find(item=>item.id===requested);
  const selected=requestedListing?.id||allListings[0]?.id,initialCategory=requestedListing?.category||CREATE_CATEGORY_NAMES[0];
  if(!selectedCreateCategories.length)selectedCreateCategories=[initialCategory];
  const selectedCategory=selectedCreateCategories[0],selectedListing=allListings.find(item=>item.category===selectedCategory)||listing(selected);
  const categoryTags=selectedCreateCategories.map(category=>`<button type="button" class="selected-category" data-action="remove-category" data-category="${escape(category)}" aria-label="${t('นำหมวดหมู่ออก {category}',{category:t(category)})}">${escape(t(category))}<span aria-hidden="true">×</span></button>`).join('');
  return `${title(t('สร้างกลุ่มหารใหม่'),t('กำหนดจำนวนคนและค่าใช้จ่ายให้ชัดก่อนชวนเพื่อน'))}<form class="form-panel" id="create-form">
    <input type="hidden" name="requestId" value="${crypto.randomUUID()}"/><input type="hidden" name="listingId" value="${selectedListing?.id||selected||''}"/><input type="hidden" name="category" value="${escape(selectedCategory)}"/>
    <section class="image-editor"><h2>${t('รูปกลุ่ม')}</h2><p>${t('เพิ่มได้สูงสุด 4 รูป · JPG, PNG, WebP ไม่เกิน 5 MB ต่อรูป · รูปจะบันทึกพร้อมกลุ่ม')}</p><label class="image-upload">${icon('plus',20)} ${t('เพิ่มรูป')}<input id="group-images" type="file" accept="image/jpeg,image/png,image/webp" multiple/></label><div id="image-draft">${gallery(groupImages,true)}</div><p id="image-upload-status" role="status"></p></section>
    <fieldset class="category-picker"><legend>${t('เลือกหมวดหมู่')}</legend><div class="selected-categories" id="selected-categories">${categoryTags}</div><div class="category-options">${CREATE_CATEGORY_NAMES.map(category=>`<button type="button" class="category-option ${selectedCreateCategories.includes(category)?'selected':''}" data-action="toggle-category" data-category="${escape(category)}" aria-pressed="${selectedCreateCategories.includes(category)}">${t(category)}</button>`).join('')}</div></fieldset>
    <label id="other-category-wrap" ${selectedCreateCategories.includes('อื่น ๆ (ระบุชื่อเอง)')?'':'hidden'}>${t('ระบุชื่อหมวดหมู่')}<input name="otherCategory" maxlength="60" ${selectedCreateCategories.includes('อื่น ๆ (ระบุชื่อเอง)')?'required':''} placeholder="${t('ระบุชื่อหมวดหมู่')}"/></label>
    <label>${t('ชื่อกลุ่ม')}<input name="name" maxlength="70" required placeholder="${t('เช่น ทีมอ่านสอบปลายเทอม')}"/></label>
    <div class="form-grid"><label>${t('จำนวนสมาชิกสูงสุด')}<input name="capacity" type="number" min="2" max="20" value="4" required/></label><label>${t('การมองเห็น')}<select name="visibility"><option value="public">${t('กลุ่มสาธารณะ')}</option><option value="link">${t('เฉพาะผู้มีลิงก์')}</option></select></label></div>
    <div class="form-grid"><label>${t('ราคาสินค้า (บาท)')}<input name="product" inputmode="decimal" value="${bahtInput(selectedListing?.price||0)}" required/></label><label>${t('ค่าส่งต่อคน (บาท)')}<input name="delivery" inputmode="decimal" value="0" required/></label></div>
    <div class="info-box">${t('ค่าธรรมเนียมแอป 2% คำนวณอัตโนมัติจากราคาสินค้าและค่าส่งรวม กลุ่มเฉพาะลิงก์จะไม่ปรากฏในการค้นหาสาธารณะ')}</div><div id="create-preview" class="preview-cost"></div><button class="button primary full" type="submit">${t('สร้างกลุ่ม')}</button>
  </form>`;
}
function syncCreateCategoryUI(){
  const form=document.querySelector('#create-form');if(!form)return;
  const primary=form.querySelector('[name="category"]'),first=selectedCreateCategories[0]||'';
  primary.value=first;
  const tags=form.querySelector('#selected-categories');
  tags.innerHTML=selectedCreateCategories.map(category=>`<button type="button" class="selected-category" data-action="remove-category" data-category="${escape(category)}" aria-label="${t('นำหมวดหมู่ออก {category}',{category:t(category)})}">${escape(t(category))}<span aria-hidden="true">×</span></button>`).join('')||`<span class="category-selection-hint">${t('เลือกอย่างน้อย 1 หมวดหมู่')}</span>`;
  form.querySelectorAll('[data-action="toggle-category"]').forEach(button=>{const active=selectedCreateCategories.includes(button.dataset.category);button.classList.toggle('selected',active);button.setAttribute('aria-pressed',String(active));});
  const otherSelected=selectedCreateCategories.includes('อื่น ๆ (ระบุชื่อเอง)'),otherWrap=form.querySelector('#other-category-wrap'),otherInput=form.querySelector('[name="otherCategory"]');
  otherWrap.hidden=!otherSelected;otherInput.required=otherSelected;
  const listingsForCategory=listings().filter(item=>item.category===first),nextListing=listingsForCategory[0]||listings()[0];
  if(nextListing){form.querySelector('[name="listingId"]').value=nextListing.id;form.querySelector('[name="product"]').value=bahtInput(nextListing.price);}
  updatePreview();
}
function getCreateCategoryValues(form){
  return selectedCreateCategories.map(category=>category==='อื่น ๆ (ระบุชื่อเอง)'?String(new FormData(form).get('otherCategory')||'').trim():category).filter(Boolean);
}
function authPage(register=false){
  if(authModalActive)return '';
  if(mockupCurrentStep!==3)mockupCurrentStep=register?2:1;
  return `<div class="auth-page-wrapper">${renderPhoneMockup(mockupCurrentStep===3?3:register?2:1, false)}<a href="/" data-link class="auth-return-link">← ${t("กลับสู่หน้าหลัก HarnKhong")}</a></div>`;
}
function myGroups(){if(!requireAuth('/my-groups'))return authRequiredView(t("กลุ่มของฉัน"),t("ติดตามสมาชิกและยอดที่ต้องยืนยันในแต่ละกลุ่ม เข้าสู่ระบบหรือลงทะเบียนเพื่อเริ่มต้น"));const gs=state.groups.filter(g=>g.members.includes(state.user.id));return `${title(t("กลุ่มของฉัน"),t("ติดตามสมาชิกและยอดที่ต้องยืนยันในแต่ละกลุ่ม"))}<div class="section-header"><h2>${t('{count} กลุ่ม',{count:gs.length})}</h2>${a('/groups/create',`${icon('plus',18)} ${t("สร้างกลุ่ม")}`,'button secondary')}</div>${gs.length?`<div class="group-grid">${gs.map(groupCard).join('')}</div>`:`<div class="empty"><h2>${t("ยังไม่มีกลุ่มที่เข้าร่วม")}</h2><p>${t("ลองสำรวจสินค้าที่อยากหารก่อน")}</p>${a('/explore',t("ไปสำรวจ"),'button primary')}</div>`}`;}
function getGroupMessages(groupId){
  const defaultGroupMessages={
    g1:[
      {id:'gm1',sender:'นที',senderId:'u2',text:'สวัสดีครับทุกคน มีใครพร้อมโอนเงินรอบนี้บ้างครับ',time:'14:20'},
      {id:'gm2',sender:'พิม',senderId:'u3',text:'เราพร้อมโอนค่ะ รอของครบคน',time:'14:25'}
    ]
  };
  try{
    const raw=localStorage.getItem(`hk_group_chat_${groupId}`);
    if(raw)return JSON.parse(raw);
  }catch{}
  return defaultGroupMessages[groupId]||[];
}
function saveGroupMessage(groupId,msg){
  const list=getGroupMessages(groupId);
  list.push(msg);
  try{
    localStorage.setItem(`hk_group_chat_${groupId}`,JSON.stringify(list));
  }catch{}
  return list;
}
function chatList(){
  if(!requireAuth('/chat'))return authRequiredView(t("แชตกับผู้ขาย"),t("เข้าสู่ระบบเพื่อดูประวัติการสนทนาและติดต่อร้านค้า"));
  const ids=Object.keys(state.conversations);
  const myGs=state.groups.filter(g=>g.members.includes(state.user.id));
  return `${title(t("แชต"),t("ข้อความทั้งหมดเป็นการจำลองในเบราว์เซอร์นี้"))}
  <div class="narrow">
    <div class="chat-section-header">
      <h2>${t("แชทกลุ่มของฉัน")}</h2>
    </div>
    ${myGs.length?myGs.map(g=>{
      const msgs=getGroupMessages(g.id);
      const lastMsg=msgs.at(-1);
      return a(`/groups/${g.id}/chat`,`<span class="avatar">${escape(g.name.slice(0,1))}</span><span><b>${escape(g.name)}</b><small>${escape(lastMsg?.text||lastMsg?.body||t("เริ่มคุยกับสมาชิกในกลุ่มได้ที่นี่"))}</small></span>${icon('arrow',18)}`,'conversation-row');
    }).join(''):`<div class="empty" style="padding:16px 0;"><h2>${t("ยังไม่มีกลุ่มที่เข้าร่วม")}</h2><p>${t("ลองสำรวจสินค้าที่อยากหารก่อน")}</p>${a('/explore',t("ไปสำรวจ"),'button outline')}</div>`}

    <div class="chat-section-header" style="margin-top:24px;">
      <h2>${t("แชตกับผู้ขาย")}</h2>
    </div>
    ${ids.length?ids.map(id=>{const s=seller(id),msgs=state.conversations[id];return a(`/chat/${id}`,`<span class="avatar">${escape(s.initials)}</span><span><b>${escape(s.name)}</b><small>${escape(msgs.at(-1)?.body||t("เริ่มต้นสนทนา"))}</small></span>${icon('arrow',18)}`,'conversation-row')}).join(''):`<div class="empty"><h2>${t("ยังไม่มีการสนทนา")}</h2><p>${t("เปิดสินค้าที่สนใจแล้วเลือกติดต่อผู้ขาย")}</p>${a('/explore',t("ดูสินค้า"),'button primary')}</div>`}
  </div>`;
}
function groupChatPage(id){
  const g=group(id);
  if(!g)return notFound();
  if(!state.user||!g.members.includes(state.user.id))return notFound();
  const p=listing(g.listingId);
  const me=state.user?.id;
  const isMember=g.members.includes(me);
  const msgs=getGroupMessages(id);
  const destination=`/groups/${id}`;
  return `<div class="chat-shell group-chat-shell">
    <div class="chat-head group-chat-head">
      ${a(destination,icon('back',20),'back-link')}
      <div class="group-chat-meta">
        <div class="group-chat-title-row">
          <h1>${escape(g.name)}</h1>
          <span class="group-chat-badge">${icon('users',14)} ${g.members.length}/${g.capacity}</span>
        </div>
        <small>${t("แชทจำลองสำหรับสมาชิกในกลุ่ม")}</small>
      </div>
      ${a(destination,`${icon('info',18)} <span>${t("ดูกลุ่ม")}</span>`,'button subtle group-chat-view-btn')}
    </div>
    ${p?`<div class="chat-product">${t("สินค้าในกลุ่ม")}: ${a(destination,escape(p.title||g.name))} · <strong style="color:var(--primary-600);">${money(g.costs.product)}</strong></div>`:''}
    <div class="messages group-messages">
      ${msgs.length?msgs.map(m=>{
        const isMine=m.senderId===me||m.from==='me';
        return `<div class="group-msg-row ${isMine?'mine':'theirs'}">
          ${!isMine?`<span class="avatar tiny">${escape((m.sender||'?').slice(0,1))}</span>`:''}
          <div class="group-msg-content">
            ${!isMine?`<div class="group-msg-sender">${escape(m.sender||t("สมาชิกในกลุ่ม"))}</div>`:''}
            <div class="bubble ${isMine?'mine':'theirs'}">${escape(m.text||m.body||'')}</div>
            <time class="group-msg-time">${escape(m.time||'')}</time>
          </div>
        </div>`;
      }).join(''):`<div class="chat-empty">${icon('chat',32)}<p><strong>${t("เริ่มคุยกับสมาชิกในกลุ่มได้ที่นี่")}</strong></p><small>${t("พูดคุย ปรึกษาเรื่องสินค้า นัดรับ หรือแชร์รายละเอียดกับสมาชิกในกลุ่มได้ที่นี่")}</small></div>`}
    </div>
    ${isMember?`<form id="group-chat-form" data-id="${id}" class="chat-input group-chat-input">
      <input name="body" maxlength="500" required placeholder="${t("พิมพ์ข้อความถึงสมาชิกในกลุ่ม...")}" aria-label="${t("ข้อความ")}" autocomplete="off"/>
      <button class="button primary" type="submit">${t("ส่ง")}</button>
    </form>`:''}
  </div>`;
}
function chatPage(id){if(!requireAuth(location.pathname+location.search))return authRequiredView(t("แชตกับผู้ขาย"),t("เข้าสู่ระบบเพื่อเริ่มต้นการสนทนากับร้านค้านี้"));const s=seller(id),msgs=state.conversations[id]||[],product=new URLSearchParams(location.search).get('product');return `<div class="chat-shell"><div class="chat-head">${a('/chat',icon('back',20))}<span class="avatar">${escape(s.initials)}</span><div><h1>${escape(s.name)}</h1><small>${t("แชตจำลอง · ไม่ส่งถึงผู้ขายจริง")}</small></div></div>${product?`<div class="chat-product">${t("กำลังสอบถามเรื่อง")} ${a(`/products/${product}`,escape(listing(product)?.title||t('สินค้า')))}</div>`:''}<div class="messages">${msgs.length?msgs.map(m=>`<div class="bubble ${m.from==='me'?'mine':'theirs'}">${escape(m.body)}</div>`).join(''):`<div class="chat-empty">${t("เริ่มคุยเรื่องสินค้า เงื่อนไขรับของ หรือค่าส่งได้ที่นี่")}</div>`}</div><form id="chat-form" data-id="${id}" class="chat-input"><input name="body" maxlength="500" required placeholder="${t("พิมพ์ข้อความเดโม...")}" aria-label="${t("ข้อความ")}"/><button class="button primary" type="submit">${t("ส่ง")}</button></form></div>`;}
function notifications(){if(!requireAuth('/notifications'))return authRequiredView(t("การแจ้งเตือน"),t("เข้าสู่ระบบเพื่อดูการแจ้งเตือนกิจกรรมและยอดสมาชิก"));const notes=state.notifications.filter(n=>n.recipient===state.user.id);return `${title(t("การแจ้งเตือน"),t("เหตุการณ์ในกลุ่มและข้อความจำลองของคุณ"))}<div class="narrow">${notes.length?notes.map(n=>`<button class="notification ${n.read?'':'unread'}" data-action="open-notice" data-id="${n.id}"><span class="notice-dot"></span><span><b>${escape(n.title)}</b><small>${escape(n.body)}</small></span>${icon('arrow',18)}</button>`).join(''):`<div class="empty"><h2>${t("ยังไม่มีการแจ้งเตือน")}</h2><p>${t("เมื่อมีสมาชิกหรือยอดเปลี่ยน รายการจะปรากฏที่นี่")}</p>${a('/explore',t("สำรวจสินค้า"),'button secondary')}</div>`}</div>`;}
function accountOrderRow(o) {
  const p = listing(o.listingId);
  const payment = o.payments[state.user.id];
  const canReport = orderPermissions(o, state.user).reportPayment;
  return `<article class="account-order-row">
    <div class="account-order-art" role="img" aria-label="${escape(t(p?.title || t('รายการสินค้า')))}">${p ? art(p) : icon('calc', 23)}</div>
    <div class="account-order-info"><strong>${escape(t(p?.title || t('รายการสินค้า')))}</strong><small>${t('กลุ่ม')}: ${escape(group(o.groupId)?.name || o.groupId)}</small><span>${paymentStatus(payment.status)} · ${orderStatus(o.status)}</span></div>
    <div class="account-order-action"><strong>${money(payment.amountSatang)}</strong>${a(`/orders/${o.groupId}`, canReport ? t('แจ้งชำระเดโม') : t('ดูรายละเอียด'), `button ${canReport ? 'primary' : 'subtle'}`)}</div>
  </article>`;
}
function myOrdersPage() {
  if (!requireAuth('/my-orders')) return authRequiredView(t('คำสั่งซื้อของฉัน'), t('เข้าสู่ระบบเพื่อดูคำสั่งซื้อเดโมของคุณ'));
  const orders = state.orders.filter(o => o && typeof o === 'object' && o.members?.includes(state.user.id) && o.payments?.[state.user.id]).sort((a, b) => Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0));
  return `<div class="account-page account-orders-page">${title(t('คำสั่งซื้อของฉัน'), t('รายการและสถานะการชำระเงินในโหมดเดโม'))}<section class="account-card"><div class="account-card-heading"><h2>${t('รายการทั้งหมด')}</h2>${a('/profile', t('กลับไปบัญชีของฉัน'), 'button subtle')}</div>${orders.length ? orders.map(accountOrderRow).join('') : `<div class="account-empty"><span>${icon('calc', 26)}</span><strong>${t('ยังไม่มีคำสั่งซื้อเดโม')}</strong><p>${t('เมื่อกลุ่มครบและสรุปคำสั่งซื้อ รายการจะปรากฏที่นี่')}</p>${a('/my-groups', t('ดูกลุ่มของฉัน'), 'button outline')}</div>`}</section></div>`;
}
function profile() {
  if (!requireAuth('/profile')) return authRequiredView(t('บัญชีของฉัน'), t('เข้าสู่ระบบหรือลงทะเบียนเพื่อจัดการข้อมูลส่วนตัว'));
  const sellerRole = state.user.role === 'seller';
  const mine = state.groups.filter(g => g.members.includes(state.user.id));
  const approvedGroups=mine.filter(g=>g.approvals?.[state.user.id]===g.revision);
  const approvedGroupShare=approvedGroups.reduce((sum,g)=>sum+(shares(g)[state.user.id]||0),0);
  const orders = state.orders.filter(o => o && typeof o === 'object' && o.members?.includes(state.user.id) && o.payments?.[state.user.id]).sort((a, b) => Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0));
  const unpaid = orders.filter(o => o.status === 'pending_payment' && o.payments?.[state.user.id]?.status === 'unpaid');
  const reported = orders.filter(o => ['payment_reported', 'verification_pending'].includes(o.payments?.[state.user.id]?.status));
  const verified = orders.filter(o => o.payments?.[state.user.id]?.status === 'verified');
  const sumPayments = entries => entries.reduce((sum, o) => sum + (o.payments[state.user.id]?.amountSatang || 0), 0);
  const unpaidAmount = sumPayments(unpaid);
  const verifiedAmount = sumPayments(verified);
  const avatar = isLocalImage(state.user.avatar) ? `<img src="${state.user.avatar}" alt=""/>` : escape(state.user.name.slice(0, 1));
  const stat = (iconName, label, value, sub, tone) => `<div class="account-stat"><span class="account-stat-icon ${tone}">${icon(iconName, 22)}</span><div><small>${label}</small><strong>${value}</strong><span>${sub}</span></div></div>`;
  const shortcut = (href, iconName, label, sub, tone) => a(href, `<span class="account-shortcut-icon ${tone}">${icon(iconName, 21)}</span><span><strong>${label}</strong><small>${sub}</small></span>${icon('arrow', 18)}`, 'account-shortcut');
  return `<div class="account-page">
    ${title(t('บัญชีของฉัน'), t(supabaseConfigured?'จัดการโปรไฟล์และกลุ่มของคุณ':'จัดการบทบาทและทดลองใช้งานหลายบัญชี'))}
    <div class="account-layout">
      <div class="account-main">
        <section class="account-card account-overview" aria-labelledby="account-name">
          <div class="account-profile-line"><span class="avatar large">${avatar}</span><div><h2 id="account-name">${escape(state.user.name)}</h2><p>${sellerRole ? t('บัญชีผู้ขายเดโม') : t(supabaseConfigured?'สมาชิก':'สมาชิกเดโม')}</p><span class="account-demo-chip">${t(supabaseConfigured?'บัญชี Supabase Auth':'บัญชีจำลอง · เก็บข้อมูลในเบราว์เซอร์นี้')}</span></div><button class="button outline" data-action="edit-profile">${icon('user', 17)} ${t('ตั้งค่าบัญชี')}</button>${supabaseConfigured?`<button class="button subtle" data-action="logout">${t('ออกจากระบบ')}</button>`:''}</div>
          ${state.user.bio ? `<p class="account-bio user-content">${escape(state.user.bio)}</p>` : ''}
          <div class="account-demo-note">${icon('shield', 21)}<div><strong>${t(supabaseConfigured?'โปรไฟล์ ที่อยู่ และกลุ่มใช้ Supabase':'บัญชีนี้เป็นตัวจำลอง')}</strong><p>${t(supabaseConfigured?'กลุ่มและการยืนยันยอดใช้ข้อมูลร่วมกันผ่าน Supabase; คำสั่งซื้อและการชำระเงินยังไม่เปิดใช้ในโหมดนี้':'ไม่มีการยืนยันตัวตนจริง ข้อมูลเดโมบันทึกในเบราว์เซอร์นี้เท่านั้น')}</p></div></div>
          <div class="account-stats">
            ${stat('users', t('กลุ่มที่เข้าร่วม'), mine.length, t('กลุ่ม'), 'blue')}
            ${stat('calc', t('คำสั่งซื้อเดโม'), orders.length, t('รายการ'), 'mint')}
            ${stat('calc', t('ยอดรอแจ้งชำระ'), money(unpaidAmount), t('เดโมเท่านั้น'), 'violet')}
            ${stat('check', t('ยอดยืนยันเดโมแล้ว'), money(verifiedAmount), t('เดโมเท่านั้น'), 'rose')}
            ${stat('check', t('ยอดส่วนแบ่งที่ยืนยัน'), money(approvedGroupShare), t('{count} กลุ่ม · ยังไม่ใช่ยอดชำระเงินจริง',{count:approvedGroups.length}), 'mint')}
          </div>
        </section>
        <section class="account-card account-summary" aria-labelledby="account-summary-title"><div class="account-card-heading"><div><h2 id="account-summary-title">${t('สรุปยอดของฉัน')}</h2><p>${t('ยอดยืนยันกลุ่มและคำสั่งซื้อเดโม')}</p></div>${a('/my-groups', t('ดูกลุ่มของฉัน'), 'button subtle')}</div><div class="account-summary-grid"><div class="account-summary-tile violet"><span>${t('รอแจ้งชำระ')}</span><strong>${money(unpaidAmount)}</strong><small>${t('{count} รายการ', {count: unpaid.length})}</small></div><div class="account-summary-tile mint"><span>${t('รอตรวจยอดเดโม')}</span><strong>${reported.length}</strong><small>${t('รายการ')}</small></div><div class="account-summary-tile blue"><span>${t('ยืนยันยอดเดโมแล้ว')}</span><strong>${money(verifiedAmount)}</strong><small>${t('{count} รายการ', {count: verified.length})}</small></div><div class="account-summary-tile rose"><span>${t('ยอดส่วนแบ่งที่ยืนยัน')}</span><strong>${money(approvedGroupShare)}</strong><small>${t('{count} กลุ่ม · ยังไม่ใช่ยอดชำระเงินจริง',{count:approvedGroups.length})}</small></div></div></section>
        ${supabaseConfigured?'':`<details class="account-card account-test-tools"><summary>${t('เครื่องมือทดสอบบัญชี')}</summary><p>${t('ใช้ทดสอบการยืนยันยอดของสมาชิกแต่ละคน')}</p><div class="account-switch"><button data-action="switch-user" data-id="demo-owner" class="button outline">${escape(demoNames['demo-owner'])}</button>${Object.entries(demoNames).filter(([id])=>id!=='demo-owner').map(([id, n]) => `<button data-action="switch-user" data-id="${id}" class="button outline">${escape(n)}</button>`).join('')}<button data-action="switch-user" data-id="demo-seller" class="button outline">${t('ผู้ขายเดโม')} · ${escape(seller('s1').name)}</button><button data-action="switch-user" data-id="demo-seller-s2" class="button outline">${t('ผู้ขายเดโม')} · ${escape(seller('s2').name)}</button></div><div class="account-test-actions"><button class="button subtle" data-action="logout">${t('ออกจากระบบเดโม')}</button><button class="button subtle" data-action="reset-demo">${t('เริ่มข้อมูลเดโมใหม่')}</button></div></details>`}
      </div>
      <aside class="account-aside">
        <section class="account-card account-orders" id="account-orders" aria-labelledby="account-orders-title"><div class="account-card-heading"><h2 id="account-orders-title">${t('รายการคำสั่งซื้อเดโม')}</h2>${a('/my-orders', `${t('ดูทั้งหมด')} ${icon('arrow', 17)}`, 'account-all-link')}</div>${orders.length ? orders.slice(0, 3).map(accountOrderRow).join('') : `<div class="account-empty"><span>${icon('calc', 26)}</span><strong>${t('ยังไม่มีคำสั่งซื้อเดโม')}</strong><p>${t('เมื่อกลุ่มครบและสรุปคำสั่งซื้อ รายการจะปรากฏที่นี่')}</p>${a('/my-groups', t('ดูกลุ่มของฉัน'), 'button outline')}</div>`}</section>
        <section class="account-card account-shortcuts" aria-labelledby="account-shortcuts-title"><h2 id="account-shortcuts-title">${t('ทางลัด')}</h2><div class="account-shortcut-grid">${shortcut('/my-groups', 'users', t('กลุ่มของฉัน'), t('ดูและจัดการกลุ่มที่เข้าร่วม'), 'blue')}${shortcut('/notifications', 'bell', t('การแจ้งเตือน'), t('อัปเดตยอดและกิจกรรม'), 'amber')}${shortcut('/explore', 'search', t('สำรวจสินค้า'), t('ค้นหาสินค้าและเข้าร่วมกลุ่ม'), 'violet')}${sellerRole ? shortcut('/seller/dashboard', 'calc', t('แดชบอร์ดผู้ขาย'), t('จัดการรายการของร้าน'), 'mint') : shortcut('/my-orders', 'check', t('รายการชำระเดโม'), t('ดูสถานะคำสั่งซื้อของฉัน'), 'mint')}</div></section>
      </aside>
    </div>${profileDialog()}
  </div>`;
}
function sellerOrders(){
  const orders=state.orders.filter(o=>o&&typeof o==='object'&&orderPermissions(o,state.user).seller);
  return `<section class="activity seller-orders"><h2>${t('คำสั่งซื้อของร้าน')}</h2>${orders.length?orders.map(o=>a(`/orders/${o.groupId}`,`<b>${escape(group(o.groupId)?.name||o.id)}</b><span>${orderStatus(o.status)}</span>`,'profile-link')).join(''):`<p>${t('ยังไม่มีคำสั่งซื้อของร้าน')}</p>`}</section>`;
}
function orderHistory(order){
  return `<section class="activity"><h2>${t('ประวัติคำสั่งซื้อ')}</h2><ol class="order-timeline">${order.history.map(h=>`<li><strong>${t('orderEvent_'+h.type)}</strong><p>${escape(actorName(h.actorId))} · <time datetime="${escape(h.at)}">${escape(dateTime(h.at))}</time></p>
    ${h.memberId?`<p>${escape(actorName(h.memberId))}</p>`:''}
    ${typeof h.newState==='string'?`<p>${h.previousState?escape(h.type==='payment_status_changed'||h.type==='payment_reported'?paymentStatus(h.previousState):orderStatus(h.previousState))+' → ':''}${escape(h.type==='payment_status_changed'||h.type==='payment_reported'?paymentStatus(h.newState):orderStatus(h.newState))}</p>`:''}
    ${h.type==='shipment_updated'?`<p>${escape(h.previousState?.trackingNumber||h.previousState?.url||'—')} → ${escape(h.newState.carrier)} ${escape(h.newState.trackingNumber||h.newState.url)}</p>`:''}
    ${h.inspection?`<p>${t('สิ้นสุดตรวจรับ')}: ${escape(dateTime(h.inspection.deadline))}</p>`:''}
    ${h.amountSatang!==undefined?`<p>${money(h.amountSatang)} · ${t('จำลองเท่านั้น')}</p>`:''}
    ${h.disputeId?`<small>${t('รหัสข้อพิพาท')}: ${escape(h.disputeId)}</small>`:''}${h.note?`<p class="user-content">${escape(h.note)}</p>`:''}</li>`).join('')}</ol></section>`;
}
function disputePanel(order,permissions){
  return `<section class="activity"><h2>${t('ข้อพิพาท')}</h2>${order.disputes.length?order.disputes.map(d=>`<article class="dispute-entry"><h3>${t('disputeReason_'+d.reason)} · ${t('disputeStatus_'+d.status)}</h3>
    <p>${t('ผู้รายงาน')}: ${escape(actorName(d.reporterId))} · ${escape(dateTime(d.createdAt))}</p><p class="user-content">${escape(d.description)}</p>
    ${d.evidence?`<p class="user-content">${t('หลักฐานอ้างอิง')}: ${escape(d.evidence)}</p>`:''}
    ${d.proposals.map(p=>`<div class="info-box"><b>${t('resolution_'+p.decision)} · ${t('proposal_'+p.status)}</b><p class="user-content">${escape(p.note)}</p><small>${escape(actorName(p.proposerId))} · ${escape(dateTime(p.proposedAt))}</small></div>`).join('')}
    ${d.resolution?`<p>${t('ยอมรับโดย')}: ${escape(actorName(d.resolution.resolverId))} · ${escape(dateTime(d.resolution.resolvedAt))}</p>`:''}
    ${d.status==='open'&&permissions.propose?`<form id="resolution-form" data-id="${order.id}" data-dispute="${d.id}" class="form-panel"><label>${t('ผลลัพธ์ที่เสนอ')}<select name="decision"><option value="resume">${t('resolution_resume')}</option><option value="refund">${t('resolution_refund')}</option></select></label><label>${t('เหตุผลการตัดสินใจ')}<textarea name="note" required maxlength="1000"></textarea></label><p>${t('คืนเงินจำลองนับเฉพาะยอดที่ตรวจยืนยันเดโมแล้ว')}</p><button class="button primary" type="submit">${t('เสนอผลลัพธ์ให้ผู้รายงาน')}</button></form>`:''}
    ${d.status==='resolution_proposed'&&permissions.respond?`<div class="order-actions"><button class="button primary" data-action="resolution-response" data-id="${order.id}" data-dispute="${d.id}" data-accept="true">${t('ยอมรับผลลัพธ์')}</button><button class="button outline" data-action="resolution-response" data-id="${order.id}" data-dispute="${d.id}" data-accept="false">${t('ไม่ยอมรับผลลัพธ์')}</button></div>`:''}
    </article>`).join(''):`<p>${t('ยังไม่มีข้อพิพาท')}</p>`}
    ${permissions.dispute?`<details><summary>${t('แจ้งปัญหาคำสั่งซื้อ')}</summary><form id="dispute-form" data-id="${order.id}" class="form-panel"><label>${t('เหตุผล')}<select name="reason" required><option value="">${t('เลือกเหตุผล')}</option>${DISPUTE_REASONS.map(reason=>`<option value="${reason}">${t('disputeReason_'+reason)}</option>`).join('')}</select></label><label>${t('รายละเอียดปัญหา')}<textarea name="description" required maxlength="1000"></textarea></label><label>${t('หลักฐานอ้างอิง (ข้อความ ไม่อัปโหลดไฟล์)')}<textarea name="evidence" maxlength="1000"></textarea></label><button class="button primary" type="submit">${t('ส่งรายงานปัญหา')}</button></form></details>`:''}
    </section>`;
}
function orderPage(id){
  const g=group(id);if(!g)return notFound();
  if(!requireAuth(`/orders/${id}`))return authRequiredView(t('สรุปคำสั่งซื้อเดโม'),t('เข้าสู่ระบบเพื่อดูสรุปคำสั่งซื้อ'));
  if(supabaseConfigured)return `<div class="empty"><h1>${t('ขั้นตอนคำสั่งซื้อยังไม่เชื่อม')}</h1><p>${t('กลุ่มนี้ใช้ Supabase แต่คำสั่งซื้อและการชำระเงินยังเป็นเดโม จึงยังเปิดขั้นตอนนี้ไม่ได้')}</p>${a(`/groups/${id}`,t('กลับไปดูกลุ่ม'),'button outline')}</div>`;
  const order=orderFor(id), permissions=order?orderPermissions(order,state.user):null;
  if(order&&order.status!=='waiting_for_members'?!permissions.view:!g.members.includes(state.user.id))return `<div class="empty"><h1>${t('orderUnauthorized')}</h1>${a('/my-groups',t('กลุ่มของฉัน'),'button secondary')}</div>`;
  const model=order&&order.status!=='waiting_for_members'?order:g, alloc=shares(model),costs=costBreakdown(model.costs,model.members.length),ready=allApproved(g);
  const action=(next,label)=>`<button class="button primary" data-action="order-transition" data-id="${id}" data-next="${next}">${t(label)}</button>`;
  return `${title(t('สรุปคำสั่งซื้อเดโม'),escape(g.name))}<div class="narrow order-detail">
    <div class="info-box">${t('เดโมเท่านั้น: HarnKhong ไม่รับฝาก ถือ โอน หรือคืนเงินจริง ไม่มีการตรวจสอบธนาคาร')}</div>
    <div class="cost-card"><h2>${t('ค่าใช้จ่าย')}</h2><div><span>${t('สินค้า')}</span><b>${money(costs.product)}</b></div><div><span>${costs.deliveryPerMember===null?t('ค่าส่ง'):t('ค่าส่ง {amount} × {count} คน',{amount:money(costs.deliveryPerMember),count:model.members.length})}</span><b>${money(costs.delivery)}</b></div><div><span>${costs.deliveryPerMember===null?t('ค่าบริการ'):t('ค่าธรรมเนียมแอป 2%')}</span><b>${money(costs.service)}</b></div><div class="total"><span>${t('รวม')}</span><b>${money(costs.total)}</b></div><h3>${t('ส่วนแบ่งสมาชิก')}</h3>${model.members.map(memberId=>`<div><span>${escape(actorName(memberId))}</span><b>${money(alloc[memberId])}</b></div>`).join('')}</div>
    ${!order||order.status==='waiting_for_members'?`<section class="form-panel"><h2>${g.members.length<g.capacity?orderStatus('waiting_for_members'):t('รอยืนยันยอด')}</h2><p>${ready?t('สมาชิกครบและยืนยันยอดรอบล่าสุดทุกคนแล้ว'):t('ยังสรุปไม่ได้: ต้องมีสมาชิกครบและยืนยันยอดรอบล่าสุดทุกคน')}</p>
    ${g.ownerId===state.user.id?`<form id="order-form" data-id="${id}"><label>${t('ระยะตรวจรับเดโม (ชั่วโมง)')}<input name="hours" type="number" min="1" max="720" value="24" required/></label><button class="button primary full" type="submit" ${ready?'':'disabled'}>${t('บันทึกคำสั่งซื้อเดโม')}</button></form>`:`<p>${t('หัวหน้ากลุ่มเป็นผู้สร้างคำสั่งซื้อ')}</p>`}</section>`:`
    <section class="activity"><h2>${t('สถานะคำสั่งซื้อ')}: ${orderStatus(order.status)}</h2><p>${t('ยืนยันยอดเงินแยกจากการแจ้งชำระและการตรวจยอดเดโม')}</p>
    ${order.status==='pending_payment'?`<p>${t('orderPaymentPending')}</p>`:''}${order.status==='disputed'?`<p class="warning">${t('orderDisputeUnresolved')}</p>`:''}
    <div class="order-actions">${permissions.prepare?action('preparing_order','เริ่มเตรียมสินค้าเดโม'):''}${permissions.deliver?action('delivered','ยืนยันว่าได้รับสินค้า (เดโม)'):''}${permissions.inspect?action('inspection_period','เริ่มระยะตรวจรับเดโม'):''}</div>
    ${order.inspection?`<p>${t('เริ่มตรวจรับ')}: ${escape(dateTime(order.inspection.startedAt))}</p><p>${t('สิ้นสุดตรวจรับ')}: ${escape(dateTime(order.inspection.deadline))}</p>`:''}
    ${order.status==='inspection_period'?`<p>${t('ไม่มีการจบคำสั่งซื้อหรือปล่อยเงินอัตโนมัติ')}</p>${permissions.leader?`<button class="button primary" data-action="order-transition" data-id="${id}" data-next="completed" ${permissions.complete?'':'disabled'}>${t('จบคำสั่งซื้อเดโม')}</button><p>${permissions.complete?'':t('orderInspectionActive')}</p>`:''}`:''}
    ${order.refund?`<div class="info-box">${t('บันทึกผลคืนเงินจำลองแล้ว ไม่ได้คืนเงินจริง')}: ${money(order.refund.amountSatang)}<p>${t('คืนเงินจำลองนับเฉพาะยอดที่ตรวจยืนยันเดโมแล้ว')}</p><p class="user-content">${escape(order.refund.note)}</p></div>`:''}</section>
    <section class="activity"><h2>${t('สถานะการชำระจำลอง')}</h2><p>${t('ไม่มีหลักฐานยืนยันธุรกรรมธนาคาร ทุกการตรวจยอดเป็นการจำลอง')}</p><div class="order-payments">${order.members.map(memberId=>{
      const payment=order.payments[memberId];
      return `<article><b>${escape(actorName(memberId))} · ${money(payment.amountSatang)}</b><p>${paymentStatus(payment.status)}</p>
      ${permissions.reportPayment&&state.user.id===memberId?`<button class="button outline" data-action="payment-open" data-id="${id}">${t('เปิด QR จำลองและแจ้งชำระ')}</button>`:''}
      ${permissions.verifyPayment&&payment.status==='payment_reported'?`<button class="button outline" data-action="payment-update" data-id="${id}" data-member="${escape(memberId)}" data-next="verification_pending">${t('รับเรื่องตรวจยอดเดโม')}</button>`:''}
      ${permissions.verifyPayment&&payment.status==='verification_pending'?`<div class="order-actions"><button class="button outline" data-action="payment-update" data-id="${id}" data-member="${escape(memberId)}" data-next="verified">${t('ยืนยันตรวจยอด (จำลองเท่านั้น)')}</button><button class="button subtle" data-action="payment-update" data-id="${id}" data-member="${escape(memberId)}" data-next="unpaid">${t('ให้แจ้งชำระใหม่')}</button></div>`:''}</article>`;
    }).join('')}</div></section>
    <section class="activity"><h2>${t('การจัดส่ง')}</h2><p>${t('ข้อมูลจัดส่งกรอกเองในเดโม ยังไม่ตรวจสอบกับขนส่ง')}</p>
    ${order.shipment?`<p>${t('ผู้ขนส่ง')}: ${escape(order.shipment.carrier||'—')}</p><p>${t('เลขติดตาม')}: ${escape(order.shipment.trackingNumber||'—')}</p>${order.shipment.url?`<p><a href="${escape(order.shipment.url)}" target="_blank" rel="noopener noreferrer">${t('เปิดลิงก์ติดตามที่ผู้ขายกรอก')}</a></p>`:''}<p>${t('ส่งเมื่อ')}: ${escape(dateTime(order.shipment.shippedAt))}</p>`:`<p>${t('ยังไม่มีข้อมูลจัดส่ง')}</p>`}
    ${order.deliveredAt?`<p>${t('ยืนยันรับเมื่อ')}: ${escape(dateTime(order.deliveredAt))}</p>`:''}
    ${permissions.shipment?`<form id="shipment-form" class="form-panel" data-id="${id}"><label>${t('ผู้ขนส่ง')}<input name="carrier" maxlength="500" value="${escape(order.shipment?.carrier||'')}"/></label><label>${t('เลขติดตาม')}<input name="trackingNumber" maxlength="500" value="${escape(order.shipment?.trackingNumber||'')}"/></label><label>${t('ลิงก์ติดตาม (http หรือ https)')}<input name="url" type="url" maxlength="500" value="${escape(order.shipment?.url||'')}"/></label><p>${t('กรอกเลขติดตามหรือลิงก์อย่างน้อยหนึ่งช่อง')}</p><button class="button primary" type="submit">${t('บันทึกการจัดส่งเดโม')}</button></form>`:''}</section>
    ${disputePanel(order,permissions)}${orderHistory(order)}`}
    ${order?.legacy?`<p class="warning">${t('นำเข้าคำสั่งซื้อเก่าโดยไม่ถือว่าเคยชำระเงินแล้ว')}</p>`:''}
    ${permissions?.reportPayment?paymentDialog(order,demoReference()):''}${a(`/groups/${id}`,t('กลับไปดูกลุ่ม'),'button outline full')}</div>`;
}
function notFound(){return `<div class="empty"><h1>${t("ไม่พบหน้านี้")}</h1><p>${t("ลิงก์อาจไม่ถูกต้องหรือรายการถูกลบ")}</p>${a('/',t("กลับหน้าแรก"),'button primary')}</div>`;}
function route(){const path=decodeURIComponent(location.pathname);if(path==='/')return home();if(path==='/explore')return explore();if(path==='/demo-accept')return demoApprovalPage(new URLSearchParams(location.search).get('accepted')==='1');if(/^\/products\/[^/]+$/.test(path))return legacyProductRoute(path.split('/')[2]);if(/^\/groups\/[^/]+\/join$/.test(path))return joinPage(path.split('/')[2]);if(/^\/groups\/[^/]+\/chat$/.test(path))return groupChatPage(path.split('/')[2]);if(path==='/groups/create')return createPage();if(/^\/groups\/[^/]+$/.test(path))return groupPage(path.split('/')[2]);if(path==='/login')return authPage();if(path==='/register')return authPage(true);if(path==='/my-groups')return myGroups();if(path==='/my-orders')return myOrdersPage();if(path==='/chat')return chatList();if(/^\/chat\/[^/]+$/.test(path))return chatPage(path.split('/')[2]);if(path==='/notifications')return notifications();if(path==='/profile')return profile();if(/^\/shops\/[^/]+$/.test(path))return shopPage(path.split('/')[2]);if(path==='/seller/dashboard')return sellerDashboard();if(path==='/seller/products/new')return newProduct();if(/^\/orders\/[^/]+$/.test(path))return orderPage(path.split('/')[2]);return notFound();}
function updateFilterCarousel(){
  const carousel=document.querySelector('.filter-carousel'),row=carousel?.querySelector('.filter-row');
  if(!row)return;
  const previous=row.scrollLeft>2,next=row.scrollLeft+row.clientWidth<row.scrollWidth-2;
  carousel.classList.toggle('can-scroll-prev',previous);
  carousel.classList.toggle('can-scroll-next',next);
  carousel.querySelector('.filter-scroll-prev').hidden=!previous;
  carousel.querySelector('.filter-scroll-next').hidden=!next;
}
function groupsLoadingSkeleton(){
  return `<section class="groups-loading" role="status" aria-live="polite" aria-busy="true" aria-label="${t('กำลังโหลดกลุ่มจาก Supabase')}">
    <span class="sr-only">${t('กำลังโหลดกลุ่มจาก Supabase')}</span>
    <div class="groups-skeleton-grid" aria-hidden="true">${Array.from({length:6},()=>`<article class="groups-skeleton-card"><span class="skeleton-block skeleton-media"></span><span class="skeleton-block skeleton-line skeleton-line-long"></span><span class="skeleton-block skeleton-line skeleton-line-short"></span></article>`).join('')}</div>
    <span class="groups-skeleton-mark" aria-hidden="true">${icon('search',28)}</span>
  </section>`;
}
function render(){
  document.documentElement.dataset.theme=theme;
  document.body.classList.toggle('mobile-menu-open',mobileMenuOpen);
  const headerScrolled=window.scrollY>10;
  const unread=state.user?state.notifications.filter(n=>n.recipient===state.user.id&&!n.read).length:0;
  const nav=[
    ['/','home',t("หน้าแรก")],
    ['/explore','search',t("ค้นหา")],
    ['/my-groups','users',t("กลุ่มของฉัน")],
    ['/chat','chat',t("แชต")],
    ['/profile','user',t("บัญชี")]
  ];
  const desktopNav=nav.slice(0,3);

  document.querySelector('#app').innerHTML=`
    ${icons}
    <header class="site-header${headerScrolled?' is-scrolled':''}${mobileMenuOpen?' menu-open':''}">
      <div class="header-inner">
        ${a('/',`<span class="logo-mark">H</span><span class="logo-text">HarnKhong<small>${t("หารของด้วยกัน")}</small></span>`,'brand')}
        <nav class="desktop-nav" aria-label="${t("เมนูหลัก")}">
          ${desktopNav.map(([href,,label])=>a(href,label,'nav-link '+(location.pathname===href?'active':''))).join('')}
        </nav>
        <div class="header-actions">
          ${/^\/groups\/[^/]+$/.test(location.pathname) ? '' : a('/groups/create',`${icon('plus',17)} ${t("เปิดกลุ่ม")}`,'button primary header-create-btn')}
          <button type="button" class="icon-button theme-toggle" data-action="theme-toggle" aria-label="${locale==='th'?(theme==='dark'?'เปลี่ยนเป็นธีมสว่าง':'เปลี่ยนเป็นธีมมืด'):(theme==='dark'?'Switch to light theme':'Switch to dark theme')}" title="${locale==='th'?(theme==='dark'?'เปลี่ยนเป็นธีมสว่าง':'เปลี่ยนเป็นธีมมืด'):(theme==='dark'?'Switch to light theme':'Switch to dark theme')}">${theme==='dark'?'<svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42"/></svg>':'<svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20.8 13.2A8.7 8.7 0 0 1 10.8 3.2 8.8 8.8 0 1 0 20.8 13.2Z"/></svg>'}</button>
          ${a('/chat',`${icon('chat',21)}<span class="sr-only">${t('แชต')}</span>`,'icon-button header-chat-btn')}
          ${a('/notifications',`${icon('bell',22)}<span class="sr-only">${t('การแจ้งเตือน')}</span>${unread?`<i>${unread}</i>`:''}`,'icon-button header-notifications-btn')}
          <select id="locale-select" class="locale-select" aria-label="${t('ภาษา')}"><option value="th" ${locale==='th'?'selected':''}>TH</option><option value="en" ${locale==='en'?'selected':''}>EN</option></select>
          ${state.user?a('/profile',`<span class="avatar tiny">${escape(state.user.name.slice(0,1))}</span><span class="header-user-name">${escape(state.user.name)}</span>`,'profile-pill'):`<button type="button" class="button primary header-login-btn" data-action="open-auth" data-step="1">${icon('user',18)} ${t("เข้าสู่ระบบ")}</button>`}
          <button type="button" class="icon-button mobile-menu-toggle" data-action="mobile-menu-toggle" aria-label="${mobileMenuOpen?t('ปิดเมนู'):t('เปิดเมนู')}" aria-expanded="${mobileMenuOpen}" aria-controls="mobile-menu"><span></span><span></span></button>
        </div>
      </div>
      <div class="mobile-menu${mobileMenuOpen?' is-open':''}" id="mobile-menu" aria-hidden="${!mobileMenuOpen}">
        <nav aria-label="${t('เมนูหลัก')}">
          ${nav.map(([href,ic,label])=>a(href,`${icon(ic,21)}<span>${label}</span>`,(location.pathname===href?'active':''))).join('')}
        </nav>
        <div class="mobile-menu-actions">
          ${/^\/groups\/[^/]+$/.test(location.pathname)?'':a('/groups/create',`${icon('plus',18)} ${t('เปิดกลุ่ม')}`,'button primary')}
          ${state.user?a('/profile',`${icon('user',18)} ${t('บัญชี')}`,'button outline'):`<button type="button" class="button primary" data-action="open-auth" data-step="1">${icon('user',18)} ${t('เข้าสู่ระบบ')}</button>`}
        </div>
      </div>
    </header>

    <main class="main-wrap${location.pathname==='/'?' home-main':''}" id="main">${groupsLoading?groupsLoadingSkeleton():groupsError?`<div class="empty"><h2>${t('โหลดกลุ่มไม่สำเร็จ')}</h2><p>${escape(authErrorMessage(groupsError))}</p><button class="button primary" data-action="refresh-groups">${t('ลองอีกครั้ง')}</button></div>`:route()}</main>

    <nav class="bottom-nav" aria-label="${t("เมนูด้านล่าง")}">
      ${nav.map(([href,ic,label])=>a(href,`${icon(ic,22)}<span>${label}</span>`,location.pathname===href?'active':'')).join('')}
    </nav>

    <div id="toast" role="status" aria-live="polite"></div>

    <footer class="site-footer">
      <div class="footer-inner">
        <div class="footer-grid">
          <div class="footer-brand">
            ${a('/','<span class="logo-mark" style="display:inline-grid;margin-right:8px;vertical-align:middle;width:32px;height:32px;border-radius:10px;font-size:0.9rem;">H</span><strong style="font-size:1.25rem;color:var(--navy);vertical-align:middle;">HarnKhong</strong>','brand')}
            <p>${t("แพลตฟอร์มเพื่อการหารค่าใช้จ่าย ซื้อของราคาส่ง และแชร์บริการสำหรับเพื่อนและชุมชนอย่างโปร่งใส ตรวจสอบยอดได้ก่อนตกลงสั่งซื้อจริง")}</p>
          </div>
          <div class="footer-col">
            <h4>${t("เมนูด่วน")}</h4>
            ${a('/explore', t("สำรวจสินค้า"))}
            ${/^\/groups\/[^/]+$/.test(location.pathname) ? '' : a('/groups/create', t("เปิดกลุ่มใหม่"))}
            ${a('/my-groups', t("กลุ่มของฉัน"))}
            ${a('/chat', t("แชตติดต่อผู้ขาย"))}
          </div>
          <div class="footer-col">
            <h4>${t("หมวดหมู่")}</h4>
            ${a('/explore?category='+encodeURIComponent('แอปพลิเคชันและเว็บไซต์'), t('แอปพลิเคชันและเว็บไซต์'))}
            ${a('/explore?category='+encodeURIComponent('ของใช้ทั่วไป'), t("ของใช้ทั่วไป"))}
            ${a('/explore?category='+encodeURIComponent('สินค้าขายส่ง'), t("สินค้าขายส่ง"))}
            ${a('/explore?category='+encodeURIComponent('บริการทั่วไป'), t("บริการทั่วไป"))}
            ${a('/explore', t("หมวดทั้งหมด"))}
          </div>
          <div class="footer-col">
            <h4>${t("ช่วยเหลือ")}</h4>
            <a href="javascript:void(0)" data-action="open-auth" data-step="1">${t("เข้าสู่ระบบ")}</a>
            <a href="javascript:void(0)" data-action="open-auth" data-step="2">${t("สมัครสมาชิก")}</a>
            ${supabaseConfigured?'':`<a href="javascript:void(0)" data-action="reset-demo">${t("รีเซ็ตข้อมูลเดโม")}</a>`}
          </div>
        </div>
        <div class="footer-bottom">
          <span>${t("© 2026 HarnKhong — แพลตฟอร์มหารของด้วยกัน")}</span>
          <span class="footer-demo-pill">${t("💡 โหมดต้นแบบจำลอง (MVP Demo) เพื่อการทดสอบ UX")}</span>
        </div>
      </div>
    </footer>

    ${authModalActive?`<dialog class="auth-modal-overlay" id="auth-modal-overlay" aria-label="${t('เข้าสู่ระบบ')}">${renderPhoneMockup(mockupCurrentStep,true)}</dialog>`:''}
  `;

  startHeroHeadlineLoop();
  if(document.querySelector('#create-form'))updatePreview();
  const filterRow=document.querySelector('.filter-row');
  if(filterRow){filterRow.addEventListener('scroll',updateFilterCarousel,{passive:true});updateFilterCarousel();}
  const authDialog=document.querySelector('#auth-modal-overlay');
  if(authDialog){authDialog.showModal();authDialog.addEventListener('cancel',e=>{e.preventDefault();closeAuthModal();});}
  document.documentElement.lang=locale;
  document.title='HarnKhong — '+t('หารของด้วยกัน');
  document.querySelector('meta[name="description"]').content=t('แพลตฟอร์มหารของและบริการที่โปร่งใส');
  document.querySelectorAll('[data-action="toggle-mockup-pw"]').forEach(button=>button.setAttribute('aria-label',t('แสดงหรือซ่อนรหัสผ่าน')));
  document.querySelector('.header-actions a[href="/notifications"]').setAttribute('aria-label',t('การแจ้งเตือน'));
}
const formCosts=d=>({product:parseBaht(d.get('product')),delivery:parseBaht(d.get('delivery')),mode:'per_member_v2'});
window.addEventListener('resize',updateFilterCarousel,{passive:true});
function updatePreview(){const f=document.querySelector('#create-form'),box=document.querySelector('#create-preview');if(!f||!box)return;try{const d=new FormData(f),count=assertCapacity(Number(d.get('capacity'))),costs=costBreakdown(formCosts(d),count);box.innerHTML=`<small>${t('ประมาณเมื่อสมาชิกครบ {count} คน',{count})}</small><strong>${money(Math.ceil(costs.total/count))} ${t("/ คน")}</strong><p>${t('รวมค่าส่งต่อคนและค่าธรรมเนียมแอป 2% แล้ว')}</p>`;}catch(e){box.innerHTML=`<small>${escape(errorMessage(e))}</small>`;}}

const storageError=error=>error?.name==='QuotaExceededError'?t('พื้นที่ในเครื่องไม่พอ ข้อมูลเดิมยังอยู่ กรุณาลดจำนวนรูปแล้วลองใหม่'):errorMessage(error);
function updateAvatarPreview() {
  const el=document.querySelector('#profile-avatar-preview');
  if(el)el.innerHTML=isLocalImage(profileAvatar)?`<img src="${profileAvatar}" alt=""/>`:escape(state.user.name.slice(0,1));
}
document.addEventListener('change',async e=>{
  const input=e.target,isGroup=input.id==='group-images',isAvatar=input.id==='profile-avatar';
  if(!isGroup&&!isAvatar)return;
  const files=[...input.files];if(!files.length)return;
  const status=document.querySelector(isGroup?'#image-upload-status':'#avatar-status');
  const form=input.closest('form'),submit=form.querySelector('[type="submit"]');
  try{
    if(isGroup&&groupImages.length+files.length>MAX_GROUP_IMAGES)throw Error(t('เพิ่มรูปได้สูงสุด 4 รูป'));
    if(isGroup)imagesLoading=true;else avatarLoading=true;
    input.disabled=true;submit.disabled=true;status.textContent=t('กำลังเตรียมรูป กรุณารอสักครู่');
    const images=[];
    for(const file of files)images.push(await readLocalImage(file));
    if(!input.isConnected)return;
    if(isGroup){groupImages.push(...images);document.querySelector('#image-draft').innerHTML=gallery(groupImages,true);}
    else{profileAvatar=images[0];updateAvatarPreview();}
    status.textContent=t('รูปพร้อมแล้ว จะบันทึกพร้อมกลุ่ม');
  }catch(err){status.textContent=storageError(err);}
  finally{if(isGroup)imagesLoading=false;else avatarLoading=false;input.value='';input.disabled=false;submit.disabled=false;}
});
document.addEventListener('dragover',e=>{const target=e.target.closest('.image-upload');if(target){e.preventDefault();target.classList.add('is-dragging');}});
document.addEventListener('dragleave',e=>{const target=e.target.closest('.image-upload');if(target&&!target.contains(e.relatedTarget))target.classList.remove('is-dragging');});
document.addEventListener('drop',e=>{const target=e.target.closest('.image-upload');if(!target)return;e.preventDefault();target.classList.remove('is-dragging');const input=target.querySelector('input[type="file"]');if(!input||!e.dataTransfer?.files?.length)return;input.files=e.dataTransfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));});
document.addEventListener('change',e=>{
  if(e.target.name==='otherCategory'){const form=e.target.form;if(form?.querySelector('[name="category"]')?.value==='อื่น ๆ (ระบุชื่อเอง)')updatePreview();return;}
  if(e.target.id!=='locale-select')return;
  if(imagesLoading||avatarLoading){e.target.value=locale;alertMessage(t('กำลังเตรียมรูป กรุณารอสักครู่'));return;}
  // Rerender labels without discarding drafts, password visibility, or the current auth step.
  const controls=[...document.querySelectorAll('input,textarea,select')];
  const focus=controls.indexOf(document.activeElement), scrollY=window.scrollY;
  const drafts=controls.map(el=>({value:el.value,checked:el.checked,type:el.type,start:el.selectionStart,end:el.selectionEnd}));
  const openDialogs=[...document.querySelectorAll('dialog[open]')].map(el=>el.id);
  const authStep=document.querySelector('.mockup-screen.active')?mockupCurrentStep:null;
  locale=e.target.value==='en'?'en':'th';
  try { localStorage.setItem(LOCALE_KEY,locale); } catch { /* Language still works for this session. */ }
  render();
  const nextControls=[...document.querySelectorAll('input,textarea,select')];
  nextControls.forEach((el,i)=>{
    const draft=drafts[i];
    if(!draft)return;
    if(el instanceof HTMLInputElement)el.type=draft.type;
    if(draft.type!=='file')el.value=draft.value;
    el.checked=draft.checked;
    if(draft.start!==null&&draft.start!==undefined)el.setSelectionRange(draft.start,draft.end);
  });
  if(authStep)setMockupStep(authStep);
  openDialogs.forEach(id=>{const dialog=document.getElementById(id);if(dialog&&!dialog.open)dialog.showModal();});
  if(openDialogs.includes('profile-dialog'))updateAvatarPreview();
  updatePreview();
  nextControls[focus]?.focus({preventScroll:true});
  window.scrollTo(0,scrollY);
});
document.addEventListener('click',async e=>{
  const overlay=e.target.closest('#auth-modal-overlay');
  if(overlay&&e.target===overlay){const r=overlay.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom){closeAuthModal();return;}}
  const link=e.target.closest('a[data-link]');
  if(link){
    e.preventDefault();
    const href=link.getAttribute('href');
    if(link.closest('.mobile-menu')){mobileMenuOpen=false;document.body.classList.remove('mobile-menu-open');}
    if(!state.user && isAuthRequired(href)){
      sessionStorage.setItem('harn-return', href);
      openAuthModal(1);
      return;
    }
    go(href);
    return;
  }
  const pageButton=e.target.closest('.pagination-control[data-page]');
  if(pageButton&&!pageButton.disabled){const params=new URLSearchParams(location.search);params.set('page',pageButton.dataset.page);go(`/explore?${params.toString()}`);window.scrollTo(0,document.querySelector('.explore-page')?.offsetTop||0);return;}
  const btn=e.target.closest('[data-action]');if(!btn)return;
  const action=btn.dataset.action,id=btn.dataset.id,actionSession=activeSupabaseSession;
  try{
    if(action==='scroll-filter'){
      const row=btn.closest('.filter-carousel')?.querySelector('.filter-row');
      row?.scrollBy({left:(btn.dataset.direction==='next'?1:-1)*Math.max(180,row.clientWidth*0.7),behavior:'smooth'});
    }
    else if(action==='quick-search'){
      if(btn.dataset.category){
        go('/explore?category=' + encodeURIComponent(btn.dataset.category));
      } else {
        go('/explore?q=' + encodeURIComponent(btn.dataset.query || ''));
      }
    }
    else if(action==='open-auth'){
      const step = Number(btn.dataset.step) || 1;
      if(!sessionStorage.getItem('harn-return') && !isAuthRequired(location.pathname)){
        sessionStorage.setItem('harn-return', location.pathname + location.search);
      }
      openAuthModal(step);
    }
    else if(action==='close-auth'){ closeAuthModal(); }
    else if(action==='mockup-step'){ setMockupStep(Number(btn.dataset.step), btn); }
    else if(action==='mockup-autofill'&&!supabaseConfigured){ fillMockupDemo(); }
    else if(action==='mockup-social'){
      if(supabaseConfigured)throw new Error(t('โปรดเข้าสู่ระบบด้วย Google ผ่านปุ่ม Supabase Auth'));
      const user=demoAccount(state.profiles,'google.demo@example.com','Google Demo');
      if(user.address)finishAuth(user);else{tempSignupData=user;setMockupStep(3,btn);}
    }
    else if(action==='supabase-google'){
      if(!supabaseConfigured||!googleAuthAvailable)throw Object.assign(new Error(),{code:'googleProviderDisabled'});
      const redirectTo=location.origin+((sessionStorage.getItem('harn-return')||'/').startsWith('/')?sessionStorage.getItem('harn-return')||'/':'/');
      const {error}=await supabase.auth.signInWithOAuth({provider:'google',options:{redirectTo}});
      if(error)throw error;
    }
    else if(action==='close-dialog'){btn.closest('dialog')?.close();}
    else if(action==='edit-profile'){
      if(avatarLoading)return;
      profileAvatar=state.user.avatar||'';
      const dialog=document.querySelector('#profile-dialog');
      dialog.querySelector('form').reset();updateAvatarPreview();
      dialog.querySelector('[data-dialog-feedback]')?.remove();
      dialog.querySelector('#bio-counter').textContent=`${(state.user.bio||'').length} / 160`;
      dialog.querySelector('#avatar-status').textContent='';dialog.showModal();
    }
    else if(action==='avatar-remove'){if(avatarLoading)return;profileAvatar='';updateAvatarPreview();}
    else if(action==='gallery-select'){
      const galleryEl=btn.closest('.group-gallery'),index=Number(btn.dataset.index);
      if(btn.dataset.editable){if(imagesLoading)return;const [cover]=groupImages.splice(index,1);if(cover)groupImages.unshift(cover);document.querySelector('#image-draft').innerHTML=gallery(groupImages,true);}
      else{galleryEl.querySelector('.gallery-main img').src=btn.querySelector('img').src;galleryEl.querySelector('.gallery-main img').alt=t('ดูรูปที่ {number}',{number:index+1});galleryEl.querySelector('.gallery-counter').textContent=`${index+1} / ${galleryEl.querySelectorAll('[data-action="gallery-select"]').length}`;galleryEl.querySelectorAll('[data-action="gallery-select"]').forEach(button=>button.setAttribute('aria-pressed',String(button===btn)));}
    }
    else if(action==='image-remove'){if(imagesLoading)return;groupImages.splice(Number(btn.dataset.index),1);document.querySelector('#image-draft').innerHTML=gallery(groupImages,true);}
    else if(action==='toggle-category'||action==='remove-category'){
      const category=btn.dataset.category;
      if(action==='toggle-category')selectedCreateCategories=selectedCreateCategories.includes(category)?selectedCreateCategories.filter(item=>item!==category):[...selectedCreateCategories,category];
      else selectedCreateCategories=selectedCreateCategories.filter(item=>item!==category);
      syncCreateCategoryUI();
    }
    else if(action==='payment-open'){
      if(!orderPermissions(orderFor(id),state.user).reportPayment)throw Object.assign(new Error(),{code:'orderUnauthorized'});
      const dialog=document.querySelector('#payment-dialog');dialog.showModal();
      const qr=dialog.querySelector('#payment-qr'),url=demoAcceptUrl(qr.dataset.reference,qr.dataset.amount);
      qr.src=await QRCode.toDataURL(url.href,{errorCorrectionLevel:'M',margin:2,width:420,color:{dark:'#092847',light:'#ffffff'}});
    }
    else if(action==='toggle-mockup-pw'){
      const form = btn.closest('form') || document;
      const targetInput = form.querySelector(`#${btn.dataset.target}`) || document.getElementById(btn.dataset.target);
      if(targetInput){
        targetInput.type = targetInput.type === 'password' ? 'text' : 'password';
      }
    }
    else if(action==='theme-toggle'){
      theme=theme==='dark'?'light':'dark';
      try{localStorage.setItem(THEME_KEY,theme);}catch{/* Apply the selected theme for this page view. */}
      document.documentElement.dataset.theme=theme;render();
    }
    else if(action==='mobile-menu-toggle'){
      mobileMenuOpen=!mobileMenuOpen;render();
    }
    else if(action==='reset-demo'){if(supabaseConfigured)throw Object.assign(new Error(),{code:'supabaseDemoResetDisabled'});if(!confirm(t("ล้างข้อมูลเดโมในเบราว์เซอร์นี้และเริ่มใหม่?")))return;state=initialState();save();go('/');alertMessage(t("เริ่มข้อมูลเดโมใหม่แล้ว"));}
    else if(action==='refresh-groups'){await refreshSupabaseGroups();}
    else if(action==='join'){
      if(supabaseConfigured){const token=new URLSearchParams(location.search).get('invite');await joinSupabaseGroup(id,token);if(!await refreshSupabaseGroups(actionSession))return;go(`/groups/${id}`);alertMessage(t('เข้าร่วมกลุ่มแล้ว กรุณายืนยันยอดใหม่'));}
      else{const g=joinGroup(group(id),state.user.id);updateGroup(g);g.members.forEach(u=>notice(t("ยอดกลุ่มเปลี่ยน"),t('มีสมาชิกใหม่ กรุณายืนยันยอดรอบ {revision}',{revision:g.revision}),`/groups/${id}`,u));if(g.members.length===g.capacity)g.members.forEach(u=>notice(t("กลุ่มครบสมาชิก"),t("รอทุกคนยืนยันยอดก่อนสรุปคำสั่งซื้อ"),`/groups/${id}`,u));go(`/groups/${id}`);alertMessage(t("เข้าร่วมกลุ่มแล้ว กรุณายืนยันยอดใหม่"));}
    }
    else if(action==='leave'){
      const current = group(id);
      if(!current) return;
      const currentShare = shares(current)[state.user?.id] || 0;
      document.querySelector('#leave-group-dialog')?.remove();
      document.body.insertAdjacentHTML('beforeend', leaveGroupDialog(current, currentShare));
      const dialog = document.querySelector('#leave-group-dialog');
      dialog.addEventListener('close', () => dialog.remove(), {once: true});
      dialog.addEventListener('click', (e) => {
        if (e.target === dialog) dialog.close();
      });
      dialog.showModal();
    }
    else if(action==='confirm-leave'){
      const dialog = btn.closest('dialog') || document.querySelector('#leave-group-dialog');
      if(dialog) dialog.close();
      const current = group(id);
      if(!current) return;
      if(supabaseConfigured){await leaveSupabaseGroup(id);if(!await refreshSupabaseGroups(actionSession))return;}
      else{const g=leaveGroup(current,state.user.id);updateGroup(g);g.members.forEach(u=>notice(t("สมาชิกออกจากกลุ่ม"),t("ยอดเปลี่ยน กรุณายืนยันใหม่"),`/groups/${id}`,u));}
      go('/my-groups');
      alertMessage(t("ออกจากกลุ่มแล้ว"));
    }
    else if(action==='kick-member'){
      const current=group(id),memberId=btn.dataset.member;
      if(!current||current.ownerId!==state.user?.id||!current.members.includes(memberId))return;
      if(!confirm(t('ยืนยันเตะสมาชิก {name} ออกจากห้อง?',{name:name(memberId)})))return;
      if(supabaseConfigured){await removeSupabaseGroupMember(id,memberId);if(!await refreshSupabaseGroups(actionSession))return;}
      else{updateGroup(leaveGroup(current,memberId));current.members.filter(u=>u!==memberId).forEach(u=>notice(t('สมาชิกออกจากกลุ่ม'),t('ยอดเปลี่ยน กรุณายืนยันใหม่'),`/groups/${id}`,u));}
      render();alertMessage(t('นำสมาชิกออกจากห้องแล้ว ยอดและการยืนยันถูกอัปเดต'));
    }
    else if(action==='delete-group'){
      const current=group(id);
      if(!current||current.ownerId!==state.user?.id)return;
      if(!confirm(t('ยืนยันลบห้อง {name}? ลบได้เฉพาะห้องที่ไม่มีสมาชิกคนอื่นอยู่',{name:current.name})))return;
      if(supabaseConfigured){await deleteSupabaseGroup(id);if(!await refreshSupabaseGroups(actionSession))return;}
      else{
        if(current.members.length>1)throw Object.assign(new Error(t('ลบห้องได้เฉพาะเมื่อไม่มีสมาชิกคนอื่นอยู่')),{code:'groupHasMembers'});
        save({...state,groups:state.groups.filter(g=>g.id!==id),orders:state.orders.filter(o=>o.groupId!==id)});
      }
      go('/my-groups');alertMessage(t('ลบห้องแล้ว'));
    }
    else if(action==='approve'){
      const current=group(id),amount=shares(current)[state.user.id];
      if(supabaseConfigured){await approveSupabaseGroup(id,Number(btn.dataset.revision));if(!await refreshSupabaseGroups(actionSession))return;render();}
      else{const g=approve(current,state.user.id,Number(btn.dataset.revision));updateGroup(g);if(allApproved(g))g.members.forEach(u=>notice(t("ยืนยันยอดครบแล้ว"),t("กลุ่มพร้อมดูสรุปคำสั่งซื้อเดโม"),`/orders/${id}`,u));render();}
      const reference=demoReference();
      document.body.insertAdjacentHTML('beforeend',shareApprovalDialog(amount,reference));const dialog=document.querySelector('#share-approval-dialog');dialog.addEventListener('close',()=>dialog.remove(),{once:true});dialog.showModal();
      const acceptUrl=demoAcceptUrl(reference,amount);
      dialog.querySelector('#share-approval-qr').src=await QRCode.toDataURL(acceptUrl.href,{errorCorrectionLevel:'M',margin:2,width:420,color:{dark:'#092847',light:'#ffffff'}});
      alertMessage(t("ยืนยันยอดรอบล่าสุดแล้ว"));
    }
    else if(action==='copy-link'){
      const current=group(id);
      if(!current)throw new Error(t('ไม่พบกลุ่ม'));
      const token=supabaseConfigured&&current.visibility==='link'?await getSupabaseInvite(id):null;
      const inviteUrl=new URL(`/groups/${encodeURIComponent(id)}`,location.href);
      if(token)inviteUrl.searchParams.set('invite',token);
      const value=inviteUrl.href;
      let copied=false;
      if(navigator.clipboard?.writeText){
        try{await navigator.clipboard.writeText(value);copied=true;}catch{/* Try the legacy clipboard API below. */}
      }
      if(!copied){
        const input=document.createElement('textarea');input.value=value;input.setAttribute('readonly','');
        input.style.position='fixed';input.style.left='0';input.style.top='0';input.style.opacity='0';document.body.append(input);input.focus();input.select();input.setSelectionRange(0,input.value.length);
        copied=document.execCommand('copy');input.remove();
      }
      if(!copied)throw new Error(t('คัดลอกลิงก์ไม่สำเร็จ'));
      alertMessage(t("คัดลอกลิงก์เชิญแล้ว"));
    }
    else if(action==='open-notice'){const n=state.notifications.find(x=>x.id===id);n.read=true;save();go(n.href);}
    else if(action==='logout'){
      authSessionSync?.invalidate();
      if(supabaseConfigured){const {error}=await supabase.auth.signOut();if(error)throw error;}
      state.user=null;state.groups=supabaseConfigured?[]:state.groups;state.profiles=supabaseConfigured?{}:state.profiles;save();
      if(supabaseConfigured)await syncSupabaseSession(null);
      go('/');alertMessage(t("ออกจากระบบแล้ว"));
    }
    else if(action==='switch-user'){if(supabaseConfigured)throw Object.assign(new Error(),{code:'orderUnauthorized'});const user=state.profiles?.[id]||(['demo-seller','demo-seller-s2'].includes(id)?{id,name:seller(id==='demo-seller'?'s1':'s2').name,role:'seller',sellerId:id==='demo-seller'?'s1':'s2'}:{id,name:demoNames[id],role:'member'});save({...state,user});render();alertMessage(t("สลับบัญชีทดสอบแล้ว"));}
    else if(action==='payment-report'){
      if(!confirm(t('ยืนยันแจ้งชำระจำลอง ไม่ใช่หลักฐานการโอนเงินจริง?')))return;
      orderChanged(reportPayment(orderFor(id),state.user),t('แจ้งชำระแล้ว รอหัวหน้ากลุ่มตรวจยอดเดโม'));
    }
    else if(action==='accept-demo-amount'){
      const acceptedAt=Date.now(),reference=btn.dataset.ref,amount=Number(btn.dataset.amount);localStorage.setItem(`harnkhong-demo-acceptance:${reference}`,JSON.stringify({amount,acceptedAt}));
      const params=new URLSearchParams();params.set('ref',reference);params.set('amount',String(amount));params.set('accepted','1');history.replaceState({},'',`/demo-accept?${params.toString()}`);render();window.scrollTo(0,0);
    }
    else if(action==='payment-update'){
      let note='';
      if(btn.dataset.next==='unpaid'){note=prompt(t('เหตุผลที่ต้องแจ้งชำระใหม่'));if(note===null)return;}
      else if(!confirm(t('การตรวจยอดนี้เป็นการจำลอง ไม่ได้ตรวจสอบธนาคาร ยืนยันดำเนินการ?')))return;
      orderChanged(updatePayment(orderFor(id),state.user,btn.dataset.member,btn.dataset.next,{note}),t('บันทึกสถานะการชำระจำลองแล้ว'));
    }
    else if(action==='order-transition'){
      if(!confirm(t('ยืนยันเปลี่ยนสถานะคำสั่งซื้อเดโม? ไม่มีการโอนหรือปล่อยเงินจริง')))return;
      orderChanged(transitionOrder(orderFor(id),state.user,btn.dataset.next),btn.dataset.next==='completed'?t('จบคำสั่งซื้อเดโมแล้ว ไม่มีการปล่อยเงินจริง'):t('บันทึกสถานะคำสั่งซื้อเดโมแล้ว'));
    }
    else if(action==='resolution-response'){
      if(!confirm(t('ยืนยันตอบข้อเสนอแก้ไขข้อพิพาทนี้? ผลคืนเงินเป็นเพียงบันทึกจำลอง')))return;
      const next=respondToResolution(orderFor(id),state.user,btn.dataset.dispute,btn.dataset.accept==='true');
      orderChanged(next,next.status==='refunded'?t('บันทึกผลคืนเงินจำลองแล้ว ไม่ได้คืนเงินจริง'):t('บันทึกคำตอบข้อเสนอแล้ว'));
    }
    else if(action==='edit-costs'){
      const g=group(id),value=prompt(t("ค่าส่งต่อคนใหม่ (บาท)"),bahtInput(g.costs.delivery));if(value===null)return;
      if(supabaseConfigured){await changeSupabaseDelivery(id,parseBaht(value));if(!await refreshSupabaseGroups(actionSession))return;}
      else{const next=changeCosts(g,state.user.id,{delivery:parseBaht(value)});updateGroup(next);next.members.forEach(u=>notice(t("ค่าใช้จ่ายเปลี่ยน"),t("ค่าส่งเปลี่ยน กรุณายืนยันยอดใหม่"),`/groups/${id}`,u));render();}
      alertMessage(t("ปรับยอดและเริ่มรอบยืนยันใหม่แล้ว"));
    }
    else if(action==='transfer'){
      const g=group(id),members=g.members.filter(u=>u!==state.user.id);if(!members.length)throw Error(t("ยังไม่มีสมาชิกให้โอนสิทธิ์"));
      document.querySelector('#transfer-group-dialog')?.remove();document.body.insertAdjacentHTML('beforeend',transferGroupDialog(g));
      const dialog=document.querySelector('#transfer-group-dialog');dialog.addEventListener('close',()=>dialog.remove(),{once:true});dialog.addEventListener('click',e=>{if(e.target===dialog)dialog.close();});dialog.showModal();
    }
  }catch(err){if(supabaseConfigured){if(actionSession!==activeSupabaseSession)return;try{await refreshSupabaseGroups(actionSession);}catch{/* Keep the explicit mutation error visible. */}}alertMessage(supabaseConfigured?authErrorMessage(err):errorMessage(err));}
});
document.addEventListener('submit',async e=>{
  const f=e.target,actionSession=activeSupabaseSession;
  if(f.id==='transfer-group-form'){
    e.preventDefault();
    try{
      const id=f.dataset.id,memberId=new FormData(f).get('memberId'),g=group(id),dialog=f.closest('dialog');
      if(!g||g.ownerId!==state.user?.id||!g.members.includes(memberId)||memberId===state.user.id)throw new Error(t('โอนหัวหน้ากลุ่มไม่ได้'));
      if(supabaseConfigured){await transferSupabaseGroup(id,memberId);if(!await refreshSupabaseGroups(actionSession))return;}
      else updateGroup(transferOwner(g,state.user.id,memberId));
      dialog?.close();render();alertMessage(t('โอนหัวหน้ากลุ่มแล้ว'));
    }catch(err){if(supabaseConfigured){if(actionSession!==activeSupabaseSession)return;try{await refreshSupabaseGroups(actionSession);}catch{/* Keep the explicit mutation error visible. */}}alertMessage(supabaseConfigured?authErrorMessage(err):errorMessage(err));}
    return;
  }
  if(['mockup-login-form','mockup-signup-form','mockup-address-form'].includes(f.id)){
    e.preventDefault();
    try{
      if(supabaseConfigured&&f.id==='mockup-login-form'){
        const email=document.getElementById('mockup-login-email').value.trim();
        const password=document.getElementById('mockup-login-pw').value;
        const {data,error}=await supabase.auth.signInWithPassword({email,password});
        if(error)throw error;
        await syncSupabaseSession(data.session);
      }else if(supabaseConfigured&&f.id==='mockup-signup-form'){
        if(document.getElementById('mockup-signup-pw').value!==document.getElementById('mockup-signup-confirm-pw').value)throw Object.assign(new Error(),{code:'authPasswordMismatch'});
        const email=document.getElementById('mockup-signup-email').value.trim();
        const password=document.getElementById('mockup-signup-pw').value;
        const display_name=document.getElementById('mockup-signup-name').value.trim();
        if(!display_name)throw Object.assign(new Error(),{code:'prototypeInvalidProfile'});
        const {data,error}=await supabase.auth.signUp({email,password,options:{data:{display_name},emailRedirectTo:location.href}});
        if(error)throw error;
        if(!data.session){
          authModalActive=false;mockupCurrentStep=1;render();
          alertMessage(t('ตรวจอีเมลเพื่อยืนยันบัญชีก่อนเข้าสู่ระบบ'));
          return;
        }
        await syncSupabaseSession(data.session);
      }else if(supabaseConfigured&&f.id==='mockup-address-form'){
        if(!state.user?.id)throw Object.assign(new Error(),{code:'orderUnauthorized'});
        const address=Object.fromEntries(['house-no','village-no','province','district','subdistrict','alley','road','postal-code','phone'].map(key=>[key.replace(/-([a-z])/g,(_,letter)=>letter.toUpperCase()),document.getElementById('mockup-'+key).value.trim()]));
        const userId=state.user.id;
        await saveAuthenticatedAddress(userId,address);
        if(state.user?.id!==userId)return;
        finishAuth({...state.user,address});
      }else if(f.id==='mockup-login-form'){
        const user=demoAccount(state.profiles,document.getElementById('mockup-login-email').value);
        if(user.address)finishAuth(user);else{tempSignupData=user;setMockupStep(3,f);}
      }else if(f.id==='mockup-signup-form'){
        if(document.getElementById('mockup-signup-pw').value!==document.getElementById('mockup-signup-confirm-pw').value)throw Error(t('⚠️ รหัสผ่านและการยืนยันรหัสผ่านไม่ตรงกัน'));
        const name=document.getElementById('mockup-signup-name').value.trim();
        if(!name)throw Object.assign(new Error(),{code:'prototypeInvalidProfile'});
        tempSignupData=demoAccount(state.profiles,document.getElementById('mockup-signup-email').value,name);
        setMockupStep(3,f);
      }else{
        if(!tempSignupData.email){setMockupStep(2,f);return;}
        const address=Object.fromEntries(['id-card','house-no','village-no','province','district','subdistrict','alley','road','postal-code','phone'].map(key=>[key.replace(/-([a-z])/g,(_,letter)=>letter.toUpperCase()),document.getElementById('mockup-'+key).value.trim()]));
        finishAuth({...tempSignupData,address});
      }
    }catch(err){alertMessage(supabaseConfigured?authErrorMessage(err):storageError(err));}
  }else if(f.id==='profile-form'){
    e.preventDefault();
    try{
      if(avatarLoading)throw Error(t('กำลังเตรียมรูป กรุณารอสักครู่'));
      const d=new FormData(f);
      if(supabaseConfigured){
        const name=String(d.get('name')||'').trim(),bio=String(d.get('bio')||'').trim();
        if(!name||name.length>70||bio.length>160)throw Object.assign(new Error(),{code:'prototypeInvalidProfile'});
        const userId=state.user.id;
        const {error}=await supabase.from('profiles').update({display_name:name,bio}).eq('id',userId);
        if(error)throw error;
        const {data:profile,error:readError}=await supabase.from('profiles').select('display_name,bio').eq('id',userId).single();
        if(readError)throw readError;
        if(state.user?.id!==userId)return;
        state={...state,user:{...state.user,name:profile.display_name,bio:profile.bio}};
        render();alertMessage(t('บันทึกโปรไฟล์แล้ว'));
        return;
      }
      const user=editProfile(state.user,{name:d.get('name'),email:d.get('email'),bio:d.get('bio'),avatar:profileAvatar});
      if(user.email&&Object.values(state.profiles||{}).some(profile=>profile.id!==user.id&&profile.email?.toLowerCase()===user.email))throw Error(t('อีเมลนี้ใช้กับบัญชีเดโมอื่นแล้ว'));
      save({...state,user,profiles:{...state.profiles,[user.id]:user}});
      render();alertMessage(t('บันทึกโปรไฟล์แล้ว'));
    }catch(err){alertMessage(storageError(err));}
  }else if(f.id==='search-form'){
    e.preventDefault();
    {const data=new FormData(f),category=data.get('category');go('/explore?q='+encodeURIComponent(String(data.get('q')||'').trim())+(category?'&category='+encodeURIComponent(category):''));}
  }else if(f.id==='create-form'){
    e.preventDefault();
    try{
      const d=new FormData(f);
      if(imagesLoading)throw Error(t('กำลังเตรียมรูป กรุณารอสักครู่'));
      if(!state.user)throw Object.assign(new Error(),{code:'orderUnauthorized'});
      const categories=[...new Set(getCreateCategoryValues(f))];
      if(!categories.length)throw new Error(t('เลือกอย่างน้อย 1 หมวดหมู่'));
      if(categories.some(category=>category.length>60))throw new Error(t('ชื่อหมวดหมู่ต้องไม่เกิน 60 ตัวอักษร'));
      if(!listing(d.get('listingId')))throw Error(t('ไม่พบสินค้า กรุณาเลือกสินค้าใหม่'));
      if(supabaseConfigured){
        const groupId=await createSupabaseGroup({listingId:d.get('listingId'),name:d.get('name'),categories,images:groupImages,visibility:d.get('visibility'),capacity:Number(d.get('capacity')),price:parseBaht(d.get('product')),delivery:parseBaht(d.get('delivery')),requestId:d.get('requestId')});
        if(!await refreshSupabaseGroups(actionSession))return;
        go(`/groups/${groupId}`);
        alertMessage(t('สร้างกลุ่มแล้ว'));
        return;
      }
      const g=createGroup({id:'g'+Date.now(),listingId:d.get('listingId'),name:d.get('name'),ownerId:state.user.id,visibility:d.get('visibility'),capacity:Number(d.get('capacity')),costs:formCosts(d)});
      g.category=categories[0];g.categories=categories;
      g.images=[...groupImages];
      const notification={id:crypto.randomUUID(),recipient:state.user.id,title:t('สร้างกลุ่มแล้ว'),body:t('ชวนสมาชิกเข้าร่วมเพื่อเริ่มหารค่าใช้จ่าย'),href:`/groups/${g.id}`,read:false,at:new Date().toISOString()};
      save({...state,groups:[g,...state.groups],notifications:[notification,...state.notifications]});
      groupImages=[];
      selectedCreateCategories=[];
      go(`/groups/${g.id}`);
      alertMessage(t("สร้างกลุ่มแล้ว"));
    }catch(err){alertMessage(storageError(err));}
  }else if(f.id==='group-chat-form'){
    e.preventDefault();
    const id=f.dataset.id,body=(new FormData(f).get('body')||'').trim();
    if(!body)return;
    const now=new Date();
    const timeStr=`${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
    const myMsg={
      id:`gm_${Date.now()}`,
      sender:state.user?.name||t('สมาชิกในกลุ่ม'),
      senderId:state.user?.id||'me',
      text:body,
      time:timeStr
    };
    saveGroupMessage(id,myMsg);
    render();
    const g=group(id);
    const otherMembers=g?.members?.filter(m=>m!==state.user?.id)||[];
    if(otherMembers.length&&!supabaseConfigured){
      setTimeout(()=>{
        const otherId=otherMembers[Math.floor(Math.random()*otherMembers.length)];
        const replyPool=[
          t('รับทราบครับ/ค่ะ! เดี๋ยวคุยกันอีกทีนะ'),
          t('โอเคเลย สะดวกตามนี้ครับ/ค่ะ'),
          t('เห็นด้วยครับ เตรียมพร้อมยืนยันยอดเลย')
        ];
        const chosenReply=replyPool[Math.floor(Math.random()*replyPool.length)];
        const replyNow=new Date();
        const replyTime=`${String(replyNow.getHours()).padStart(2,'0')}:${String(replyNow.getMinutes()).padStart(2,'0')}`;
        const replyMsg={
          id:`gm_${Date.now()}`,
          sender:name(otherId).replace(/\s*\(หัวหน้ากลุ่ม\)$/,''),
          senderId:otherId,
          text:chosenReply,
          time:replyTime
        };
        saveGroupMessage(id,replyMsg);
        notice(t('ข้อความใหม่ในกลุ่ม'),escape(g.name),`/groups/${id}/chat`);
        if(location.pathname===`/groups/${id}/chat`)render();
      },750);
    }
  }else if(f.id==='chat-form'){
    e.preventDefault();
    const id=f.dataset.id,body=new FormData(f).get('body').trim();
    if(!body)return;
    state.conversations[id]??=[];
    state.conversations[id].push({from:'me',body,at:new Date().toISOString()});
    state.conversations[id].push({from:'seller',body:t("ขอบคุณที่ติดต่อค่ะ นี่คือคำตอบจำลอง กรุณาตรวจสอบรายละเอียดสินค้าก่อนตกลงจริง"),at:new Date().toISOString()});
    save();
    notice(t("ผู้ขายตอบข้อความ"),t('มีข้อความตอบกลับจำลองจาก {name}',{name:seller(id).name}),`/chat/${id}`);
    render();
  }else if(['order-form','shipment-form','dispute-form','resolution-form'].includes(f.id)){
    e.preventDefault();
    try{
      const id=f.dataset.id,d=new FormData(f),current=orderFor(id);
      let next,feedback=t('บันทึกสถานะคำสั่งซื้อเดโมแล้ว');
      if(f.id==='order-form'){
        const g=group(id),options={hours:Number(d.get('hours'))};
        if(!confirm(t('สร้างคำสั่งซื้อเดโมและล็อกสมาชิกกับยอดที่ยืนยันแล้ว?')))return;
        next=current?activateOrder(current,g,listing(g.listingId),state.user,options):createOrder(g,listing(g.listingId),state.user,options);
      }else if(f.id==='shipment-form'){
        next=updateShipment(current,state.user,{carrier:d.get('carrier'),trackingNumber:d.get('trackingNumber'),url:d.get('url')});
      }else if(f.id==='dispute-form'){
        if(!confirm(t('ยืนยันส่งรายงาน? คำสั่งซื้อจะหยุดรอแก้ไขข้อพิพาท และไม่มีการคืนเงินอัตโนมัติ')))return;
        next=openDispute(current,state.user,{reason:d.get('reason'),description:d.get('description'),evidence:d.get('evidence')});
        feedback=t('เปิดข้อพิพาทแล้ว คำสั่งซื้อหยุดรอการแก้ไข');
      }else{
        if(!confirm(t('ยืนยันเสนอผลลัพธ์? ต้องรอผู้รายงานยอมรับก่อนปิดเรื่อง')))return;
        next=proposeResolution(current,state.user,f.dataset.dispute,{decision:d.get('decision'),note:d.get('note')});
        feedback=t('เสนอผลลัพธ์แล้ว รอผู้รายงานยอมรับ');
      }
      orderChanged(next,feedback);
    }catch(err){alertMessage(errorMessage(err));}
  }else if(f.id==='product-form'){
    e.preventDefault();
    try{
      const d=new FormData(f),p={id:'p'+Date.now(),title:d.get('title').trim(),category:d.get('category'),kind:'สินค้า',price:parseBaht(d.get('price')),sellerId:sellerIdFor(state.user),art:'custom',mark:'NEW',description:d.get('description').trim(),terms:d.get('terms').trim()};
      assertListingSeller(p,state.user);
      if(!p.title||!p.description||!p.terms)throw Error(t("กรุณากรอกข้อมูลให้ครบ"));
      state.customListings.unshift(p);
      save();
      go(`/groups/create?product=${p.id}`);
      alertMessage(t("เพิ่มรายการเดโมแล้ว"));
    }catch(err){alertMessage(errorMessage(err));}
  }
});
document.addEventListener('input',e=>{
  if(e.target.closest('#create-form'))updatePreview();
  if(e.target.name==='bio'&&e.target.closest('#profile-form'))document.querySelector('#bio-counter').textContent=`${e.target.value.length} / 160`;
  if(e.target.id === 'mockup-id-card'){
    let val = e.target.value.replace(/\D/g, '');
    if (val.length > 13) val = val.substring(0, 13);
    let f = '';
    if (val.length > 0) f += val.substring(0, 1);
    if (val.length > 1) f += '-' + val.substring(1, 5);
    if (val.length > 5) f += '-' + val.substring(5, 10);
    if (val.length > 10) f += '-' + val.substring(10, 12);
    if (val.length > 12) f += '-' + val.substring(12, 13);
    e.target.value = f;
  }
  if(e.target.id === 'mockup-phone'){
    let val = e.target.value.replace(/\D/g, '');
    if (val.length > 10) val = val.substring(0, 10);
    let f = '';
    if (val.length > 0) f += val.substring(0, 3);
    if (val.length > 3) f += '-' + val.substring(3, 6);
    if (val.length > 6) f += '-' + val.substring(6, 10);
    e.target.value = f;
  }
});

function authErrorMessage(error){
  const code=error?.code||'';
  const message=String(error?.message||'').toLowerCase();
  if(error?.code==='groupTotalMismatch')return t('ข้อมูลยอดจากฐานข้อมูลไม่ตรงกับสูตรแอป กรุณาติดต่อผู้ดูแล');
  if(code==='PGRST202'&&(message.includes('remove_group_member')||message.includes('delete_group')))return t('ฐานข้อมูลยังไม่มีระบบจัดการห้อง กรุณารัน migration ล่าสุดของ Supabase');
  if(message.includes('group_locked'))return t('ฐานข้อมูลยังใช้กติกาเตะสมาชิกเวอร์ชันเก่า กรุณารัน migration ล่าสุดของ Supabase');
  if(error?.code==='groupHasMembers'||message.includes('group_has_members'))return t('ลบห้องได้เฉพาะเมื่อไม่มีสมาชิกคนอื่นอยู่');
  if(error?.code==='groupTotalOutOfRange'||message.includes('group_total_out_of_range'))return t('ยอดรวมเกินขอบเขตที่รองรับ');
  if(message.includes('invite_invalid'))return t('คำเชิญไม่ถูกต้องหรือหมดอายุ');
  if(message.includes('full_group'))return t('กลุ่มเต็มแล้ว');
  if(message.includes('already_member'))return t('คุณเป็นสมาชิกกลุ่มนี้แล้ว');
  if(message.includes('owner_must_transfer'))return t('หัวหน้ากลุ่มต้องโอนสิทธิ์ก่อนออก');
  if(message.includes('owner_only'))return t('เฉพาะหัวหน้ากลุ่มแก้ไขค่าใช้จ่ายได้');
  if(message.includes('stale_revision'))return t('ยอดมีการเปลี่ยน กรุณาโหลดข้อมูลล่าสุด');
  if(message.includes('failed to fetch')||message.includes('networkerror'))return t('เชื่อมต่อ Supabase ไม่สำเร็จ กรุณาตรวจอินเทอร์เน็ตแล้วลองอีกครั้ง');
  if(code==='authPasswordMismatch')return t('รหัสผ่านและการยืนยันรหัสผ่านไม่ตรงกัน');
  if(code==='googleProviderDisabled')return t('ยังไม่ได้เปิดใช้ Google OAuth');
  if(code==='invalid_credentials'||message.includes('invalid login credentials'))return t('อีเมลหรือรหัสผ่านไม่ถูกต้อง');
  if(code==='user_already_exists'||message.includes('user already registered'))return t('อีเมลนี้มีบัญชีแล้ว กรุณาเข้าสู่ระบบ');
  if(code==='email_not_confirmed'||message.includes('email not confirmed'))return t('กรุณายืนยันอีเมลก่อนเข้าสู่ระบบ');
  if(code==='weak_password'||message.includes('password should be'))return t('รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร');
  if(error?.code==='orderUnauthorized')return t('orderUnauthorized');
  return t('เกิดข้อผิดพลาด กรุณาลองใหม่');
}

async function fetchSupabaseState(authUser){
  const inviteToken=new URLSearchParams(location.search).get('invite');
  const routeGroup=location.pathname.match(/^\/groups\/([^/]+)(?:\/join)?$/)?.[1];
  const user=authUser?await loadAuthenticatedUser(authUser):null;
  const snapshot=await loadSupabaseGroups();
  if(authUser&&inviteToken&&routeGroup){
    try{const invite=await resolveSupabaseInvite(routeGroup,inviteToken,authUser.id);
      if(invite){snapshot.groups=[invite.group,...snapshot.groups.filter(group=>group.id!==invite.group.id)];Object.assign(snapshot.names,invite.names);}
    }catch(error){if(!String(error?.message||'').toLowerCase().includes('invite_invalid'))throw error;}
  }
  return {user,snapshot};
}

async function refreshSupabaseGroups(session=activeSupabaseSession){
  if(!supabaseConfigured)return;
  if(session!==activeSupabaseSession)return;
  const snapshot=await syncSupabaseSession(session);
  if(groupsError)throw groupsError;
  return snapshot;
}

function beginSupabaseSession(session){
  authSessionSync.invalidate();
  activeSupabaseSession=session;
  if((state.user?.id||null)!==(session?.user?.id||null)){
    state={...state,user:null,groups:[],profiles:{}};
    tempSignupData={};authModalActive=false;mockupCurrentStep=1;
  }
  groupsLoading=true;groupsError=null;render();
}

if(supabaseConfigured){
  authSessionSync=createAuthSessionSync({
    loadUser:fetchSupabaseState,
    applyUser:result=>{
      state={...state,user:result.user,groups:result.snapshot.groups,profiles:result.snapshot.names,remoteListings:result.snapshot.listings,remoteSellers:result.snapshot.sellers};
      groupsLoading=false;groupsError=null;
      if(result.user&&!result.user.address){tempSignupData=result.user;mockupCurrentStep=3;authModalActive=true;render();return result.snapshot;}
      if(result.user&&(['/login','/register'].includes(location.pathname)||sessionStorage.getItem('harn-return')))finishAuth(result.user);
      else{if(!result.user){authModalActive=false;tempSignupData={};}render();}
      return result.snapshot;
    },
    onError:error=>{state={...state,user:null,groups:[],profiles:{}};groupsLoading=false;groupsError=error;render();alertMessage(authErrorMessage(error));},
  });
  syncSupabaseSession=session=>{beginSupabaseSession(session);return authSessionSync.sync(session);};
}

document.addEventListener('keydown',e=>{
  if(e.key==='Escape'&&mobileMenuOpen){mobileMenuOpen=false;document.body.classList.remove('mobile-menu-open');render();}
});
window.addEventListener('scroll',()=>{
  const header=document.querySelector('.site-header');
  if(!header)return;
  header.classList.toggle('is-scrolled',window.scrollY>48);
},{passive:true});
window.addEventListener('popstate',render);
render();
if(supabaseConfigured){
  refreshAuthProviders().then(()=>{if(authModalActive||location.pathname==='/login'||location.pathname==='/register')render();});
  supabase.auth.onAuthStateChange((event,session)=>{
    beginSupabaseSession(session);
    const sync=()=>{if(activeSupabaseSession===session)void authSessionSync.sync(session);};
    if(event!=='INITIAL_SESSION')setTimeout(sync,0);
    else sync();
  });
}

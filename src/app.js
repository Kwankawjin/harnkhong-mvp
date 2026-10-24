import './style.css';
import {listings as seedListings, sellers, demoNames, initialState} from './data.js';
import {assertCapacity, createGroup, totalCost, shares, joinGroup, leaveGroup, approve, changeCosts, parseBaht, allApproved, transferOwner} from './domain.js';
import {messages, translate, formatSatang, bahtInput} from './i18n.js';
import {createOrder,activateOrder,migrateOrders,lockOrderedGroups,orderPermissions,reportPayment,updatePayment,transitionOrder,updateShipment,openDispute,proposeResolution,respondToResolution,DISPUTE_REASONS,sellerIdFor,assertListingSeller} from './orders.js';

const LOCALE_KEY='harnkhong-locale';
let locale='th';
try { if(localStorage.getItem(LOCALE_KEY)==='en')locale='en'; } catch { /* Keep Thai when storage is unavailable. */ }
const t=(key,values)=>translate(locale,key,values);
const errorMessage=error=>messages[locale][error.code]??error.message??t('เกิดข้อผิดพลาด กรุณาลองใหม่');

const KEY='harnkhong-demo-v1';
let state;
try { state={...initialState(),...JSON.parse(localStorage.getItem(KEY)||'{}')}; } catch { state=initialState(); }
const save=(next=state)=>{localStorage.setItem(KEY,JSON.stringify(next));state=next;};
const restoredOrders=migrateOrders(state.orders,state.groups,[...seedListings,...state.customListings]);
const restoredGroups=lockOrderedGroups(state.groups,restoredOrders);
if(restoredOrders.some((o,i)=>o!==state.orders[i])||restoredGroups.some((g,i)=>g!==state.groups[i])) {
  // Keep the original stored data if upgrading cannot be saved.
  try {save({...state,orders:restoredOrders,groups:restoredGroups});} catch {state={...state,orders:restoredOrders,groups:restoredGroups};}
}
const listings=()=>[...seedListings,...state.customListings];
const listing=id=>listings().find(x=>x.id===id);
const seller=id=>sellers.find(x=>x.id===id)||{id,name:t('ร้านตัวอย่าง'),intro:t("ผู้ขายในโหมดเดโม"),initials:'DE'};
const group=id=>state.groups.find(x=>x.id===id);
const name=id=>id===state.user?.id?state.user.name:(demoNames[id]||t("สมาชิกเดโม"));
const money=n=>formatSatang(n,locale);
const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const icon=(id,size=22)=>`<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><use href="#i-${id}"/></svg>`;
const icons=`<svg xmlns="http://www.w3.org/2000/svg" style="position:absolute;width:0;height:0;overflow:hidden"><symbol id="i-home" viewBox="0 0 24 24"><path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z"/><path d="M9 21v-7h6v7"/></symbol><symbol id="i-search" viewBox="0 0 24 24"><circle cx="10.8" cy="10.8" r="7"/><path d="m16 16 5 5"/></symbol><symbol id="i-users" viewBox="0 0 24 24"><circle cx="9" cy="8" r="3"/><path d="M2 20v-2a6 6 0 0 1 12 0v2zM17 11a3 3 0 1 0-1-5.8M16 15a5 5 0 0 1 6 5"/></symbol><symbol id="i-chat" viewBox="0 0 24 24"><path d="M4 4h16v13H8l-4 3z"/><path d="M8 9h8M8 13h5"/></symbol><symbol id="i-user" viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></symbol><symbol id="i-bell" viewBox="0 0 24 24"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 8-3 9h18c0-1-3-2-3-9ZM10 21h4"/></symbol><symbol id="i-arrow" viewBox="0 0 24 24"><path d="M5 12h14m-6-6 6 6-6 6"/></symbol><symbol id="i-check" viewBox="0 0 24 24"><path d="m5 12 4 4L19 6"/></symbol><symbol id="i-plus" viewBox="0 0 24 24"><path d="M12 4v16M4 12h16"/></symbol><symbol id="i-back" viewBox="0 0 24 24"><path d="m14 5-7 7 7 7"/></symbol><symbol id="i-lock" viewBox="0 0 24 24"><rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></symbol><symbol id="i-link" viewBox="0 0 24 24"><path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-2 2M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l2-2"/></symbol><symbol id="i-shield" viewBox="0 0 24 24"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></symbol><symbol id="i-sparkles" viewBox="0 0 24 24"><path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3L12 3z"/></symbol><symbol id="i-calc" viewBox="0 0 24 24"><rect x="4" y="2" width="16" height="20" rx="2"/><line x1="8" y1="6" x2="16" y2="6"/><line x1="16" y1="14" x2="16" y2="18"/><path d="M16 10h.01M12 10h.01M8 10h.01M12 14h.01M8 14h.01M12 18h.01M8 18h.01"/></symbol><symbol id="i-trending" viewBox="0 0 24 24"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></symbol><symbol id="i-fire" viewBox="0 0 24 24"><path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/></symbol></svg>`;
const a=(href,label,cls='')=>`<a href="${href}" data-link class="${cls}">${label}</a>`;
function go(path){history.pushState({},'',path);render();window.scrollTo(0,0);}
let authModalActive = false;
let mockupCurrentStep = 1;
let tempSignupData = {};

function isAuthRequired(href) {
  if (!href) return false;
  const path = href.split('?')[0];
  if (['/my-groups', '/chat', '/profile', '/notifications', '/groups/create', '/seller/dashboard', '/seller/products/new'].includes(path)) {
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
  if (isAuthRequired(location.pathname)) {
    go('/');
  } else {
    render();
  }
}

function setMockupStep(step, triggerElement = null) {
  mockupCurrentStep = step;
  const chassis = triggerElement ? triggerElement.closest('.phone-chassis') : null;
  const targets = chassis ? [chassis] : document.querySelectorAll('.phone-chassis');
  targets.forEach(c => {
    c.querySelectorAll('.mockup-screen').forEach((s, idx) => {
      s.classList.toggle('active', idx + 1 === step);
    });
    c.querySelectorAll('.mockup-step-btn').forEach((b, idx) => {
      b.classList.toggle('active', idx + 1 === step);
    });
  });
}

function fillMockupDemo() {
  document.querySelectorAll('#mockup-login-email').forEach(el => { el.value = 'somchai.demo@example.com'; });
  document.querySelectorAll('#mockup-login-pw').forEach(el => { el.value = 'Password123!'; });

  document.querySelectorAll('#mockup-signup-name').forEach(el => { el.value = 'สมชาย ใจดี'; });
  document.querySelectorAll('#mockup-signup-email').forEach(el => { el.value = 'somchai.jaidee@gmail.com'; });
  document.querySelectorAll('#mockup-signup-pw').forEach(el => { el.value = 'Secret999!'; });
  document.querySelectorAll('#mockup-signup-confirm-pw').forEach(el => { el.value = 'Secret999!'; });

  document.querySelectorAll('#mockup-id-card').forEach(el => { el.value = '1-1020-03456-78-9'; });
  document.querySelectorAll('#mockup-house-no').forEach(el => { el.value = '128/45'; });
  document.querySelectorAll('#mockup-village-no').forEach(el => { el.value = '3'; });
  document.querySelectorAll('#mockup-province').forEach(el => { el.value = 'กรุงเทพมหานคร'; });
  document.querySelectorAll('#mockup-district').forEach(el => { el.value = 'ปทุมวัน'; });
  document.querySelectorAll('#mockup-subdistrict').forEach(el => { el.value = 'ลุมพินี'; });
  document.querySelectorAll('#mockup-alley').forEach(el => { el.value = 'ซอยร่วมฤดี'; });
  document.querySelectorAll('#mockup-road').forEach(el => { el.value = 'เพลินจิต'; });
  document.querySelectorAll('#mockup-postal-code').forEach(el => { el.value = '10330'; });
  document.querySelectorAll('#mockup-phone').forEach(el => { el.value = '089-123-4567'; });

  alertMessage(t("กรอกข้อมูลตัวอย่างใน Mockup เรียบร้อยแล้ว"));
}

function renderPhoneMockup(initialStep = 1, isModal = true) {
  return `
    <div class="auth-modal-container">
      ${isModal ? `<button type="button" class="btn-close-auth" data-action="close-auth" title="${t("ปิดหน้าต่าง")}">✕</button>` : ''}
      <div class="phone-chassis">
        <div class="hw-button hw-action"></div>
        <div class="hw-button hw-volume-up"></div>
        <div class="hw-button hw-volume-down"></div>
        <div class="hw-button hw-power"></div>

        <div class="phone-screen">
          <div class="screen-glare"></div>

          <!-- Status Bar -->
          <div class="phone-status-bar">
            <span>09:41</span>
            <div class="dynamic-island">
              <div class="island-camera"></div>
              <div class="island-sensor"></div>
            </div>
            <div class="status-icons">
              <svg width="15" height="10" viewBox="0 0 16 11" fill="currentColor">
                <rect x="0" y="8" width="2.5" height="3" rx="0.5"/>
                <rect x="4.2" y="6" width="2.5" height="5" rx="0.5"/>
                <rect x="8.5" y="3.5" width="2.5" height="7.5" rx="0.5"/>
                <rect x="12.8" y="0.5" width="2.5" height="10.5" rx="0.5"/>
              </svg>
              <div class="battery-icon"><div class="battery-fill"></div></div>
            </div>
          </div>

          <!-- Quick Autofill Helper -->
          <div class="mockup-quick-actions">
            <span>📱 ${t("โหมดจำลองสำหรับมือถือ")}</span>
            <button type="button" class="mockup-autofill-btn" data-action="mockup-autofill">⚡ ${t("ข้อมูลตัวอย่าง")}</button>
          </div>

          <!-- Step Switcher Inside Phone -->
          <div class="mockup-stepper">
            <button type="button" class="mockup-step-btn ${initialStep === 1 ? 'active' : ''}" data-action="mockup-step" data-step="1">1. ${t("เข้าสู่ระบบ")}</button>
            <button type="button" class="mockup-step-btn ${initialStep === 2 ? 'active' : ''}" data-action="mockup-step" data-step="2">2. ${t("สมัครสมาชิก")}</button>
            <button type="button" class="mockup-step-btn ${initialStep === 3 ? 'active' : ''}" data-action="mockup-step" data-step="3">3. ${t("ที่อยู่")}</button>
          </div>

          <!-- Scrollable Phone Viewport -->
          <div class="phone-viewport">
            
            <!-- SCREEN 1: LOGIN -->
            <div class="mockup-screen ${initialStep === 1 ? 'active' : ''}" id="m-screen-1">
              <h2 class="mockup-title text-center">${t("เข้าสู่ระบบ")}</h2>
              <form id="mockup-login-form" class="mockup-form">
                <div class="mockup-input-group">
                  <input type="email" id="mockup-login-email" class="mockup-input" placeholder="${t("อีเมล")}" required autocomplete="email">
                </div>
                <div class="mockup-input-group">
                  <input type="password" id="mockup-login-pw" class="mockup-input" placeholder="${t("รหัสผ่าน")}" required autocomplete="current-password">
                  <button type="button" class="btn-toggle-mockup-pw" data-action="toggle-mockup-pw" data-target="mockup-login-pw">👁</button>
                </div>
                <button type="submit" class="mockup-btn-primary">${t("เข้าสู่ระบบ")}</button>
                
                <div class="mockup-social-circular">
                  <button type="button" class="mockup-circle-btn" data-action="mockup-social" data-provider="Google" title="Google">
                    <svg width="20" height="20" viewBox="0 0 24 24"><path fill="#4285F4" d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17z"/><path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.25v3.15C3.26 21.36 7.33 24 12 24z"/><path fill="#FBBC05" d="M5.28 14.27c-.25-.72-.38-1.49-.38-2.27s.13-1.55.38-2.27V6.58H1.25C.45 8.18 0 10.03 0 12s.45 3.82 1.25 5.42l4.03-3.15z"/><path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.33 0 3.26 2.64 1.25 6.58l4.03 3.15c.95-2.83 3.6-4.98 6.72-4.98z"/></svg>
                  </button>
                  <button type="button" class="mockup-circle-btn" data-action="mockup-social" data-provider="Facebook" title="Facebook">
                    <svg width="20" height="20" viewBox="0 0 24 24"><circle cx="12" cy="12" r="12" fill="#1877F2"/><path fill="#FFFFFF" d="M15.4 12h-2.3v7.9h-3.3V12h-1.6V9.3h1.6V7.4c0-2.2 1.3-3.4 3.3-3.4 1 0 1.8.1 2.1.1v2.4h-1.4c-1.1 0-1.3.5-1.3 1.3v1.5h2.7l-.4 2.7z"/></svg>
                  </button>
                  <button type="button" class="mockup-circle-btn" data-action="mockup-social" data-provider="Apple" title="Apple">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="#000"><path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.81-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M15.97 6.37c.62-.75 1.04-1.8 0.93-2.85-.9.04-1.99.6-2.63 1.35-.57.65-1.06 1.72-.93 2.73 1.01.08 2.03-.5 2.63-1.23z"/></svg>
                  </button>
                </div>

                <a href="javascript:void(0)" class="mockup-switch-link" data-action="mockup-step" data-step="2">${t("สมัครสมาชิก")}</a>
              </form>
            </div>

            <!-- SCREEN 2: SINGUP -->
            <div class="mockup-screen ${initialStep === 2 ? 'active' : ''}" id="m-screen-2">
              <h2 class="mockup-title text-center">${t("สมัครสมาชิก")}</h2>
              <form id="mockup-signup-form" class="mockup-form">
                <div class="mockup-input-group">
                  <input type="text" id="mockup-signup-name" class="mockup-input" placeholder="${t("ชื่อ")}" required autocomplete="name">
                </div>
                <div class="mockup-input-group">
                  <input type="email" id="mockup-signup-email" class="mockup-input" placeholder="${t("อีเมล")}" required autocomplete="email">
                </div>
                <div class="mockup-input-group">
                  <input type="password" id="mockup-signup-pw" class="mockup-input" placeholder="${t("รหัสผ่าน")}" required autocomplete="new-password">
                  <button type="button" class="btn-toggle-mockup-pw" data-action="toggle-mockup-pw" data-target="mockup-signup-pw">👁</button>
                </div>
                <div class="mockup-input-group">
                  <input type="password" id="mockup-signup-confirm-pw" class="mockup-input" placeholder="${t("ยืนยันรหัสผ่าน")}" required autocomplete="new-password">
                  <button type="button" class="btn-toggle-mockup-pw" data-action="toggle-mockup-pw" data-target="mockup-signup-confirm-pw">👁</button>
                </div>
                <button type="submit" class="mockup-btn-primary">${t("ต่อไป (กรอกที่อยู่)")}</button>

                <div class="mockup-social-stacked">
                  <button type="button" class="mockup-pill-btn" data-action="mockup-social" data-provider="Google">
                    <svg width="16" height="16" viewBox="0 0 24 24"><path fill="#4285F4" d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17z"/><path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.25v3.15C3.26 21.36 7.33 24 12 24z"/><path fill="#FBBC05" d="M5.28 14.27c-.25-.72-.38-1.49-.38-2.27s.13-1.55.38-2.27V6.58H1.25C.45 8.18 0 10.03 0 12s.45 3.82 1.25 5.42l4.03-3.15z"/><path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.33 0 3.26 2.64 1.25 6.58l4.03 3.15c.95-2.83 3.6-4.98 6.72-4.98z"/></svg>
                    <span>${t("สมัครด้วย Google")}</span>
                  </button>
                  <button type="button" class="mockup-pill-btn" data-action="mockup-social" data-provider="Facebook">
                    <svg width="16" height="16" viewBox="0 0 24 24"><circle cx="12" cy="12" r="12" fill="#1877F2"/><path fill="#FFFFFF" d="M15.4 12h-2.3v7.9h-3.3V12h-1.6V9.3h1.6V7.4c0-2.2 1.3-3.4 3.3-3.4 1 0 1.8.1 2.1.1v2.4h-1.4c-1.1 0-1.3.5-1.3 1.3v1.5h2.7l-.4 2.7z"/></svg>
                    <span>${t("สมัครด้วย Facebook")}</span>
                  </button>
                </div>

                <a href="javascript:void(0)" class="mockup-switch-link muted" data-action="mockup-step" data-step="1">${t("มีบัญชีอยู่แล้ว?")} <u>${t("เข้าสู่ระบบ")}</u></a>
              </form>
            </div>

            <!-- SCREEN 3: กรอกที่อยู่ -->
            <div class="mockup-screen ${initialStep === 3 ? 'active' : ''}" id="m-screen-3">
              <h2 class="mockup-title thai-title">${t("กรอกที่อยู่")}</h2>
              <p class="mockup-subtitle">${t("ก่อนกดยืนยันตรวจสอบข้อมูลของท่านให้เรียบร้อย")}</p>

              <form id="mockup-address-form" class="mockup-form mockup-address-form">
                <div class="mockup-input-group">
                  <input type="text" id="mockup-id-card" class="mockup-input" placeholder="${t("เลขบัตรประชาชน")}" maxlength="17" inputmode="numeric" required>
                </div>
                <div class="mockup-input-grid-2">
                  <input type="text" id="mockup-house-no" class="mockup-input" placeholder="${t("บ้านเลขที่")}" required>
                  <input type="text" id="mockup-village-no" class="mockup-input" placeholder="${t("หมู่")}">
                </div>
                <div class="mockup-input-grid-2">
                  <input type="text" id="mockup-province" class="mockup-input" placeholder="${t("จังหวัด")}" required>
                  <input type="text" id="mockup-district" class="mockup-input" placeholder="${t("อำเภอ")}" required>
                </div>
                <div class="mockup-input-grid-2">
                  <input type="text" id="mockup-subdistrict" class="mockup-input" placeholder="${t("ตำบล")}" required>
                  <input type="text" id="mockup-alley" class="mockup-input" placeholder="${t("ซอย")}">
                </div>
                <div class="mockup-input-grid-2">
                  <input type="text" id="mockup-road" class="mockup-input" placeholder="${t("ถนน")}">
                  <input type="text" id="mockup-postal-code" class="mockup-input" placeholder="${t("รหัสไปรษณีย์")}" maxlength="5" inputmode="numeric" required>
                </div>
                <div class="mockup-input-group">
                  <input type="tel" id="mockup-phone" class="mockup-input" placeholder="${t("เบอร์มือถือ")}" maxlength="12" inputmode="tel" required>
                </div>

                <button type="submit" class="mockup-btn-primary" style="margin-top: 4px;">${t("ยืนยันข้อมูล")}</button>
              </form>
            </div>

          </div>

          <!-- Home Indicator -->
          <div class="phone-home-indicator"></div>
        </div>
      </div>
    </div>
  `;
}

function requireAuth(path){
  if(!state.user){
    sessionStorage.setItem('harn-return', path);
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
        ${renderPhoneMockup(1, false)}
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
const actorName=id=>id===state.user?.id?state.user.name:demoNames[id]||(id==='demo-seller'?seller('s1').name:id==='demo-seller-s2'?seller('s2').name:id||t('ระบบนำเข้าข้อมูลเดิม'));
const orderStatus=status=>t('orderStatus_'+status);
const paymentStatus=status=>t('paymentStatus_'+status);
function alertMessage(msg){document.querySelector('#toast').textContent=msg;document.querySelector('#toast').classList.add('show');setTimeout(()=>document.querySelector('#toast')?.classList.remove('show'),3500);}
const title=(heading,sub='')=>`<div class="page-heading"><h1>${heading}</h1>${sub?`<p>${sub}</p>`:''}</div>`;
const art=item=>`<div class="product-art ${escape(item.art)}"><span>${escape(item.mark)}</span><small>${escape(t(item.category))}</small></div>`;
function listingCard(p){
  const groups = state.groups.filter(g => g.listingId === p.id && g.visibility === 'public' && g.status !== 'cancelled');
  const g = groups[0];
  const s = seller(p.sellerId);
  return `
    <article class="listing-card">
      <div class="card-media-wrapper">
        ${a(`/products/${p.id}`, art(p), 'art-link')}
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
          <span class="store-rating">★ 4.9</span>
        </div>
        ${a(`/products/${p.id}`, `<h3 class="listing-title">${escape(p.title)}</h3>`)}
        <p class="listing-desc">${escape(p.description)}</p>
        <div class="listing-pricing-box">
          <div class="price-full">
            <small>${t("ราคารวมเต็ม")}</small>
            <span>${money(p.price)}</span>
          </div>
          <div class="price-split">
            <small>${g ? t("หารเริ่มต้น") : t("ประมาณต่อคน")}</small>
            <strong>${money(g ? Math.ceil(totalCost(g.costs) / g.capacity) : Math.ceil(p.price / 4))}<small> ${t("/คน")}</small></strong>
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
          ${a(`/products/${p.id}`, `${t("ดูรายละเอียดและกลุ่ม")} ${icon('arrow', 16)}`, 'button outline full')}
        </div>
      </div>
    </article>
  `;
}

function groupCard(g){
  const p = listing(g.listingId);
  const remaining = g.capacity - g.members.length;
  const pct = Math.round((g.members.length / g.capacity) * 100);
  const perPerson = Math.ceil(totalCost(g.costs) / g.capacity);
  return `
    <article class="group-card">
      <div class="group-card-header">
        <div class="group-badges">
          <span class="chip-visibility">${g.visibility === 'link' ? t("🔒 ลิงก์ส่วนตัว") : t("🌐 กลุ่มสาธารณะ")}</span>
          <span class="status-pill ${g.status}">${g.status === 'ready' ? t("✓ พร้อมสรุปคำสั่งซื้อ") : t("⏳ รอสมาชิกครบ")}</span>
        </div>
        ${remaining === 1 ? `<span class="urgency-badge hot">${icon('fire', 14)} ${t("ว่างที่เดียว!")}</span>` : `<span class="urgency-badge">${t('ว่าง {count} ที่',{count:remaining})}</span>`}
      </div>

      ${a(`/groups/${g.id}`, `<h3 class="group-title">${escape(g.name)}</h3>`)}
      <div class="group-product-name">
        <span>📦</span>
        <span>${escape(p?.title || t("รายการสินค้า"))}</span>
      </div>

      <div class="group-members-row">
        <div class="member-avatars-group">
          ${g.members.slice(0, 4).map(mid => `<span class="member-avatar-pill" title="${escape(name(mid))}">${escape(name(mid).slice(0, 1))}</span>`).join('')}
          ${remaining > 0 ? `<span class="member-avatar-pill empty-slot">+${remaining}</span>` : ''}
        </div>
        <div class="members-count-label">
          ${icon('users', 16)}
          <span>${t('{count}/{capacity} คน',{count:'<b>'+g.members.length+'</b>',capacity:g.capacity})}</span>
        </div>
      </div>

      <div class="progress-wrap">
        <div class="progress-bar-bg">
          <div class="progress-bar-fill" style="width: ${pct}%"></div>
        </div>
        <div class="progress-text-row">
          <span>${t("ความคืบหน้า")}</span>
          <span>${pct}%</span>
        </div>
      </div>

      <div class="group-pricing-row">
        <div class="price-original">
          <small>${t("ราคารวมกลุ่ม")}</small>
          <span>${money(totalCost(g.costs))}</span>
        </div>
        <div class="price-per-person">
          <small>${t("ตกเพียง")}</small>
          <strong>${money(perPerson)}<small> ${t("/คน")}</small></strong>
        </div>
      </div>

      <div class="group-card-footer">
        ${a(`/groups/${g.id}`, `${t("ดูกลุ่มและเข้าร่วม")} ${icon('arrow', 16)}`, 'button primary full')}
      </div>
    </article>
  `;
}

function home(){
  const activeGroups = state.groups.filter(g => g.visibility === 'public' && g.members.length < g.capacity);
  const categoriesList = [
    { name: 'ทั้งหมด', symbol: '✳', query: 'ทั้งหมด' },
    { name: 'เครื่องเขียน', symbol: '📄', query: 'เครื่องเขียน' },
    { name: 'ของใช้', symbol: '🧼', query: 'ของใช้' },
    { name: 'งานพิมพ์', symbol: '🖨️', query: 'งานพิมพ์' }
  ];

  return `
    <section class="hero">
      <div class="hero-text">
        <span class="home-kicker">${icon('sparkles', 15)} ${t("แพลตฟอร์มหารของและบริการที่โปร่งใส")}</span>
        <h1>${t("ของดี ๆ")}<br><em>${t("หารกันได้!")}</em></h1>
        <p>${t("ชวนเพื่อนเปิดกลุ่มซื้อสินค้าราคาส่ง ของใช้จำเป็น หรือแพ็กเกจสุดคุ้ม คำนวณเศษสตางค์เป๊ะ เห็นยอดโปร่งใสก่อนตกลงสั่งซื้อจริง")}</p>

        <form class="hero-search" id="search-form">
          <span>${icon('search', 20)}</span>
          <input name="q" placeholder="${t("ค้นหากระดาษ A4, กล่องข้าว, งานพิมพ์...")}" aria-label="${t("ค้นหาสินค้าหรือบริการ")}"/>
          <button type="submit">${t("ค้นหา")}</button>
        </form>

        <div class="hero-quick-tags">
          <span>${t("ค้นหายอดนิยม:")}</span>
          <button type="button" class="hero-tag" data-action="quick-search" data-query="กระดาษ">${t("📄 กระดาษ A4")}</button>
          <button type="button" class="hero-tag" data-action="quick-search" data-query="กล่องข้าว">${t("🍱 กล่องข้าว")}</button>
          <button type="button" class="hero-tag" data-action="quick-search" data-query="งานพิมพ์">${t("🖨️ โปสเตอร์")}</button>
          <button type="button" class="hero-tag" data-action="quick-search" data-query="ของใช้">${t("🧼 ของใช้ทั่วไป")}</button>
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

    <div class="flow-strip">
      <div class="flow-card">
        <span class="flow-badge">1</span>
        <div class="flow-card-copy">
          <strong>${t("เลือกของที่ต้องการ")}</strong>
          <p>${t("ค้นหาสินค้าหรือบริการราคายกลัง/แพ็กใหญ่เพื่อความคุ้มค่า")}</p>
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

    <section class="section">
      <div class="section-header">
        <div>
          <h2>${t("อยากหารอะไรวันนี้?")}</h2>
          <p>${t("เลือกหมวดหมู่ที่ใช่ แล้วดูว่ามีกลุ่มไหนกำลังเปิดรับอยู่")}</p>
        </div>
      </div>
      <div class="categories">
        ${categoriesList.map(c => {
          const count = c.name === 'ทั้งหมด' ? listings().length : listings().filter(l => l.category === c.name).length;
          return a(`/explore?category=${encodeURIComponent(c.name)}`, `
            <div class="category-left">
              <span class="category-symbol">${c.symbol}</span>
              <span>${t(c.name)}</span>
            </div>
            <span class="category-count">${t('{count} รายการ',{count})}</span>
          `, 'category');
        }).join('')}
      </div>
    </section>

    <section class="section">
      <div class="section-header">
        <div>
          <h2>${t("กลุ่มที่กำลังเปิดรับ")}</h2>
          <p>${t("เห็นจำนวนสมาชิกและราคาจริงเมื่อหารครบ ไม่ต้องรอช้า")}</p>
        </div>
        ${a('/explore', `${t("ดูกลุ่มทั้งหมด")} ${icon('arrow', 16)}`, 'text-link')}
      </div>
      <div class="group-grid">
        ${activeGroups.slice(0, 2).map(groupCard).join('')}
      </div>
    </section>

    <section class="section">
      <div class="section-header">
        <div>
          <h2>${t("เลือกของก่อนเข้ากลุ่ม")}</h2>
          <p>${t("เปิดดูรายละเอียดสินค้า รีวิว และสร้างกลุ่มใหม่ตามจำนวนคนที่ต้องการ")}</p>
        </div>
        ${a('/explore', `${t("สำรวจสินค้าทั้งหมด")} ${icon('arrow', 16)}`, 'text-link')}
      </div>
      <div class="listing-grid">
        ${listings().slice(0, 3).map(listingCard).join('')}
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
          <h3>${t("ประหยัดสูงสุดถึง 60%")}</h3>
          <p>${t("ซื้อของในราคาส่งหรือแพ็กคุ้มค่าร่วมกับผู้อื่น โดยไม่ต้องซื้อมาเก็บไว้คนเดียวเกินความจำเป็น")}</p>
        </div>
      </div>
    </section>

    <div class="stats-section">
      <div class="stats-grid">
        <div class="stat-card">
          <strong>฿1,250+</strong>
          <span>${t("เฉลี่ยประหยัดต่อคน/เดือน")}</span>
        </div>
        <div class="stat-card">
          <strong>100%</strong>
          <span>${t("ความโปร่งใสในทุกกลุ่ม")}</span>
        </div>
        <div class="stat-card">
          <strong>4.9 / 5</strong>
          <span>${t("ความพึงพอใจของสมาชิก")}</span>
        </div>
        <div class="stat-card">
          <strong>2 – 20</strong>
          <span>${t("รองรับขนาดกลุ่มยืดหยุ่น")}</span>
        </div>
      </div>
    </div>

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
function explore(){const params=new URLSearchParams(location.search),q=params.get('q')||'',category=params.get('category')||'ทั้งหมด';const results=listings().filter(p=>(category==='ทั้งหมด'||p.category===category)&&(`${p.title} ${p.category} ${p.description}`).toLowerCase().includes(q.toLowerCase()));return `${title(t("สำรวจของที่หารได้"),t("ค้นหาสินค้าหรือบริการที่เหมาะกับกลุ่มของคุณ"))}<form class="search-bar" id="search-form"><span>${icon('search')}</span><input name="q" value="${escape(q)}" placeholder="${t("ค้นหาสินค้า บริการ หรือหมวดหมู่")}" aria-label="${t("ค้นหา")}"/><button type="submit">${t("ค้นหา")}</button></form><div class="filter-row">${['ทั้งหมด','เครื่องเขียน','ของใช้','งานพิมพ์'].map(x=>a('/explore?category='+encodeURIComponent(x)+(q?'&q='+encodeURIComponent(q):''),t(x),'filter '+(category===x?'active':''))).join('')}</div><div class="section-header"><h2>${t("ผลการค้นหา")} <small>${t('{count} รายการ',{count:results.length})}</small></h2>${a('/groups/create',`${icon('plus',18)} ${t("สร้างกลุ่ม")}`,'button secondary')}</div>${results.length?`<div class="listing-grid">${results.map(listingCard).join('')}</div>`:`<div class="empty"><h2>${t("ยังไม่พบรายการที่ตรงกัน")}</h2><p>${t("ลองใช้คำค้นอื่น หรือดูทุกหมวด")}</p>${a('/explore',t("ดูทั้งหมด"),'button secondary')}</div>`}`;}
function productPage(id){const p=listing(id);if(!p)return notFound();const gs=state.groups.filter(g=>g.listingId===id&&g.visibility==='public'&&g.status!=='cancelled');return `<div class="breadcrumb">${a('/explore',t("สำรวจ"))} / ${escape(t(p.category))}</div><div class="product-layout"><div>${art(p)}<div class="detail-copy">${title(escape(p.title),escape(p.description))}<div class="seller-line">${a(`/shops/${p.sellerId}`,`<span class="avatar">${escape(seller(p.sellerId).initials)}</span><span><b>${escape(seller(p.sellerId).name)}</b><small>${t("ดูโปรไฟล์ผู้ขาย")}</small></span>${icon('arrow',18)}`)}</div><h2>${t("เงื่อนไขสินค้าและการรับของ")}</h2><p>${escape(p.terms)}</p><div class="info-box">${t("ยอดที่เห็นเป็นตัวอย่างจากข้อมูลจำลอง กรุณาตกลงรายละเอียดกับผู้ขายก่อนสั่งซื้อจริง")}</div></div></div><aside class="detail-side"><div class="summary-card"><small>${t("ราคาสินค้ารวม")}</small><strong>${money(p.price)}</strong><p>${t("ยังไม่รวมค่าส่งที่แต่ละกลุ่มกำหนด")}</p>${a(`/groups/create?product=${p.id}`,`${icon('plus',19)} ${t("สร้างกลุ่มใหม่")}`,'button primary full')}${a(`/chat/${p.sellerId}?product=${p.id}`,`${icon('chat',19)} ${t("ติดต่อผู้ขาย")}`,'button outline full')}</div></aside></div><section class="section"><div class="section-header"><div><h2>${t("กลุ่มที่เปิดรับ")}</h2><p>${t("เลือกกลุ่มที่เหมาะกับจำนวนคนและค่าใช้จ่าย")}</p></div></div>${gs.length?`<div class="group-grid">${gs.map(groupCard).join('')}</div>`:`<div class="empty"><h3>${t("ยังไม่มีกลุ่มสาธารณะ")}</h3><p>${t("เริ่มกลุ่มใหม่สำหรับสินค้านี้ได้เลย")}</p>${a(`/groups/create?product=${p.id}`,t("สร้างกลุ่ม"),'button primary')}</div>`}</section>`;}
function groupPage(id){const g=group(id);if(!g)return notFound();const p=listing(g.listingId),sum=totalCost(g.costs),alloc=shares(g),me=state.user?.id,isMember=g.members.includes(me),isOwner=g.ownerId===me,locked=!!g.orderId,full=g.members.length===g.capacity,approved=g.approvals[me]===g.revision;return `<div class="breadcrumb">${a(`/products/${p.id}`,escape(p.title))} / ${t("รายละเอียดกลุ่ม")}</div><div class="group-detail"><div>${title(escape(g.name),escape(p.title))}<div class="detail-tags"><span class="chip">${g.visibility==='link'?t("เฉพาะผู้มีลิงก์"):t("กลุ่มสาธารณะ")}</span><span class="status ${g.status}">${g.status==='ready'?t("พร้อมสรุปคำสั่งซื้อ"):t("รอยืนยันยอด")}</span></div><div class="members-card"><div class="section-header"><h2>${t('สมาชิก {count} / {capacity} คน',{count:g.members.length,capacity:g.capacity})}</h2><b>${t('ว่าง {count} ที่',{count:g.capacity-g.members.length})}</b></div><div class="progress"><span style="width:${g.members.length/g.capacity*100}%"></span></div><div class="member-list">${g.members.map(id=>`<div><span class="avatar small">${escape(name(id).slice(0,1))}</span><span>${escape(name(id))}${id===g.ownerId?t(" · หัวหน้ากลุ่ม"):''}</span><strong>${money(alloc[id])}</strong><small>${g.approvals[id]===g.revision?t("ยืนยันแล้ว"):t("รอยืนยัน")}</small></div>`).join('')}</div></div><div class="cost-card"><h2>${t('ค่าใช้จ่ายรอบที่ {revision}',{revision:g.revision})}</h2><div><span>${t("ราคาสินค้า")}</span><b>${money(g.costs.product)}</b></div><div><span>${t("ค่าส่ง")}</span><b>${money(g.costs.delivery)}</b></div><div><span>${t("ค่าบริการ")}</span><b>${money(g.costs.service)}</b></div><div class="total"><span>${t("รวมทั้งหมด")}</span><b>${money(sum)}</b></div><p>${t("หารตามจำนวนสมาชิกปัจจุบัน เศษสตางค์จัดสรรตามลำดับที่เข้ากลุ่ม")}</p></div><div class="activity"><h2>${t("ประวัติการเปลี่ยนยอด")}</h2>${g.history.slice().reverse().map(h=>`<p>${t('รอบ {revision}',{revision:h.revision})} · ${escape(h.reason)}</p>`).join('')}</div></div><aside><div class="summary-card sticky"><small>${isMember?t("ยอดที่คุณต้องยืนยัน"):t("ยอดประมาณเมื่อเข้าร่วม")}</small><strong>${money(isMember?alloc[me]:Math.ceil(sum/(g.members.length+1)))}</strong><p>${isMember?t('ยอดรอบที่ {revision}',{revision:g.revision})+(approved?t(" · คุณยืนยันแล้ว"):t(" · กรุณาตรวจสอบก่อนยืนยัน")):t("ยอดจะคำนวณใหม่เมื่อคุณเข้าร่วม และสมาชิกทุกคนต้องยืนยันอีกครั้ง")}</p>${!isMember&&!full&&!locked?a(`/groups/${id}/join`,t("เข้าร่วมกลุ่ม"),'button primary full'):''}${isMember&&!approved&&!locked?`<button class="button primary full" data-action="approve" data-id="${id}" data-revision="${g.revision}">${t('ยืนยันยอด {amount}',{amount:money(alloc[me])})}</button>`:''}${isMember&&approved?`<div class="success-line">${icon('check',18)} ${t("คุณยืนยันยอดรอบนี้แล้ว")}</div>`:''}${isMember&&!isOwner&&!locked?`<button class="button outline full" data-action="leave" data-id="${id}">${t("ออกจากกลุ่ม")}</button>`:''}${isOwner&&!locked?`<button class="button outline full" data-action="edit-costs" data-id="${id}">${t("แก้ไขค่าใช้จ่าย")}</button><button class="button outline full" data-action="transfer" data-id="${id}">${t("โอนหัวหน้ากลุ่ม")}</button>`:''}${g.visibility==='link'?`<button class="button outline full" data-action="copy-link" data-id="${id}">${icon('link',18)} ${t("คัดลอกลิงก์เชิญ")}</button>`:''}${locked?`<p class="info-box">${t("กลุ่มถูกล็อกตามยอดคำสั่งซื้อเดโมแล้ว")}</p>`:""}${a(`/orders/${id}`,t("ดูสรุปคำสั่งซื้อเดโม"),'button subtle full')}${!full?`<p class="warning">${t("ยังสั่งซื้อไม่ได้จนกว่าสมาชิกจะครบและยืนยันยอดทุกคน")}</p>`:!allApproved(g)?`<p class="warning">${t("รอสมาชิกทุกคนยืนยันยอดรอบล่าสุด")}</p>`:''}</div></aside></div>`;}
function joinPage(id){const g=group(id);if(!g)return notFound();if(!requireAuth(`/groups/${id}/join`))return authRequiredView(t("ยืนยันการเข้าร่วมกลุ่ม"),t("เข้าสู่ระบบก่อนเพื่อเข้าร่วมกลุ่มและยืนยันยอด"));if(g.members.includes(state.user.id))return `<div class="empty"><h1>${t("คุณอยู่ในกลุ่มนี้แล้ว")}</h1>${a(`/groups/${id}`,t("ดูกลุ่ม"),'button primary')}</div>`;if(g.members.length>=g.capacity)return `<div class="empty"><h1>${t("กลุ่มนี้เต็มแล้ว")}</h1>${a(`/groups/${id}`,t("ดูกลุ่ม"),'button secondary')}</div>`;const p=listing(g.listingId),estimate=Math.ceil(totalCost(g.costs)/(g.members.length+1));return `${title(t("ยืนยันการเข้าร่วม"),escape(g.name))}<div class="narrow"><div class="cost-card"><h2>${escape(p.title)}</h2><div><span>${t("ราคาสินค้า")}</span><b>${money(g.costs.product)}</b></div><div><span>${t("ค่าส่ง")}</span><b>${money(g.costs.delivery)}</b></div><div><span>${t("ค่าบริการ")}</span><b>${money(g.costs.service)}</b></div><div class="total"><span>${t("ยอดประมาณของคุณ")}</span><b>${money(estimate)}</b></div></div><div class="info-box">${t("เมื่อเข้าร่วม ระบบจะคำนวณยอดใหม่และให้สมาชิกทุกคน รวมถึงคุณ ยืนยันยอดรอบใหม่อีกครั้ง ยังไม่มีการเก็บเงินจริง")}</div><button class="button primary full" data-action="join" data-id="${id}">${t("ยืนยันเข้าร่วมกลุ่ม")}</button>${a(`/groups/${id}`,t("กลับไปดูกลุ่ม"),'button outline full')}</div>`;}
function createPage(){if(!requireAuth(location.pathname+location.search))return authRequiredView(t("สร้างกลุ่มหารใหม่"),t("กำหนดจำนวนคนและค่าใช้จ่ายให้ชัดก่อนชวนเพื่อน"));const params=new URLSearchParams(location.search),selected=params.get('product')||listings()[0].id;return `${title(t("สร้างกลุ่มหารใหม่"),t("กำหนดจำนวนคนและค่าใช้จ่ายให้ชัดก่อนชวนเพื่อน"))}<form class="form-panel" id="create-form"><label>${t("สินค้า / บริการ")}<select name="listingId" required>${listings().map(p=>`<option value="${p.id}" ${p.id===selected?'selected':''}>${escape(p.title)}</option>`).join('')}</select></label><label>${t("ชื่อกลุ่ม")}<input name="name" maxlength="70" required placeholder="${t("เช่น ทีมอ่านสอบปลายเทอม")}"/></label><div class="form-grid"><label>${t("จำนวนสมาชิกสูงสุด")}<input name="capacity" type="number" min="2" max="20" value="4" required/></label><label>${t("การมองเห็น")}<select name="visibility"><option value="public">${t("กลุ่มสาธารณะ")}</option><option value="link">${t("เฉพาะผู้มีลิงก์")}</option></select></label></div><div class="form-grid"><label>${t("ราคาสินค้า (บาท)")}<input name="product" inputmode="decimal" value="${bahtInput(listing(selected)?.price||0)}" required/></label><label>${t("ค่าส่ง (บาท)")}<input name="delivery" inputmode="decimal" value="0" required/></label></div><label>${t("ค่าบริการ (บาท)")}<input name="service" inputmode="decimal" value="0" required/></label><div class="info-box">${t("ค่าบริการเริ่มต้น 0 บาท กลุ่มเฉพาะลิงก์จะไม่ปรากฏในการค้นหาสาธารณะ")}</div><div id="create-preview" class="preview-cost"></div><button class="button primary full" type="submit">${t("สร้างกลุ่ม")}</button></form>`;}
function authPage(register=false){
  return `<div class="auth-page-wrapper">${renderPhoneMockup(register ? 2 : 1, false)}<a href="/" data-link class="auth-return-link">← ${t("กลับสู่หน้าหลัก HarnKhong")}</a></div>`;
}
function myGroups(){if(!requireAuth('/my-groups'))return authRequiredView(t("กลุ่มของฉัน"),t("ติดตามสมาชิกและยอดที่ต้องยืนยันในแต่ละกลุ่ม เข้าสู่ระบบหรือลงทะเบียนเพื่อเริ่มต้น"));const gs=state.groups.filter(g=>g.members.includes(state.user.id));return `${title(t("กลุ่มของฉัน"),t("ติดตามสมาชิกและยอดที่ต้องยืนยันในแต่ละกลุ่ม"))}<div class="section-header"><h2>${t('{count} กลุ่ม',{count:gs.length})}</h2>${a('/groups/create',`${icon('plus',18)} ${t("สร้างกลุ่ม")}`,'button secondary')}</div>${gs.length?`<div class="group-grid">${gs.map(groupCard).join('')}</div>`:`<div class="empty"><h2>${t("ยังไม่มีกลุ่มที่เข้าร่วม")}</h2><p>${t("ลองสำรวจสินค้าที่อยากหารก่อน")}</p>${a('/explore',t("ไปสำรวจ"),'button primary')}</div>`}`;}
function chatList(){if(!requireAuth('/chat'))return authRequiredView(t("แชตกับผู้ขาย"),t("เข้าสู่ระบบเพื่อดูประวัติการสนทนาและติดต่อร้านค้า"));const ids=Object.keys(state.conversations);return `${title(t("แชตกับผู้ขาย"),t("ข้อความทั้งหมดเป็นการจำลองในเบราว์เซอร์นี้"))}<div class="narrow">${ids.length?ids.map(id=>{const s=seller(id),msgs=state.conversations[id];return a(`/chat/${id}`,`<span class="avatar">${escape(s.initials)}</span><span><b>${escape(s.name)}</b><small>${escape(msgs.at(-1)?.body||t("เริ่มต้นสนทนา"))}</small></span>${icon('arrow',18)}`,'conversation-row')}).join(''):`<div class="empty"><h2>${t("ยังไม่มีการสนทนา")}</h2><p>${t("เปิดสินค้าที่สนใจแล้วเลือกติดต่อผู้ขาย")}</p>${a('/explore',t("ดูสินค้า"),'button primary')}</div>`}</div>`;}
function chatPage(id){if(!requireAuth(location.pathname+location.search))return authRequiredView(t("แชตกับผู้ขาย"),t("เข้าสู่ระบบเพื่อเริ่มต้นการสนทนากับร้านค้านี้"));const s=seller(id),msgs=state.conversations[id]||[],product=new URLSearchParams(location.search).get('product');return `<div class="chat-shell"><div class="chat-head">${a('/chat',icon('back',20))}<span class="avatar">${escape(s.initials)}</span><div><h1>${escape(s.name)}</h1><small>${t("แชตจำลอง · ไม่ส่งถึงผู้ขายจริง")}</small></div></div>${product?`<div class="chat-product">${t("กำลังสอบถามเรื่อง")} ${a(`/products/${product}`,escape(listing(product)?.title||t('สินค้า')))}</div>`:''}<div class="messages">${msgs.length?msgs.map(m=>`<div class="bubble ${m.from==='me'?'mine':'theirs'}">${escape(m.body)}</div>`).join(''):`<div class="chat-empty">${t("เริ่มคุยเรื่องสินค้า เงื่อนไขรับของ หรือค่าส่งได้ที่นี่")}</div>`}</div><form id="chat-form" data-id="${id}" class="chat-input"><input name="body" maxlength="500" required placeholder="${t("พิมพ์ข้อความเดโม...")}" aria-label="${t("ข้อความ")}"/><button class="button primary" type="submit">${t("ส่ง")}</button></form></div>`;}
function notifications(){if(!requireAuth('/notifications'))return authRequiredView(t("การแจ้งเตือน"),t("เข้าสู่ระบบเพื่อดูการแจ้งเตือนกิจกรรมและยอดสมาชิก"));const notes=state.notifications.filter(n=>n.recipient===state.user.id);return `${title(t("การแจ้งเตือน"),t("เหตุการณ์ในกลุ่มและข้อความจำลองของคุณ"))}<div class="narrow">${notes.length?notes.map(n=>`<button class="notification ${n.read?'':'unread'}" data-action="open-notice" data-id="${n.id}"><span class="notice-dot"></span><span><b>${escape(n.title)}</b><small>${escape(n.body)}</small></span>${icon('arrow',18)}</button>`).join(''):`<div class="empty"><h2>${t("ยังไม่มีการแจ้งเตือน")}</h2><p>${t("เมื่อมีสมาชิกหรือยอดเปลี่ยน รายการจะปรากฏที่นี่")}</p>${a('/explore',t("สำรวจสินค้า"),'button secondary')}</div>`}</div>`;}
function profile(){if(!requireAuth('/profile'))return authRequiredView(t("บัญชีของฉัน"),t("เข้าสู่ระบบหรือลงทะเบียนเพื่อจัดการข้อมูลส่วนตัว"));const sellerRole=state.user?.role==='seller';return `${title(t("บัญชีของฉัน"),t("จัดการบทบาทและทดลองใช้งานหลายบัญชี"))}<div class="profile-grid"><div class="form-panel"><div class="profile-main"><span class="avatar large">${escape(state.user.name.slice(0,1))}</span><div><h2>${escape(state.user.name)}</h2><p>${sellerRole?t("บัญชีผู้ขายเดโม"):t("สมาชิกเดโม")}</p></div></div><div class="info-box">${t("บัญชีนี้เป็นตัวจำลอง ไม่มีระบบยืนยันตัวตนหรือข้อมูลส่วนตัวบนเซิร์ฟเวอร์")}</div><h3>${t("สลับบัญชีทดสอบ")}</h3><p>${t("ใช้ทดสอบการยืนยันยอดของสมาชิกแต่ละคน")}</p><div class="account-switch">${Object.entries(demoNames).map(([id,n])=>`<button data-action="switch-user" data-id="${id}" class="button outline">${escape(n)}</button>`).join('')}<button data-action="switch-user" data-id="demo-seller" class="button outline">${t("ผู้ขายเดโม")} · ${escape(seller("s1").name)}</button><button data-action="switch-user" data-id="demo-seller-s2" class="button outline">${t("ผู้ขายเดโม")} · ${escape(seller("s2").name)}</button></div><button class="button subtle" data-action="logout">${t("ออกจากระบบเดโม")}</button><button class="button subtle" data-action="reset-demo">${t("เริ่มข้อมูลเดโมใหม่")}</button></div><div class="form-panel"><h2>${t("ทางลัด")}</h2>${a('/my-groups',t("กลุ่มของฉัน"),'profile-link')}${a('/notifications',t("การแจ้งเตือน"),'profile-link')}${sellerRole?a('/seller/dashboard',t("แดชบอร์ดผู้ขาย"),'profile-link'):''}${a('/explore',t("สำรวจสินค้า"),'profile-link')}</div></div>`;}
function shopPage(id){const s=seller(id),ps=listings().filter(p=>p.sellerId===id);return `<div class="shop-banner"><span class="avatar large">${escape(s.initials)}</span><div><h1>${escape(s.name)}</h1><p>${escape(s.intro)}</p></div></div><div class="section-header"><h2>${t("สินค้าจากร้านนี้")}</h2>${a(`/chat/${id}`,`${icon('chat',18)} ${t("ติดต่อผู้ขาย")}`,'button secondary')}</div><div class="listing-grid">${ps.map(listingCard).join('')}</div>`;}
function sellerDashboard(){if(!requireAuth('/seller/dashboard'))return authRequiredView(t("แดชบอร์ดผู้ขาย"),t("เข้าสู่ระบบด้วยบัญชีผู้ขายเดโมเพื่อจัดการรายการ"));if(state.user.role!=='seller')return `<div class="empty"><h1>${t("สำหรับผู้ขายเดโม")}</h1><p>${t("เข้าสู่ระบบด้วยบัญชี “ผู้ขายเดโม” เพื่อจัดการรายการ")}</p>${a('/profile',t("สลับบัญชี"),'button primary')}</div>`;return `${title(t("แดชบอร์ดผู้ขาย"),t("จัดการรายการและดูคำถามในโหมดจำลอง"))}<div class="dashboard-actions">${a('/seller/products/new',`${icon('plus',18)} ${t("เพิ่มสินค้า")}`,'button primary')}${a('/chat',t("ดูข้อความ"),'button secondary')}</div><div class="listing-grid">${listings().filter(p=>p.sellerId===sellerIdFor(state.user)).map(listingCard).join('')}</div>${sellerOrders()}`;}
function newProduct(){if(!requireAuth('/seller/products/new'))return authRequiredView(t("เพิ่มสินค้าใหม่"),t("เข้าสู่ระบบด้วยบัญชีผู้ขายเพื่อลงรายการสินค้าใหม่"));if(state.user.role!=='seller')return sellerDashboard();return `${title(t("เพิ่มสินค้าเดโม"),t("ข้อมูลจะบันทึกเฉพาะเบราว์เซอร์นี้"))}<form class="form-panel" id="product-form"><label>${t("ชื่อสินค้า")}<input name="title" required maxlength="90"/></label><div class="form-grid"><label>${t("หมวดหมู่")}<select name="category"><option value="เครื่องเขียน">${t("เครื่องเขียน")}</option><option value="ของใช้">${t("ของใช้")}</option><option value="งานพิมพ์">${t("งานพิมพ์")}</option></select></label><label>${t("ราคาสินค้า (บาท)")}<input name="price" required inputmode="decimal"/></label></div><label>${t("รายละเอียด")}<textarea name="description" required maxlength="500"></textarea></label><label>${t("เงื่อนไขการรับของ")}<textarea name="terms" required maxlength="500"></textarea></label><div class="info-box">${t("ระบบเดโมไม่มีการอัปโหลดรูปหรือเผยแพร่สินค้าออนไลน์")}</div><button class="button primary full" type="submit">${t("บันทึกรายการเดโม")}</button></form>`;}
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
  const order=orderFor(id), permissions=order?orderPermissions(order,state.user):null;
  if(order&&order.status!=='waiting_for_members'?!permissions.view:!g.members.includes(state.user.id))return `<div class="empty"><h1>${t('orderUnauthorized')}</h1>${a('/my-groups',t('กลุ่มของฉัน'),'button secondary')}</div>`;
  const model=order&&order.status!=='waiting_for_members'?order:g, alloc=shares(model),ready=allApproved(g);
  const action=(next,label)=>`<button class="button primary" data-action="order-transition" data-id="${id}" data-next="${next}">${t(label)}</button>`;
  return `${title(t('สรุปคำสั่งซื้อเดโม'),escape(g.name))}<div class="narrow order-detail">
    <div class="info-box">${t('เดโมเท่านั้น: HarnKhong ไม่รับฝาก ถือ โอน หรือคืนเงินจริง ไม่มีการตรวจสอบธนาคาร')}</div>
    <div class="cost-card"><h2>${t('ค่าใช้จ่าย')}</h2><div><span>${t('สินค้า')}</span><b>${money(model.costs.product)}</b></div><div><span>${t('ค่าส่ง')}</span><b>${money(model.costs.delivery)}</b></div><div><span>${t('ค่าบริการ')}</span><b>${money(model.costs.service)}</b></div><div class="total"><span>${t('รวม')}</span><b>${money(totalCost(model.costs))}</b></div><h3>${t('ส่วนแบ่งสมาชิก')}</h3>${model.members.map(memberId=>`<div><span>${escape(actorName(memberId))}</span><b>${money(alloc[memberId])}</b></div>`).join('')}</div>
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
      ${permissions.reportPayment&&state.user.id===memberId?`<button class="button outline" data-action="payment-report" data-id="${id}">${t('แจ้งชำระจำลองของฉัน')}</button>`:''}
      ${permissions.verifyPayment&&payment.status==='payment_reported'?`<button class="button outline" data-action="payment-update" data-id="${id}" data-member="${escape(memberId)}" data-next="verification_pending">${t('รับเรื่องตรวจยอดเดโม')}</button>`:''}
      ${permissions.verifyPayment&&payment.status==='verification_pending'?`<div class="order-actions"><button class="button outline" data-action="payment-update" data-id="${id}" data-member="${escape(memberId)}" data-next="verified">${t('ยืนยันตรวจยอด (จำลองเท่านั้น)')}</button><button class="button subtle" data-action="payment-update" data-id="${id}" data-member="${escape(memberId)}" data-next="unpaid">${t('ให้แจ้งชำระใหม่')}</button></div>`:''}</article>`;
    }).join('')}</div></section>
    <section class="activity"><h2>${t('การจัดส่ง')}</h2><p>${t('ข้อมูลจัดส่งกรอกเองในเดโม ยังไม่ตรวจสอบกับขนส่ง')}</p>
    ${order.shipment?`<p>${t('ผู้ขนส่ง')}: ${escape(order.shipment.carrier||'—')}</p><p>${t('เลขติดตาม')}: ${escape(order.shipment.trackingNumber||'—')}</p>${order.shipment.url?`<p><a href="${escape(order.shipment.url)}" target="_blank" rel="noopener noreferrer">${t('เปิดลิงก์ติดตามที่ผู้ขายกรอก')}</a></p>`:''}<p>${t('ส่งเมื่อ')}: ${escape(dateTime(order.shipment.shippedAt))}</p>`:`<p>${t('ยังไม่มีข้อมูลจัดส่ง')}</p>`}
    ${order.deliveredAt?`<p>${t('ยืนยันรับเมื่อ')}: ${escape(dateTime(order.deliveredAt))}</p>`:''}
    ${permissions.shipment?`<form id="shipment-form" class="form-panel" data-id="${id}"><label>${t('ผู้ขนส่ง')}<input name="carrier" maxlength="500" value="${escape(order.shipment?.carrier||'')}"/></label><label>${t('เลขติดตาม')}<input name="trackingNumber" maxlength="500" value="${escape(order.shipment?.trackingNumber||'')}"/></label><label>${t('ลิงก์ติดตาม (http หรือ https)')}<input name="url" type="url" maxlength="500" value="${escape(order.shipment?.url||'')}"/></label><p>${t('กรอกเลขติดตามหรือลิงก์อย่างน้อยหนึ่งช่อง')}</p><button class="button primary" type="submit">${t('บันทึกการจัดส่งเดโม')}</button></form>`:''}</section>
    ${disputePanel(order,permissions)}${orderHistory(order)}`}
    ${order?.legacy?`<p class="warning">${t('นำเข้าคำสั่งซื้อเก่าโดยไม่ถือว่าเคยชำระเงินแล้ว')}</p>`:''}
    ${a(`/groups/${id}`,t('กลับไปดูกลุ่ม'),'button outline full')}</div>`;
}
function notFound(){return `<div class="empty"><h1>${t("ไม่พบหน้านี้")}</h1><p>${t("ลิงก์อาจไม่ถูกต้องหรือรายการถูกลบ")}</p>${a('/',t("กลับหน้าแรก"),'button primary')}</div>`;}
function route(){const path=decodeURIComponent(location.pathname);if(path==='/')return home();if(path==='/explore')return explore();if(/^\/products\/[^/]+$/.test(path))return productPage(path.split('/')[2]);if(/^\/groups\/[^/]+\/join$/.test(path))return joinPage(path.split('/')[2]);if(path==='/groups/create')return createPage();if(/^\/groups\/[^/]+$/.test(path))return groupPage(path.split('/')[2]);if(path==='/login')return authPage();if(path==='/register')return authPage(true);if(path==='/my-groups')return myGroups();if(path==='/chat')return chatList();if(/^\/chat\/[^/]+$/.test(path))return chatPage(path.split('/')[2]);if(path==='/notifications')return notifications();if(path==='/profile')return profile();if(/^\/shops\/[^/]+$/.test(path))return shopPage(path.split('/')[2]);if(path==='/seller/dashboard')return sellerDashboard();if(path==='/seller/products/new')return newProduct();if(/^\/orders\/[^/]+$/.test(path))return orderPage(path.split('/')[2]);return notFound();}
function render(){
  const unread=state.user?state.notifications.filter(n=>n.recipient===state.user.id&&!n.read).length:0;
  const nav=[
    ['/','home',t("หน้าแรก")],
    ['/explore','search',t("สำรวจ")],
    ['/my-groups','users',t("กลุ่มของฉัน")],
    ['/chat','chat',t("แชต")],
    ['/profile','user',t("บัญชี")]
  ];

  document.querySelector('#app').innerHTML=`
    ${icons}
    <header class="site-header">
      <div class="header-inner">
        ${a('/',`<span class="logo-mark">H</span><span class="logo-text">HarnKhong<small>${t("หารของด้วยกัน")}</small></span>`,'brand')}
        <nav class="desktop-nav" aria-label="${t("เมนูหลัก")}">
          ${nav.map(([href,,label])=>a(href,label,'nav-link '+(location.pathname===href?'active':''))).join('')}
        </nav>
        <div class="header-actions">
          <select id="locale-select" class="locale-select" aria-label="${t('ภาษา')}"><option value="th" ${locale==='th'?'selected':''}>TH</option><option value="en" ${locale==='en'?'selected':''}>EN</option></select>
          ${a('/groups/create', `${icon('plus',17)} ${t("สร้างกลุ่ม")}`, 'button primary header-create-btn')}
          ${a('/notifications',`${icon('bell',22)}${unread?`<i>${unread}</i>`:''}`,'icon-button')}
          ${state.user?a('/profile',`<span class="avatar tiny">${escape(state.user.name.slice(0,1))}</span><span class="header-user-name">${escape(state.user.name)}</span>`,'profile-pill'):`<button type="button" class="button primary header-login-btn" data-action="open-auth" data-step="1">${icon('user',18)} ${t("เข้าสู่ระบบ")}</button>`}
        </div>
      </div>
    </header>

    <main class="main-wrap" id="main">${route()}</main>

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
            ${a('/groups/create', t("เปิดกลุ่มใหม่"))}
            ${a('/my-groups', t("กลุ่มของฉัน"))}
            ${a('/chat', t("แชตติดต่อผู้ขาย"))}
          </div>
          <div class="footer-col">
            <h4>${t("หมวดหมู่")}</h4>
            ${a('/explore?category=เครื่องเขียน', t('เครื่องเขียน'))}
            ${a('/explore?category=ของใช้', t("ของใช้ทั่วไป"))}
            ${a('/explore?category=งานพิมพ์', t("งานพิมพ์/เอกสาร"))}
            ${a('/explore', t("หมวดทั้งหมด"))}
          </div>
          <div class="footer-col">
            <h4>${t("ช่วยเหลือ")}</h4>
            <a href="javascript:void(0)" data-action="open-auth" data-step="1">${t("เข้าสู่ระบบ")}</a>
            <a href="javascript:void(0)" data-action="open-auth" data-step="2">${t("สมัครสมาชิก")}</a>
            <a href="javascript:void(0)" data-action="reset-demo">${t("รีเซ็ตข้อมูลเดโม")}</a>
          </div>
        </div>
        <div class="footer-bottom">
          <span>${t("© 2026 HarnKhong — แพลตฟอร์มหารของด้วยกัน")}</span>
          <span class="footer-demo-pill">${t("💡 โหมดต้นแบบจำลอง (MVP Demo) เพื่อการทดสอบ UX")}</span>
        </div>
      </div>
    </footer>

    ${authModalActive?`<div class="auth-modal-overlay" id="auth-modal-overlay">${renderPhoneMockup(mockupCurrentStep,true)}</div>`:''}
  `;

  if(document.querySelector('#create-form'))updatePreview();
  document.documentElement.lang=locale;
  document.title='HarnKhong — '+t('หารของด้วยกัน');
  document.querySelector('meta[name="description"]').content=t('แพลตฟอร์มหารของและบริการที่โปร่งใส');
  document.querySelectorAll('[data-action="toggle-mockup-pw"]').forEach(button=>button.setAttribute('aria-label',t('แสดงหรือซ่อนรหัสผ่าน')));
  document.querySelector('.header-actions a[href="/notifications"]').setAttribute('aria-label',t('การแจ้งเตือน'));
}
const formCosts=d=>({product:parseBaht(d.get('product')),delivery:parseBaht(d.get('delivery')),service:parseBaht(d.get('service'))});
function updatePreview(){const f=document.querySelector('#create-form'),box=document.querySelector('#create-preview');if(!f||!box)return;try{const d=new FormData(f),sum=totalCost(formCosts(d)),count=assertCapacity(Number(d.get('capacity')));box.innerHTML=`<small>${t('ประมาณเมื่อสมาชิกครบ {count} คน',{count})}</small><strong>${money(Math.ceil(sum/count))} ${t("/ คน")}</strong><p>${t("ยอดจริงจัดสรรเป็นสตางค์เมื่อสมาชิกเข้าร่วม")}</p>`;}catch(e){box.innerHTML=`<small>${escape(errorMessage(e))}</small>`;}}

document.addEventListener('change',e=>{
  if(e.target.id!=='locale-select')return;
  // Rerender labels without discarding drafts, password visibility, or the current auth step.
  const controls=[...document.querySelectorAll('input,textarea,select')];
  const focus=controls.indexOf(document.activeElement), scrollY=window.scrollY;
  const drafts=controls.map(el=>({value:el.value,checked:el.checked,type:el.type,start:el.selectionStart,end:el.selectionEnd}));
  const steps=[...document.querySelectorAll('.mockup-screen,.mockup-step-btn')].map(el=>el.classList.contains('active'));
  locale=e.target.value==='en'?'en':'th';
  try { localStorage.setItem(LOCALE_KEY,locale); } catch { /* Language still works for this session. */ }
  render();
  const nextControls=[...document.querySelectorAll('input,textarea,select')];
  nextControls.forEach((el,i)=>{
    const draft=drafts[i];
    if(!draft)return;
    if(el instanceof HTMLInputElement)el.type=draft.type;
    el.value=draft.value;
    el.checked=draft.checked;
    if(draft.start!==null&&draft.start!==undefined)el.setSelectionRange(draft.start,draft.end);
  });
  document.querySelectorAll('.mockup-screen,.mockup-step-btn').forEach((el,i)=>el.classList.toggle('active',steps[i]));
  updatePreview();
  nextControls[focus]?.focus({preventScroll:true});
  window.scrollTo(0,scrollY);
});
document.addEventListener('click',async e=>{
  const overlay=e.target.closest('#auth-modal-overlay');
  if(overlay && e.target === overlay){ closeAuthModal(); return; }
  const link=e.target.closest('a[data-link]');
  if(link){
    e.preventDefault();
    const href=link.getAttribute('href');
    if(!state.user && isAuthRequired(href)){
      sessionStorage.setItem('harn-return', href);
      openAuthModal(1);
      return;
    }
    go(href);
    return;
  }
  const btn=e.target.closest('[data-action]');if(!btn)return;
  const action=btn.dataset.action,id=btn.dataset.id;
  try{
    if(action==='quick-search'){
      go('/explore?q=' + encodeURIComponent(btn.dataset.query || ''));
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
    else if(action==='mockup-autofill'){ fillMockupDemo(); }
    else if(action==='mockup-social'){ alertMessage(t('จำลองการเชื่อมต่อ {provider}...',{provider:btn.dataset.provider})); }
    else if(action==='toggle-mockup-pw'){
      const form = btn.closest('form') || document;
      const targetInput = form.querySelector(`#${btn.dataset.target}`) || document.getElementById(btn.dataset.target);
      if(targetInput){
        targetInput.type = targetInput.type === 'password' ? 'text' : 'password';
      }
    }
    else if(action==='reset-demo'){if(!confirm(t("ล้างข้อมูลเดโมในเบราว์เซอร์นี้และเริ่มใหม่?")))return;state=initialState();save();go('/');alertMessage(t("เริ่มข้อมูลเดโมใหม่แล้ว"));}
    else if(action==='join'){const g=joinGroup(group(id),state.user.id);updateGroup(g);g.members.forEach(u=>notice(t("ยอดกลุ่มเปลี่ยน"),t('มีสมาชิกใหม่ กรุณายืนยันยอดรอบ {revision}',{revision:g.revision}),`/groups/${id}`,u));if(g.members.length===g.capacity)g.members.forEach(u=>notice(t("กลุ่มครบสมาชิก"),t("รอทุกคนยืนยันยอดก่อนสรุปคำสั่งซื้อ"),`/groups/${id}`,u));go(`/groups/${id}`);alertMessage(t("เข้าร่วมกลุ่มแล้ว กรุณายืนยันยอดใหม่"));}
    else if(action==='leave'){if(!confirm(t("ออกจากกลุ่มนี้? สมาชิกที่เหลือจะต้องยืนยันยอดใหม่")))return;const g=leaveGroup(group(id),state.user.id);updateGroup(g);g.members.forEach(u=>notice(t("สมาชิกออกจากกลุ่ม"),t("ยอดเปลี่ยน กรุณายืนยันใหม่"),`/groups/${id}`,u));go('/my-groups');alertMessage(t("ออกจากกลุ่มแล้ว"));}
    else if(action==='approve'){const g=approve(group(id),state.user.id,Number(btn.dataset.revision));updateGroup(g);if(allApproved(g))g.members.forEach(u=>notice(t("ยืนยันยอดครบแล้ว"),t("กลุ่มพร้อมดูสรุปคำสั่งซื้อเดโม"),`/orders/${id}`,u));render();alertMessage(t("ยืนยันยอดรอบล่าสุดแล้ว"));}
    else if(action==='copy-link'){await navigator.clipboard.writeText(location.origin+`/groups/${id}`);alertMessage(t("คัดลอกลิงก์เชิญแล้ว"));}
    else if(action==='open-notice'){const n=state.notifications.find(x=>x.id===id);n.read=true;save();go(n.href);}
    else if(action==='logout'){state.user=null;save();go('/');alertMessage(t("ออกจากระบบแล้ว"));}
    else if(action==='switch-user'){state.user=['demo-seller','demo-seller-s2'].includes(id)?{id,name:seller(id==='demo-seller'?'s1':'s2').name,role:'seller',sellerId:id==='demo-seller'?'s1':'s2'}:{id,name:demoNames[id],role:'member'};save();render();alertMessage(t("สลับบัญชีทดสอบแล้ว"));}
    else if(action==='payment-report'){
      if(!confirm(t('ยืนยันแจ้งชำระจำลอง ไม่ใช่หลักฐานการโอนเงินจริง?')))return;
      orderChanged(reportPayment(orderFor(id),state.user),t('แจ้งชำระแล้ว รอหัวหน้ากลุ่มตรวจยอดเดโม'));
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
    else if(action==='edit-costs'){const g=group(id);const value=prompt(t("ค่าส่งใหม่ (บาท)"),bahtInput(g.costs.delivery));if(value===null)return;const next=changeCosts(g,state.user.id,{...g.costs,delivery:parseBaht(value)});updateGroup(next);next.members.forEach(u=>notice(t("ค่าใช้จ่ายเปลี่ยน"),t("ค่าส่งเปลี่ยน กรุณายืนยันยอดใหม่"),`/groups/${id}`,u));render();alertMessage(t("ปรับยอดและเริ่มรอบยืนยันใหม่แล้ว"));}
    else if(action==='transfer'){const g=group(id),members=g.members.filter(u=>u!==state.user.id);if(!members.length)throw Error(t("ยังไม่มีสมาชิกให้โอนสิทธิ์"));const choice=prompt(t('พิมพ์ ID สมาชิกที่จะเป็นหัวหน้าคนใหม่: {members}',{members:members.join(', ')}),members[0]);if(choice===null)return;updateGroup(transferOwner(g,state.user.id,choice));render();alertMessage(t("โอนหัวหน้ากลุ่มแล้ว"));}
  }catch(err){alertMessage(errorMessage(err));}
});
document.addEventListener('submit',e=>{
  const f=e.target;
  if(f.id==='mockup-login-form'){
    e.preventDefault();
    const emailInput = f.querySelector('#mockup-login-email') || document.getElementById('mockup-login-email');
    const email = emailInput ? emailInput.value.trim() : 'demo@example.com';
    const name = email.split('@')[0] || t("ผู้ใช้");
    state.user = { id: 'user-' + Date.now(), name, email, role: 'member' };
    save();
    authModalActive = false;
    const back = sessionStorage.getItem('harn-return') || '/';
    sessionStorage.removeItem('harn-return');
    go(back);
    alertMessage(t('เข้าสู่ระบบสำเร็จ! ยินดีต้อนรับ {name}',{name}));
  }else if(f.id==='mockup-signup-form'){
    e.preventDefault();
    const pw = (f.querySelector('#mockup-signup-pw') || document.getElementById('mockup-signup-pw'))?.value || '';
    const confirmPw = (f.querySelector('#mockup-signup-confirm-pw') || document.getElementById('mockup-signup-confirm-pw'))?.value || '';
    if(pw !== confirmPw){
      alertMessage(t("⚠️ รหัสผ่านและการยืนยันรหัสผ่านไม่ตรงกัน"));
      return;
    }
    const nameInput = f.querySelector('#mockup-signup-name') || document.getElementById('mockup-signup-name');
    const emailInput = f.querySelector('#mockup-signup-email') || document.getElementById('mockup-signup-email');
    tempSignupData = {
      name: nameInput ? nameInput.value.trim() : 'สมชาย ใจดี',
      email: emailInput ? emailInput.value.trim() : 'somchai.jaidee@gmail.com'
    };
    setMockupStep(3, f);
    alertMessage(t("ข้อมูลบัญชีถูกต้อง โปรดกรอกที่อยู่เพื่อเสร็จสิ้นขั้นตอน"));
  }else if(f.id==='mockup-address-form'){
    e.preventDefault();
    const name = tempSignupData.name || 'สมชาย ใจดี';
    const email = tempSignupData.email || 'somchai.jaidee@gmail.com';
    const address = {
      idCard: (f.querySelector('#mockup-id-card') || document.getElementById('mockup-id-card'))?.value || '',
      houseNo: (f.querySelector('#mockup-house-no') || document.getElementById('mockup-house-no'))?.value || '',
      province: (f.querySelector('#mockup-province') || document.getElementById('mockup-province'))?.value || '',
      phone: (f.querySelector('#mockup-phone') || document.getElementById('mockup-phone'))?.value || ''
    };
    state.user = { id: 'user-' + Date.now(), name, email, role: 'member', address };
    save();
    authModalActive = false;
    const back = sessionStorage.getItem('harn-return') || '/';
    sessionStorage.removeItem('harn-return');
    go(back);
    alertMessage(t('ลงทะเบียนและบันทึกที่อยู่เรียบร้อยแล้ว ยินดีต้อนรับคุณ {name}',{name}));
  }else if(f.id==='search-form'){
    e.preventDefault();
    go('/explore?q='+encodeURIComponent(new FormData(f).get('q').trim()));
  }else if(f.id==='create-form'){
    e.preventDefault();
    try{
      const d=new FormData(f);
      if(!listing(d.get('listingId')))throw Error(t('ไม่พบสินค้า กรุณาเลือกสินค้าใหม่'));
      const g=createGroup({id:'g'+Date.now(),listingId:d.get('listingId'),name:d.get('name'),ownerId:state.user.id,visibility:d.get('visibility'),capacity:Number(d.get('capacity')),costs:formCosts(d)});
      state.groups.unshift(g);
      save();
      notice(t("สร้างกลุ่มแล้ว"),t("ชวนสมาชิกเข้าร่วมเพื่อเริ่มหารค่าใช้จ่าย"),`/groups/${g.id}`);
      go(`/groups/${g.id}`);
      alertMessage(t("สร้างกลุ่มแล้ว"));
    }catch(err){alertMessage(errorMessage(err));}
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
      go(`/products/${p.id}`);
      alertMessage(t("เพิ่มรายการเดโมแล้ว"));
    }catch(err){alertMessage(errorMessage(err));}
  }
});
document.addEventListener('input',e=>{
  if(e.target.closest('#create-form'))updatePreview();
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

window.addEventListener('popstate',render);
render();







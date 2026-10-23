/**
 * UI Mockup: Mobile Smartphone Flow & Interactive Prototype Logic
 * Antigravity Web Application
 */

// Global State
let currentViewMode = 'single'; // 'single' | 'multi'
let currentStep = 1; // 1: Login, 2: SingUp, 3: Address

// Sample Data for Demo
const demoData = {
  login: {
    email: 'user.demo@example.com',
    password: 'Password123!'
  },
  signup: {
    name: 'สมชาย ใจดี',
    email: 'somchai.jaidee@gmail.com',
    password: 'SecretPassword999!',
    confirmPassword: 'SecretPassword999!'
  },
  address: {
    idCard: '1-1020-03456-78-9',
    houseNo: '128/45',
    villageNo: '3',
    province: 'กรุงเทพมหานคร',
    district: 'ปทุมวัน',
    subdistrict: 'ลุมพินี',
    alley: 'ซอยร่วมฤดี',
    road: 'เพลินจิต',
    postalCode: '10330',
    phoneNumber: '089-123-4567'
  }
};

document.addEventListener('DOMContentLoaded', () => {
  setupInputMasks();
  startLiveClock();
  goToStep(1);
});

/**
 * Switch view mode: 'single' (focused phone) vs 'multi' (all 3 phones side-by-side)
 */
function switchViewMode(mode) {
  currentViewMode = mode;
  const stage = document.getElementById('phones-stage');
  const btnSingle = document.getElementById('btn-view-single');
  const btnMulti = document.getElementById('btn-view-multi');
  const stepperPills = document.getElementById('stepper-pills');

  if (mode === 'single') {
    stage.classList.remove('mode-multi');
    stage.classList.add('mode-single');
    btnSingle.classList.add('active');
    btnMulti.classList.remove('active');
    stepperPills.style.opacity = '1';
    stepperPills.style.pointerEvents = 'auto';
    goToStep(currentStep);
    showToast('สลับเป็นโหมด: จำลองสมาร์ตโฟนเครื่องเดียว (Interactive Flow)');
  } else {
    stage.classList.remove('mode-single');
    stage.classList.add('mode-multi');
    btnMulti.classList.add('active');
    btnSingle.classList.remove('active');
    stepperPills.style.opacity = '0.4';
    stepperPills.style.pointerEvents = 'none';
    showToast('สลับเป็นโหมด: เทียบมือถือ 3 เครื่องพร้อมกัน');
  }
}

/**
 * Navigate to a specific step in single phone mode
 */
function goToStep(stepNumber) {
  currentStep = stepNumber;

  // Update phone wrappers
  for (let i = 1; i <= 3; i++) {
    const wrapper = document.getElementById(`wrapper-screen-${i}`);
    const pill = document.getElementById(`pill-step-${i}`);
    const mNav = document.getElementById(`m-nav-${i}`);

    if (wrapper) {
      if (i === stepNumber) {
        wrapper.classList.add('active-step');
        // Scroll the phone viewport back to top
        const viewport = wrapper.querySelector('.phone-viewport');
        if (viewport) viewport.scrollTop = 0;
      } else {
        wrapper.classList.remove('active-step');
      }
    }

    if (pill) {
      if (i === stepNumber) {
        pill.classList.add('active');
      } else {
        pill.classList.remove('active');
      }
    }

    if (mNav) {
      if (i === stepNumber) {
        mNav.classList.add('active');
      } else {
        mNav.classList.remove('active');
      }
    }
  }

  // If in multi mode, scroll the target device into view smoothly
  if (currentViewMode === 'multi') {
    const targetWrapper = document.getElementById(`wrapper-screen-${stepNumber}`);
    if (targetWrapper) {
      targetWrapper.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    }
  }
}

/**
 * Phone finish / theme color switcher
 */
function setPhoneTheme(themeClass) {
  document.body.className = themeClass;

  // Update active dot in picker
  document.querySelectorAll('.color-dot').forEach(dot => dot.classList.remove('active'));
  const dotMap = {
    'theme-black': '.dot-black',
    'theme-silver': '.dot-silver',
    'theme-blue': '.dot-blue',
    'theme-purple': '.dot-purple'
  };
  const targetDot = document.querySelector(dotMap[themeClass]);
  if (targetDot) targetDot.classList.add('active');

  const names = {
    'theme-black': 'Titanium Black',
    'theme-silver': 'Natural Titanium / Silver',
    'theme-blue': 'Midnight Blue',
    'theme-purple': 'Deep Purple'
  };
  showToast(`เปลี่ยนสีกรอบตัวเครื่องเป็น: ${names[themeClass] || themeClass}`);
}

/**
 * Live Clock in Status Bar
 */
function startLiveClock() {
  function updateTime() {
    const now = new Date();
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    document.querySelectorAll('.live-clock').forEach(el => {
      el.textContent = `${hours}:${minutes}`;
    });
  }
  updateTime();
  setInterval(updateTime, 10000);
}

/**
 * Dynamic Island pulse animation
 */
function pulseDynamicIsland(el) {
  el.classList.add('pulsing');
  showToast('⚡ Dynamic Island: HarnKhong App');
  setTimeout(() => {
    el.classList.remove('pulsing');
  }, 1200);
}

/**
 * Password Visibility Toggle
 */
function togglePasswordVisibility(inputId, btnElement) {
  const input = document.getElementById(inputId);
  if (!input) return;

  const eyeOpen = btnElement.querySelector('.eye-open');
  const eyeClosed = btnElement.querySelector('.eye-closed');

  if (input.type === 'password') {
    input.type = 'text';
    eyeOpen.style.display = 'none';
    eyeClosed.style.display = 'block';
  } else {
    input.type = 'password';
    eyeOpen.style.display = 'block';
    eyeClosed.style.display = 'none';
  }
}

/**
 * Input Masks for Thai National ID & Phone Number
 */
function setupInputMasks() {
  const idCardInput = document.getElementById('id-card');
  if (idCardInput) {
    idCardInput.addEventListener('input', (e) => {
      let val = e.target.value.replace(/\D/g, '');
      if (val.length > 13) val = val.substring(0, 13);
      
      let formatted = '';
      if (val.length > 0) formatted += val.substring(0, 1);
      if (val.length > 1) formatted += '-' + val.substring(1, 5);
      if (val.length > 5) formatted += '-' + val.substring(5, 10);
      if (val.length > 10) formatted += '-' + val.substring(10, 12);
      if (val.length > 12) formatted += '-' + val.substring(12, 13);
      
      e.target.value = formatted;
    });
  }

  const phoneInput = document.getElementById('phone-number');
  if (phoneInput) {
    phoneInput.addEventListener('input', (e) => {
      let val = e.target.value.replace(/\D/g, '');
      if (val.length > 10) val = val.substring(0, 10);

      let formatted = '';
      if (val.length > 0) formatted += val.substring(0, 3);
      if (val.length > 3) formatted += '-' + val.substring(3, 6);
      if (val.length > 6) formatted += '-' + val.substring(6, 10);

      e.target.value = formatted;
    });
  }
}

/**
 * Form Submit Handlers
 */
function handleLoginSubmit(event) {
  event.preventDefault();
  const email = document.getElementById('login-email').value;
  showToast(`เข้าสู่ระบบสำเร็จ: ${email}`);
  setTimeout(() => {
    goToStep(2);
  }, 600);
}

function handleSignupSubmit(event) {
  event.preventDefault();
  const pw = document.getElementById('signup-password').value;
  const confirmPw = document.getElementById('signup-confirm-password').value;

  if (pw !== confirmPw) {
    showToast('⚠️ รหัสผ่านและการยืนยันรหัสผ่านไม่ตรงกัน โปรดตรวจสอบอีกครั้ง');
    const confirmInput = document.getElementById('signup-confirm-password');
    confirmInput.focus();
    confirmInput.style.borderColor = '#ef4444';
    setTimeout(() => {
      confirmInput.style.borderColor = '';
    }, 2500);
    return;
  }

  const name = document.getElementById('signup-name').value;
  showToast(`สมัครสมาชิกสำเร็จ! ยินดีต้อนรับคุณ ${name}`);
  setTimeout(() => {
    goToStep(3);
  }, 600);
}

function handleAddressSubmit(event) {
  event.preventDefault();

  const formData = {
    idCard: document.getElementById('id-card').value || '-',
    houseNo: document.getElementById('house-no').value || '-',
    villageNo: document.getElementById('village-no').value || '-',
    province: document.getElementById('province').value || '-',
    district: document.getElementById('district').value || '-',
    subdistrict: document.getElementById('subdistrict').value || '-',
    alley: document.getElementById('alley').value || '-',
    road: document.getElementById('road').value || '-',
    postalCode: document.getElementById('postal-code').value || '-',
    phoneNumber: document.getElementById('phone-number').value || '-'
  };

  const summaryContainer = document.getElementById('summary-data');
  summaryContainer.innerHTML = `
    <div class="summary-row"><span class="summary-label">เลขบัตรประชาชน:</span><span class="summary-val">${formData.idCard}</span></div>
    <div class="summary-row"><span class="summary-label">ที่อยู่:</span><span class="summary-val">${formData.houseNo} ${formData.villageNo !== '-' ? 'หมู่ ' + formData.villageNo : ''} ${formData.alley !== '-' ? formData.alley : ''} ${formData.road !== '-' ? formData.road : ''}</span></div>
    <div class="summary-row"><span class="summary-label">ตำบล/อำเภอ:</span><span class="summary-val">ต.${formData.subdistrict} อ.${formData.district}</span></div>
    <div class="summary-row"><span class="summary-label">จังหวัด / รหัสไปรษณีย์:</span><span class="summary-val">${formData.province} ${formData.postalCode}</span></div>
    <div class="summary-row"><span class="summary-label">เบอร์ติดต่อ:</span><span class="summary-val">${formData.phoneNumber}</span></div>
  `;

  document.getElementById('success-modal').style.display = 'flex';
}

function closeModal() {
  document.getElementById('success-modal').style.display = 'none';
}

function closeModalAndReset() {
  closeModal();
  resetAllForms();
  goToStep(1);
  showToast('เริ่มต้นใหม่เรียบร้อยแล้ว');
}

/**
 * Social Auth Mock
 */
function handleSocialAuth(provider) {
  showToast(`กำลังเชื่อมต่อเข้าสู่ระบบด้วย ${provider}... (Mock)`);
}

/**
 * Autofill Demo Data
 */
function fillDemoData() {
  // Login Form
  const loginEmail = document.getElementById('login-email');
  const loginPw = document.getElementById('login-password');
  if (loginEmail) loginEmail.value = demoData.login.email;
  if (loginPw) loginPw.value = demoData.login.password;

  // SignUp Form
  const sName = document.getElementById('signup-name');
  const sEmail = document.getElementById('signup-email');
  const sPw = document.getElementById('signup-password');
  const sConfirmPw = document.getElementById('signup-confirm-password');
  if (sName) sName.value = demoData.signup.name;
  if (sEmail) sEmail.value = demoData.signup.email;
  if (sPw) sPw.value = demoData.signup.password;
  if (sConfirmPw) sConfirmPw.value = demoData.signup.confirmPassword;

  // Address Form
  const idCard = document.getElementById('id-card');
  const houseNo = document.getElementById('house-no');
  const villageNo = document.getElementById('village-no');
  const province = document.getElementById('province');
  const district = document.getElementById('district');
  const subdistrict = document.getElementById('subdistrict');
  const alley = document.getElementById('alley');
  const road = document.getElementById('road');
  const postalCode = document.getElementById('postal-code');
  const phone = document.getElementById('phone-number');

  if (idCard) idCard.value = demoData.address.idCard;
  if (houseNo) houseNo.value = demoData.address.houseNo;
  if (villageNo) villageNo.value = demoData.address.villageNo;
  if (province) province.value = demoData.address.province;
  if (district) district.value = demoData.address.district;
  if (subdistrict) subdistrict.value = demoData.address.subdistrict;
  if (alley) alley.value = demoData.address.alley;
  if (road) road.value = demoData.address.road;
  if (postalCode) postalCode.value = demoData.address.postalCode;
  if (phone) phone.value = demoData.address.phoneNumber;

  showToast('กรอกข้อมูลตัวอย่างครบทั้ง 3 หน้าเรียบร้อยแล้ว!');
}

/**
 * Reset All Forms
 */
function resetAllForms() {
  document.getElementById('form-login')?.reset();
  document.getElementById('form-signup')?.reset();
  document.getElementById('form-address')?.reset();
  showToast('ล้างข้อมูลฟอร์มทั้งหมดเรียบร้อยแล้ว');
}

/**
 * Toast Notification Utility
 */
let toastTimeout;
function showToast(message) {
  const toast = document.getElementById('toast');
  if (!toast) return;

  toast.textContent = message;
  toast.classList.add('show');

  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => {
    toast.classList.remove('show');
  }, 2800);
}

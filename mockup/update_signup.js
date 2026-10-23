const fs = require('fs');
const path = require('path');

// 1. Update index.html
const indexPath = path.join(__dirname, 'index.html');
let html = fs.readFileSync(indexPath, 'utf8');

const confirmFieldHtml = `
            <div class="input-group password-group">
              <input type="password" id="signup-confirm-password" class="custom-input" placeholder="ยืนยัน Password" autocomplete="new-password" required>
              <button type="button" class="btn-toggle-pw" onclick="togglePasswordVisibility('signup-confirm-password', this)" tabindex="-1" title="ดูรหัสผ่าน">
                <svg class="eye-open" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                <svg class="eye-closed" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="display:none;"><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
              </button>
            </div>`;

// Insert after the password group in screen-2 if not already there
if (!html.includes('id="signup-confirm-password"')) {
  const passwordGroupRegex = /(<input[^>]*id="signup-password"[^>]*>[\s\S]*?<\/div>)/;
  html = html.replace(passwordGroupRegex, `$1\n${confirmFieldHtml}`);
  fs.writeFileSync(indexPath, html, 'utf8');
  console.log('index.html updated successfully with signup-confirm-password');
} else {
  console.log('signup-confirm-password already present in index.html');
}

// 2. Update app.js
const appPath = path.join(__dirname, 'app.js');
let appJs = fs.readFileSync(appPath, 'utf8');

// Update demoData.signup
if (!appJs.includes("confirmPassword: 'SecretPassword999!'")) {
  appJs = appJs.replace(
    "password: 'SecretPassword999!'",
    "password: 'SecretPassword999!',\n    confirmPassword: 'SecretPassword999!'"
  );
}

// Update handleSignupSubmit with password confirmation check
const oldSignupHandler = /function handleSignupSubmit\(event\) \{[\s\S]*?showToast\(`ลงทะเบียนสำเร็จ ยินดีต้อนรับคุณ \$\{name\}!`\);/;
const newSignupHandler = `function handleSignupSubmit(event) {
  event.preventDefault();
  const name = document.getElementById('signup-name').value;
  const password = document.getElementById('signup-password').value;
  const confirmPassword = document.getElementById('signup-confirm-password').value;

  if (password !== confirmPassword) {
    showToast('⚠️ รหัสผ่านและการยืนยัน Password ไม่ตรงกัน!');
    const confirmInput = document.getElementById('signup-confirm-password');
    confirmInput.focus();
    confirmInput.style.borderColor = '#ef4444';
    setTimeout(() => {
      confirmInput.style.borderColor = '';
    }, 2000);
    return;
  }

  showToast(\`ลงทะเบียนสำเร็จ ยินดีต้อนรับคุณ \${name}!\`);`;

appJs = appJs.replace(oldSignupHandler, newSignupHandler);

// Update fillDemoData
if (!appJs.includes("document.getElementById('signup-confirm-password').value")) {
  appJs = appJs.replace(
    "document.getElementById('signup-password').value = demoData.signup.password;",
    "document.getElementById('signup-password').value = demoData.signup.password;\n  document.getElementById('signup-confirm-password').value = demoData.signup.confirmPassword;"
  );
}

// Update closeModalAndReset
if (!appJs.includes("document.getElementById('form-signup').reset();")) {
  // Already resets the form
}

fs.writeFileSync(appPath, appJs, 'utf8');
console.log('app.js updated successfully with password confirmation logic');

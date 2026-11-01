/*
 * 해녀바당 로그인·회원가입 (데모: 회원 정보는 이 기기 브라우저 localStorage에만 저장)
 * - 회원 목록 haenyeo_users, 로그인 상태 haenyeo_session (userType: 'haenyeo' | 'general')
 * - 비밀번호는 그대로 두지 않고 SHA-256으로 바꿔 저장 (서버가 없어서 진짜 보안은 아님)
 */
(function () {
  'use strict';
  const $ = (s) => document.querySelector(s);
  const USERS = 'haenyeo_users', SESSION = 'haenyeo_session';
  const read = (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } };
  const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* 저장 안 되는 환경 */ } };
  async function hash(username, password) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(username + ':' + password));
    return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  const showError = (id, on) => { const el = $(id); if (el) el.hidden = !on; };
  const go = () => location.replace('/market/');
  function startSession(u, demo) {
    write(SESSION, { username: u.username, name: u.name, userType: u.userType, demo: !!demo, loggedInAt: Date.now() });
    go();
  }

  // 비밀번호 보기
  const eye = $('#togglePassword');
  if (eye) eye.addEventListener('click', () => {
    const pw = $('[name="password"]'), show = pw.type === 'password';
    pw.type = show ? 'text' : 'password';
    eye.textContent = show ? '숨기기' : '보기';
    eye.setAttribute('aria-label', show ? '비밀번호 숨기기' : '비밀번호 보기');
  });

  // 시연용: 계정 없이 해녀·손님으로 바로 둘러보기
  document.querySelectorAll('[data-demo]').forEach((b) => b.addEventListener('click', () => {
    const haenyeo = b.dataset.demo === 'haenyeo';
    startSession({ username: haenyeo ? 'demo-haenyeo' : 'demo-guest', name: haenyeo ? '김순덕(예시)' : '체험 손님', userType: haenyeo ? 'haenyeo' : 'general' }, true);
  }));

  // 로그인
  const login = $('#loginForm');
  if (login) {
    if (read(SESSION, null)) go();   // 이미 로그인돼 있으면 바로 앱으로
    login.addEventListener('submit', async (e) => {
      e.preventDefault();
      const username = login.querySelector('[name="username"]').value.trim(), password = login.querySelector('[name="password"]').value;
      ['#errUsername', '#errPassword', '#errLogin'].forEach((id) => showError(id, false));
      if (!username) showError('#errUsername', true);
      if (!password) showError('#errPassword', true);
      if (!username || !password) return;
      const user = read(USERS, []).find((u) => u.username === username);
      const ok = user && (user.pw ? user.pw === await hash(username, password) : user.password === password);
      if (!ok) { showError('#errLogin', true); return; }
      startSession(user);
    });
  }

  // 회원가입
  const signup = $('#signupForm');
  if (signup) {
    signup.addEventListener('submit', async (e) => {
      e.preventDefault();
      const type = signup.querySelector('[name="userType"]:checked');
      const val = (n) => signup.querySelector(`[name="${n}"]`).value;   // signup.name은 폼 자체의 이름이라 이렇게 찾음
      const name = val('name').trim(), username = val('username').trim(), password = val('password');
      ['#errUserType', '#errName', '#errUsername', '#errUsernameTaken', '#errPassword', '#errPasswordLen'].forEach((id) => showError(id, false));
      let bad = false;
      if (!type) { showError('#errUserType', true); bad = true; }
      if (!name) { showError('#errName', true); bad = true; }
      if (!username) { showError('#errUsername', true); bad = true; }
      if (!password) { showError('#errPassword', true); bad = true; }
      else if (password.length < 4) { showError('#errPasswordLen', true); bad = true; }
      if (bad) return;
      const users = read(USERS, []);
      if (users.some((u) => u.username === username) || /^demo-/.test(username)) { showError('#errUsernameTaken', true); return; }
      const user = { id: Date.now().toString(36) + Math.random().toString(36).slice(2), username, pw: await hash(username, password), name, userType: type.value, createdAt: Date.now() };
      users.push(user);
      write(USERS, users);
      startSession(user);   // 가입하면 바로 들어감
    });
  }
})();

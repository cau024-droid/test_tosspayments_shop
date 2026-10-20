// 로그인 · 회원가입 · 비밀번호 찾기 (login.html?mode=signup | find)
renderLayout("");

const root = document.getElementById("auth-root");
const next = safeNext(qs("next"));
const keepNext = qs("next") ? `&next=${encodeURIComponent(next)}` : "";

// Supabase Auth 의 영어 에러를 손님이 알아듣기 쉬운 말로 바꿔요.
function authErrorMessage(error) {
  const m = (error && error.message) || "";
  if (/Invalid login credentials/i.test(m)) return "이메일 또는 비밀번호가 맞지 않아요";
  if (/Email not confirmed/i.test(m)) return "메일의 확인 링크를 눌러 가입을 끝내 주세요";
  if (/already registered/i.test(m)) return "이미 가입한 이메일이에요. 로그인해 주세요";
  if (/rate limit|too many/i.test(m)) return "요청이 많아요. 잠시 후 다시 시도해 주세요";
  if (/Password should be/i.test(m)) return "비밀번호는 8자 이상으로 정해 주세요";
  if (/invalid.*email|email.*invalid/i.test(m)) return "이메일 주소를 확인해 주세요";
  return "처리하지 못했어요. 잠시 후 다시 시도해 주세요";
}

const isEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

function sentHtml(title, email, desc) {
  return `
    <div class="auth-box">
      <h1>${title}</h1>
      <p class="auth-desc"><b>${escapeHtml(email)}</b>(으)로 메일을 보냈어요.<br>${desc}</p>
      <p class="notice">메일이 오지 않으면 스팸함을 확인해 주세요. 몇 분이 지나도 없으면 다시 시도해 주세요.</p>
      <a class="btn btn-black auth-submit" href="login.html${keepNext ? "?" + keepNext.slice(1) : ""}">로그인 화면으로</a>
    </div>`;
}

function drawLogin() {
  document.title = "로그인 | OOTD STORE";
  root.innerHTML = `
    <form class="auth-box" id="form" novalidate>
      <h1>로그인</h1>
      <div class="auth-field"><label for="email">이메일</label><input id="email" type="email" autocomplete="email" placeholder="example@email.com" /></div>
      <div class="auth-field"><label for="password">비밀번호</label><input id="password" type="password" autocomplete="current-password" /></div>
      <button type="submit" class="btn btn-black auth-submit">로그인</button>
      <div class="auth-links">
        <a href="login.html?mode=signup${keepNext}">회원가입</a>
        <a href="login.html?mode=find${keepNext}">비밀번호 찾기</a>
      </div>
      <p class="notice">회원이 아니어도 결제할 수 있어요. 다만 주문 내역·취소·리뷰는 회원만 쓸 수 있어요.</p>
    </form>`;

  document.getElementById("form").onsubmit = async (e) => {
    e.preventDefault();
    const email = document.getElementById("email").value.trim();
    const password = document.getElementById("password").value;
    if (!isEmail(email)) return toast("이메일 주소를 확인해 주세요");
    if (!password) return toast("비밀번호를 입력해 주세요");
    const btn = e.target.querySelector("button[type=submit]");
    btn.disabled = true;
    const { error } = await sb.auth.signInWithPassword({ email, password });
    btn.disabled = false;
    if (error) return toast(authErrorMessage(error));
    await Auth.ready;
    location.replace(next);
  };
}

function drawSignup() {
  document.title = "회원가입 | OOTD STORE";
  root.innerHTML = `
    <form class="auth-box" id="form" novalidate>
      <h1>회원가입</h1>
      <div class="auth-field"><label for="email">이메일</label><input id="email" type="email" autocomplete="email" placeholder="example@email.com" /></div>
      <div class="auth-field"><label for="password">비밀번호</label><input id="password" type="password" autocomplete="new-password" placeholder="8자 이상" /></div>
      <div class="auth-field"><label for="password2">비밀번호 확인</label><input id="password2" type="password" autocomplete="new-password" /></div>
      <div class="auth-field"><label for="name">이름</label><input id="name" autocomplete="name" maxlength="50" /></div>
      <div class="auth-field"><label for="phone">휴대폰 <small>(선택)</small></label><input id="phone" type="tel" autocomplete="tel" placeholder="01012345678" /></div>
      <button type="submit" class="btn btn-black auth-submit">가입하기</button>
      <p class="notice">가입하면 확인 메일이 가요. 메일의 링크를 눌러야 가입이 끝나요.</p>
      <div class="auth-links"><span>이미 회원인가요?</span><a href="login.html${keepNext ? "?" + keepNext.slice(1) : ""}">로그인</a></div>
    </form>`;

  document.getElementById("form").onsubmit = async (e) => {
    e.preventDefault();
    const email = document.getElementById("email").value.trim();
    const password = document.getElementById("password").value;
    const password2 = document.getElementById("password2").value;
    const name = document.getElementById("name").value.trim();
    const phone = document.getElementById("phone").value.replace(/\D/g, "");
    if (!isEmail(email)) return toast("이메일 주소를 확인해 주세요");
    if (password.length < 8) return toast("비밀번호는 8자 이상으로 정해 주세요");
    if (password !== password2) return toast("비밀번호가 서로 달라요");
    if (!name) return toast("이름을 입력해 주세요");
    if (phone && !/^01\d{8,9}$/.test(phone)) return toast("휴대폰 번호를 확인해 주세요");

    const btn = e.target.querySelector("button[type=submit]");
    btn.disabled = true;
    const { data, error } = await sb.auth.signUp({
      email,
      password,
      options: {
        data: { name, phone: phone || null },
        emailRedirectTo: pageBase() + "login.html?confirmed=1" + keepNext,
      },
    });
    btn.disabled = false;
    if (error) return toast(authErrorMessage(error));
    // 확인 메일 없이 바로 가입되는 설정이면 로그인된 상태로 돌아와요.
    if (data.session) {
      await Auth.ready;
      toast("가입했어요. 환영해요!");
      return setTimeout(() => location.replace(next), 800);
    }
    root.innerHTML = sentHtml("메일을 확인해 주세요", email, "메일의 링크를 누르면 가입이 끝나요.<br>이미 가입한 이메일이면 메일이 가지 않아요. 로그인하거나 비밀번호 찾기를 써 주세요.");
  };
}

function drawFind() {
  document.title = "비밀번호 찾기 | OOTD STORE";
  root.innerHTML = `
    <form class="auth-box" id="form" novalidate>
      <h1>비밀번호 찾기</h1>
      <p class="auth-desc">가입한 이메일을 입력하면 비밀번호를 다시 정하는 링크를 보내 드려요.</p>
      <div class="auth-field"><label for="email">이메일</label><input id="email" type="email" autocomplete="email" placeholder="example@email.com" /></div>
      <button type="submit" class="btn btn-black auth-submit">재설정 메일 보내기</button>
      <div class="auth-links"><a href="login.html${keepNext ? "?" + keepNext.slice(1) : ""}">로그인으로 돌아가기</a></div>
    </form>`;

  document.getElementById("form").onsubmit = async (e) => {
    e.preventDefault();
    const email = document.getElementById("email").value.trim();
    if (!isEmail(email)) return toast("이메일 주소를 확인해 주세요");
    const btn = e.target.querySelector("button[type=submit]");
    btn.disabled = true;
    const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: pageBase() + "reset.html" });
    btn.disabled = false;
    if (error) return toast(authErrorMessage(error));
    root.innerHTML = sentHtml("메일을 확인해 주세요", email, "메일의 링크를 눌러 새 비밀번호를 정해 주세요.");
  };
}

(async () => {
  if (!sb) {
    root.innerHTML = `<p class="empty">로그인 기능을 불러오지 못했어요. 새로고침해 주세요.</p>`;
    return;
  }
  await Auth.ready;
  // 가입 확인 메일의 링크로 들어오면 Supabase가 자동으로 로그인시켜요.
  if (qs("confirmed") && Auth.user) {
    root.innerHTML = `
      <div class="auth-box">
        <h1>가입이 끝났어요</h1>
        <p class="auth-desc">${escapeHtml(Auth.name())}님, 환영해요! 이제 주문 내역·취소·리뷰를 쓸 수 있어요.</p>
        <a class="btn btn-black auth-submit" href="${next}">쇼핑하러 가기</a>
      </div>`;
    return;
  }
  if (Auth.user) return location.replace(next);
  // 메일 링크가 만료됐거나 이미 쓴 링크면 주소 뒤에 에러가 붙어서 와요.
  if (/error_description|error=/.test(location.hash)) toast("링크가 만료됐어요. 다시 시도해 주세요");

  const mode = qs("mode");
  if (mode === "signup") drawSignup();
  else if (mode === "find") drawFind();
  else drawLogin();
})();

// 공통: 레이아웃, 가격 포맷, 장바구니, 좋아요, 상품 카드
const SHOP_NAME = "OOTD STORE";
// 검색엔진에 알려줄 대표 주소 (canonical, 구조화 데이터, sitemap.xml 과 같게 맞춰요)
const SITE_URL = "https://testtosspaymentsshop-taupe.vercel.app";

const won = (n) => n.toLocaleString("ko-KR") + "원";
const pct = (p) => Math.round((1 - p.sale / p.price) * 100);
const qs = (key) => new URLSearchParams(location.search).get(key);

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
}

// ---- storage (사파리 비공개 모드 등에서 실패해도 동작하도록) ----
function load(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}
function save(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* ignore */ }
}

// ---- Supabase (회원·좋아요·리뷰) ----
// 공개(publishable) 키라 브라우저에 둬도 돼요. 데이터는 RLS로 본인 것만 읽고 쓸 수 있어요.
const SUPABASE_URL = "https://bxtfhadwhteljgzmuecy.supabase.co";
const SUPABASE_KEY = "sb_publishable_0EP4VpNtaQIGY6W4cUFhWw_vvyxzeB4";
const sb = window.supabase && window.supabase.createClient ? window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY) : null;

// 지금 페이지가 있는 폴더 주소 (메일 링크가 돌아올 곳)
const pageBase = () => location.href.replace(/[?#].*$/, "").replace(/[^/]*$/, "");

const Auth = {
  user: null,
  profile: null,
  async init() {
    if (!sb) return;
    const { data } = await sb.auth.getSession();
    await this.apply(data.session, "INITIAL");
    // 콜백 안에서 Supabase를 바로 부르면 멈출 수 있어서 한 박자 늦게 처리해요.
    sb.auth.onAuthStateChange((event, session) => setTimeout(() => this.apply(session, event), 0));
  },
  async apply(session, event) {
    const user = session ? session.user : null;
    const before = this.user ? this.user.id : null;
    this.user = user;
    if ((user ? user.id : null) === before) return;
    if (user) {
      const { data } = await sb.from("profiles").select("*").eq("id", user.id).maybeSingle();
      this.profile = data;
      // 로그인하는 순간에만 비회원일 때 누른 좋아요를 계정으로 옮겨요.
      await Likes.sync(event === "SIGNED_IN");
    } else {
      this.profile = null;
      if (before) { save("likes", []); refreshLikeButtons(); }
    }
    drawAuthArea();
    document.dispatchEvent(new CustomEvent("auth:change"));
  },
  name() {
    if (!this.user) return "";
    return (this.profile && this.profile.name) || this.user.email.split("@")[0];
  },
  async token() {
    if (!sb) return null;
    const { data } = await sb.auth.getSession();
    return data.session ? data.session.access_token : null;
  },
  async signOut() {
    if (sb) await sb.auth.signOut();
  },
};
Auth.ready = Auth.init().catch((err) => console.error("[auth]", err));

// 로그인해야 쓸 수 있는 페이지에서 불러요. 로그인하지 않았으면 로그인 화면으로 보내요.
async function requireLogin() {
  await Auth.ready;
  if (Auth.user) return true;
  const here = location.pathname.split("/").pop() + location.search;
  location.replace("login.html?next=" + encodeURIComponent(here));
  return false;
}

// 로그인 후 돌아갈 곳. 같은 사이트의 페이지만 허용해요.
function safeNext(next) {
  return /^[a-z-]+\.html(\?[^#]*)?$/.test(next || "") ? next : "index.html";
}

// 우리 서버 API 호출. 로그인했으면 토큰을 함께 보내요.
async function api(path, { method = "GET", body } = {}) {
  const headers = { "Content-Type": "application/json" };
  const token = Auth.user ? await Auth.token() : null;
  if (token) headers.Authorization = "Bearer " + token;
  let res;
  try {
    res = await fetch(path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  } catch {
    const err = new Error("서버에 연결할 수 없어요. 잠시 후 다시 시도해 주세요");
    err.code = "NETWORK_ERROR";
    throw err;
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.message || "요청을 처리하지 못했어요");
    err.code = data.code;
    err.status = res.status;
    throw err;
  }
  return data;
}

// ---- 주문 상태 ----
const ORDER_STATUS = {
  DONE: "결제 완료",
  CANCELED: "취소 완료",
  PARTIAL_CANCELED: "부분 취소",
  WAITING_FOR_DEPOSIT: "입금 대기",
  PENDING: "결제 대기",
  READY: "결제 대기",
  IN_PROGRESS: "결제 대기",
  FAILED: "결제 실패",
  ABORTED: "결제 실패",
  EXPIRED: "결제 실패",
  USER_CANCELED: "결제 취소",
};
// 결제가 되지 않은 주문 (목록에서 숨겨요)
const UNPAID_STATUS = ["PENDING", "READY", "IN_PROGRESS", "FAILED", "ABORTED", "EXPIRED", "USER_CANCELED"];
const statusLabel = (s) => ORDER_STATUS[s] || s;
const fmtDate = (iso) => (iso ? new Date(iso).toLocaleString("ko-KR") : "-");
const fmtDay = (iso) => (iso ? new Date(iso).toLocaleDateString("ko-KR") : "-");

// ---- 상품 통계 (실제 좋아요 수·리뷰 수·평균 별점) ----
// 마지막으로 읽은 값을 먼저 보여주고, 새 값을 받으면 "stats:change" 이벤트로 화면을 다시 그려요.
const Stats = {
  map: load("productStats", {}),
  apply() {
    PRODUCTS.forEach((p) => {
      const s = this.map[p.id] || {};
      p.likes = s.likes || 0;
      p.reviews = s.reviews || 0;
      p.rating = s.rating || 0;
    });
  },
  async refresh() {
    if (!sb) return;
    const { data, error } = await sb.rpc("product_stats");
    if (error) return console.error("[stats]", error.message);
    this.map = {};
    data.forEach((r) => { this.map[r.product_id] = { likes: Number(r.likes), reviews: Number(r.reviews), rating: Number(r.rating) || 0 }; });
    save("productStats", this.map);
    this.apply();
    document.dispatchEvent(new CustomEvent("stats:change"));
  },
  // 좋아요를 누르면 서버 값을 기다리지 않고 바로 숫자를 바꿔요.
  bump(id, diff) {
    const s = (this.map[id] = this.map[id] || { likes: 0, reviews: 0, rating: 0 });
    s.likes = Math.max(0, s.likes + diff);
    save("productStats", this.map);
    this.apply();
  },
};
Stats.apply();
Stats.refresh();

// ---- 결제 실패 기록 ----
// 결제창을 닫았거나 실패한 이유를 서버 주문에 남겨요. 실패해도 화면에는 영향이 없어요.
function reportPaymentFail(orderId, code, message) {
  if (!orderId) return Promise.resolve();
  return fetch("/api/fail", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ orderId, code, message }),
  }).catch(() => {});
}

// ---- 장바구니 ----
const Cart = {
  items() { return load("cart", []); },
  set(items) { save("cart", items); updateCartBadge(); },
  add(id, size, qty) {
    const items = this.items();
    const found = items.find((i) => i.id === id && i.size === size);
    if (found) found.qty += qty;
    else items.push({ id, size, qty });
    this.set(items);
  },
  count() { return this.items().reduce((s, i) => s + i.qty, 0); },
};

// ---- 주문 금액 계산 (3만원 이상 또는 전 상품 무료배송이면 배송비 0원) ----
const FREE_SHIPPING_MIN = 30000;
const SHIPPING_FEE = 3000;

function summarize(items) {
  const lines = items
    .map((i) => ({ ...i, product: getProduct(i.id) }))
    .filter((l) => l.product);
  const subtotal = lines.reduce((s, l) => s + l.product.sale * l.qty, 0);
  const origin = lines.reduce((s, l) => s + l.product.price * l.qty, 0);
  const allFree = lines.length > 0 && lines.every((l) => l.product.free);
  const shipping = lines.length === 0 || allFree || subtotal >= FREE_SHIPPING_MIN ? 0 : SHIPPING_FEE;
  return { lines, origin, discount: origin - subtotal, subtotal, shipping, total: subtotal + shipping };
}

function lineHtml(l, editable) {
  const p = l.product;
  return `
    <div class="line">
      <a href="product.html?id=${p.id}" class="thumb" style="background:${p.bg}"><div class="art">${productArt(p)}</div></a>
      <div class="line-info">
        <div class="brand">${escapeHtml(p.brand)}</div>
        <div class="name">${escapeHtml(p.name)}</div>
        <div class="opt">옵션: ${escapeHtml(l.size)}${editable ? "" : ` · ${l.qty}개`}</div>
        ${editable ? `
        <div class="qty">
          <button type="button" data-act="minus" data-key="${l.id}|${l.size}" aria-label="수량 감소">−</button>
          <input type="number" value="${l.qty}" readonly aria-label="수량" />
          <button type="button" data-act="plus" data-key="${l.id}|${l.size}" aria-label="수량 증가">+</button>
        </div>` : ""}
      </div>
      <div class="line-right">
        <strong>${won(p.sale * l.qty)}</strong>
        ${editable ? `<button type="button" class="remove" data-act="remove" data-key="${l.id}|${l.size}">삭제</button>` : ""}
      </div>
    </div>`;
}

// ---- 좋아요 ----
// 비회원은 이 브라우저에만 저장해요. 로그인하면 계정(Supabase likes)에 저장하고, 브라우저에는 사본을 둬요.
const Likes = {
  all() { return load("likes", []); },
  has(id) { return this.all().includes(id); },
  toggle(id) {
    const list = this.all();
    const i = list.indexOf(id);
    i >= 0 ? list.splice(i, 1) : list.push(id);
    save("likes", list);
    const on = i < 0;
    if (Auth.user && sb) {
      const q = on ? sb.from("likes").insert({ product_id: id }) : sb.from("likes").delete().eq("product_id", id);
      q.then(({ error }) => {
        if (error && error.code !== "23505") toast("좋아요를 저장하지 못했어요. 잠시 후 다시 눌러 주세요");
      });
      Stats.bump(id, on ? 1 : -1);
    }
    return on;
  },
  // 계정의 좋아요를 읽어와요. merge 가 true 면 비회원일 때 누른 좋아요를 계정에 더해요.
  async sync(merge) {
    const { data, error } = await sb.from("likes").select("product_id");
    if (error) return console.error("[likes]", error.message);
    const remote = data.map((r) => r.product_id);
    const extra = merge ? this.all().filter((id) => !remote.includes(id) && getProduct(id)) : [];
    if (extra.length) {
      const { error: upErr } = await sb.from("likes")
        .upsert(extra.map((product_id) => ({ product_id })), { onConflict: "user_id,product_id", ignoreDuplicates: true });
      if (upErr) console.error("[likes] merge failed:", upErr.message);
      else Stats.refresh();
    }
    save("likes", [...remote, ...extra]);
    refreshLikeButtons();
  },
};

// 화면의 하트를 저장된 좋아요에 맞춰요.
function refreshLikeButtons() {
  document.querySelectorAll("[data-like]").forEach((b) => b.classList.toggle("on", Likes.has(b.dataset.like)));
  document.dispatchEvent(new CustomEvent("likes:change"));
}

// ---- 레이아웃 ----
function renderLayout(active) {
  const nav = [
    ["home", "index.html", "홈"],
    ["top", "tops.html", "상의"],
    ["shoes", "shoes.html", "신발"],
    ["pants", "pants.html", "바지"],
  ];

  document.getElementById("header").innerHTML = `
    <div class="top-banner">신규 회원 첫 구매 20% 쿠폰 · 3만원 이상 무료배송</div>
    <header class="header">
      <div class="inner">
        <a href="index.html" class="logo">${SHOP_NAME}</a>
        <form class="search" action="index.html" onsubmit="return false">
          <input type="search" placeholder="브랜드, 상품, 프로필, 태그 등" aria-label="검색" />
        </form>
        <div class="header-util">
          <span class="auth-area" id="auth-area"></span>
          <a href="cart.html" class="cart-link">장바구니 <span class="cart-badge" id="cart-badge">0</span></a>
        </div>
      </div>
    </header>
    <nav class="gnb">
      <div class="inner">
        ${nav.map(([key, href, label]) => `<a href="${href}" class="${key === active ? "active" : ""}">${label}</a>`).join("")}
      </div>
    </nav>`;

  document.getElementById("footer").innerHTML = `
    <footer class="footer">
      <div class="inner">
        <strong>${SHOP_NAME}</strong>
        고객센터 1234-5678 · 평일 10:00 - 18:00<br />
        본 사이트는 퍼블리싱 샘플이며, 결제는 토스페이먼츠 테스트 환경에서 진행되어 실제로 청구되지 않아요.<br />
        © ${new Date().getFullYear()} ${SHOP_NAME}
      </div>
    </footer>`;

  updateCartBadge();
  // 로그인 상태를 확인하기 전에는 비워 두고, 확인한 뒤에 그려요. (깜빡임 방지)
  Auth.ready.then(drawAuthArea);
}

// 헤더 오른쪽 위: "OOO님 · 마이페이지 · 로그아웃" 또는 "로그인 · 회원가입"
function drawAuthArea() {
  const el = document.getElementById("auth-area");
  if (!el) return;
  if (!sb) { el.innerHTML = ""; return; }
  el.innerHTML = Auth.user
    ? `<span class="who">${escapeHtml(Auth.name())}님</span><a href="mypage.html">마이페이지</a><button type="button" id="logout-btn">로그아웃</button>`
    : `<a href="login.html">로그인</a><a href="login.html?mode=signup">회원가입</a>`;
  const out = document.getElementById("logout-btn");
  if (out) out.onclick = async () => {
    await Auth.signOut();
    toast("로그아웃했어요");
    if (document.body.dataset.private === "true") location.href = "index.html";
  };
}

function updateCartBadge() {
  const el = document.getElementById("cart-badge");
  if (el) el.textContent = Cart.count();
}

// ---- 상품 카드 ----
const HEART_SVG = `<svg viewBox="0 0 24 24"><path fill="rgba(0,0,0,.15)" stroke="#fff" stroke-width="1.6" d="M12 20.5s-7.5-4.6-9.3-9.2C1.5 8 3.6 4.5 7.2 4.5c2 0 3.4 1 4.8 2.7 1.4-1.7 2.8-2.7 4.8-2.7 3.6 0 5.7 3.5 4.5 6.8C19.5 15.9 12 20.5 12 20.5z"/></svg>`;

function productCard(p, rank) {
  const off = pct(p);
  return `
    <a class="card" href="product.html?id=${p.id}">
      <div class="thumb" style="background:${p.bg}">
        <div class="art">${productArt(p)}</div>
        ${rank ? `<span class="rank">${rank}</span>` : ""}
        <button type="button" class="like-btn ${Likes.has(p.id) ? "on" : ""}" data-like="${p.id}" aria-label="좋아요">${HEART_SVG}</button>
      </div>
      <div class="info">
        <div class="brand">${escapeHtml(p.brand)}</div>
        <div class="name">${escapeHtml(p.name)}</div>
        <div class="price-row">
          ${off > 0 ? `<span class="discount">${off}%</span>` : ""}
          <span>${won(p.sale)}</span>
        </div>
        <div class="meta">
          <span class="heart">♥ ${p.likes.toLocaleString()}</span>
          ${p.reviews ? `<span>★ ${p.rating} (${p.reviews.toLocaleString()})</span>` : ""}
        </div>
        <div class="tags">
          ${p.free ? `<span class="tag free">무료배송</span>` : ""}
          ${off >= 30 ? `<span class="tag">특가</span>` : ""}
        </div>
      </div>
    </a>`;
}

// 카드 안의 좋아요 버튼 (링크 이동 막고 토글)
document.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-like]");
  if (!btn) return;
  e.preventDefault();
  const on = Likes.toggle(btn.dataset.like);
  btn.classList.toggle("on", on);
  toast(on ? "좋아요에 추가했어요" : "좋아요를 취소했어요");
});

// ---- 토스트 ----
let toastTimer;
function toast(msg) {
  let el = document.querySelector(".toast");
  if (!el) {
    el = document.createElement("div");
    el.className = "toast";
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 1800);
}

// ---- 카테고리 목록 페이지 ----
function renderCategoryPage(catKey) {
  const cat = CATEGORIES[catKey];
  renderLayout(catKey);
  document.title = `${cat.name} | ${SHOP_NAME}`;

  const state = { sub: "전체", sort: "popular" };
  const chips = document.getElementById("chips");
  const grid = document.getElementById("grid");
  const count = document.getElementById("count");
  const sortSel = document.getElementById("sort");

  chips.innerHTML = ["전체", ...cat.subs]
    .map((s) => `<button type="button" class="chip ${s === "전체" ? "active" : ""}" data-sub="${s}">${s}</button>`)
    .join("");

  function draw() {
    let list = PRODUCTS.filter((p) => p.cat === catKey && (state.sub === "전체" || p.sub === state.sub));
    const sorters = {
      popular: (a, b) => b.likes - a.likes,
      low: (a, b) => a.sale - b.sale,
      high: (a, b) => b.sale - a.sale,
      discount: (a, b) => pct(b) - pct(a),
      review: (a, b) => b.reviews - a.reviews,
    };
    list = list.sort(sorters[state.sort]);
    count.textContent = `상품 ${list.length}개`;
    grid.innerHTML = list.length
      ? list.map((p, i) => productCard(p, state.sort === "popular" ? i + 1 : null)).join("")
      : `<p class="empty">조건에 맞는 상품이 없어요.</p>`;
  }

  chips.addEventListener("click", (e) => {
    const b = e.target.closest("[data-sub]");
    if (!b) return;
    state.sub = b.dataset.sub;
    chips.querySelectorAll(".chip").forEach((c) => c.classList.toggle("active", c === b));
    draw();
  });
  sortSel.addEventListener("change", () => { state.sort = sortSel.value; draw(); });
  document.addEventListener("stats:change", draw);

  draw();
  setJsonLd("itemlist", categoryJsonLd(catKey));
}

// ---- 검색엔진·AI 검색용 정보 (SEO·AEO·GEO) ----
// 페이지마다 바뀌는 제목·설명·대표 주소를 head 의 meta 태그에 맞춰요.
function setMeta({ title, description, path }) {
  const url = SITE_URL + "/" + path;
  const set = (selector, attr, value) => {
    const el = document.querySelector(selector);
    if (el) el.setAttribute(attr, value);
  };
  if (title) {
    document.title = title;
    set('meta[property="og:title"]', "content", title);
    set('meta[name="twitter:title"]', "content", title);
  }
  if (description) {
    set('meta[name="description"]', "content", description);
    set('meta[property="og:description"]', "content", description);
    set('meta[name="twitter:description"]', "content", description);
  }
  set('link[rel="canonical"]', "href", url);
  set('meta[property="og:url"]', "content", url);
}

// 구조화 데이터(JSON-LD)를 넣거나 새 값으로 바꿔요.
function setJsonLd(key, data) {
  let el = document.querySelector(`script[data-ld="${key}"]`);
  if (!el) {
    el = document.createElement("script");
    el.type = "application/ld+json";
    el.dataset.ld = key;
    document.head.appendChild(el);
  }
  el.textContent = JSON.stringify(data);
}

const productUrl = (p) => `${SITE_URL}/product.html?id=${p.id}`;

// 카테고리 목록: 상품 목록(ItemList)
function categoryJsonLd(catKey) {
  const cat = CATEGORIES[catKey];
  const list = PRODUCTS.filter((p) => p.cat === catKey);
  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: `${SHOP_NAME} ${cat.name}`,
    numberOfItems: list.length,
    itemListElement: list.map((p, i) => ({ "@type": "ListItem", position: i + 1, url: productUrl(p), name: p.name })),
  };
}

// 상품 상세: 상품(Product) + 이동 경로(BreadcrumbList). 리뷰가 있을 때만 평균 별점을 넣어요.
function productJsonLd(p) {
  const cat = CATEGORIES[p.cat];
  const product = {
    "@context": "https://schema.org",
    "@type": "Product",
    sku: p.id,
    name: p.name,
    description: productDescription(p),
    brand: { "@type": "Brand", name: p.brand },
    category: `${cat.name} > ${p.sub}`,
    url: productUrl(p),
    offers: {
      "@type": "Offer",
      url: productUrl(p),
      priceCurrency: "KRW",
      price: p.sale,
      availability: "https://schema.org/InStock",
      itemCondition: "https://schema.org/NewCondition",
      seller: { "@type": "Organization", name: SHOP_NAME },
      shippingDetails: {
        "@type": "OfferShippingDetails",
        shippingRate: { "@type": "MonetaryAmount", value: p.free || p.sale >= 30000 ? 0 : 3000, currency: "KRW" },
        shippingDestination: { "@type": "DefinedRegion", addressCountry: "KR" },
      },
    },
  };
  if (p.reviews) {
    product.aggregateRating = { "@type": "AggregateRating", ratingValue: p.rating, reviewCount: p.reviews, bestRating: 5, worstRating: 1 };
  }
  return [
    product,
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "홈", item: SITE_URL + "/" },
        { "@type": "ListItem", position: 2, name: cat.name, item: `${SITE_URL}/${cat.page}` },
        { "@type": "ListItem", position: 3, name: p.name, item: productUrl(p) },
      ],
    },
  ];
}

// 검색 결과·AI 답변에 그대로 쓰일 수 있게 상품을 한 문장으로 설명해요.
function productDescription(p) {
  const cat = CATEGORIES[p.cat];
  const off = pct(p);
  const price = off > 0 ? `정가 ${won(p.price)}에서 ${off}% 할인한 ${won(p.sale)}` : won(p.sale);
  const ship = p.free ? "무료배송" : "3만원 이상 무료배송(미만 3,000원)";
  return `${p.brand} ${p.name}. ${cat.name} › ${p.sub}, ${price}. 사이즈 ${cat.sizes.join("·")}, ${ship}. OOTD STORE에서 토스페이먼츠로 결제해요.`;
}

// ---- 리뷰 ----
const stars = (n) => "★".repeat(n) + "☆".repeat(5 - n);

function reviewHtml(r, mine) {
  return `
    <div class="review" data-review="${r.id}">
      <div class="review-head">
        <span class="review-stars" aria-label="별점 ${r.rating}점">${stars(r.rating)}</span>
        <span class="review-meta">${escapeHtml(r.author_name)} · ${fmtDay(r.created_at)}${r.size ? ` · 구매 사이즈 ${escapeHtml(r.size)}` : ""}</span>
        ${mine ? `<span class="review-mine"><button type="button" data-act="edit">수정</button><button type="button" data-act="delete">삭제</button></span>` : ""}
      </div>
      <p class="review-body">${escapeHtml(r.content)}</p>
    </div>`;
}

function reviewFormHtml(r) {
  const rating = r ? r.rating : 5;
  return `
    <form class="review-form">
      <div class="star-pick" aria-label="별점">
        ${[1, 2, 3, 4, 5].map((n) => `<button type="button" data-star="${n}" class="${n <= rating ? "on" : ""}" aria-label="${n}점">★</button>`).join("")}
      </div>
      <textarea name="content" maxlength="500" placeholder="상품은 어떠셨나요? 10자 이상 써 주세요">${r ? escapeHtml(r.content) : ""}</textarea>
      <div class="review-form-foot">
        <span class="len"></span>
        <div class="review-form-btns">
          <button type="button" class="btn btn-white" data-act="cancel">취소</button>
          <button type="submit" class="btn btn-black">${r ? "수정하기" : "등록하기"}</button>
        </div>
      </div>
    </form>`;
}

// 별점 고르기, 글자 수 표시, 저장 버튼을 연결해요.
function bindReviewForm(form, { rating, onSubmit, onCancel }) {
  let value = rating || 5;
  const ta = form.querySelector("textarea");
  const len = form.querySelector(".len");
  const updateLen = () => { len.textContent = `${ta.value.trim().length}/500자`; };
  updateLen();
  ta.oninput = updateLen;
  form.querySelector(".star-pick").onclick = (e) => {
    const b = e.target.closest("[data-star]");
    if (!b) return;
    value = Number(b.dataset.star);
    form.querySelectorAll("[data-star]").forEach((s) => s.classList.toggle("on", Number(s.dataset.star) <= value));
  };
  form.querySelector('[data-act="cancel"]').onclick = onCancel;
  form.onsubmit = async (e) => {
    e.preventDefault();
    const content = ta.value.trim();
    if (content.length < 10) return toast("리뷰는 10자 이상 써 주세요");
    if (content.length > 500) return toast("리뷰는 500자까지 쓸 수 있어요");
    const btn = form.querySelector('[type="submit"]');
    btn.disabled = true;
    try {
      await onSubmit({ rating: value, content });
    } catch (err) {
      toast(err.message);
    } finally {
      btn.disabled = false;
    }
  };
  ta.focus();
}

const Reviews = {
  // id 가 있으면 고치고, 없으면 새로 써요. 사이즈와 작성자 이름은 DB가 주문에서 채워요.
  async save({ id, orderId, productId, rating, content }) {
    const q = id
      ? sb.from("reviews").update({ rating, content }).eq("id", id)
      : sb.from("reviews").insert({ order_id: orderId, product_id: productId, rating, content });
    const { data, error } = await q.select().single();
    if (error) throw new Error(reviewErrorMessage(error));
    Stats.refresh();
    return data;
  },
  async remove(id) {
    const { error } = await sb.from("reviews").delete().eq("id", id);
    if (error) throw new Error("리뷰를 지우지 못했어요");
    Stats.refresh();
  },
};

function reviewErrorMessage(error) {
  if (error.code === "23505") return "이 상품의 리뷰는 이미 썼어요";
  if (/REVIEW_NOT_ALLOWED/.test(error.message)) return "결제 완료된 내 주문의 상품만 리뷰를 쓸 수 있어요";
  if (error.code === "23514") return "별점과 글(10~500자)을 확인해 주세요";
  return "리뷰를 저장하지 못했어요. 잠시 후 다시 시도해 주세요";
}

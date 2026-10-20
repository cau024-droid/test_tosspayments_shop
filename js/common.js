// 공통: 레이아웃, 가격 포맷, 장바구니, 좋아요, 상품 카드
const SHOP_NAME = "OOTD STORE";

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
const Likes = {
  all() { return load("likes", []); },
  has(id) { return this.all().includes(id); },
  toggle(id) {
    const list = this.all();
    const i = list.indexOf(id);
    i >= 0 ? list.splice(i, 1) : list.push(id);
    save("likes", list);
    return i < 0;
  },
};

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
          <a href="#" onclick="toast('로그인은 퍼블리싱 범위 밖이에요'); return false;">로그인</a>
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
          <span>★ ${p.rating} (${p.reviews.toLocaleString()})</span>
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

  draw();
}

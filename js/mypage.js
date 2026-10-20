// 마이페이지: 내 주문 내역, 좋아요한 상품 (로그인한 회원만)
renderLayout("");

const ordersEl = document.getElementById("orders");
const likesEl = document.getElementById("likes");
let showUnpaid = false;
let myOrders = [];

// 주문 한 건의 상품 줄 (사진·이름·사이즈·수량)
function orderLines(order) {
  return order.items
    .map((i) => ({ ...i, product: getProduct(i.id) }))
    .filter((l) => l.product)
    .map((l) => lineHtml(l, false))
    .join("");
}

function orderCard(o) {
  const href = `order.html?id=${encodeURIComponent(o.orderId)}`;
  // 상품 사진은 상품 상세로 가는 링크라서, 카드 전체는 <a> 대신 클릭으로 이동해요.
  return `
    <div class="order-card" data-href="${href}">
      <div class="order-card-head">
        <div><strong>${fmtDay(o.createdAt)}</strong><span class="order-no">주문번호 ${escapeHtml(o.orderId)}</span></div>
        <span class="status status-${escapeHtml(o.status)}">${escapeHtml(statusLabel(o.status))}</span>
      </div>
      ${orderLines(o)}
      <div class="order-card-foot"><span>결제 금액 <b>${won(o.amount)}</b></span><a class="more" href="${href}">상세 보기 ›</a></div>
    </div>`;
}

ordersEl.addEventListener("click", (e) => {
  const card = e.target.closest(".order-card");
  if (card && !e.target.closest("a, button")) location.href = card.dataset.href;
});

function drawOrders() {
  const unpaid = myOrders.filter((o) => UNPAID_STATUS.includes(o.status));
  const list = showUnpaid ? unpaid : myOrders.filter((o) => !UNPAID_STATUS.includes(o.status));
  const toggle = unpaid.length
    ? `<button type="button" class="unpaid-toggle" id="unpaid-toggle">${showUnpaid ? "‹ 주문 내역으로 돌아가기" : `결제 안 된 주문 보기 (${unpaid.length})`}</button>`
    : "";
  const empty = showUnpaid
    ? "결제 안 된 주문이 없어요."
    : `아직 주문이 없어요.<br><br><a href="index.html"><u>쇼핑하러 가기</u></a>`;
  ordersEl.innerHTML = `
    ${showUnpaid ? `<p class="notice" style="margin:0 0 12px">결제를 끝내지 않았거나 결제에 실패한 주문이에요. 돈은 나가지 않았어요.</p>` : ""}
    ${list.length ? list.map(orderCard).join("") : `<p class="empty">${empty}</p>`}
    ${toggle}`;
  const t = document.getElementById("unpaid-toggle");
  if (t) t.onclick = () => { showUnpaid = !showUnpaid; drawOrders(); };
}

async function loadOrders() {
  try {
    const data = await api("/api/my-orders");
    myOrders = data.orders;
    drawOrders();
  } catch (err) {
    ordersEl.innerHTML = `<p class="empty">주문 내역을 불러오지 못했어요.<br>${escapeHtml(err.message)}</p>`;
  }
}

function drawLikes() {
  const list = Likes.all().map(getProduct).filter(Boolean);
  likesEl.innerHTML = list.length
    ? list.map((p) => productCard(p)).join("")
    : `<p class="empty">좋아요한 상품이 없어요. 마음에 드는 상품의 하트를 눌러 보세요.</p>`;
}

function showTab(name) {
  document.querySelectorAll("#tabs .tab").forEach((t) => t.classList.toggle("active", t.dataset.tab === name));
  document.getElementById("tab-orders").hidden = name !== "orders";
  document.getElementById("tab-likes").hidden = name !== "likes";
  if (name === "likes") drawLikes();
  history.replaceState(null, "", name === "likes" ? "?tab=likes" : location.pathname);
}

document.getElementById("tabs").onclick = (e) => {
  const t = e.target.closest("[data-tab]");
  if (t) showTab(t.dataset.tab);
};
// 좋아요 탭에서 하트를 끄면 목록에서도 빼요.
document.addEventListener("click", (e) => {
  if (e.target.closest("#likes [data-like]")) setTimeout(drawLikes, 0);
});
document.addEventListener("likes:change", () => { if (!document.getElementById("tab-likes").hidden) drawLikes(); });
document.addEventListener("stats:change", () => { if (!document.getElementById("tab-likes").hidden) drawLikes(); });

(async () => {
  if (!(await requireLogin())) return;
  document.getElementById("hello").textContent = `${Auth.name()}님의 마이페이지`;
  showTab(qs("tab") === "likes" ? "likes" : "orders");
  loadOrders();
})();

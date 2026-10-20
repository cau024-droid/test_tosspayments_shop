// 주문 상세: 배송지, 결제 정보, 영수증, 주문 취소(환불), 리뷰 쓰기 (로그인한 회원 본인 주문만)
renderLayout("");

const root = document.getElementById("order-root");
const orderId = qs("id");
// 서버(lib/shop.js CANCEL_REASONS)와 같은 목록이에요.
const CANCEL_REASONS = ["단순 변심", "사이즈를 잘못 골랐어요", "다른 상품으로 다시 살게요", "기타"];
let order = null;
let myReviews = {}; // product_id → review

const CANCEL_ERRORS = {
  NOT_CANCELABLE: "결제 후 7일이 지나 직접 취소할 수 없어요. 고객센터로 문의해 주세요.",
  ALREADY_CANCELED: "이미 취소된 주문이에요.",
  ORDER_NOT_FOUND: "주문을 찾을 수 없어요.",
  INVALID_REASON: "취소 이유를 골라 주세요.",
  UNAUTHORIZED: "로그인이 만료됐어요. 다시 로그인해 주세요.",
};

function row(label, value) {
  return `<div class="d-row"><dt>${label}</dt><dd>${value}</dd></div>`;
}

function itemsHtml() {
  const canReview = order.status === "DONE";
  return order.items
    .map((i) => ({ ...i, product: getProduct(i.id) }))
    .filter((l) => l.product)
    .map((l) => {
      const r = myReviews[l.id];
      let action = "";
      if (r) action = `<button type="button" class="btn btn-white btn-sm" data-review-open="${l.id}">리뷰 수정</button>`;
      else if (canReview) action = `<button type="button" class="btn btn-white btn-sm" data-review-open="${l.id}">리뷰 쓰기</button>`;
      return `
        <div class="order-item">
          ${lineHtml(l, false)}
          ${action || r ? `<div class="order-item-review" id="review-${l.id}">
            ${r ? `<div class="my-review"><span class="review-stars">${stars(r.rating)}</span> ${escapeHtml(r.content)}</div>` : ""}
            ${action}
          </div>` : ""}
        </div>`;
    })
    .join("");
}

function cancelHtml() {
  if (order.status === "CANCELED" || order.status === "PARTIAL_CANCELED") {
    return `
      <section class="box">
        <div class="box-head">취소·환불</div>
        <div class="box-body">
          <dl class="d-rows plain">
            ${row("환불 금액", `<b>${won(order.canceledAmount || order.amount)}</b>`)}
            ${row("취소 시각", fmtDate(order.canceledAt))}
            ${order.cancelReason ? row("취소 이유", escapeHtml(order.cancelReason)) : ""}
          </dl>
          <p class="notice">카드 결제는 카드사 사정에 따라 환불까지 3~7일(영업일) 걸릴 수 있어요.</p>
        </div>
      </section>`;
  }
  if (order.status !== "DONE") return "";
  if (!order.cancelable) {
    return `
      <section class="box">
        <div class="box-head">주문 취소</div>
        <div class="box-body"><p class="notice" style="margin:0">결제 후 7일이 지나 직접 취소할 수 없어요. 고객센터(1234-5678)로 문의해 주세요.</p></div>
      </section>`;
  }
  return `
    <section class="box">
      <div class="box-head">주문 취소</div>
      <div class="box-body">
        <p class="notice" style="margin:0 0 12px">결제 후 7일 이내, 배송이 시작되기 전까지 직접 취소할 수 있어요. 취소하면 결제한 수단으로 전액 환불돼요.</p>
        <div class="cancel-row">
          <select id="cancel-reason" aria-label="취소 이유">
            <option value="">취소 이유를 골라 주세요</option>
            ${CANCEL_REASONS.map((r) => `<option value="${escapeHtml(r)}">${escapeHtml(r)}</option>`).join("")}
          </select>
          <button type="button" class="btn btn-black" id="cancel-btn">주문 취소</button>
        </div>
        <p class="notice">카드 결제는 카드사 사정에 따라 환불까지 3~7일(영업일) 걸릴 수 있어요.</p>
      </div>
    </section>`;
}

function draw() {
  const unpaid = UNPAID_STATUS.includes(order.status);
  const c = order.customer || {};
  const method = order.method ? escapeHtml(order.method + (order.card ? ` (${order.card})` : "")) : "-";
  root.innerHTML = `
    <div class="two-col">
      <div style="display:grid; gap:20px">
        <section class="box">
          <div class="box-head order-detail-head">
            <span>${fmtDate(order.createdAt)} 주문 <small class="order-no">${escapeHtml(order.orderId)}</small></span>
            <span class="status status-${escapeHtml(order.status)}">${escapeHtml(statusLabel(order.status))}</span>
          </div>
          ${itemsHtml()}
        </section>

        <section class="box">
          <div class="box-head">배송지</div>
          <div class="box-body">
            <dl class="d-rows plain">
              ${row("받는 분", escapeHtml(c.name || "-"))}
              ${row("휴대폰", escapeHtml(c.phone || "-"))}
              ${c.email ? row("이메일", escapeHtml(c.email)) : ""}
              ${row("주소", escapeHtml(c.addr || "-"))}
            </dl>
          </div>
        </section>

        ${cancelHtml()}
      </div>

      <aside class="box summary">
        <div class="box-head">결제 정보</div>
        <div class="box-body">
          <div class="sum-row"><span>결제 수단</span><span>${method}</span></div>
          <div class="sum-row"><span>승인 시각</span><span>${fmtDate(order.approvedAt)}</span></div>
          <div class="sum-row total"><span>결제 금액</span><span>${won(order.amount)}</span></div>
          ${unpaid ? `<p class="notice">결제가 되지 않은 주문이에요. 돈은 나가지 않았어요.${order.failMessage ? `<br>이유: ${escapeHtml(order.failMessage)}` : ""}</p>` : ""}
          ${order.receiptUrl ? `<a class="btn btn-white" href="${escapeHtml(order.receiptUrl)}" target="_blank" rel="noopener">영수증 보기</a>` : ""}
          <a class="btn btn-white" href="mypage.html">주문 내역으로</a>
        </div>
      </aside>
    </div>`;

  const cancelBtn = document.getElementById("cancel-btn");
  if (cancelBtn) cancelBtn.onclick = cancelOrder;
}

async function cancelOrder() {
  const reason = document.getElementById("cancel-reason").value;
  if (!reason) return toast("취소 이유를 골라 주세요");
  if (!confirm(`정말 취소할까요?\n${won(order.amount)}이 결제한 수단으로 환불돼요.`)) return;
  const btn = document.getElementById("cancel-btn");
  btn.disabled = true;
  btn.textContent = "취소하고 있어요";
  try {
    order = await api("/api/cancel", { method: "POST", body: { orderId, reason } });
    draw();
    toast("주문을 취소했어요");
  } catch (err) {
    btn.disabled = false;
    btn.textContent = "주문 취소";
    toast(CANCEL_ERRORS[err.code] || err.message);
  }
}

// 리뷰 쓰기·수정 (주문 상품 아래에 폼을 열어요)
root.addEventListener("click", async (e) => {
  const open = e.target.closest("[data-review-open]");
  if (!open) return;
  const productId = open.dataset.reviewOpen;
  const box = document.getElementById("review-" + productId);
  const existing = myReviews[productId];
  box.innerHTML = reviewFormHtml(existing) +
    (existing ? `<button type="button" class="link-btn" id="review-delete">리뷰 지우기</button>` : "");
  bindReviewForm(box.querySelector("form"), {
    rating: existing && existing.rating,
    onCancel: draw,
    onSubmit: async ({ rating, content }) => {
      const saved = await Reviews.save({ id: existing && existing.id, orderId, productId, rating, content });
      myReviews[productId] = saved;
      draw();
      toast(existing ? "리뷰를 고쳤어요" : "리뷰를 등록했어요");
    },
  });
  const del = document.getElementById("review-delete");
  if (del) del.onclick = async () => {
    if (!confirm("리뷰를 지울까요?")) return;
    try {
      await Reviews.remove(existing.id);
      delete myReviews[productId];
      draw();
      toast("리뷰를 지웠어요");
    } catch (err) {
      toast(err.message);
    }
  };
});

(async () => {
  if (!(await requireLogin())) return;
  try {
    const data = await api("/api/my-orders");
    order = data.orders.find((o) => o.orderId === orderId);
  } catch (err) {
    root.innerHTML = `<p class="empty">주문을 불러오지 못했어요.<br>${escapeHtml(err.message)}</p>`;
    return;
  }
  if (!order) {
    root.innerHTML = `<p class="empty">주문을 찾을 수 없어요. <a href="mypage.html"><u>주문 내역으로</u></a></p>`;
    return;
  }
  const { data: reviews } = await sb.from("reviews").select("*").eq("order_id", orderId).eq("user_id", Auth.user.id);
  (reviews || []).forEach((r) => { myReviews[r.product_id] = r; });
  draw();
})();

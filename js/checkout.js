// 주문서 + 토스페이먼츠 결제위젯 연동
// 클라이언트 키: 토스페이먼츠 개발자센터 > API 키 > 결제위젯 연동 키 > 클라이언트 키
// 아래 값은 토스페이먼츠 문서용 공개 테스트 키예요. 운영 시 본인 상점의 키(test_gck_... / live_gck_...)로 바꿔 주세요.
const TOSS_CLIENT_KEY = "test_gck_docs_Ovk5rk1EwkEbP0W43n07xlzm";

renderLayout("cart");

const order = load("checkout", null);
const sum = summarize(order ? order.items : []);

if (!sum.lines.length) {
  alert("주문할 상품이 없어요.");
  location.replace("index.html");
} else {
  drawSummary();
  initPayment().catch((err) => {
    console.error(err);
    document.getElementById("payment-method").innerHTML =
      `<p class="empty" style="padding:40px 20px">결제위젯을 불러오지 못했어요.<br>${escapeHtml(err.message || err)}</p>`;
  });
}

function drawSummary() {
  document.getElementById("item-count").textContent = sum.lines.length;
  document.getElementById("order-lines").innerHTML = sum.lines.map((l) => lineHtml(l, false)).join("");
  document.getElementById("s-origin").textContent = won(sum.origin);
  document.getElementById("s-discount").textContent = "-" + won(sum.discount);
  document.getElementById("s-ship").textContent = sum.shipping ? won(sum.shipping) : "무료";
  document.getElementById("s-total").textContent = won(sum.total);
  document.getElementById("pay-btn").textContent = `${won(sum.total)} 결제하기`;
}

function makeOrderId() {
  // 6~64자, 영문 대소문자·숫자·-·_ 만 허용
  return "ORD-" + Date.now() + "-" + Math.random().toString(36).slice(2, 10);
}

function makeOrderName() {
  const first = sum.lines[0].product.name;
  const restCount = sum.lines.length - 1;
  return restCount > 0 ? `${first} 외 ${restCount}건` : first;
}

async function initPayment() {
  if (typeof TossPayments !== "function") throw new Error("토스페이먼츠 SDK 스크립트가 로드되지 않았어요.");

  const tossPayments = TossPayments(TOSS_CLIENT_KEY);
  // 비회원 결제. 회원이라면 유저별 고유값(UUID 등)을 customerKey로 넘겨요.
  const widgets = tossPayments.widgets({ customerKey: TossPayments.ANONYMOUS });

  await widgets.setAmount({ currency: "KRW", value: sum.total });
  await Promise.all([
    widgets.renderPaymentMethods({ selector: "#payment-method", variantKey: "DEFAULT" }),
    widgets.renderAgreement({ selector: "#agreement", variantKey: "AGREEMENT" }),
  ]);

  const payBtn = document.getElementById("pay-btn");
  payBtn.disabled = false;

  payBtn.addEventListener("click", async () => {
    const name = document.getElementById("c-name").value.trim();
    const phone = document.getElementById("c-phone").value.replace(/\D/g, "");
    const email = document.getElementById("c-email").value.trim();
    const addr = document.getElementById("c-addr").value.trim();

    if (!name) return toast("받는 분 이름을 입력해 주세요");
    if (!/^01\d{8,9}$/.test(phone)) return toast("휴대폰 번호를 확인해 주세요");
    if (!addr) return toast("주소를 입력해 주세요");

    const orderId = makeOrderId();
    const orderName = makeOrderName();

    // 1) 서버에 주문을 먼저 저장해요. 금액은 서버가 상품 가격으로 다시 계산해요.
    //    결제 승인 때 서버가 이 금액과 실제 결제 금액을 비교해서 위변조를 막아요.
    payBtn.disabled = true;
    try {
      const res = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId, orderName, items: order.items }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "주문을 저장하지 못했어요");
      if (data.amount !== sum.total) throw new Error("결제 금액이 변경됐어요. 새로고침 후 다시 시도해 주세요");
    } catch (err) {
      payBtn.disabled = false;
      return toast(err instanceof TypeError ? "테스트 서버(serve.ps1)에 연결할 수 없어요" : err.message);
    }
    payBtn.disabled = false;

    // 결제 완료 화면에 배송 정보를 보여주기 위해 저장해요.
    save("pendingOrder", {
      orderId, orderName, amount: sum.total, from: order.from,
      items: order.items, customer: { name, phone, email, addr },
    });

    const base = location.href.replace(/[^/]*$/, "");
    try {
      await widgets.requestPayment({
        orderId,
        orderName,
        successUrl: base + "success.html",
        failUrl: base + "fail.html",
        customerName: name,
        customerMobilePhone: phone,
        ...(email ? { customerEmail: email } : {}),
      });
    } catch (err) {
      // 사용자가 결제창을 닫은 경우 등
      toast(err.message || "결제가 취소됐어요");
    }
  });
}

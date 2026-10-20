// 상품 데이터 (퍼블리싱용 더미 데이터). 좋아요 수·리뷰 수·별점은 Supabase에서 실제 값을 읽어요. (common.js 의 Stats)
const CATEGORIES = {
  top:   { name: "상의", page: "tops.html",  subs: ["반소매 티셔츠", "맨투맨", "후드 티셔츠", "셔츠"],      sizes: ["S", "M", "L", "XL", "XXL"] },
  shoes: { name: "신발", page: "shoes.html", subs: ["스니커즈", "러닝화", "로퍼", "부츠"],               sizes: ["230", "240", "250", "260", "270", "280", "290"] },
  pants: { name: "바지", page: "pants.html", subs: ["데님 팬츠", "슬랙스", "트레이닝 팬츠", "카고 팬츠"], sizes: ["S", "M", "L", "XL"] },
};

const PRODUCTS = [
  // ---- 상의 ----
  { id: "T001", cat: "top", sub: "반소매 티셔츠", art: "tee",    color: "#ffffff", bg: "#ececec", brand: "PLAINWORKS", name: "에센셜 오버핏 반소매 티셔츠 화이트",       price: 39000, sale: 29000, free: true },
  { id: "T002", cat: "top", sub: "반소매 티셔츠", art: "tee",    color: "#1d1d1d", bg: "#e6e6e6", brand: "OFFDUTY",    name: "헤비웨이트 로고 반소매 티셔츠 블랙",       price: 45000, sale: 35100, free: true },
  { id: "T003", cat: "top", sub: "맨투맨",       art: "sweat",  color: "#7d8a9c", bg: "#e9ecf0", brand: "NORTHLAB",   name: "브러시드 기모 크루넥 스웨트셔츠 블루그레이", price: 69000, sale: 48300, free: true },
  { id: "T004", cat: "top", sub: "맨투맨",       art: "sweat",  color: "#c9b79c", bg: "#f2ede6", brand: "SLOWMOVE",   name: "피그먼트 다잉 맨투맨 샌드베이지",          price: 59000, sale: 59000, free: false },
  { id: "T005", cat: "top", sub: "후드 티셔츠",  art: "hoodie", color: "#3b4a3f", bg: "#e7ebe7", brand: "MODULE",     name: "투웨이 지퍼 후드 집업 포레스트",           price: 89000, sale: 62300, free: true },
  { id: "T006", cat: "top", sub: "후드 티셔츠",  art: "hoodie", color: "#9e9e9e", bg: "#efefef", brand: "PLAINWORKS", name: "릴랙스드 핏 스웻 후디 멜란지그레이",       price: 72000, sale: 57600, free: true },
  { id: "T007", cat: "top", sub: "셔츠",         art: "shirt",  color: "#bcd3ea", bg: "#edf2f7", brand: "HAUS",       name: "옥스포드 버튼다운 셔츠 스카이블루",        price: 65000, sale: 45500, free: false },
  { id: "T008", cat: "top", sub: "셔츠",         art: "shirt",  color: "#f3efe4", bg: "#ecebe6", brand: "ROUTE 9",    name: "린넨 블렌드 오버 셔츠 아이보리",           price: 79000, sale: 55300, free: true },
  { id: "T009", cat: "top", sub: "반소매 티셔츠", art: "tee",    color: "#8a3b3b", bg: "#f0e8e8", brand: "KICKSTAND",  name: "빈티지 워싱 그래픽 티셔츠 버건디",         price: 42000, sale: 29400, free: false },
  { id: "T010", cat: "top", sub: "맨투맨",       art: "sweat",  color: "#22304a", bg: "#e5e8ee", brand: "OFFDUTY",    name: "아치 로고 스웨트셔츠 네이비",              price: 68000, sale: 51000, free: true },

  // ---- 신발 ----
  { id: "S001", cat: "shoes", sub: "스니커즈", art: "sneaker", color: "#f5f5f5", bg: "#e9e9e9", brand: "KICKSTAND", name: "클래식 로우 레더 스니커즈 올화이트",      price: 129000, sale: 99000,  free: true },
  { id: "S002", cat: "shoes", sub: "스니커즈", art: "sneaker", color: "#2b2b2b", bg: "#e4e4e4", brand: "MODULE",    name: "스웨이드 컵솔 스니커즈 블랙",             price: 109000, sale: 87200,  free: true },
  { id: "S003", cat: "shoes", sub: "러닝화",   art: "runner",  color: "#ff6b3d", bg: "#f6ebe6", brand: "ROUTE 9",   name: "에어 쿠션 데일리 러닝화 오렌지",          price: 159000, sale: 119000, free: true },
  { id: "S004", cat: "shoes", sub: "러닝화",   art: "runner",  color: "#5a6b7d", bg: "#e8ecef", brand: "NORTHLAB",  name: "트레일 러너 GTX 스톰그레이",              price: 189000, sale: 151200, free: true },
  { id: "S005", cat: "shoes", sub: "로퍼",     art: "loafer",  color: "#2a1e18", bg: "#ece8e4", brand: "HAUS",      name: "페니 로퍼 폴리시드 레더 다크브라운",      price: 168000, sale: 134400, free: true },
  { id: "S006", cat: "shoes", sub: "로퍼",     art: "loafer",  color: "#111111", bg: "#e7e7e7", brand: "SLOWMOVE",  name: "청키 솔 로퍼 블랙",                       price: 139000, sale: 139000, free: false },
  { id: "S007", cat: "shoes", sub: "부츠",     art: "boot",    color: "#8a5a32", bg: "#f1ebe5", brand: "NORTHLAB",  name: "워커 레이스업 부츠 휘트",                 price: 219000, sale: 175200, free: true },
  { id: "S008", cat: "shoes", sub: "부츠",     art: "boot",    color: "#1b1b1b", bg: "#e5e5e5", brand: "OFFDUTY",   name: "사이드 고어 첼시 부츠 블랙",              price: 189000, sale: 132300, free: true },
  { id: "S009", cat: "shoes", sub: "스니커즈", art: "sneaker", color: "#cfd8c4", bg: "#eef1ea", brand: "PLAINWORKS", name: "캔버스 하이브리드 스니커즈 세이지",      price: 89000,  sale: 62300,  free: false },

  // ---- 바지 ----
  { id: "P001", cat: "pants", sub: "데님 팬츠",     art: "pants",  color: "#3e5f8a", bg: "#e7ecf2", brand: "ROUTE 9",    name: "와이드 스트레이트 데님 팬츠 미드블루",   price: 79000, sale: 55300, free: true },
  { id: "P002", cat: "pants", sub: "데님 팬츠",     art: "pants",  color: "#1f2a3a", bg: "#e4e7ec", brand: "MODULE",     name: "생지 셀비지 데님 팬츠 로우",            price: 129000, sale: 103200, free: true },
  { id: "P003", cat: "pants", sub: "슬랙스",        art: "slacks", color: "#2d2d2d", bg: "#e8e8e8", brand: "HAUS",       name: "원턱 와이드 슬랙스 차콜",               price: 59000, sale: 41300, free: true },
  { id: "P004", cat: "pants", sub: "슬랙스",        art: "slacks", color: "#bfae95", bg: "#f2eee8", brand: "SLOWMOVE",   name: "세미 와이드 크림 슬랙스 베이지",        price: 55000, sale: 55000, free: false },
  { id: "P005", cat: "pants", sub: "트레이닝 팬츠", art: "jogger", color: "#4a4a4a", bg: "#ebebeb", brand: "PLAINWORKS", name: "스웨트 조거 팬츠 차콜그레이",           price: 49000, sale: 34300, free: true },
  { id: "P006", cat: "pants", sub: "트레이닝 팬츠", art: "jogger", color: "#1a2b4c", bg: "#e5e8ef", brand: "KICKSTAND",  name: "사이드 라인 트랙 팬츠 네이비",          price: 69000, sale: 48300, free: true },
  { id: "P007", cat: "pants", sub: "카고 팬츠",     art: "cargo",  color: "#5b6142", bg: "#ecede6", brand: "NORTHLAB",   name: "나일론 파라슈트 카고 팬츠 올리브",      price: 89000, sale: 62300, free: true },
  { id: "P008", cat: "pants", sub: "카고 팬츠",     art: "cargo",  color: "#c8bca6", bg: "#f1eee8", brand: "OFFDUTY",    name: "코튼 워크 카고 팬츠 스톤",              price: 82000, sale: 65600, free: false },
  { id: "P009", cat: "pants", sub: "데님 팬츠",     art: "pants",  color: "#9bb3cc", bg: "#edf1f5", brand: "SLOWMOVE",   name: "라이트 워싱 루즈핏 데님 스카이",        price: 75000, sale: 52500, free: true },
];

// ---- 상품 일러스트 (이미지 대신 SVG) ----
function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const c = (v) => Math.max(0, Math.min(255, v + amt));
  const r = c(n >> 16), g = c((n >> 8) & 255), b = c(n & 255);
  return "#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
}

function productArt(p) {
  const c = p.color, d = shade(p.color, -28), s = 'stroke="rgba(0,0,0,.18)" stroke-width="1.5" stroke-linejoin="round"';
  const arts = {
    tee: `<svg viewBox="0 0 200 200"><path ${s} fill="${c}" d="M70 30 L50 36 L18 64 L38 92 L54 80 L54 176 L146 176 L146 80 L162 92 L182 64 L150 36 L130 30 Q100 52 70 30Z"/><path fill="${d}" d="M70 30 Q100 52 130 30 Q100 42 70 30Z"/></svg>`,
    sweat: `<svg viewBox="0 0 200 200"><path ${s} fill="${c}" d="M72 28 L46 36 L22 120 L22 150 L44 152 L54 100 L54 176 L146 176 L146 100 L156 152 L178 150 L178 120 L154 36 L128 28 Q100 46 72 28Z"/><rect fill="${d}" x="54" y="166" width="92" height="10"/><path fill="${d}" d="M22 142 h22 v10 h-22z M156 142 h22 v10 h-22z"/></svg>`,
    hoodie: `<svg viewBox="0 0 200 200"><path ${s} fill="${c}" d="M70 34 L46 42 L22 122 L22 152 L44 154 L54 102 L54 178 L146 178 L146 102 L156 154 L178 152 L178 122 L154 42 L130 34 Q132 12 100 10 Q68 12 70 34Z"/><path fill="${d}" d="M78 38 Q100 62 122 38 Q120 22 100 20 Q80 22 78 38Z"/><path fill="${d}" d="M70 130 h60 v24 h-60z" opacity=".55"/><path stroke="${d}" stroke-width="2" d="M92 60 v26 M108 60 v26"/></svg>`,
    shirt: `<svg viewBox="0 0 200 200"><path ${s} fill="${c}" d="M74 26 L48 34 L22 120 L22 150 L44 152 L54 98 L54 178 L146 178 L146 98 L156 152 L178 150 L178 120 L152 34 L126 26 L100 46Z"/><path fill="${d}" d="M74 26 L100 46 L88 58 L70 34Z M126 26 L100 46 L112 58 L130 34Z"/><path stroke="${d}" stroke-width="2" d="M100 46 V178"/><g fill="${d}"><circle cx="106" cy="76" r="2.5"/><circle cx="106" cy="104" r="2.5"/><circle cx="106" cy="132" r="2.5"/><circle cx="106" cy="160" r="2.5"/></g></svg>`,
    sneaker: `<svg viewBox="0 0 200 200"><path ${s} fill="${c}" d="M20 128 Q22 96 40 90 L78 82 Q92 98 116 102 L160 110 Q182 116 182 136 L182 142 L20 142Z"/><path fill="#fafafa" ${s} d="M18 140 h166 v12 q0 8 -8 8 h-150 q-8 0 -8 -8z"/><path stroke="${d}" stroke-width="3" stroke-linecap="round" d="M74 96 l14 -4 M82 104 l14 -4 M90 112 l14 -4"/><path fill="${d}" d="M120 116 Q140 112 156 126 Q136 124 120 116Z"/></svg>`,
    runner: `<svg viewBox="0 0 200 200"><path ${s} fill="${c}" d="M22 126 Q26 98 46 92 L76 84 Q96 100 124 104 L162 112 Q184 120 182 138 L22 140Z"/><path fill="${d}" d="M60 124 Q100 100 150 132 L60 132Z" opacity=".55"/><path ${s} fill="#ffffff" d="M18 138 h166 q2 18 -14 20 h-136 q-16 -2 -16 -20z"/><path fill="#e2e2e2" d="M28 150 h140 v4 h-140z"/></svg>`,
    loafer: `<svg viewBox="0 0 200 200"><path ${s} fill="${c}" d="M26 132 Q26 108 48 104 L92 100 Q118 92 144 102 Q178 112 180 136 L180 140 L26 140Z"/><path fill="${shade(p.color, 30)}" d="M92 104 Q120 98 146 108 L142 118 Q118 112 96 116Z"/><path ${s} fill="#1a1a1a" d="M22 138 h162 v8 q0 6 -6 6 h-150 q-6 0 -6 -6z"/><rect fill="#1a1a1a" x="34" y="146" width="34" height="10"/></svg>`,
    boot: `<svg viewBox="0 0 200 200"><path ${s} fill="${c}" d="M52 30 L112 30 L114 104 Q152 108 172 124 Q180 132 178 142 L44 142 Q40 90 52 30Z"/><path stroke="${d}" stroke-width="3" stroke-linecap="round" d="M96 46 h18 M96 62 h18 M96 78 h18 M96 94 h18"/><path ${s} fill="#2a2420" d="M40 140 h142 v12 q0 6 -6 6 h-130 q-6 0 -6 -6z"/><path fill="${d}" d="M52 30 h60 v8 h-60z"/></svg>`,
    pants: `<svg viewBox="0 0 200 200"><path ${s} fill="${c}" d="M56 18 H144 L156 182 H112 L100 74 L88 182 H44Z"/><rect fill="${d}" x="56" y="18" width="88" height="12"/><path stroke="${d}" stroke-width="2" fill="none" d="M62 30 Q66 50 84 50 M138 30 Q134 50 116 50 M100 30 V74"/><circle cx="100" cy="24" r="2.5" fill="#c9a24a"/></svg>`,
    slacks: `<svg viewBox="0 0 200 200"><path ${s} fill="${c}" d="M58 18 H142 L162 182 H114 L100 70 L86 182 H38Z"/><rect fill="${d}" x="58" y="18" width="84" height="11"/><path stroke="${shade(p.color, 40)}" stroke-width="1.5" d="M72 34 L62 182 M128 34 L138 182"/><path stroke="${d}" stroke-width="2" d="M100 29 V70"/></svg>`,
    jogger: `<svg viewBox="0 0 200 200"><path ${s} fill="${c}" d="M58 18 H142 L152 164 Q152 176 140 176 H118 Q112 176 112 168 L100 72 L88 168 Q88 176 82 176 H60 Q48 176 48 164Z"/><rect fill="${d}" x="58" y="18" width="84" height="14" rx="2"/><path fill="${d}" d="M48 160 h40 v16 h-34 q-6 0 -6 -6z M112 160 h40 v10 q0 6 -6 6 h-34z"/><path stroke="#fff" stroke-width="2" d="M92 32 l-2 12 M108 32 l2 12"/></svg>`,
    cargo: `<svg viewBox="0 0 200 200"><path ${s} fill="${c}" d="M56 18 H144 L158 182 H112 L100 72 L88 182 H42Z"/><rect fill="${d}" x="56" y="18" width="88" height="12"/><path ${s} fill="${d}" d="M48 96 h30 v34 h-32z M122 96 h30 l2 34 h-32z"/><path stroke="${shade(p.color, 30)}" stroke-width="2" d="M48 104 h30 M122 104 h30"/></svg>`,
  };
  return arts[p.art] || arts.tee;
}

function getProduct(id) {
  return PRODUCTS.find((p) => p.id === id);
}

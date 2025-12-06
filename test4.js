document.addEventListener("DOMContentLoaded",()=>{

// ================= HERO CATEGORY PILLS =================
const pills=document.querySelectorAll(".category-pill");
const scrollBtn=document.getElementById("heroScrollBtn");
let activeTarget="curated-kits";
const THICK_ARROW = "⬇";

function updateScrollButton(){
  const active=document.querySelector(".category-pill--highlight");
  if(!active||!scrollBtn)return;
  const label=active.querySelector(".label").innerText;
  scrollBtn.innerHTML=`
    <span class="scroll-text">Scroll to ${label}</span>
    <span class="scroll-arrow">${THICK_ARROW}</span>
  `;
  activeTarget=active.dataset.target;
}

if(pills.length && scrollBtn){
  pills.forEach(p=>{
    p.style.cursor="pointer";
    p.onclick=function(){
      pills.forEach(x=>x.classList.remove("category-pill--highlight"));
      this.classList.add("category-pill--highlight");
      activeTarget=this.dataset.target;
      updateScrollButton();
    };
  });

  scrollBtn.onclick=function(){
    scrollBtn.classList.add("btn-primary");
    scrollBtn.style.transform="scale(.97)";
    setTimeout(()=>{scrollBtn.classList.remove("btn-primary");scrollBtn.style.transform="";},180);
    const s=document.getElementById(activeTarget);
    if(s)window.scrollTo({top:s.offsetTop-90,behavior:"smooth"});
  };

  updateScrollButton();
}
const SHEET_URL = "https://raw.githubusercontent.com/ivl-ad/campus/refs/heads/main/catalog%20-%20n1.csv"
// ================= GOOGLE SHEET LOADER =================
//const SHEET_URL = "https://raw.githubusercontent.com/ivl-ad/campus/refs/heads/main/catalog.csv";
//const SHEET_URL =
//  "https://api.allorigins.win/raw?url=" +
//  encodeURIComponent("https://docs.google.com/spreadsheets/d/e/2PACX-1vQT_ZgeXViOTuPl1rUmWJNS1bm5rEZqCwu_8zM0I1nm-22E0uP7Zl_2aClUdZLtxUcFuYl0BAt1WK59/pub?gid=0&single=true&output=csv");


fetch(SHEET_URL)
  .then(r=>r.text())
  .then(csv=>buildCatalogFromCSV(csv))
  .catch(err=>console.error("Sheet Load Error:",err));

function csvToRows(text){
  return text
    .replace(/\r/g,"")
    .trim()
    .split("\n")
    .slice(1)
    .map(row =>
      row.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/)
         .map(cell => cell.replace(/^"|"$/g,"").trim())
    );
}

function buildCatalogFromCSV(csv){
  const rows = csvToRows(csv);
  const catalogMap = {};

  rows.forEach(r=>{
    if(r.length < 10) return;

    let [
      cid, ctitle, cbadge, ckicker,
      stitle, slabel,
      ptitle, pdesc,
      price, tags, img
    ] = r;

    // SAFETY FILTERS
    cid = cid.toLowerCase().replace(/\s+/g,"-");
    if(!cid || !ptitle) return;

    if(!catalogMap[cid]){
      catalogMap[cid] = {
        id: cid,
        title: ctitle,
        badge: cbadge,
        kicker: ckicker,
        subs: {}
      };
    }

    if(!catalogMap[cid].subs[stitle]){
      catalogMap[cid].subs[stitle] = {
        title: stitle,
        label: slabel,
        products: []
      };
    }

    catalogMap[cid].subs[stitle].products.push([
      ptitle || "Untitled Product",
      pdesc || "No description.",
      price || "$0",
      "View Details",
      tags ? tags.split(",").map(t=>t.trim()) : [],
      img || "https://picsum.photos/400"
    ]);
  });

  const catalogData = Object.values(catalogMap)
    .map(c => ({...c, subs:Object.values(c.subs)}));

  console.log("CATALOG READY ✅", catalogData);

  if(!catalogData.length){
    console.error("❌ No categories created. Check category_id values in sheet.");
    return;
  }

  renderCatalog(catalogData);
}


// ================= RENDER ===================
function renderCatalog(catalogData){
document.getElementById("catalog-root").innerHTML =
catalogData.map(sec=>`
<section id="${sec.id}" class="category-section"><div class="content-width">
<div class="section-header">
<h2 class="section-title">${sec.title}<span class="section-title-badge">${sec.badge}</span></h2>
<p class="section-kicker">${sec.kicker}</p>
</div>
${sec.subs.map(sc=>`
<div class="subcat-block">
<div class="subcat-header">
<h3 class="subcat-title">${sc.title}</h3>
<p class="subcat-label">${sc.label}</p>
</div>
<div class="product-grid">
${sc.products.map(p=>`
<article class="product-card" data-title="${p[0]}" data-desc="${p[1]}" data-price="${p[2]}" data-tags="${p[4].join('|')}">
<div class="product-image">
<img src="${p[5]}" alt="${p[0]}" onerror="this.src='https://picsum.photos/400'">
</div>
<h4 class="product-title">${p[0]}</h4>
<p class="product-meta">${p[1]}</p>
<div class="product-tags">${p[4].map(t=>`<span class="product-tag">${t}</span>`).join("")}</div>
<div class="product-footer">
<div class="product-price">${p[2]}</div>
<div class="cta-group">
<button class="product-cta actionBtn">View Details</button>
<button class="product-cta cardAddBtn">Add to Cart</button>
</div>
</div>
</article>`).join("")}
</div>
</div>`).join("")}
</div></section>`).join("");

initShowMore();
}

// ================= POPUP ===================
document.body.insertAdjacentHTML("beforeend",`
<div id="productPopup">
<div class="popup-panel">
<div class="popup-image"></div>
<div class="popup-body"><div>
<div class="mini-title">Campus Essential</div>
<h2 id="popupTitle"></h2>
<p id="popupDesc"></p><hr>
<h4>Product Highlights</h4>
<ul><li>Designed for campus use</li><li>Student-tested</li><li>Lightweight</li><li>Dorm-friendly</li></ul>
<h4>Specifications</h4><div id="popupTags" class="product-tags"></div>
</div>
<div class="popup-footer">
<div><div class="mini-title">Price</div><div id="popupPrice" class="product-price"></div></div>
<div class="cta-group">
<button id="popupBuy" class="product-cta">Add to Cart</button>
<button id="popupClose" class="product-cta">Close</button>
</div>
</div></div></div></div>
`);

// ================= CSS =================
const style=document.createElement("style");
style.innerHTML=`
#productPopup{position:fixed;inset:0;display:none;background:rgba(0,0,0,.7);z-index:9999;align-items:center;justify-content:center}
.popup-panel{max-width:860px;width:90%;background:#111;border-radius:12px;display:grid;grid-template-columns:1fr 1.1fr}
.popup-image img{width:100%;height:100%;object-fit:cover}
.popup-body{padding:24px;display:flex;flex-direction:column;justify-content:space-between}
.popup-footer{display:flex;justify-content:space-between;margin-top:15px}
.cta-group{display:flex;gap:10px}
.show-more-btn{margin:18px auto;display:block;padding:10px 18px;border-radius:30px;background:#161616;color:white;cursor:pointer}
`;
document.head.appendChild(style);

// ================= SHOW MORE =================
function initShowMore() {

  // Remove existing buttons first
  document.querySelectorAll(".show-more-btn").forEach(b => b.remove());

  document.querySelectorAll(".subcat-block").forEach(block => {

    const grid = block.querySelector(".product-grid");
    const items = [...grid.children];

    if (!items.length) return;

    // RESET VISIBILITY FIRST (IMPORTANT)
    items.forEach(i => i.style.display = "block");

    // Allow layout to settle before reading rows
    requestAnimationFrame(() => {

      const firstTop = items[0].offsetTop;
      const visibleCount = items.filter(i => i.offsetTop === firstTop).length;

      if (items.length <= visibleCount) return;

      // Hide overflow
      items.slice(visibleCount).forEach(i => i.style.display = "none");

      const btn = document.createElement("button");
      btn.className = "show-more-btn";
      btn.textContent = `Show More (${items.length - visibleCount})`;

      let open = false;

      btn.onclick = () => {
        open = !open;
        items.forEach((i, idx) => {
          i.style.display = open || idx < visibleCount ? "block" : "none";
        });
        btn.textContent = open ? "Show Less" : `Show More (${items.length - visibleCount})`;
      };

      grid.after(btn);
    });

  });
}



// ================= EVENTS =================
const popup=document.getElementById("productPopup");
const img=document.querySelector(".popup-image");
const t=document.getElementById("popupTitle");
const d=document.getElementById("popupDesc");
const pr=document.getElementById("popupPrice");
const tags=document.getElementById("popupTags");
const buy=document.getElementById("popupBuy");
const close=document.getElementById("popupClose");

document.addEventListener("click",e=>{

if(e.target.classList.contains("actionBtn")){
  const c=e.target.closest(".product-card");
  img.innerHTML="";
  img.appendChild(c.querySelector("img").cloneNode());
  t.textContent=c.dataset.title;
  d.textContent=c.dataset.desc;
  pr.textContent=c.dataset.price;
  tags.innerHTML=c.dataset.tags.split("|").map(x=>`<span class="product-tag">${x}</span>`).join("");
  popup.style.display="flex";
  document.body.style.overflow="hidden";
}

if(e.target.classList.contains("cardAddBtn")){
  const b=e.target,txt=b.textContent;
  b.textContent="Added ✅";b.disabled=true;
  setTimeout(()=>{b.textContent=txt;b.disabled=false},1000);
}

if(e.target===popup){
  popup.style.display="none";
  document.body.style.overflow="";
}
});

close.onclick=e=>{
  e.preventDefault();
  popup.style.display="none";
  document.body.style.overflow="";
};

buy.onclick=e=>{
  e.preventDefault();
  buy.textContent="Added ✅";
  setTimeout(()=>buy.textContent="Add to Cart",1000);
};


// ========= DESKTOP WIDTH TOGGLE =========
// ========= DESKTOP WIDTH TOGGLE (WITH REFRESH) =========
const toggle = document.getElementById("widthToggle");

if (toggle) {

  // Load state on startup
  const saved = localStorage.getItem("wideLayout");
  if (saved === "on") {
    document.body.classList.add("wide-layout");
    toggle.innerHTML = "⤡ Focused View";
  }

  toggle.onclick = () => {

    const nowWide = !document.body.classList.contains("wide-layout");
    localStorage.setItem("wideLayout", nowWide ? "on" : "off");

    // Force reload so layout + grid + show-more re-measure correctly
    location.reload();
  };
}


let resizeTimer;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(initShowMore, 200);
});



});

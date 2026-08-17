function toggleBlogPost(postId, triggerEl) {
  var post = document.getElementById(postId);
  if (!post) return;

  if (!triggerEl) {
    triggerEl = document.querySelector('[data-blog-toggle="' + postId + '"]');
  }

  var isHidden = window.getComputedStyle(post).display === "none";

  if (isHidden) {
    post.style.display = "block";
    if (triggerEl) {
      triggerEl.textContent = "Hide";
      triggerEl.setAttribute("aria-expanded", "true");
    }
  } else {
    post.style.display = "none";
    if (triggerEl) {
      triggerEl.textContent = "Expand";
      triggerEl.setAttribute("aria-expanded", "false");
    }
  }
}

document.addEventListener("DOMContentLoaded",()=>{

// ================= HARDCODED BLOG CARD TOGGLES =================
document.addEventListener("click", function (e) {
  const toggleBtn = e.target.closest(".show-more-btn");

  if (toggleBtn && toggleBtn.hasAttribute("data-blog-toggle")) {
    e.preventDefault();
    e.stopPropagation();

    const postId = toggleBtn.getAttribute("data-blog-toggle");
    toggleBlogPost(postId, toggleBtn);
    return;
  }

  const hardcodedBlogCard = e.target.closest(".blog-review-section .blog-card");

  if (hardcodedBlogCard) {
    const body = hardcodedBlogCard.querySelector(".blog-card-body");
    const post = hardcodedBlogCard.querySelector(".blog-modal-bodytext");
    const btn = hardcodedBlogCard.querySelector(".show-more-btn[data-blog-toggle]");

    if (!body || !post || !btn) return;

    // Don't double-trigger if user clicked the button itself
    if (e.target.closest(".show-more-btn[data-blog-toggle]")) return;

    toggleBlogPost(post.id, btn);
  }
});

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



// ================= HARDCODED CATALOG DATA =================
// This replaces the CSV fetch completely.
// Keep the same CSV format so the rest of your code still works unchanged.

const HARDCODED_CSV = `category_id,category_title,category_badge,category_kicker,subcategory_title,subcategory_label,product_title,product_desc,product_price,tags,image_url,product_url,orig_url
tech-electronics,01 • Tech & Electronics,Devices • Kitchen,Power through lectures and campus life,Dorm Tech,Dorm essentials,Electric Kettle Mini,Fast-boil compact kettle,$29.99,Kettle,https://m.media-amazon.com/images/I/51o-cOhFFnL._AC_SX679_.jpg,https://amzn.to/4rqUEhP,https://www.amazon.com/Electric-Stainless-Shut-off-Portable-Business/dp/B0B4S9ZM9W
apparel-lifestyle,04 • Apparel & Lifestyle,Style • Carry • Wear,Show your campus style,Bags & Backpacks,Carry smarter,Samsonite Campus Backpack,"Classic 2.0 Everyday Backpack, 14.1""",$48.99,Backpack,"https://slimages.macysassets.com/is/image/MCY/products/9/optimized/21191549_fpx.tif?op_sharpen=1&wid=700&fit=fit,1&fmt=webp",https://sovrn.co/eg4mdmh,https://www.macys.com/shop/product/samsonite-classic-2.0-everyday-backpack-14.1?ID=13886456&tdp=cm_app~zMCOM-NAVAPP~xcm_zone~zPDP_ZONE_B~xcm_choiceId~zcidM06SHD-516cd042-b08e-4bfd-8e3b-e499351641d5@T00@More%2Bfrom%2B%2BSamsonite%2B$29722$23560392~xcm_pos~zPos11~xcm_srcCatID~z29722
curated-kits,08 • Curated Kits,Bundles • Value • Gifts,All-in-one packs,Starter Kits,Freshman must-haves,Freshman Starter Kit,Dorm & school combo,$38.99,Bundle,https://m.media-amazon.com/images/I/61mfToYnuRL._AC_SX679_.jpg,https://amzn.to/4aMSTnU,https://www.amazon.com/Mega-School-Supply-College-Students/dp/B0C7LJYH6Q/ref=sr_1_17?crid=28M41PE3YL4VH&dib=eyJ2IjoiMSJ9.1eUGxO8c4rGOmF89EFnIK5MebhrRgI9ULPz5-aAq1frgzgGQvqAHkPfQTIqgaNL58ZL0Ilp9f_OXn00OLckcz0OePnmXB75rd3bepgXv-TN7k_90twrRfX7OQyELCff7dp4rt7wMIrjx2wyLfiaI9DwTehuA7adakZfAvj65KEGx0n1FF-mnmCyHZg9KMsyzndR4k0wc4TDy7xKmhP_wrm-VBw4HW7bmOmfunWhNhRjQ4Nz7dec9avkaJD-Sk-eipqODBKdkiPkW89luH89YZLGmc6vIwvKQnQcrVmVqQew.6U2W3Mikhw83xE17swhnKhMldVdMQEpv9fA_2mjFJOc&dib_tag=se&keywords=college+bundle&qid=1771820751&sprefix=college+bundl%2Caps%2C138&sr=8-17`;



// ================= HARDCODED BLOG / REVIEW CONTENT =================
const BLOG_REVIEW_DATA = [
  {
    id: "electric-kettle-review",
    type: "review",
    category: "Dorm Tech",
    title: "Electric Kettle Mini Review: A Smart Dorm Upgrade for Fast Meals and Coffee",
    excerpt:
      "A compact electric kettle can be one of the most practical dorm purchases. This model stands out for quick heating, a smaller footprint, and easy daily use for tea, instant noodles, oatmeal, and late-night study breaks.",
    image:
      "https://m.media-amazon.com/images/I/51o-cOhFFnL._AC_SX679_.jpg",
    linkedProduct: "Electric Kettle Mini",
    productUrl: "https://amzn.to/4rqUEhP",
    readTime: "4 min read",
    rating: "4.4/5",
    tags: ["Dorm Review", "Kitchen", "Small Space", "Budget Pick"],
    pros: [
      "Compact enough for tight dorm rooms",
      "Useful for tea, ramen, oatmeal, and hot cocoa",
      "Faster than microwave heating for many daily tasks",
      "Simple product category that students understand immediately"
    ],
    cons: [
      "Only useful if your dorm allows it",
      "Small size may not be enough for shared-room use",
      "Needs regular cleaning if used often"
    ],
    body: `
      <p>For students moving into a dorm, an electric kettle is one of those small purchases that can make campus life noticeably easier. It is not flashy, but it solves several day-to-day problems: quick hot water for coffee, tea, instant noodles, soup cups, and even basic meal prep when time is short.</p>

      <p>This compact kettle format works especially well for students because it does not take up much desk or counter space. In many dorm rooms, every inch matters, so smaller appliances tend to deliver more real value than oversized ones.</p>

      <p>What makes this type of kettle attractive is speed and convenience. Instead of waiting on a shared kitchen or using a microwave repeatedly, students can heat water quickly in their room and move on with their day. That makes it useful during early class mornings and long study nights alike.</p>

      <p>The biggest thing to check before buying is whether your residence hall allows kettles or small heating appliances. Rules vary by campus and building. If approved, though, this is one of the easiest dorm-tech wins because it supports food, drinks, and comfort at the same time.</p>

      <p>Overall, this is the kind of practical item that fits the MyCampusKorner audience well: affordable, compact, useful, and easy to explain. It works best for students who want one small item that improves their routine right away.</p>
    `
  },
  {
    id: "backpack-review",
    type: "review",
    category: "Bags & Backpacks",
    title: "Samsonite Campus Backpack Review: A Clean, Reliable Everyday Carry for Class",
    excerpt:
      "A good campus backpack should feel organized, durable, and comfortable enough to carry every day. This Samsonite option fits a student lifestyle well with a simple look, laptop storage, and commuter-friendly design.",
    image:
      "https://slimages.macysassets.com/is/image/MCY/products/9/optimized/21191549_fpx.tif?op_sharpen=1&wid=700&fit=fit,1&fmt=webp",
    linkedProduct: "Samsonite Campus Backpack",
    productUrl: "https://sovrn.co/eg4mdmh",
    readTime: "5 min read",
    rating: "4.5/5",
    tags: ["Backpack Review", "Campus Carry", "Laptop Bag", "Daily Use"],
    pros: [
      "Professional look that works for class or internships",
      "Laptop-friendly everyday carry",
      "Strong fit for commuters and walking campuses",
      "Easy category for parents and students to browse"
    ],
    cons: [
      "Higher-priced than ultra-budget bags",
      "May feel too minimal for students wanting a trend-heavy style",
      "Storage layout depends on personal preference"
    ],
    body: `
      <p>A backpack is one of the most heavily used products in student life. It goes to class, the library, coffee shops, group meetings, travel days, and sometimes even work. That means the best student backpack is not just about looks. It has to function well over time.</p>

      <p>This Samsonite backpack works because it hits a strong middle ground: clean design, recognizable brand trust, and enough structure for daily campus routines. It looks polished without feeling too formal, which makes it a good fit for students who want one bag they can carry almost everywhere.</p>

      <p>The biggest advantage of a backpack like this is versatility. A student can use it for a laptop, notebooks, chargers, water bottle, small accessories, and the random extras that come with campus life. For commuters especially, that matters more than trend alone.</p>

      <p>It also fits well within a curated storefront because it speaks to both students and parents. Students want comfort and style; parents often look for durability and something that feels like a smart purchase. This kind of product sits right in that overlap.</p>

      <p>If your store is trying to feature dependable essentials rather than novelty items, this is a strong review candidate. It represents a category people immediately understand, and it supports a “buy once, use daily” message that works well for student shopping.</p>
    `
  },
  {
    id: "freshman-starter-kit-guide",
    type: "guide",
    category: "Starter Kits",
    title: "Freshman Starter Kit Guide: What New Students Actually Need in Week One",
    excerpt:
      "Starter kits work best when they solve real move-in stress. The strongest freshman bundle is not just a random collection of products. It should feel like a practical shortcut for students and parents preparing for the first week on campus.",
    image:
      "https://m.media-amazon.com/images/I/61mfToYnuRL._AC_SX679_.jpg",
    linkedProduct: "Freshman Starter Kit",
    productUrl: "https://amzn.to/4aMSTnU",
    readTime: "6 min read",
    rating: "4.6/5",
    tags: ["Freshman Guide", "Bundle", "Move-In", "Parent Friendly"],
    pros: [
      "Easy value proposition for first-time buyers",
      "Good fit for gifting and move-in season",
      "Reduces decision fatigue for students and parents",
      "Works well as a featured or seasonal promotion"
    ],
    cons: [
      "Bundles need careful product selection",
      "Some students already own parts of the kit",
      "Perceived value depends on how clearly contents are explained"
    ],
    body: `
      <p>The idea behind a freshman starter kit is simple: make the first week of college easier. That sounds obvious, but many bundles fail because they combine too many unrelated products without a clear use case. The best starter kit solves move-in stress, saves time, and feels intentional.</p>

      <p>For a student marketplace, starter kits are valuable because they help shoppers make one decision instead of ten. That is especially important for freshmen and parents, who are usually balancing checklists, deadlines, dorm rules, and budget all at once.</p>

      <p>A strong kit should focus on real early-semester needs. Think practical items for class, dorm comfort, basic organization, and a few convenience products that reduce friction during the first days on campus. If the bundle feels random, shoppers lose confidence quickly.</p>

      <p>From a merchandising standpoint, curated kits are also excellent because they let your site tell a clearer story. Instead of only selling individual items, you are presenting a ready-made solution. That can improve browsing, gift appeal, and seasonal promotions like move-in week or back-to-school campaigns.</p>

      <p>This particular product category is a smart one to feature with fuller editorial content. It gives you a chance to explain why bundles matter, who they help, and what type of student should buy them. That makes the store feel more curated and more useful, not just transactional.</p>
    `
  }
];

// Build catalog immediately from the hardcoded CSV string
//buildCatalogFromCSV(HARDCODED_CSV);
renderBlogReviews(BLOG_REVIEW_DATA);

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



// ================= LEGAL (MODAL): open on click / hash =================
const legalModal = document.getElementById("legalModal");

function openLegalModal(which) {
  if (!legalModal) return;

  const docs = legalModal.querySelectorAll("[data-legal-doc]");
  docs.forEach(d => d.style.display = (d.dataset.legalDoc === which) ? "block" : "none");

  const titleEl = document.getElementById("legalModalTitle");
  if (titleEl) {
    titleEl.textContent = (which === "privacy") ? "Privacy Policy" : "Affiliate Disclosure";
  }

  legalModal.classList.add("is-open");
  legalModal.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";
}

function closeLegalModal() {
  if (!legalModal) return;
  legalModal.classList.remove("is-open");
  legalModal.setAttribute("aria-hidden", "true");
  document.body.style.overflow = "";
}

function openLegalFromHash() {
  const hash = window.location.hash;
  if (hash === "#privacy-policy") openLegalModal("privacy");
  if (hash === "#affiliate-disclosure") openLegalModal("affiliate");
}

// Click handlers (buttons + any anchor links to the hashes)
document.addEventListener("click", (e) => {
  const openBtn = e.target.closest("[data-legal-open]");
  if (openBtn) {
    e.preventDefault();
    const which = openBtn.getAttribute("data-legal-open");
    window.location.hash = (which === "privacy") ? "privacy-policy" : "affiliate-disclosure";
    openLegalModal(which);
    return;
  }

  const a = e.target.closest('a[href^="#"]');
  if (a) {
    const href = a.getAttribute("href");
    if (href === "#privacy-policy") {
      e.preventDefault();
      window.location.hash = "privacy-policy";
      openLegalModal("privacy");
      return;
    }
    if (href === "#affiliate-disclosure") {
      e.preventDefault();
      window.location.hash = "affiliate-disclosure";
      openLegalModal("affiliate");
      return;
    }
  }

  if (e.target.closest("[data-legal-close]")) {
    e.preventDefault();
    closeLegalModal();
  }
});

// Escape key to close
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && legalModal?.classList.contains("is-open")) {
    closeLegalModal();
  }

  if (e.key === "Escape" && blogModal?.classList.contains("is-open")) {
    closeBlogModal();
  }
});

// Support direct loads with hash
openLegalFromHash();
window.addEventListener("hashchange", openLegalFromHash);




function buildCatalogFromCSV(csv){
  const rows = csvToRows(csv);
  const catalogMap = {};

  rows.forEach(r=>{
    if(r.length < 10) return;

    let [
  cid, ctitle, cbadge, ckicker,
  stitle, slabel,
  ptitle, pdesc,
  price, tags, img, product_url
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
  img || "https://picsum.photos/400",
  product_url || ""
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


function renderBlogReviews(items) {
  const root = document.getElementById("blog-review-root");
  if (!root) return;

  root.innerHTML = `
    <div class="blog-review-grid">
      ${items.map(item => `
        <article class="blog-card" data-blog-id="${item.id}">
          <div class="blog-card-image">
            <img src="${item.image}" alt="${item.title}" onerror="this.src='https://picsum.photos/800/500'">
            <div class="blog-card-type">${item.type === "guide" ? "Guide" : "Review"}</div>
          </div>

          <div class="blog-card-body">
            <div class="blog-meta-row">
              <span class="blog-meta-pill">${item.category}</span>
              <span class="blog-meta-text">${item.readTime}</span>
              <span class="blog-meta-text">Rating: ${item.rating}</span>
            </div>

            <h3 class="blog-card-title">${item.title}</h3>
            <p class="blog-card-excerpt">${item.excerpt}</p>

            <div class="blog-tag-row">
              ${item.tags.map(tag => `<span class="blog-tag">${tag}</span>`).join("")}
            </div>

            <div class="blog-card-actions">
              <button class="blog-read-btn" data-open-blog="${item.id}">Read Article</button>
              <a class="blog-product-btn" href="${item.productUrl}" target="_blank" rel="noopener noreferrer sponsored">
                View Product ↗
              </a>
            </div>
          </div>
        </article>
      `).join("")}
    </div>
  `;
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
<article class="product-card" data-title="${p[0]}" data-desc="${p[1]}" data-price="${p[2]}" data-tags="${p[4].join('|')}" data-url="${p[6] || ''}">
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
<a class="product-cta purchaseBtn" href="${p[6] || '#'}" target="_blank" rel="noopener noreferrer sponsored">
  Purchase ↗
</a>
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
<a id="popupBuy" class="product-cta" href="#" target="_blank" rel="noopener noreferrer sponsored">Purchase ↗</a>
<button id="popupClose" class="product-cta">Close</button>
</div>
</div></div></div></div>
`);

document.body.insertAdjacentHTML("beforeend", `
<div id="blogModal" class="blog-modal">
  <div class="blog-modal-backdrop"></div>
  <div class="blog-modal-panel">
    <button id="blogModalClose" class="blog-modal-close" aria-label="Close article">✕</button>

    <div class="blog-modal-media">
      <img id="blogModalImage" src="" alt="">
    </div>

    <div class="blog-modal-content">
      <div class="blog-modal-meta">
        <span id="blogModalType" class="blog-meta-pill"></span>
        <span id="blogModalCategory" class="blog-meta-text"></span>
        <span id="blogModalReadTime" class="blog-meta-text"></span>
        <span id="blogModalRating" class="blog-meta-text"></span>
      </div>

      <h2 id="blogModalTitle" class="blog-modal-title"></h2>
      <p id="blogModalExcerpt" class="blog-modal-excerpt"></p>

      <div class="blog-modal-columns">
        <div>
          <h4 class="blog-modal-subtitle">Why it stands out</h4>
          <ul id="blogModalPros" class="blog-bullet-list"></ul>
        </div>
        <div>
          <h4 class="blog-modal-subtitle">Things to consider</h4>
          <ul id="blogModalCons" class="blog-bullet-list"></ul>
        </div>
      </div>

      <div id="blogModalBody" class="blog-modal-bodytext"></div>

      <div class="blog-modal-footer">
        <a id="blogModalProductLink" class="blog-product-btn" href="#" target="_blank" rel="noopener noreferrer sponsored">
          View Linked Product ↗
        </a>
      </div>
    </div>
  </div>
</div>
`);

const blogModal = document.getElementById("blogModal");
const blogModalImage = document.getElementById("blogModalImage");
const blogModalType = document.getElementById("blogModalType");
const blogModalCategory = document.getElementById("blogModalCategory");
const blogModalReadTime = document.getElementById("blogModalReadTime");
const blogModalRating = document.getElementById("blogModalRating");
const blogModalTitle = document.getElementById("blogModalTitle");
const blogModalExcerpt = document.getElementById("blogModalExcerpt");
const blogModalPros = document.getElementById("blogModalPros");
const blogModalCons = document.getElementById("blogModalCons");
const blogModalBody = document.getElementById("blogModalBody");
const blogModalProductLink = document.getElementById("blogModalProductLink");
const blogModalClose = document.getElementById("blogModalClose");

function openBlogModal(id) {
  const item = BLOG_REVIEW_DATA.find(x => x.id === id);
  if (!item || !blogModal) return;

  blogModalImage.src = item.image;
  blogModalImage.alt = item.title;
  blogModalType.textContent = item.type === "guide" ? "Guide" : "Review";
  blogModalCategory.textContent = item.category;
  blogModalReadTime.textContent = item.readTime;
  blogModalRating.textContent = `Rating: ${item.rating}`;
  blogModalTitle.textContent = item.title;
  blogModalExcerpt.textContent = item.excerpt;

  blogModalPros.innerHTML = item.pros.map(p => `<li>${p}</li>`).join("");
  blogModalCons.innerHTML = item.cons.map(c => `<li>${c}</li>`).join("");
  blogModalBody.innerHTML = item.body;
  blogModalProductLink.href = item.productUrl || "#";

  blogModal.classList.add("is-open");
  document.body.style.overflow = "hidden";
}

function closeBlogModal() {
  if (!blogModal) return;
  blogModal.classList.remove("is-open");
  document.body.style.overflow = "";
}

// ================= CSS =================
const style=document.createElement("style");
style.innerHTML=`
#productPopup{position:fixed;inset:0;display:none;background:rgba(0,0,0,.7);z-index:9999;align-items:center;justify-content:center}
.popup-panel{max-width:860px;width:90%;background:#111;border-radius:12px;display:grid;grid-template-columns:1fr 1.1fr}
.popup-image img{width:100%;height:100%;object-fit:cover}
.popup-body{padding:24px;display:flex;flex-direction:column;justify-content:space-between}
.popup-footer{display:flex;justify-content:space-between;margin-top:15px}
.cta-group{display:flex;gap:10px}

.show-more-btn{
  margin:18px auto 0;
  display:inline-flex;
  align-items:center;
  justify-content:center;
  min-height:44px;
  padding:12px 18px;
  border:1px solid #161616;
  border-radius:30px;
  background:#161616;
  color:#fff;
  cursor:pointer;
  font:inherit;
  line-height:1;
  text-align:center;
  -webkit-appearance:none;
  appearance:none;
}

.show-more-btn:hover{
  opacity:.92;
}

.show-more-btn:focus-visible{
  outline:2px solid #000;
  outline-offset:2px;
}

section#blog-reviews .blog-card{
  cursor:pointer;
}

section#blog-reviews .blog-card .blog-modal-bodytext{
  cursor:default;
}

@media (max-width: 768px){
  .show-more-btn{
    width:100%;
    max-width:100%;
  }
}
`;
document.head.appendChild(style);

// ================= SHOW MORE =================
function initShowMore() {

  // Remove existing buttons first
  document.querySelectorAll(".subcat-block > .show-more-btn").forEach(b => b.remove());

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
	
	
	const blogBtn = e.target.closest("[data-open-blog]");
if (blogBtn) {
  e.preventDefault();
  openBlogModal(blogBtn.getAttribute("data-open-blog"));
  return;
}

if (e.target.classList.contains("blog-modal-backdrop")) {
  closeBlogModal();
  return;
}

if(e.target.classList.contains("actionBtn")){
  const c=e.target.closest(".product-card");
  img.innerHTML="";
  img.appendChild(c.querySelector("img").cloneNode());
  t.textContent=c.dataset.title;
  d.textContent=c.dataset.desc;
  pr.textContent=c.dataset.price;
  tags.innerHTML=c.dataset.tags.split("|").map(x=>`<span class="product-tag">${x}</span>`).join("");

  // Set popup purchase link
  const url = c.dataset.url || "#";
  buy.setAttribute("href", url);

  popup.style.display="flex";
  document.body.style.overflow="hidden";
}

if(e.target.classList.contains("purchaseBtn")){
  const a = e.target;
  const url = a.getAttribute("href");

  // Prevent dead links
  if(!url || url === "#" ){
    e.preventDefault();
    alert("Purchase link unavailable for this item.");
  }
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

if (blogModalClose) {
  blogModalClose.onclick = (e) => {
    e.preventDefault();
    closeBlogModal();
  };
}

buy.onclick = (e) => {
  const url = buy.getAttribute("href");
  if(!url || url === "#"){
    e.preventDefault();
    alert("Purchase link unavailable for this item.");
  }
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

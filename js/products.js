/*
 * products.js — the catalog, as data.
 *
 * This is the single source of truth for every product on the site. It is a
 * plain script (not a fetch), so it works from file:// and needs no build
 * step to be read by product.html.
 *
 * To add or edit a product, edit the array below. Then re-run
 *     python3 tools/build_listings.py
 * to re-bake the product cards into store.html and index.html, which stay as
 * static HTML so they are crawlable and survive JavaScript being off. The
 * per-category and per-merchant pages (category.html?id=<cat> and
 * merchant.html?id=<merchantSlug>) read this file at runtime via
 * js/listing-page.js, so they need no rebuild.
 *
 * Fields: id (URL slug, must stay stable — it is the permalink), name, cat,
 * catLabel, merchant, merchantSlug, url (merchant product page), img.
 * price is optional — omit it for brand/landing pages that have no single
 * price, and the UI hides the price line rather than inventing one.
 */
window.PRODUCTS = [
  {"id": "vans-crosspath", "name": "Vans Crosspath XC GORE-TEXShoes ", "cat": "personal-lifestyle", "catLabel": "Personal Lifestyle", "merchant": "Vans", "merchantSlug": "vans", "url": "https://vans.pxf.io/c/5891219/3796160/48802?prodsku=VN000DAMWHT_VN%3A000DAM%3AWHT%3A055%3AM%3A1%3A&u=https%3A%2F%2Fwww.vans.com%2Fen-us%2Fp%2Fshoes%2Fcrosspath-6135%2Fcrosspath-xc-gore-tex-shoe-VN000DAMWHT%3F%26utm_source%3Dgoogle%26utm_medium%3Dorganic%26utm_campaign%3Dorganic-shopping&intsrc=APIG_31325", "img": "https://assets.vans.com/images/t_img/c_fill,g_center,f_auto,h_573,e_unsharp_mask:100,w_458/dpr_2.0/v1781130631/VN000EKHFS8-HERO/Crosspath-XC-GORETEX-Shoe-VANS-HERO.png", "price": 180.0},
  {"id": "belkin-tech-accessories-weekly-deals", "name": "Belkin Tech Accessories — Weekly Deals", "cat": "academic-essentials", "catLabel": "Academic Essentials", "merchant": "Belkin", "merchantSlug": "belkin", "url": "https://www.belkin.com/sale/", "img": "https://www.belkin.com/on/demandware.static/-/Sites/default/dw58ddf68f/2026-Falcon-gaming-campaign-dotcom-homepage-banner-03-mobile-373x400-us.jpg", "note": "Sale landing page - no single product price"},
  {"id": "modern-threads-wavy-luxury-spa-6-pc-quick-dry", "name": "Modern Threads Wavy Luxury Spa 6-pc. Quick-dry Towel Set", "cat": "bathroom", "catLabel": "Bathroom", "merchant": "Bed Bath & Beyond", "merchantSlug": "bed-bath-beyond", "url": "https://www.bedbathandbeyond.com/Bedding-Bath/Amrapur-Overseas-Wavy-Luxury-Spa-Collection-6-piece-Quick-Dry-Towel-Set/10122652/product.html", "img": "https://ak1.ostkcdn.com/images/products/10122652/Wavy-Luxury-Spa-Collection-6-Piece-Quick-Dry-Towel-Set-1c10c465-1170-4369-9174-8f6fe790b5cc_600.jpg", "price": 33.96, "note": "Price is \"From $33.96\" (varies by color)"},
  {"id": "basic-necessities---bedding-package", "name": "Basic Necessities - Bedding Package", "cat": "dorm-living-essentials", "catLabel": "Dorm & Living Essentials", "merchant": "Dormco", "merchantSlug": "dormco", "url": "https://www.dormco.com/Basic_Necessities_College_Dorm_Bedding_Package_p/basic-necess.htm", "img": "https://cdn11.bigcommerce.com/s-9uidjadyqm/images/stencil/1280x1280/products/3606/60279/basic_necessities-cherry_red_nightfall_navy2__65350.1744310315.jpg?c=1", "price": 127.06},
  {"id": "fully-loaded-pack---dorm-bedding-essentials-3", "name": "Fully-Loaded Pack - Dorm Bedding + Essentials #3 Package", "cat": "dorm-living-essentials", "catLabel": "Dorm & Living Essentials", "merchant": "Dormco", "merchantSlug": "dormco", "url": "https://www.dormco.com/DormCo_College_Dorm_Package_3_Fully_Loaded_Pack_p/buck2-dcdp1.htm", "img": "https://cdn11.bigcommerce.com/s-9uidjadyqm/images/stencil/1280x1280/products/4891/10255/BUCK2-DCDP1-2__95951.1740770457.jpg?c=1", "price": 224.14},
  {"id": "the-44-piece-college-dorm-essentials-set--", "name": "The 44-Piece College Dorm Essentials Set - Totally Complete", "cat": "dorm-living-essentials", "catLabel": "Dorm & Living Essentials", "merchant": "Dormco", "merchantSlug": "dormco", "url": "https://www.dormco.com/The_44_Piece_College_Dorm_Essentials_Set_Totall_p/top44-essentials.htm", "img": "https://cdn11.bigcommerce.com/s-9uidjadyqm/images/stencil/1280x1280/products/14800/60275/The_44-Piece_Package_-_Orchid_Petal_Alloy2_3__86283.1744309860.jpg?c=1", "price": 198.24},
  {"id": "yucca-hint-of-mint-full-comforter--", "name": "Yucca/Hint of Mint Full Comforter - Oversized Full XL Bedding", "cat": "dorm-living-essentials", "catLabel": "Dorm & Living Essentials", "merchant": "Dormco", "merchantSlug": "dormco", "url": "https://www.dormco.com/Reversible_Full_College_Comforter_Yucca_and_Mint_p/crys-micro-rev-full-hmyu.htm", "img": "https://cdn11.bigcommerce.com/s-9uidjadyqm/images/stencil/1280x1280/products/6788/15616/CRYS-MICRO-REV-FULL-HMYU-2__76982.1740770737.jpg?c=1", "price": 68.2},
  {"id": "gemini-crypto-trading-earn-platform", "name": "Gemini — Crypto Trading & Earn Platform", "cat": "financial-services", "catLabel": "Financial Services", "merchant": "Gemini", "merchantSlug": "gemini", "url": "https://www.gemini.com/", "img": "https://www.gemini.com/static/images/og-meta-v2.png", "note": "Brand landing page - no product price"},
  {"id": "resume-io-free-resume-builder", "name": "Resume.io — Free Resume Builder", "cat": "financial-services", "catLabel": "Financial Services", "merchant": "Resume.io", "merchantSlug": "resume-io", "url": "https://resume.io/", "img": "https://s3.resume.io/uploads/country/og_image/2/OG.png", "note": "Brand landing page - no product price"},
  {"id": "cloudfield-bamboo-sunglasses-blue-light-glasses", "name": "Cloudfield — Bamboo Sunglasses & Blue Light Glasses", "cat": "personal-lifestyle", "catLabel": "Personal Lifestyle", "merchant": "Cloudfield", "merchantSlug": "cloudfield", "url": "https://www.cloudfield.co/", "img": "https://static.wixstatic.com/media/d2d7a5_25b1c6b1276c478b9697481d39c2fa50~mv2.jpg", "note": "Brand landing page - no single product price"},
];

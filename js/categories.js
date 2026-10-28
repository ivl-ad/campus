/*
 * categories.js — the product categories, as data, in order.
 *
 * Edited from /admin/ (the Categories tab). Everything that shows
 * categories follows this list: the product editor, the home page cards,
 * the header and footer menus, the Store filters and the category pages.
 *   id      the address (/category?id=...) and what products refer to;
 *           never changes once products use it
 *   name    what shoppers see -- rename a category here
 *   home    "hidden" keeps it off the home page cards; otherwise shown
 *   button  the card's button text, e.g. "Shop dorm essentials"
 *   text    the card's description
 *   img     the card's picture: a path under images/ or an https:// address
 *   alt     describes that picture, for screen readers
 */
window.CATEGORIES = [
  {"id": "dorm-living-essentials", "name": "Dorm & Living Essentials", "button": "Shop dorm essentials", "text": "Turn a bare dorm room into a place that feels like home. Bedding, storage, lighting and the small organizers that make a shared room work, picked for tight spaces and a smooth move-in day.", "img": "images/Dorm-img_1Dorm-img.avif", "alt": "Student studying on a laptop in a dorm room with a bed, window, and bookshelves."},
  {"id": "academic-essentials", "name": "Academic Essentials", "button": "Shop academic essentials", "text": "Secure the precise study setups required to crush your specific major. From workspace organization and high-quality writing instruments to STEM-ready graphing calculators and capable, budget-friendly tech options.", "img": "images/Academic-img_1Academic-img.avif", "alt": "Young woman with curly hair holding books in a library, looking thoughtfully to the side."},
  {"id": "personal-lifestyle", "name": "Personal Lifestyle", "button": "Shop personal lifestyle", "text": "The everyday gear that keeps campus life running, from headphones and bags to self-care basics, chosen with a student budget in mind.", "img": "images/peronal-lifestyle-img_1peronal-lifestyle-img.avif", "alt": "Smiling young man with curly hair wearing headphones, green shirt, and backpack, sitting outdoors."},
  {"id": "event-tickets-travel", "name": "Travel & Entertainment", "button": "Explore travel & entertainment", "text": "Game days, concerts and weekend trips: tickets, travel gear and ways to get around, so getting home and getting out is one less thing to plan.", "img": "images/travel-img_1travel-img.avif", "alt": "Smiling woman with glasses, backpack, and map stands near fountains in a historic city square at sunset."},
  {"id": "financial-services", "name": "Financial Services", "button": "Explore financial services", "text": "Student-friendly banking, budgeting and money tools for managing your own finances, often for the first time.", "img": "images/services-img_1services-img.avif", "alt": "Man smiling while using smartphone and holding credit card at desk with laptop and headphones."},
  {"id": "health-fitness", "name": "Health & Fitness", "button": "Shop health & fitness", "text": "Stay active between classes and keep your energy up through finals: workout gear, running shoes, recovery and wellness picks that fit a student budget and a small dorm.", "img": "images/fitness-img_1fitness-img.avif", "alt": "Young woman with curly hair jogging in a park on a sunny day."},
];

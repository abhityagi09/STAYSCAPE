/**
 * Editorial marketing content for the homepage. This is curated copy — not inventory.
 * No prices, availability, ratings or property names are shown until real listings exist.
 */
export const CATEGORIES = [
  { slug: 'hotels', label: 'Hotels', blurb: 'City stays with service you can count on' },
  { slug: 'resorts', label: 'Resorts', blurb: 'Pools, spas and long, slow mornings' },
  { slug: 'villas', label: 'Villas', blurb: 'Private space for families and friends' },
  { slug: 'boutique', label: 'Boutique', blurb: 'Small, characterful, design-led' },
  { slug: 'homestays', label: 'Homestays', blurb: 'Local hosts and home-cooked meals' },
  { slug: 'apartments', label: 'Serviced apartments', blurb: 'Room to live for longer trips' },
] as const;

export const DESTINATIONS = [
  {
    name: 'Goa',
    region: 'Konkan coast',
    note: 'Beaches, Portuguese quarters and quiet southern coves.',
    season: 'Nov – Mar',
    tint: 'from-[#0f4c5c] to-[#173d35]',
  },
  {
    name: 'Jaipur',
    region: 'Rajasthan',
    note: 'Palaces, bazaars and the warm pink stone of the old city.',
    season: 'Oct – Mar',
    tint: 'from-[#8a4b2a] to-[#3d2418]',
  },
  {
    name: 'Munnar',
    region: 'Kerala',
    note: 'Tea estates folded into misty Western Ghats hills.',
    season: 'Sep – May',
    tint: 'from-[#2f6b3a] to-[#173d35]',
  },
  {
    name: 'Udaipur',
    region: 'Rajasthan',
    note: 'Lakeside havelis and sunset boat rides on Pichola.',
    season: 'Sep – Mar',
    tint: 'from-[#5a4a8a] to-[#24203d]',
  },
  {
    name: 'Rishikesh',
    region: 'Uttarakhand',
    note: 'River retreats, yoga mornings and Himalayan foothills.',
    season: 'Sep – Jun',
    tint: 'from-[#356e5e] to-[#102c26]',
  },
  {
    name: 'Coorg',
    region: 'Karnataka',
    note: 'Coffee plantations, waterfalls and cool forest air.',
    season: 'Oct – May',
    tint: 'from-[#6b5a2a] to-[#2c2410]',
  },
] as const;

export const TRAVEL_NOTES = [
  {
    title: 'Book shoulder season, not peak week',
    body: 'Travelling a fortnight either side of peak dates usually means calmer sights and more choice of rooms — and the weather is often just as good.',
    tag: 'Planning',
  },
  {
    title: 'Read the cancellation policy first',
    body: 'Flexible and non-refundable rates can differ meaningfully. On STAYSCAPE every rate will show its cancellation deadline in your local time before you pay.',
    tag: 'Booking',
  },
  {
    title: 'Monsoon escapes done right',
    body: 'The Western Ghats are at their greenest from June to September. Pick stays with covered outdoor spaces and check road access to hill properties.',
    tag: 'Seasonal',
  },
] as const;

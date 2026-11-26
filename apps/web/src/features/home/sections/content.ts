import { tr } from '@/lib/tr';
/**
 * Editorial marketing content for the homepage. This is curated copy — not inventory.
 * No prices, availability, ratings or property names are shown until real listings exist.
 */
export const CATEGORIES = [
  {
    slug: 'hotels',
    get label() {
      return tr('Hotels');
    },
    blurb: 'City stays with service you can count on',
  },
  {
    slug: 'resorts',
    get label() {
      return tr('Resorts');
    },
    blurb: 'Pools, spas and long, slow mornings',
  },
  {
    slug: 'villas',
    get label() {
      return tr('Villas');
    },
    blurb: 'Private space for families and friends',
  },
  {
    slug: 'boutique',
    get label() {
      return tr('Boutique');
    },
    blurb: 'Small, characterful, design-led',
  },
  {
    slug: 'homestays',
    get label() {
      return tr('Homestays');
    },
    blurb: 'Local hosts and home-cooked meals',
  },
  {
    slug: 'apartments',
    get label() {
      return tr('Serviced apartments');
    },
    blurb: 'Room to live for longer trips',
  },
] as const;

export const DESTINATIONS = [
  {
    name: 'Goa',
    region: 'Konkan coast',
    get note() {
      return tr('Beaches, Portuguese quarters and quiet southern coves.');
    },
    season: 'Nov – Mar',
    tint: 'from-[#0f4c5c] to-[#173d35]',
  },
  {
    name: 'Jaipur',
    region: 'Rajasthan',
    get note() {
      return tr('Palaces, bazaars and the warm pink stone of the old city.');
    },
    season: 'Oct – Mar',
    tint: 'from-[#8a4b2a] to-[#3d2418]',
  },
  {
    name: 'Munnar',
    region: 'Kerala',
    get note() {
      return tr('Tea estates folded into misty Western Ghats hills.');
    },
    season: 'Sep – May',
    tint: 'from-[#2f6b3a] to-[#173d35]',
  },
  {
    name: 'Udaipur',
    region: 'Rajasthan',
    get note() {
      return tr('Lakeside havelis and sunset boat rides on Pichola.');
    },
    season: 'Sep – Mar',
    tint: 'from-[#5a4a8a] to-[#24203d]',
  },
  {
    name: 'Rishikesh',
    region: 'Uttarakhand',
    get note() {
      return tr('River retreats, yoga mornings and Himalayan foothills.');
    },
    season: 'Sep – Jun',
    tint: 'from-[#356e5e] to-[#102c26]',
  },
  {
    name: 'Coorg',
    region: 'Karnataka',
    get note() {
      return tr('Coffee plantations, waterfalls and cool forest air.');
    },
    season: 'Oct – May',
    tint: 'from-[#6b5a2a] to-[#2c2410]',
  },
] as const;

export const TRAVEL_NOTES = [
  {
    get title() {
      return tr('Book shoulder season, not peak week');
    },
    get body() {
      return tr(
        'Travelling a fortnight either side of peak dates usually means calmer sights and more choice of rooms — and the weather is often just as good.',
      );
    },
    tag: 'Planning',
  },
  {
    get title() {
      return tr('Read the cancellation policy first');
    },
    get body() {
      return tr(
        'Flexible and non-refundable rates can differ meaningfully. On STAYSCAPE every rate will show its cancellation deadline in your local time before you pay.',
      );
    },
    tag: 'Booking',
  },
  {
    get title() {
      return tr('Monsoon escapes done right');
    },
    get body() {
      return tr(
        'The Western Ghats are at their greenest from June to September. Pick stays with covered outdoor spaces and check road access to hill properties.',
      );
    },
    tag: 'Seasonal',
  },
] as const;

/**
 * DEVELOPMENT/TEST SEED — fictional data only.
 *
 *   SEED_USER_PASSWORD='Choose-A-Str0ng-One' npm run seed
 *
 * Idempotent: every record is upserted by a natural key (email, slug, code, names within a
 * parent), images are generated only once per listing, and inventory rows are only inserted.
 * Refuses to run in production or against a non-local database.
 * Ratings are marked source=DEVELOPMENT_SEED and are labelled as sample data in the UI —
 * no fabricated guest reviews are created.
 */
import type { Types } from 'mongoose';
import mongoose from 'mongoose';
import sharp from 'sharp';
import { addDays, passwordSchema, todayInTimeZone, type PropertyType } from '@stayscape/shared';
import { loadConfig } from '@/config/env';
import { loadDotenv } from '@/config/load-dotenv';
import { connectMongo } from '@/infrastructure/database';
import { syncAllIndexes } from '@/infrastructure/models';
import {
  createPrivateStorageProvider,
  createStorageProvider,
} from '@/infrastructure/storage/storage.provider';
import { FieldEncryptor } from '@/lib/field-encryption';
import { createLogger } from '@/lib/logger';
import { PasswordHasher } from '@/lib/password';
import { AmenityModel, DestinationModel } from '@/modules/catalog/catalog.models';
import { slugify } from '@/modules/hotels/hotel.mapper';
import { DEFAULT_TAX_CONFIG, HotelModel } from '@/modules/hotels/hotel.model';
import { DailyInventoryModel } from '@/modules/inventory/inventory.models';
import { MediaService } from '@/modules/media/media.service';
import { PartnerModel } from '@/modules/partners/partner.model';
import { PricingRuleModel, RatePlanModel, RoomTypeModel } from '@/modules/rooms/room.models';
import { UserModel } from '@/modules/users/user.model';
import { assertBootstrapAllowed } from './bootstrap-admin';

/** Deterministic PRNG so repeated runs produce the same catalogue. */
function rng(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = rng(20270101);
const pick = <T>(items: readonly T[]): T => items[Math.floor(rand() * items.length)]!;
const between = (min: number, max: number) => Math.round(min + rand() * (max - min));

export const AMENITIES = [
  ['wifi', 'Free Wi-Fi', 'GENERAL', 'wifi'],
  ['parking', 'Free parking', 'GENERAL', 'car'],
  ['pool', 'Swimming pool', 'WELLNESS', 'waves'],
  ['breakfast', 'Breakfast available', 'FOOD', 'coffee'],
  ['pet-friendly', 'Pet friendly', 'GENERAL', 'paw-print'],
  ['wheelchair-accessible', 'Wheelchair accessible', 'ACCESSIBILITY', 'accessibility'],
  ['spa', 'Spa', 'WELLNESS', 'flower'],
  ['gym', 'Fitness centre', 'WELLNESS', 'dumbbell'],
  ['restaurant', 'Restaurant', 'FOOD', 'utensils'],
  ['bar', 'Bar', 'FOOD', 'wine'],
  ['room-service', 'Room service', 'SERVICES', 'bell'],
  ['air-conditioning', 'Air conditioning', 'ROOM', 'snowflake'],
  ['airport-shuttle', 'Airport shuttle', 'SERVICES', 'plane'],
  ['beach-access', 'Beach access', 'ACTIVITIES', 'umbrella'],
  ['garden', 'Garden', 'GENERAL', 'trees'],
  ['kids-club', "Kids' club", 'FAMILY', 'baby'],
  ['laundry', 'Laundry service', 'SERVICES', 'shirt'],
  ['ev-charging', 'EV charging', 'GENERAL', 'plug'],
  ['workspace', 'Work desk', 'ROOM', 'laptop'],
  ['kitchen', 'Kitchen', 'ROOM', 'cooking-pot'],
  ['balcony', 'Balcony', 'ROOM', 'sun'],
  ['mountain-view', 'Mountain view', 'ROOM', 'mountain'],
  ['lake-view', 'Lake view', 'ROOM', 'sailboat'],
  ['sea-view', 'Sea view', 'ROOM', 'waves'],
  ['yoga', 'Yoga sessions', 'ACTIVITIES', 'heart'],
  ['bonfire', 'Bonfire', 'ACTIVITIES', 'flame'],
  ['front-desk-24h', '24-hour front desk', 'SERVICES', 'clock'],
  ['elevator', 'Lift', 'ACCESSIBILITY', 'arrow-up-down'],
  ['power-backup', 'Power backup', 'GENERAL', 'zap'],
  ['family-rooms', 'Family rooms', 'FAMILY', 'users'],
  ['rooftop', 'Rooftop terrace', 'GENERAL', 'building'],
  ['tv', 'Television', 'ROOM', 'tv'],
] as const;

export const DESTINATIONS = [
  {
    name: 'Goa',
    city: 'Goa',
    region: 'Goa',
    lat: 15.4909,
    lng: 73.8278,
    desc: 'Beaches, Portuguese quarters and quiet southern coves.',
    themes: ['beach-access', 'sea-view', 'pool', 'bar'],
  },
  {
    name: 'Jaipur',
    city: 'Jaipur',
    region: 'Rajasthan',
    lat: 26.9124,
    lng: 75.7873,
    desc: 'Palaces, bazaars and the warm pink stone of the old city.',
    themes: ['rooftop', 'pool', 'restaurant'],
  },
  {
    name: 'Udaipur',
    city: 'Udaipur',
    region: 'Rajasthan',
    lat: 24.5854,
    lng: 73.7125,
    desc: 'Lakeside havelis and sunset boat rides on Pichola.',
    themes: ['lake-view', 'rooftop', 'spa'],
  },
  {
    name: 'Munnar',
    city: 'Munnar',
    region: 'Kerala',
    lat: 10.0889,
    lng: 77.0595,
    desc: 'Tea estates folded into misty Western Ghats hills.',
    themes: ['mountain-view', 'garden', 'bonfire'],
  },
  {
    name: 'Rishikesh',
    city: 'Rishikesh',
    region: 'Uttarakhand',
    lat: 30.0869,
    lng: 78.2676,
    desc: 'River retreats, yoga mornings and Himalayan foothills.',
    themes: ['yoga', 'mountain-view', 'garden'],
  },
  {
    name: 'Coorg',
    city: 'Coorg',
    region: 'Karnataka',
    lat: 12.3375,
    lng: 75.8069,
    desc: 'Coffee plantations, waterfalls and cool forest air.',
    themes: ['garden', 'bonfire', 'pool'],
  },
  {
    name: 'Manali',
    city: 'Manali',
    region: 'Himachal Pradesh',
    lat: 32.2432,
    lng: 77.1892,
    desc: 'Snow peaks, apple orchards and the Beas river valley.',
    themes: ['mountain-view', 'bonfire', 'balcony'],
  },
  {
    name: 'Varanasi',
    city: 'Varanasi',
    region: 'Uttar Pradesh',
    lat: 25.3176,
    lng: 82.9739,
    desc: 'Ancient ghats, evening aarti and winding lanes.',
    themes: ['rooftop', 'restaurant'],
  },
  {
    name: 'Pondicherry',
    city: 'Pondicherry',
    region: 'Puducherry',
    lat: 11.9416,
    lng: 79.8083,
    desc: 'French Quarter streets and a calm seafront promenade.',
    themes: ['sea-view', 'garden', 'restaurant'],
  },
  {
    name: 'Darjeeling',
    city: 'Darjeeling',
    region: 'West Bengal',
    lat: 27.041,
    lng: 88.2663,
    desc: 'Toy train, tea gardens and views of Kanchenjunga.',
    themes: ['mountain-view', 'garden'],
  },
  {
    name: 'Mumbai',
    city: 'Mumbai',
    region: 'Maharashtra',
    lat: 19.076,
    lng: 72.8777,
    desc: 'Art deco seafronts, street food and endless energy.',
    themes: ['gym', 'workspace', 'bar', 'sea-view'],
  },
  {
    name: 'Bengaluru',
    city: 'Bengaluru',
    region: 'Karnataka',
    lat: 12.9716,
    lng: 77.5946,
    desc: 'Garden city cafés, microbreweries and tech hubs.',
    themes: ['gym', 'workspace', 'bar'],
  },
] as const;

const NAME_A = [
  'Amber',
  'Banyan',
  'Cedar',
  'Coral',
  'Dune',
  'Emerald',
  'Fern',
  'Hearth',
  'Indigo',
  'Jasmine',
  'Kesar',
  'Lotus',
  'Monsoon',
  'Neem',
  'Opal',
  'Peacock',
  'Quill',
  'Saffron',
  'Teak',
  'Vetiver',
  'Willow',
  'Zephyr',
];
const NAME_B: Record<PropertyType, string[]> = {
  HOTEL: ['Grand Hotel', 'City Hotel', 'Residency', 'Inn'],
  RESORT: ['Resort & Spa', 'Retreat', 'Resort'],
  VILLA: ['Villa', 'Estate', 'Villas'],
  BOUTIQUE: ['House', 'Haveli', 'Boutique Stay'],
  HOMESTAY: ['Homestay', 'Farmstay', 'Cottage'],
  APARTMENT: ['Suites', 'Residences', 'Apartments'],
  HOSTEL: ['Hostel', 'Backpackers', 'Commons'],
  GUESTHOUSE: ['Guesthouse', 'Lodge', 'Rest House'],
};
const TIERS = [
  {
    name: 'budget',
    types: ['HOSTEL', 'GUESTHOUSE', 'HOMESTAY', 'HOTEL'] as PropertyType[],
    stars: [1, 2, 3],
    price: [120_000, 350_000],
  },
  {
    name: 'mid',
    types: ['HOTEL', 'BOUTIQUE', 'HOMESTAY', 'APARTMENT', 'VILLA'] as PropertyType[],
    stars: [3, 4],
    price: [400_000, 850_000],
  },
  {
    name: 'luxury',
    types: ['RESORT', 'BOUTIQUE', 'VILLA', 'HOTEL'] as PropertyType[],
    stars: [4, 5],
    price: [1_200_000, 3_500_000],
  },
];
const ROOM_TEMPLATES = [
  {
    name: 'Standard Room',
    size: 20,
    beds: [{ type: 'DOUBLE', count: 1 }],
    adults: 2,
    children: 1,
    occupancy: 2,
    factor: 1,
  },
  {
    name: 'Superior Twin',
    size: 24,
    beds: [{ type: 'TWIN', count: 2 }],
    adults: 2,
    children: 1,
    occupancy: 3,
    factor: 1.2,
  },
  {
    name: 'Deluxe Room',
    size: 30,
    beds: [{ type: 'KING', count: 1 }],
    adults: 3,
    children: 1,
    occupancy: 3,
    factor: 1.45,
  },
  {
    name: 'Family Suite',
    size: 48,
    beds: [
      { type: 'KING', count: 1 },
      { type: 'SOFA_BED', count: 1 },
    ],
    adults: 4,
    children: 2,
    occupancy: 5,
    factor: 2,
  },
  {
    name: 'Signature Suite',
    size: 65,
    beds: [{ type: 'KING', count: 1 }],
    adults: 3,
    children: 1,
    occupancy: 3,
    factor: 2.8,
  },
] as const;

async function devImage(title: string, subtitle: string, hue: number): Promise<Buffer> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1067" viewBox="0 0 1600 1067">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue},45%,30%)"/><stop offset="1" stop-color="hsl(${(hue + 40) % 360},50%,14%)"/></linearGradient></defs>
  <rect width="1600" height="1067" fill="url(#g)"/>
  <circle cx="1250" cy="260" r="160" fill="hsl(${(hue + 180) % 360},55%,70%)" opacity="0.35"/>
  <path d="M0 820 L320 560 L560 760 L860 470 L1180 780 L1600 520 L1600 1067 L0 1067 Z" fill="hsl(${hue},35%,10%)" opacity="0.55"/>
  <text x="96" y="860" font-family="Georgia, serif" font-size="84" fill="#F8F6F1">${title.replace(/&/g, '&amp;')}</text>
  <text x="100" y="930" font-family="Arial, sans-serif" font-size="36" fill="#E8DFD1">${subtitle} · DEVELOPMENT IMAGE</text></svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

async function main() {
  loadDotenv();
  assertBootstrapAllowed(process.env);
  const config = loadConfig();
  const logger = createLogger({ ...config, LOG_LEVEL: 'warn', LOG_PRETTY: false });
  const password = passwordSchema.safeParse(process.env.SEED_USER_PASSWORD);
  if (!password.success)
    throw new Error(
      'Set SEED_USER_PASSWORD (10+ chars with upper, lower and a digit) to run the seed.',
    );

  await connectMongo(config, logger);
  await syncAllIndexes();
  const media = new MediaService(
    createStorageProvider(config),
    createPrivateStorageProvider(config),
    logger,
  );
  const hasher = new PasswordHasher(config);
  const encryptor = new FieldEncryptor(config.DATA_ENCRYPTION_KEY);
  const passwordHash = await hasher.hash(password.data);
  const now = new Date();

  // ---- amenities & destinations
  await AmenityModel.bulkWrite(
    AMENITIES.map(([code, name, category, icon]) => ({
      updateOne: {
        filter: { code },
        update: { $set: { name, category, icon, active: true } },
        upsert: true,
      },
    })),
  );
  await DestinationModel.bulkWrite(
    DESTINATIONS.map((d, i) => ({
      updateOne: {
        filter: { slug: slugify(d.name) },
        update: {
          $set: {
            name: d.name,
            city: d.city,
            region: d.region,
            country: 'IN',
            coordinates: { type: 'Point', coordinates: [d.lng, d.lat] },
            description: d.desc,
            popularityScore: 100 - i * 5,
            active: true,
          },
        },
        upsert: true,
      },
    })),
  );

  // ---- users & partners
  const upsertUser = async (email: string, firstName: string, lastName: string, roles: string[]) =>
    (await UserModel.findOneAndUpdate(
      { email },
      {
        $set: { firstName, lastName, roles, accountStatus: 'ACTIVE' },
        $setOnInsert: { email, passwordHash, emailVerifiedAt: now },
      },
      { upsert: true, new: true },
    ))!;
  await upsertUser('seed.traveller@stayscape.dev', 'Seed', 'Traveller', ['CUSTOMER']);

  const bankFor = (n: number) => ({
    reference: `sa_seed_${n}`,
    accountHolderName: `Seed Partner ${n}`,
    bankName: 'Example Development Bank',
    ifsc: 'EXMP0000001',
    accountNumberLast4: String(1000 + n),
    accountNumberEncrypted: encryptor.encrypt(`99990000${1000 + n}`),
  });
  const partnerBase = (n: number, status: string) => ({
    ownerName: `Seed Owner ${n}`,
    businessName: `Seed Hospitality ${n} (Development)`,
    businessType: 'PRIVATE_LIMITED',
    registrationNumber: `DEV-REG-${n}`,
    taxDetails: { pan: 'ABCDE1234F', gstin: null },
    businessAddress: {
      line1: `${n} Development Street`,
      city: 'Bengaluru',
      state: 'Karnataka',
      postalCode: '560001',
      country: 'IN',
    },
    contactDetails: { email: `seed.partner${n}@stayscape.dev`, phone: '+919800000000' },
    settlementAccount: bankFor(n),
    settlementAccountReference: `sa_seed_${n}`,
    verificationStatus: status,
  });

  const approvedPartners: Types.ObjectId[] = [];
  for (let n = 1; n <= 6; n += 1) {
    const user = await upsertUser(`seed.partner${n}@stayscape.dev`, 'Seed', `Partner ${n}`, [
      'CUSTOMER',
      'HOTEL_OWNER',
    ]);
    const partner = await PartnerModel.findOneAndUpdate(
      { ownerId: user._id },
      { $set: { ...partnerBase(n, 'APPROVED'), approvedAt: now, submittedAt: now } },
      { upsert: true, new: true },
    );
    approvedPartners.push(partner!._id);
  }
  for (const [n, status, reason] of [
    [7, 'UNDER_REVIEW', null],
    [8, 'REJECTED', 'Development example: registration certificate expired.'],
  ] as const) {
    const user = await upsertUser(`seed.partner${n}@stayscape.dev`, 'Seed', `Applicant ${n}`, [
      'CUSTOMER',
    ]);
    await PartnerModel.findOneAndUpdate(
      { ownerId: user._id },
      { $set: { ...partnerBase(n, status), rejectionReason: reason, submittedAt: now } },
      { upsert: true, new: true },
    );
  }

  // ---- hotels
  const today = todayInTimeZone('Asia/Kolkata');
  let created = 0;
  for (let i = 0; i < 78; i += 1) {
    const destination = DESTINATIONS[i % DESTINATIONS.length]!;
    const tier = TIERS[i % 3]!;
    const propertyType = pick(tier.types);
    const name = `${NAME_A[i % NAME_A.length]} ${pick(NAME_B[propertyType])}`;
    const slug = slugify(`${name} ${destination.city}`);
    const partnerId = approvedPartners[i % approvedPartners.length]!;
    // The last three are unpublished examples (draft, submitted, rejected).
    const status =
      i === 75 ? 'DRAFT' : i === 76 ? 'SUBMITTED' : i === 77 ? 'REJECTED' : 'PUBLISHED';
    const amenities = [
      ...new Set([
        'wifi',
        'front-desk-24h',
        'tv',
        ...destination.themes.filter(() => rand() > 0.3),
        ...AMENITIES.filter(() => rand() > 0.82).map((a) => a[0]),
        ...(tier.name === 'luxury' ? ['spa', 'restaurant', 'room-service', 'pool'] : []),
        ...(tier.name === 'budget' ? [] : ['air-conditioning', 'parking']),
      ]),
    ];
    const lat = destination.lat + (rand() - 0.5) * 0.08;
    const lng = destination.lng + (rand() - 0.5) * 0.08;
    const base =
      between(tier.price[0]!, tier.price[1]!) - (between(tier.price[0]!, tier.price[1]!) % 100);

    const hotel = await HotelModel.findOneAndUpdate(
      { slug },
      {
        $set: {
          partnerId,
          name,
          description: `${name} is a fictional ${propertyType.toLowerCase()} in ${destination.name} created for STAYSCAPE development and testing. ${destination.desc} Rooms are designed for comfort, with thoughtful service and easy access to the neighbourhood.`,
          shortDescription: `${tier.name === 'luxury' ? 'Indulgent' : tier.name === 'mid' ? 'Characterful' : 'Easy-going'} ${propertyType.toLowerCase()} in ${destination.name} (development listing)`,
          propertyType,
          starCategory: pick(tier.stars),
          address: {
            line1: `${between(1, 200)} ${pick(['Lake', 'Temple', 'Market', 'Beach', 'Hill', 'Garden'])} Road`,
          },
          city: destination.city,
          state: destination.region,
          country: 'IN',
          postalCode: String(between(110001, 799999)),
          location: {
            type: 'Point',
            coordinates: [Number(lng.toFixed(5)), Number(lat.toFixed(5))],
          },
          timeZone: 'Asia/Kolkata',
          currency: 'INR',
          contactDetails: {
            phone: '+919800000000',
            email: `stay.${slug.slice(0, 30)}@example.com`,
          },
          amenities,
          languagesSpoken: ['English', 'Hindi'],
          policies: {
            petsAllowed: amenities.includes('pet-friendly'),
            smokingAllowed: false,
            coupleFriendly: true,
            minimumCheckInAge: 18,
            additionalRules: ['Valid government photo ID required at check-in.'],
            cancellationSummary: 'See each rate for its cancellation terms.',
          },
          checkInTime: '14:00',
          checkOutTime: '11:00',
          instantConfirmation: rand() > 0.2,
          nearbyAttractions: [
            { name: `${destination.name} old town`, distanceKm: between(1, 8), category: 'Sight' },
            {
              name: `${destination.name} railway station`,
              distanceKm: between(2, 15),
              category: 'Transport',
            },
          ],
          taxConfig: {
            ...DEFAULT_TAX_CONFIG,
            fees:
              tier.name === 'luxury'
                ? [
                    {
                      code: 'SERVICE',
                      label: 'Service charge',
                      amountMinor: 50_000,
                      chargeBasis: 'PER_STAY',
                    },
                  ]
                : [],
          },
          publicationStatus: status,
          verificationStatus:
            status === 'PUBLISHED' ? 'VERIFIED' : status === 'REJECTED' ? 'REJECTED' : 'PENDING',
          everApproved: status === 'PUBLISHED',
          featuredStatus: status === 'PUBLISHED' && i % 7 === 0 ? 'FEATURED' : 'NONE',
          ratingSummary:
            status === 'PUBLISHED'
              ? {
                  average: Math.round((3.6 + rand() * 1.3) * 10) / 10,
                  count: between(12, 900),
                  source: 'DEVELOPMENT_SEED',
                }
              : { average: 0, count: 0, source: 'REVIEWS' },
          popularityScore: between(0, 500),
          'review.rejectionReason':
            status === 'REJECTED'
              ? 'Development example: photos do not match the property address.'
              : null,
        },
      },
      { upsert: true, new: true },
    );
    if (!hotel) continue;

    if (hotel.images.length === 0) {
      const images = [];
      for (const [k, label] of ['Exterior', 'Interior'].entries()) {
        const asset = await media.uploadImage({
          partnerId: partnerId.toString(),
          hotelId: hotel._id.toString(),
          uploadedBy: partnerId.toString(),
          purpose: 'HOTEL_IMAGE',
          file: {
            buffer: await devImage(name, `${destination.name} · ${label}`, (i * 37 + k * 90) % 360),
            size: 0,
            originalname: `${slug}-${k}.png`,
          },
        });
        images.push({
          mediaId: asset._id,
          alt: `${name} — ${label.toLowerCase()} (development image)`,
        });
      }
      await HotelModel.updateOne(
        { _id: hotel._id },
        { $set: { images, coverImageId: images[0]!.mediaId } },
      );
      await mongoose.connection
        .collection('mediaassets')
        .updateMany(
          { _id: { $in: images.map((im) => im.mediaId) } },
          { $set: { status: 'ATTACHED' } },
        );
      hotel.images = images as typeof hotel.images;
      created += 1;
    }

    // ---- rooms, rates, rules
    const roomCount = 3 + (i % 3);
    for (const [r, template] of ROOM_TEMPLATES.slice(0, roomCount).entries()) {
      const room = await RoomTypeModel.findOneAndUpdate(
        { hotelId: hotel._id, name: template.name },
        {
          $set: {
            description: `${template.name} at ${name}. Fictional development inventory.`,
            images: hotel.images.slice(r % 2, (r % 2) + 1),
            roomSize: template.size,
            roomSizeUnit: 'SQM',
            bedConfiguration: template.beds,
            maximumAdults: template.adults,
            maximumChildren: template.children,
            maximumOccupancy: template.occupancy,
            amenities: [
              'wifi',
              'tv',
              ...(tier.name === 'budget' ? [] : ['air-conditioning', 'workspace']),
            ],
            totalInventory: tier.name === 'luxury' ? between(3, 8) : between(6, 18),
            status: 'ACTIVE',
          },
        },
        { upsert: true, new: true },
      );
      if (!room) continue;
      const roomBase = Math.round((base * template.factor) / 100) * 100;
      const plans = [
        {
          name: 'Room only — non-refundable',
          mealPlan: 'ROOM_ONLY',
          cancellationPolicy: {
            type: 'NON_REFUNDABLE',
            freeCancellationHours: 0,
            refundBasisPointsAfterDeadline: 0,
          },
          basePriceMinor: Math.round((roomBase * 0.9) / 100) * 100,
          mealSupplementPerGuestMinor: 0,
        },
        {
          name: 'Breakfast included — free cancellation',
          mealPlan: 'BREAKFAST',
          cancellationPolicy: {
            type: 'FREE_CANCELLATION',
            freeCancellationHours: 48,
            refundBasisPointsAfterDeadline: 0,
          },
          basePriceMinor: roomBase,
          mealSupplementPerGuestMinor: tier.name === 'budget' ? 15_000 : 40_000,
        },
      ];
      for (const plan of plans) {
        await RatePlanModel.updateOne(
          { roomTypeId: room._id, name: plan.name },
          {
            $set: {
              ...plan,
              hotelId: hotel._id,
              currency: 'INR',
              includedAdults: 2,
              includedChildren: 0,
              additionalAdultPriceMinor: Math.round((roomBase * 0.25) / 100) * 100,
              additionalChildPriceMinor: Math.round((roomBase * 0.12) / 100) * 100,
              extraBedPriceMinor: 80_000,
              minimumStay: 1,
              maximumStay: 30,
              active: true,
            },
          },
          { upsert: true },
        );
      }
      // Inventory for the next 120 days (inserted once; existing rows are left untouched).
      const rows = Array.from({ length: 120 }, (_, d) => addDays(today, d));
      await DailyInventoryModel.bulkWrite(
        rows.map((localDate, d) => ({
          updateOne: {
            filter: { roomTypeId: room._id, localDate },
            update: {
              $setOnInsert: {
                hotelId: hotel._id,
                roomTypeId: room._id,
                localDate,
                totalRooms: room.totalInventory,
                // A few fully blocked dates per hotel exercise date-range availability.
                blockedRooms: (d + i) % 29 === 0 ? room.totalInventory : 0,
                heldRooms: 0,
                bookedRooms: 0,
                closedToArrival: (d + i) % 41 === 0,
                closedToDeparture: false,
                minimumStay: null,
                maximumStay: null,
              },
            },
            upsert: true,
          },
        })),
        { ordered: false },
      );
    }

    const rules = [
      {
        name: 'Weekend rate',
        ruleType: 'WEEKEND',
        daysOfWeek: [5, 6],
        adjustmentType: 'PERCENT',
        adjustmentValue: 1500,
        priority: 50,
        stackingPolicy: 'STACKABLE',
        startDate: null,
        endDate: null,
        conditions: {},
      },
      {
        name: 'Festive season',
        ruleType: 'SEASONAL',
        daysOfWeek: [],
        adjustmentType: 'PERCENT',
        adjustmentValue: 2500,
        priority: 80,
        stackingPolicy: 'STACKABLE',
        startDate: `${today.slice(0, 4)}-12-20`,
        endDate: `${Number(today.slice(0, 4)) + 1}-01-05`,
        conditions: {},
      },
      {
        name: 'Stay 7, save 10%',
        ruleType: 'LONG_STAY',
        daysOfWeek: [],
        adjustmentType: 'PERCENT',
        adjustmentValue: -1000,
        priority: 60,
        stackingPolicy: 'STACKABLE',
        startDate: null,
        endDate: null,
        conditions: { minNights: 7 },
      },
      {
        name: 'Early bird 8%',
        ruleType: 'EARLY_BIRD',
        daysOfWeek: [],
        adjustmentType: 'PERCENT',
        adjustmentValue: -800,
        priority: 40,
        stackingPolicy: 'STACKABLE',
        startDate: null,
        endDate: null,
        conditions: { minDaysBeforeArrival: 30 },
      },
      ...(i % 4 === 0
        ? [
            {
              name: 'Last-minute deal',
              ruleType: 'LAST_MINUTE',
              daysOfWeek: [],
              adjustmentType: 'PERCENT',
              adjustmentValue: -1200,
              priority: 90,
              stackingPolicy: 'EXCLUSIVE',
              startDate: null,
              endDate: null,
              conditions: { maxDaysBeforeArrival: 2 },
            },
          ]
        : []),
    ];
    for (const rule of rules)
      await PricingRuleModel.updateOne(
        { hotelId: hotel._id, name: rule.name, roomTypeId: null, ratePlanId: null },
        { $set: { ...rule, active: true } },
        { upsert: true },
      );
  }

  const published = await HotelModel.countDocuments({ publicationStatus: 'PUBLISHED' });
  console.log(
    `Seed complete: ${DESTINATIONS.length} destinations, ${AMENITIES.length} amenities, ${published} published listings (${created} newly imaged), 8 partner accounts.`,
  );
  console.log(
    'Development accounts: seed.partner1..8@stayscape.dev and seed.traveller@stayscape.dev (password from SEED_USER_PASSWORD).',
  );
  await mongoose.disconnect();
}

const invokedDirectly = process.argv[1] && /seed\.(ts|js)$/.test(process.argv[1]);
if (invokedDirectly) {
  main().catch(async (error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    await mongoose.disconnect().catch(() => undefined);
    process.exit(1);
  });
}

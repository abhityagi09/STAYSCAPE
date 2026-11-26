/**
 * STAYSCAPE load test (k6). Run ONLY against an approved staging stack — never production.
 *
 *   docker run --rm -i -e BASE_URL=http://host.docker.internal:8081 \
 *     -e MAILPIT_URL=http://host.docker.internal:8026 -e SEED_USER_PASSWORD=... \
 *     -e PROFILE=baseline -v "$PWD/tests/load:/scripts" grafana/k6:1.3.0 run /scripts/stayscape.js
 *
 * Profiles: smoke (1 VU each), baseline (expected peak), stress (≈3× baseline). Scenarios run
 * concurrently with realistic mixes: browsing traffic dominates; booking traffic creates real
 * holds/bookings/sandbox orders and releases them so inventory is not exhausted.
 * Thresholds encode the performance budgets in docs/testing.md ("Performance budgets").
 */
import http from 'k6/http';
import { check, sleep, fail } from 'k6';
import { Trend } from 'k6/metrics';

const BASE = __ENV.BASE_URL || 'http://host.docker.internal:8081';
const API = `${BASE}/api/v1`;
const MAILPIT = __ENV.MAILPIT_URL || 'http://host.docker.internal:8026';
const PROFILE = __ENV.PROFILE || 'baseline';
const PASSWORD = 'Load-Test-Passw0rd!';
const SEED_PASSWORD = __ENV.SEED_USER_PASSWORD;

const scale = { smoke: 0.05, baseline: 1, stress: 3 }[PROFILE] ?? 1;
const vus = (n) => Math.max(1, Math.round(n * scale));
const stages = (n) => [
  { duration: '20s', target: vus(n) },
  { duration: PROFILE === 'smoke' ? '20s' : '90s', target: vus(n) },
  { duration: '10s', target: 0 },
];

export const options = {
  discardResponseBodies: false,
  scenarios: {
    browse: { executor: 'ramping-vus', exec: 'browse', stages: stages(40) },
    autocomplete: { executor: 'ramping-vus', exec: 'autocomplete', stages: stages(10) },
    availability: { executor: 'ramping-vus', exec: 'availability', stages: stages(15) },
    booking: { executor: 'ramping-vus', exec: 'booking', stages: stages(6) },
    partner: { executor: 'ramping-vus', exec: 'partner', stages: stages(3) },
    admin: { executor: 'ramping-vus', exec: 'admin', stages: stages(2) },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    'http_req_duration{name:search}': ['p(95)<800'],
    'http_req_duration{name:search_dates}': ['p(95)<1500'],
    'http_req_duration{name:suggest}': ['p(95)<300'],
    'http_req_duration{name:hotel_detail}': ['p(95)<500'],
    'http_req_duration{name:offers}': ['p(95)<1000'],
    'http_req_duration{name:hold}': ['p(95)<1500'],
    'http_req_duration{name:payment_order}': ['p(95)<1500'],
    'http_req_duration{name:inventory_update}': ['p(95)<1500'],
    'http_req_duration{name:admin_dashboard}': ['p(95)<2000'],
  },
  summaryTrendStats: ['avg', 'min', 'med', 'p(90)', 'p(95)', 'p(99)', 'max', 'count'],
};

const bookingFlow = new Trend('booking_flow_duration', true);
const DESTINATIONS = [
  'goa',
  'udaipur',
  'jaipur',
  'munnar',
  'rishikesh',
  'coorg',
  'shimla',
  'pondicherry',
];
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const day = (n) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
const json = { headers: { 'Content-Type': 'application/json' } };
const auth = (token, extra = {}) => ({
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...extra },
});
const uuid = () =>
  'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });

function login(email, password) {
  const res = http.post(`${API}/auth/login`, JSON.stringify({ email, password }), {
    ...json,
    tags: { name: 'login' },
  });
  if (res.status !== 200) fail(`login ${email} → ${res.status}`);
  return res.json('data.accessToken');
}

/** Registers and verifies a pool of booking users (holds are limited to 3 per person). */
function createBookers(n) {
  const run = Date.now().toString(36);
  const users = [];
  for (let i = 0; i < n; i += 1) {
    const email = `load.${run}.${i}@example.com`;
    const reg = http.post(
      `${API}/auth/register`,
      JSON.stringify({
        firstName: 'Load',
        lastName: `Tester ${String.fromCharCode(65 + (i % 26))}`,
        email,
        password: PASSWORD,
        acceptTerms: true,
      }),
      json,
    );
    if (reg.status !== 201) fail(`register → ${reg.status} ${reg.body}`);
    users.push(email);
  }
  sleep(2);
  for (const email of users) {
    let token = null;
    for (let attempt = 0; attempt < 10 && !token; attempt += 1) {
      const found = http.get(
        `${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}`,
      );
      const id = found.json('messages.0.ID');
      if (id) {
        const text = http.get(`${MAILPIT}/api/v1/message/${id}`).json('Text');
        token = /verify-email\?token=([A-Za-z0-9_-]+)/.exec(text || '')?.[1] ?? null;
      }
      if (!token) sleep(1);
    }
    if (!token) fail(`no verification email for ${email}`);
    const v = http.post(`${API}/auth/verify-email`, JSON.stringify({ token }), json);
    if (v.status !== 200) fail(`verify → ${v.status}`);
  }
  return users;
}

export function setup() {
  const list = http.get(`${API}/hotels?limit=50`).json('data.items');
  if (!list || list.length === 0) fail('No published hotels: seed the staging stack first.');
  const hotels = list.map((h) => h.slug);
  // Room type + rate for booking flows, from the public detail of a few hotels.
  const bookable = [];
  for (const slug of hotels.slice(0, 12)) {
    const d = http.get(`${API}/hotels/${slug}`).json('data');
    const room = d.roomTypes.find((r) => r.ratePlans.length);
    if (room)
      bookable.push({ hotelId: d.id, slug, roomTypeId: room.id, ratePlanId: room.ratePlans[0].id });
  }
  const bookers = createBookers(Math.max(vus(6) * 2, 4));
  let partner = null;
  if (SEED_PASSWORD) {
    const token = login('seed.partner1@stayscape.dev', SEED_PASSWORD);
    const own = http.get(`${API}/partner/hotels`, auth(token)).json('data');
    const hotelId = own[0].id;
    const roomTypeId = http
      .get(`${API}/partner/hotels/${hotelId}/room-types`, auth(token))
      .json('data.0.id');
    partner = { email: 'seed.partner1@stayscape.dev', hotelId, roomTypeId };
  }
  return { hotels, bookable, bookers, partner };
}

export function browse(data) {
  const destination = pick(DESTINATIONS);
  http.get(`${API}/hotels?destination=${destination}&page=1&limit=20`, {
    tags: { name: 'search' },
  });
  const offset = 7 + Math.floor(Math.random() * 60);
  const res = http.get(
    `${API}/hotels?destination=${destination}&checkIn=${day(offset)}&checkOut=${day(offset + 2)}&adults=2&rooms=1&sort=price_asc`,
    { tags: { name: 'search_dates' } },
  );
  check(res, { 'search 200': (r) => r.status === 200 });
  const slug = pick(data.hotels);
  const detail = http.get(`${API}/hotels/${slug}`, { tags: { name: 'hotel_detail' } });
  check(detail, { 'detail 200': (r) => r.status === 200 });
  http.get(`${API}/hotels/${slug}/reviews`, { tags: { name: 'hotel_reviews' } });
  sleep(1 + Math.random() * 2);
}

export function autocomplete() {
  const q = pick(['go', 'goa', 'ud', 'udai', 'ja', 'jaip', 'mun', 'rish', 'co', 'shi']);
  const res = http.get(`${API}/destinations/suggestions?q=${q}`, { tags: { name: 'suggest' } });
  check(res, { 'suggest 200': (r) => r.status === 200 });
  sleep(0.3 + Math.random() * 0.5);
}

export function availability(data) {
  const slug = pick(data.hotels);
  const offset = 5 + Math.floor(Math.random() * 90);
  const res = http.get(
    `${API}/hotels/${slug}/offers?checkIn=${day(offset)}&checkOut=${day(offset + 1 + Math.floor(Math.random() * 4))}&adults=2&children=0&childrenAges=&rooms=1`,
    { tags: { name: 'offers' } },
  );
  check(res, { 'offers 200': (r) => r.status === 200 });
  sleep(1 + Math.random());
}

const tokens = {};
export function booking(data) {
  const email = data.bookers[(__VU - 1) % data.bookers.length];
  tokens[email] ??= login(email, PASSWORD);
  const token = tokens[email];
  const h = pick(data.bookable);
  const offset = 120 + Math.floor(Math.random() * 200);
  const started = Date.now();
  const hold = http.post(
    `${API}/bookings/holds`,
    JSON.stringify({
      hotelId: h.hotelId,
      checkIn: day(offset),
      checkOut: day(offset + 2),
      items: [
        {
          roomTypeId: h.roomTypeId,
          ratePlanId: h.ratePlanId,
          rooms: 1,
          adults: 2,
          childrenAges: [],
          extraBeds: 0,
        },
      ],
    }),
    {
      ...auth(token, { 'Idempotency-Key': uuid() }),
      tags: { name: 'hold' },
      // Sold out for those dates is a valid outcome under contention, not an error.
      responseCallback: http.expectedStatuses({ min: 200, max: 399 }, 409),
    },
  );
  // 409 = genuinely sold out for those dates (valid business outcome under contention).
  if (
    !check(hold, { 'hold 201/409': (r) => r.status === 201 || r.status === 409 }) ||
    hold.status !== 201
  ) {
    sleep(1);
    return;
  }
  const reference = hold.json('data.reference');
  const booked = http.post(
    `${API}/bookings`,
    JSON.stringify({
      holdReference: reference,
      acceptTerms: true,
      guestDetails: {
        primaryGuest: { firstName: 'Load', lastName: 'Test', email, phone: '+919811111111' },
        additionalGuests: [],
        specialRequests: '',
        estimatedArrivalTime: '14:00',
      },
    }),
    { ...auth(token, { 'Idempotency-Key': uuid() }), tags: { name: 'booking_create' } },
  );
  if (check(booked, { 'booking 201': (r) => r.status === 201 })) {
    const ref = booked.json('data.reference');
    const order = http.post(`${API}/bookings/${ref}/payments`, null, {
      ...auth(token, { 'Idempotency-Key': uuid() }),
      tags: { name: 'payment_order' },
    });
    check(order, { 'payment order 201': (r) => r.status === 201 });
    // Leave nothing behind: cancel the unpaid booking, which releases its rooms.
    http.post(`${API}/bookings/${ref}/cancel`, JSON.stringify({ reason: 'Load test cleanup' }), {
      ...auth(token, { 'Idempotency-Key': uuid() }),
      tags: { name: 'booking_cancel' },
    });
  } else {
    http.del(`${API}/bookings/holds/${reference}`, null, {
      ...auth(token),
      tags: { name: 'hold_release' },
    });
  }
  bookingFlow.add(Date.now() - started);
  sleep(1 + Math.random() * 2);
}

let partnerToken = null;
export function partner(data) {
  if (!data.partner) {
    sleep(5);
    return;
  }
  partnerToken ??= login(data.partner.email, SEED_PASSWORD);
  const offset = 200 + Math.floor(Math.random() * 100);
  const res = http.patch(
    `${API}/partner/hotels/${data.partner.hotelId}/inventory`,
    JSON.stringify({
      roomTypeId: data.partner.roomTypeId,
      from: day(offset),
      to: day(offset + 6),
      set: { stopSell: Math.random() < 0.5 },
    }),
    { ...auth(partnerToken), tags: { name: 'inventory_update' } },
  );
  check(res, { 'inventory 200': (r) => r.status === 200 });
  http.get(
    `${API}/partner/hotels/${data.partner.hotelId}/inventory?roomTypeId=${data.partner.roomTypeId}&from=${day(offset)}&to=${day(offset + 30)}`,
    {
      ...auth(partnerToken),
      tags: { name: 'inventory_read' },
    },
  );
  sleep(2);
}

let adminToken = null;
export function admin() {
  adminToken ??= login(
    __ENV.ADMIN_EMAIL || 'admin@stayscape.local',
    __ENV.ADMIN_PASSWORD || 'E2e-Admin-Passw0rd',
  );
  const res = http.get(`${API}/admin/dashboard`, {
    ...auth(adminToken),
    tags: { name: 'admin_dashboard' },
  });
  check(res, { 'dashboard 200': (r) => r.status === 200 });
  http.get(`${API}/admin/bookings?page=1&limit=25`, {
    ...auth(adminToken),
    tags: { name: 'admin_bookings' },
  });
  sleep(3);
}

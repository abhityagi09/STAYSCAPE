# 9. The frontend — what users see and how it is built

## 9.1 What a single-page application (SPA) is

In old websites, every click loaded a whole new page from the server. In a **single-page app**,
the browser loads the app once; after that, clicking around only fetches **data** (JSON) and the app
redraws the part of the screen that changed. It feels faster, like a desktop app.

STAYSCAPE's web app is an SPA built with **React**, bundled by **Vite**, and served by nginx.

## 9.2 React and components

React builds interfaces from **components** — reusable pieces like `Button`, `HotelCard`,
`PriceBreakdown`, `Modal`. A component is a function that takes inputs (**props**) and returns what
should appear. When data changes, React updates only what's needed on screen.

- **State** — data a component remembers (the selected room, whether a menu is open).
- **Hooks** — functions starting with `use` that give components abilities: `useState` (remember a
  value), `useEffect` (do something after rendering), and custom hooks such as `useAuth`,
  `useHotelSearch`, `useDocumentTitle`.
- **Design system** — STAYSCAPE has its own library of 33+ components with consistent colours
  (design **tokens**), spacing, dark mode and focus styles, so every screen looks and behaves alike.

## 9.3 Routing

**React Router** maps URLs to screens (`/hotels/:slug` → hotel page). Important features used:

- **Lazy loading / code splitting** — each area (public site, account, partner workspace, admin
  console) is a separate file downloaded only when visited. A traveller never downloads the admin
  code.
- **Route guards** — `RequireAuth` redirects to sign-in (remembering where you wanted to go) or to
  a 403 page if you lack the permission. This is for user experience; the **server** still enforces
  every rule.
- **URL-synced state** — search filters live in the URL (`?destination=goa&sort=price_asc`), so the
  back button, refresh and sharing a link all work (tested in the resilience end-to-end tests).

## 9.4 Data fetching and state

| Kind of state                                  | Tool                      | Example                                  |
| ---------------------------------------------- | ------------------------- | ---------------------------------------- |
| **Server state** — copies of data from the API | **TanStack Query**        | Search results, a booking, the dashboard |
| **Client state** — app-wide UI facts           | **Redux Toolkit**         | Who is signed in, the comparison tray    |
| **Form state**                                 | **React Hook Form + Zod** | Registration, guest details              |
| **Local state**                                | `useState`                | Is this dropdown open                    |

TanStack Query gives every request a key (`['hotel', slug]`), caches the result, shows loading and
error states, retries, refetches when you return to the tab, and cancels requests you no longer
need (moving the map cancels the previous search). Mutations (like cancelling a booking) invalidate
the related cached data so screens update.

The **API client** (Axios) attaches the access token, and when a request fails with "token expired"
it refreshes once and retries — coordinating so that ten simultaneous failures trigger only one
refresh.

## 9.5 Every screen has four states

A screen is not finished when it shows data. Users see each of these, and every STAYSCAPE screen
handles them:

1. **Loading** — skeleton placeholders, not blank space.
2. **Empty** — a helpful message and next step ("No bookings yet — find a stay").
3. **Error** — a clear message and a **Try again** button (tested by simulating a lost connection).
4. **Success** — the data.

## 9.6 Accessibility (a11y)

**Accessibility** means people with disabilities can use the site — blind users with screen readers,
people who only use a keyboard, people with low vision or motor difficulties. In India and many
countries it is also a legal and ethical requirement. STAYSCAPE targets **WCAG 2.2 AA**, the
international standard.

| Principle            | What STAYSCAPE does                                                                                                                                           |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Semantic HTML        | Real buttons, links, headings in order (one `<h1>` per page, no skipped levels), landmarks (`main`, `nav`)                                                    |
| Screen-reader labels | Every input has a label; icon-only buttons have names; the accessible name contains the visible text                                                          |
| Keyboard             | Everything works with Tab/Enter/Escape; a "Skip to content" link comes first; visible focus rings                                                             |
| Dialogs              | Focus moves into the dialog, is **trapped** inside it, and returns to the trigger on close                                                                    |
| Errors               | Invalid fields are marked `aria-invalid`, linked to their message, and focus moves to the first error; server errors use an alert announced by screen readers |
| Colour contrast      | Text at least 4.5:1 against its background (some gold and grey tokens were darkened after automated checks found failures)                                    |
| Motion               | Animations are turned off for people who ask their device to reduce motion                                                                                    |
| Zoom and text size   | Works at 200 % text size and at phone widths without sideways scrolling                                                                                       |
| Touch targets        | Buttons at least 24×24 CSS pixels                                                                                                                             |

These are verified automatically with **axe** on public pages and the customer, partner and admin
workspaces, plus scripted keyboard, zoom, motion and target-size tests. A manual audit with a real
screen reader is still recommended.

## 9.7 Responsive design

The same site must work from a 320-pixel phone to a 1920-pixel monitor. Tailwind's breakpoints
change layouts: filters move into a slide-out drawer on phones, the dashboard sidebar becomes a menu,
tables scroll inside their card. Tests check nine widths (320 → 1920) for horizontal overflow and save
screenshots. Two subtle bugs found this way: the dashboard header was too wide on phones, and
visually hidden screen-reader text inside scrollable tables escaped its container and widened the
page.

## 9.8 Two languages (internationalisation, "i18n")

Every piece of visible text goes through `tr('English text')`. When the user picks Hindi, a
separate Hindi dictionary (1,950 entries, downloaded only when needed) supplies the translation. A
script extracts every text from the code and fails the build if a translation is missing or a
placeholder like `{0}` is wrong — so new text can't be shipped untranslated. The `<html lang>`
attribute changes so screen readers pronounce correctly.

**Currency display** converts prices using official European Central Bank rates, marked as
approximate; payment always happens in rupees. No exchange rate is ever invented.

## 9.9 Performance and Core Web Vitals

Google measures user experience with **Core Web Vitals**:

| Metric                              | Meaning                                                   | STAYSCAPE (lab, desktop)                              |
| ----------------------------------- | --------------------------------------------------------- | ----------------------------------------------------- |
| **LCP** — Largest Contentful Paint  | How fast the main content appears (good < 2.5 s)          | Home 0.9–1.3 s, search 0.45 s, property 0.3 s         |
| **CLS** — Cumulative Layout Shift   | How much the page jumps around while loading (good < 0.1) | ≈ 0                                                   |
| **INP** — Interaction to Next Paint | How quickly the page responds to clicks                   | Interactions are lightweight; not separately measured |

Techniques used: code splitting by area; the large map library split into its own file loaded only
on map views (the home page now downloads 308 KB of JavaScript instead of 626 KB); images served as
modern **WebP/AVIF** in several sizes so phones download small versions; self-hosted fonts;
caching of immutable files for a year (file names contain a content hash, so a new version gets a
new name). Two fixes from testing: the hero heading used a fade-in animation that delayed LCP, and
the property page jumped (CLS 0.37) because the footer appeared during loading and was then pushed
down — fixed by reserving a full screen of height.

## 9.10 SEO — being found on Google

Search engines and link previews (WhatsApp, LinkedIn) read the page's HTML. An SPA initially sends an
almost empty HTML file, which is weak for **SEO** (Search Engine Optimisation). STAYSCAPE solves this
without rewriting the app:

- nginx uses **Server-Side Includes (SSI)**: when serving the page, it asks the API for the right
  `<head>` for that URL — title, description, **canonical URL** (the one official address of a
  page), **Open Graph** tags (for link previews) and **JSON-LD structured data** (machine-readable
  facts like "this is a Hotel at this address with this star rating");
- a short crawlable summary inside `<noscript>` for crawlers that don't run JavaScript (inside
  `<noscript>` it never shows to normal users, so it can't cause layout shift);
- `sitemap.xml` lists every published hotel, destination and guide; `robots.txt` keeps private areas
  (account, partner, admin, checkout) out of search engines, which also get a `noindex` tag;
- ratings are only exposed as structured data when they come from real verified reviews — never from
  sample data (search engines penalise fake ratings).

Full server-side rendering (like Next.js) would be the next step for an SEO-heavy business.

## Say it in an interview

**"How is the frontend structured?"** — _"A React 19 SPA with Vite and React Router, lazy-loaded per
area. TanStack Query handles server state with caching and cancellation; Redux Toolkit holds auth
and the compare tray; forms use React Hook Form with the shared Zod schemas. A custom design system
on Tailwind tokens gives consistent components, dark mode and accessible focus handling."_

**"How do you make an SPA SEO-friendly?"** — _"nginx server-side includes fetch per-URL metadata
from the API — title, canonical, Open Graph and JSON-LD — plus a sitemap, robots rules and noindex on
private routes. The values are escaped so hostile content can't break out of the HTML."_

**"What did you do for accessibility?"** — _"WCAG 2.2 AA: semantic HTML, labels, keyboard support,
focus trapping, announced errors, contrast tokens and reduced motion — verified with axe across
public and logged-in pages, plus scripted keyboard, zoom and target-size tests, which caught real
contrast, heading and overflow bugs."_

# 2. How the web works — the foundations

Everything in later chapters rests on a handful of ideas. Learn these well and the rest becomes easy.

## 2.1 Clients and servers — the restaurant analogy

Think of a restaurant:

| Restaurant                                           | Web application                                                |
| ---------------------------------------------------- | -------------------------------------------------------------- |
| The dining room, menus and waiters you interact with | The **frontend** (client): the website running in your browser |
| The kitchen, where food is actually prepared         | The **backend** (server): the program that does the work       |
| The pantry and recipe book                           | The **database**: where information is stored permanently      |
| The order slip a waiter carries to the kitchen       | A **request**                                                  |
| The plate that comes back                            | A **response**                                                 |
| The fixed menu of dishes you are allowed to order    | The **API** — the list of requests the kitchen accepts         |

The browser (Chrome, Safari) is a program that downloads the frontend and shows it. When you click
"Search", the frontend writes an order slip (a request) and sends it over the internet to the
backend. The backend checks it, asks the database for hotels, calculates prices, and sends a
response back. The frontend turns that response into what you see.

Why split them? The kitchen must be **trusted** (only it can decide prices and touch money), while
anything in the dining room — your browser — can be inspected and changed by the user. **Never
trust the client** is one of the most important rules in software, and STAYSCAPE follows it: the
browser never sends a price; the server always recalculates.

## 2.2 The internet, addresses and domains

Every computer on the internet has a numeric address (an **IP address**, like a phone number).
People remember names (`stayscape.example.com`), so the **DNS** (Domain Name System) acts as the
phone book that turns names into numbers. A **port** is like an extension number: one machine can
run several services, and the port says which one (web servers usually use 443 for HTTPS).

## 2.3 HTTP — the language of requests

Browsers and servers talk using **HTTP** (HyperText Transfer Protocol). A request has:

- a **method** — the verb: `GET` (read), `POST` (create/do), `PUT`/`PATCH` (change), `DELETE`
  (remove);
- a **URL / path** — what you want: `/api/v1/hotels?destination=goa`;
  the part after `?` is the **query string** (search options);
- **headers** — extra information on the envelope, e.g. `Authorization: Bearer …` (who you are),
  `Content-Type: application/json` (what format the body is in);
- an optional **body** — the content, e.g. guest details.

A response has a **status code** (a three-digit result), headers and a body:

| Code                  | Meaning                                                     | Example in STAYSCAPE                                            |
| --------------------- | ----------------------------------------------------------- | --------------------------------------------------------------- |
| 200 OK                | Worked                                                      | Search results returned                                         |
| 201 Created           | Something new was created                                   | A room hold was created                                         |
| 400 Bad Request       | Malformed request                                           | A webhook with a broken signature                               |
| 401 Unauthorized      | You are not signed in (or your token is invalid)            | Opening your bookings without signing in                        |
| 403 Forbidden         | Signed in but not allowed                                   | A customer opening an admin page                                |
| 404 Not Found         | Does not exist — _or you are not allowed to know it exists_ | Someone else's booking                                          |
| 409 Conflict          | Clashes with the current state                              | The last room was just taken                                    |
| 422 Unprocessable     | Data failed validation                                      | Check-out date before check-in                                  |
| 429 Too Many Requests | Rate limit hit                                              | Too many login attempts                                         |
| 500 Server Error      | A bug                                                       | (The authorization test checks none of 300 routes returns this) |
| 503 Unavailable       | A dependency is down                                        | Database unreachable during a health check                      |

**HTTPS** is HTTP inside an encrypted tunnel (TLS). Nobody between your browser and the server can
read or change the traffic. Production STAYSCAPE is HTTPS-only.

## 2.4 APIs, REST and JSON

An **API** (Application Programming Interface) is the menu of things one program lets another
program ask for. STAYSCAPE's API follows the **REST** style: things are _resources_ with URLs
(`/bookings/SS-ABC123`), and the HTTP method says what to do with them.

Data travels as **JSON** (JavaScript Object Notation) — a simple text format of names and values:

```json
{
  "success": true,
  "data": {
    "reference": "SS-7K2M9Q4X",
    "status": "CONFIRMED",
    "checkIn": "2026-12-12",
    "totalMinor": 1050000,
    "currency": "INR"
  }
}
```

Every STAYSCAPE response has the same envelope: `{ success, data }` or
`{ success: false, error: { code, message, details, requestId } }`. Consistency makes the frontend
simpler and errors easy to trace. The API is **versioned** (`/api/v1/`) so a future v2 can change
things without breaking existing apps. It is documented with **OpenAPI** (a machine-readable
description) and Swagger UI (an interactive page to try requests).

## 2.5 Statelessness, sessions and cookies

HTTP is **stateless**: each request is independent; the server does not automatically remember
you. To stay signed in, the client must prove who it is on each request. Two tools:

- a **cookie** — a small piece of data the server asks the browser to store and send back
  automatically on future requests to the same site;
- a **token** — a signed string the frontend attaches to requests in a header.

STAYSCAPE uses both carefully (chapter 6): a short-lived token in memory and a long-lived,
locked-down cookie used only to get new tokens.

## 2.6 The browser's safety rules

Browsers protect users with rules that matter in every interview:

- **Same-origin policy** — a page from site A cannot read responses from site B. An _origin_ is
  scheme + domain + port (`https://stayscape.example.com:443`).
- **CORS** (Cross-Origin Resource Sharing) — the way a server says "these other origins may call
  me". STAYSCAPE keeps an explicit allow-list; anything else is refused.
- **Content Security Policy (CSP)** — the server tells the browser which sources of scripts,
  images and frames are allowed. STAYSCAPE only allows its own scripts plus Razorpay's checkout,
  so injected scripts from elsewhere will not run.

## 2.7 Frontend, backend, database — and the extra pieces

A modern system usually has more than three parts. STAYSCAPE has:

| Piece                              | Job                                                                               | Analogy                        |
| ---------------------------------- | --------------------------------------------------------------------------------- | ------------------------------ |
| **Web app** (React)                | What users see and click                                                          | Dining room                    |
| **nginx**                          | Front door: serves the web files, forwards `/api` requests, adds security headers | Receptionist                   |
| **API server** (Node.js + Express) | Business rules, permissions, prices, bookings                                     | Kitchen                        |
| **MongoDB**                        | Permanent storage                                                                 | Pantry and records office      |
| **Redis**                          | Very fast short-term memory: rate-limit counters, cache, job queues               | Whiteboard by the kitchen door |
| **Worker**                         | Does slow or scheduled jobs in the background (emails, expiring holds)            | Night shift staff              |
| **External services**              | Payment gateway, email provider, file storage, currency rates, AI                 | Suppliers                      |

## 2.8 Synchronous vs asynchronous work

When you pay, you want an answer _now_ — that is **synchronous** work inside the request. Sending
the confirmation email or generating the invoice PDF can happen a second later without you waiting
— that is **asynchronous** work, handed to a background worker through a **queue** (chapter 10).
This keeps the website fast and makes slow outside services (email) unable to slow down booking.

## Say it in an interview

**"Explain what happens when a user searches."** — _"The React app builds a GET request to
`/api/v1/hotels` with the destination and dates in the query string. nginx forwards it to the API.
Express validates the query with a Zod schema, the search service finds matching published hotels
in MongoDB, the pricing engine computes a real quote for each hotel's cheapest available room for
those dates, results are sorted and paginated, and the API returns JSON in a consistent envelope.
TanStack Query in the browser caches it and React renders the cards and map."_

**"What's the difference between 401 and 403?"** — _"401 means we don't know who you are — sign in.
403 means we know who you are and you're not allowed. For other people's records I return 404
rather than 403 so I don't reveal that the record exists."_

**"Why never trust the client?"** — _"Anything in the browser can be modified with developer tools.
So prices, permissions and totals are always recalculated and checked on the server; the browser
only displays them."_

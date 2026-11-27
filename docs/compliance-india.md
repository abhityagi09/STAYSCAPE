# India-first compliance readiness checklist

**This is an engineering readiness checklist, not legal advice.** Policy pages existing in the
product does not make STAYSCAPE legally compliant. Every item marked **⚖ legal** or **₹ tax**
must be reviewed and signed off by a qualified Indian lawyer or tax professional before launch.

Legend: ✅ implemented in the product · 🟡 partly implemented / needs a decision · ⬜ not started (external).

## Data protection — Digital Personal Data Protection Act, 2023 (DPDP) and DPDP Rules

| Requirement                                                         | Status | Product evidence / gap                                                                                                                                              | Review                    |
| ------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| Notice describing personal data, purposes and rights                | 🟡     | Privacy policy page exists as a draft (marked not reviewed by counsel)                                                                                              | ⚖ legal                   |
| Consent for marketing; separate from service                        | ✅     | Opt-in newsletter and promotional email preference, unsubscribe                                                                                                     | ⚖ confirm wording         |
| Purpose limitation / data minimisation                              | ✅     | Guests' contact details are not shared with partners beyond the stay; analytics are aggregate (no user id/IP in search events); assistant logs exclude message text | —                         |
| Right to access (data export)                                       | ✅     | Account → Settings → Download my data (JSON)                                                                                                                        | ⚖ confirm scope           |
| Right to correction                                                 | ✅     | Profile and preferences editable                                                                                                                                    | —                         |
| Right to erasure                                                    | ✅     | Self-service deletion with anonymisation; financial records retained for statutory periods                                                                          | ⚖ confirm retention basis |
| Grievance redressal (contact, timelines)                            | 🟡     | Support tickets exist; a named Grievance Officer and response timelines must be published                                                                           | ⚖ legal                   |
| Children's data (verifiable parental consent)                       | 🟡     | Terms require users to be 18+; no age verification flow                                                                                                             | ⚖ legal                   |
| Security safeguards                                                 | ✅     | docs/security.md (encryption, access control, audit log, monitoring)                                                                                                | —                         |
| Breach notification (Board and affected people)                     | 🟡     | Procedure documented (docs/security.md, docs/monitoring.md); needs an owner and contact list                                                                        | ⚖ legal                   |
| Data processors (hosting, email, payments, AI) — contracts and DPAs | ⬜     | Atlas, Redis host, S3, SMTP, Razorpay, Anthropic                                                                                                                    | ⚖ legal                   |
| Cross-border transfer                                               | 🟡     | Recommend ap-south-1 hosting; the AI provider and some SaaS process data abroad                                                                                     | ⚖ legal                   |
| Significant Data Fiduciary obligations (if notified)                | ⬜     | Depends on scale                                                                                                                                                    | ⚖ legal                   |

## Information security reporting — CERT-In Directions (28 April 2022)

| Requirement                                        | Status | Notes                                                                                 | Review  |
| -------------------------------------------------- | ------ | ------------------------------------------------------------------------------------- | ------- |
| Report specified cyber incidents within 6 hours    | 🟡     | In the incident procedure; needs a named point of contact registered with CERT-In     | ⚖ legal |
| Keep ICT system logs for 180 days within India     | 🟡     | Structured logs exist; configure the log platform's retention (≥ 180 days) and region | ops     |
| Synchronise clocks with NTP (NIC/NPL or traceable) | 🟡     | Managed hosts sync time; document the source                                          | ops     |

## Payments — RBI framework

| Requirement                                                          | Status | Notes                                                                                                 | Review              |
| -------------------------------------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------- | ------------------- |
| No storage of card data (card-on-file tokenisation rules)            | ✅     | Razorpay Checkout; STAYSCAPE stores only provider ids and amounts                                     | —                   |
| Use an RBI-authorised Payment Aggregator                             | 🟡     | Razorpay (authorised PA); merchant onboarding/KYC pending                                             | ⬜                  |
| Marketplace money flows (escrow/nodal handling for partner payables) | 🟡     | Ledger separates partner payables; settlement arrangements depend on the payment aggregator agreement | ⚖ legal + ₹ tax     |
| Refund timelines and customer communication                          | ✅     | Policy-driven refunds, provider-confirmed status, emails                                              | ⚖ confirm timelines |

## Tax — GST

| Requirement                                                                                                        | Status | Notes                                                                                                                          | Review              |
| ------------------------------------------------------------------------------------------------------------------ | ------ | ------------------------------------------------------------------------------------------------------------------------------ | ------------------- |
| GST on accommodation by tariff slab                                                                                | 🟡     | Per-property tax slab configuration in the pricing engine; rates are data and must be verified                                 | ₹ tax               |
| E-commerce operator obligations (Section 9(5) CGST Act for hotel accommodation through ECOs; TCS under Section 52) | ⬜     | Decide who invoices and pays GST (`INVOICE_ISSUER_MODE`); implement TCS reporting if applicable                                | ₹ tax               |
| Tax invoices with mandatory fields, sequential numbering                                                           | 🟡     | Invoices generated per paid booking with sequential numbers; field set must be validated for the chosen model                  | ₹ tax               |
| GSTIN capture for partners and corporate customers                                                                 | ✅     | Partner registration and corporate organisations capture GSTIN                                                                 | ₹ verify validation |
| TDS on commission / payouts (e.g. Section 194-O)                                                                   | ⬜     | Settlement deductions not implemented                                                                                          | ₹ tax               |
| Record retention (accounts and invoices, typically 6–8 years)                                                      | 🟡     | Financial records are never deleted (append-only ledger; retained on account deletion); backup retention must cover the period | ₹ tax               |

## Consumer protection

| Requirement                                                                                                                                    | Status | Notes                                                                                                                                               | Review    |
| ---------------------------------------------------------------------------------------------------------------------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| Consumer Protection (E-Commerce) Rules, 2020: seller details, total price, cancellation and refund policies before purchase, grievance officer | 🟡     | Totals with taxes and fees and the cancellation policy are shown before payment; seller (property) details shown; grievance officer to be published | ⚖ legal   |
| No dark patterns (CCPA guidelines 2023: drip pricing, false urgency, basket sneaking)                                                          | ✅     | Prices include taxes/fees upfront; "rooms left" only from real inventory; no pre-ticked add-ons                                                     | ⚖ confirm |
| Honest reviews (verified stays only; sample data labelled)                                                                                     | ✅     | Only guests of completed stays can review; development ratings are labelled                                                                         | —         |

## Hospitality and partner obligations

| Requirement                                                                                | Status | Notes                                                                         | Review                  |
| ------------------------------------------------------------------------------------------ | ------ | ----------------------------------------------------------------------------- | ----------------------- |
| Partner KYC and property authorisation documents                                           | ✅     | Document upload, admin verification workflow, private storage                 | ⚖ confirm document list |
| Guest identification and registers (e.g. Form C for foreign nationals, local police rules) | ⬜     | Property's obligation at check-in; the platform does not collect ID documents | ⚖ legal                 |
| Partner agreement (commission, settlement, liability, content rights, data processing)     | ⬜     | Commission and settlement mechanics implemented; contract terms to be drafted | ⚖ legal                 |
| Accessibility claims                                                                       | ✅     | Partners declare features; admin verifies; guests see who stated/verified     | —                       |

## Product documents

| Document                       | Status                                                         | Review    |
| ------------------------------ | -------------------------------------------------------------- | --------- |
| Terms of service               | draft page                                                     | ⚖ legal   |
| Privacy policy                 | draft page                                                     | ⚖ legal   |
| Cancellation and refund policy | per-rate policies shown at booking; general policy page needed | ⚖ legal   |
| Partner agreement              | not drafted                                                    | ⚖ legal   |
| Cookie notice                  | strictly necessary cookies only (no banner needed today)       | ⚖ confirm |

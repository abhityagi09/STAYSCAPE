# Known limitations

Status as of 2026-11-27. Items are grouped by what is needed to close them.

## Blocked on external accounts, credentials or approvals

| Item                        | Current state                                                                                                                                                                                             | Needed                                                                                                                                                                        |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Live payments (Razorpay)    | Integration implemented against Razorpay's API and verified with the labelled sandbox gateway that reproduces its order/signature/webhook flow; not yet exercised against Razorpay's own test environment | Razorpay account with KYC; test keys to run the suite against Razorpay test mode; live keys + webhook configuration for production                                            |
| Partner payouts             | Disabled (`PAYOUT_PROVIDER=disabled`); settlements are paid by bank transfer and recorded with evidence                                                                                                   | A payout provider (e.g. RazorpayX) and its compliance onboarding                                                                                                              |
| Third-party channel manager | Local simulator only (signed, idempotent adapter contract tested)                                                                                                                                         | API access to a provider (e.g. STAAH, SiteMinder) to build and certify a real adapter                                                                                         |
| Claude-powered assistant    | Implemented with the official SDK; tested with a scripted client; the deterministic assistant is the default                                                                                              | `ANTHROPIC_API_KEY` to verify the live path and tune prompts                                                                                                                  |
| Production infrastructure   | Verified on a local production-mode staging stack                                                                                                                                                         | Hosting account, domain, TLS certificate, MongoDB Atlas cluster, managed Redis, S3 buckets, SMTP provider with SPF/DKIM/DMARC, GitHub environments with reviewers and secrets |
| Error-tracking SaaS         | Errors are structured logs + metrics + alerts                                                                                                                                                             | Optional: Sentry/Datadog account if a dedicated tool is wanted                                                                                                                |
| Legal and tax               | Policy pages are drafts marked as not reviewed by counsel                                                                                                                                                 | Review by an Indian lawyer and a GST practitioner (docs/compliance-india.md)                                                                                                  |

## Product limitations (accepted for the pilot)

- Phone numbers are stored but not verified (no SMS provider); SMS notifications are not sent.
- Push notifications are a stored preference only (no mobile app or web push yet).
- Hindi translations were produced in-house and have not yet been reviewed by a native-speaking
  editor; status badges show API enum names in English.
- Currency conversion is display-only from ECB reference rates; AED is not published by the ECB
  and is not converted. All charges are in the property's currency (INR).
- Search indexing: public pages get server-generated metadata, JSON-LD and a crawlable summary
  through nginx server-side includes; full server-side rendering of page bodies is not
  implemented (the app renders client-side).
- Self-service account deletion is for customer accounts; partner, staff and administrator
  accounts are closed through support so properties and permissions can be handed over.
- Reviews are post-moderated: published immediately, reportable, removed by moderators.

## Operational limitations

- Load tests ran on a laptop Docker Desktop VM (8 vCPU / 3.7 GiB shared with other projects),
  not on production-sized infrastructure; capacity numbers in docs/testing.md are indicative.
- The backup restore drill was verified on staging-sized data (66 collections); restore time for
  production volumes must be measured with a production-sized copy.
- Lab Web Vitals were measured on a local network; field data (RUM) is not collected yet.
- Automated accessibility checks (axe) plus scripted keyboard, zoom, motion and target-size tests
  pass; a manual screen-reader audit (NVDA/VoiceOver) by an accessibility specialist is still
  recommended before a public launch.

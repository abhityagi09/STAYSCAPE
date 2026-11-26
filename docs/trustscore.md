# TrustScore

A transparent 0–100 score shown on each property page, together with its components, confidence
and the evidence behind it. It is computed only from Stayscape's own records
(`apps/api/src/modules/trust/trust.service.ts`). Properties cannot pay to change it.

## Components

All components use the last 365 days.

| Component            | Weight | Calculation                                                                                                                                                                                              |
| -------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Guest reviews        | 40 %   | Bayesian mean of published review scores: `(Σ scores + 10 × 3.5) ÷ (n + 10)`, mapped from 1–5 onto 0–100. The prior pulls small samples toward the middle, so 2 five-star reviews cannot top the ranking |
| Booking reliability  | 20 %   | `1 − (property-initiated cancellations + rejections) ÷ confirmed bookings`. 100 when there are no bookings yet                                                                                           |
| Verification         | 15 %   | 50 for a partner whose business (KYC) Stayscape approved, plus 50 for a listing Stayscape verified                                                                                                       |
| Responsiveness       | 10 %   | Share of reviews with a property response. A neutral 50 when there are no reviews                                                                                                                        |
| Complaint rate       | 10 %   | `1 − min(1, complaint tickets ÷ confirmed bookings × 5)`. Complaint tickets are booking, property, cancellation and other tickets linked to the property                                                 |
| Listing completeness | 5 %    | 20 points each for: at least 5 photos, a description of at least 200 characters, at least 5 amenities, house policies, and accessibility information                                                     |

The overall score is the weighted mean of the components, rounded.

## Confidence and withholding

- **HIGH:** at least 25 reviews and at least 50 completed stays.
- **MEDIUM:** at least 5 reviews and at least 10 completed stays.
- **LOW:** otherwise.

No overall score is shown while a property has fewer than 3 reviews _and_ fewer than 5 completed
stays. The components are still listed, with the text "Not enough stays or reviews yet".

## Caching

Each property's result is stored in `trustscoresnapshots` and recomputed after 24 hours.

## Accessibility provenance

Accessibility features are stored per property with their provenance:

- `PARTNER_DECLARED`: stated by the property.
- `ADMIN_VERIFIED`: checked by Stayscape staff, with the date and internal evidence notes. The
  evidence is never shown publicly.

Changing a verified feature's description returns it to "declared". Search can filter by features
and, optionally, by verified features only (`accessibilityFeatures`, `accessibilityVerifiedOnly`).

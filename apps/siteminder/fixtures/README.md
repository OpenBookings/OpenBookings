# SiteMinder sample messages

Copied verbatim from the SiteConnect docs (https://developer.siteminder.com/siteconnect-api, cached markdown). Bare OTA samples carry no SOAP envelope in the docs; the security header shape is in `security-header-envelope.xml`.

| File | Source page and section |
| --- | --- |
| `security-header-envelope.xml` | reference_rooms-and-rates: Rooms and Rates > Security Header > Configuration Request tab |
| `rooms-and-rates-rq.xml` | reference_rooms-and-rates: Rooms and Rates > 1. Configuration Request |
| `rooms-and-rates-rs-success.xml` | reference_rooms-and-rates: Rooms and Rates > 2. Configuration Response > Success tab |
| `rooms-and-rates-rs-success-multi-rates.xml` | reference_rooms-and-rates: Rooms and Rates > 2. Configuration Response > Success Multi. Rates tab |
| `rooms-and-rates-rs-success-obp.xml` | reference_rooms-and-rates: Rooms and Rates > 2. Configuration Response > Success for OBP tab |
| `rooms-and-rates-rs-error.xml` | reference_rooms-and-rates: Rooms and Rates > 2. Configuration Response > Error tab |
| `availability-rq-stay-on-arrival.xml` | reference_availability-and-restrictions: Availability and Restrictions > 1. Availability and Restrictions Update > Stay on Arrival tab (availability, stop sell, SetMinLOS/SetMaxLOS, CTA, CTD) |
| `availability-rq-stay-through.xml` | reference_availability-and-restrictions: Availability and Restrictions > 1. Availability and Restrictions Update > Stay Through tab (SetForwardMinStay/SetForwardMaxStay) |
| `availability-rs-success.xml` | reference_availability-and-restrictions: Availability and Restrictions > 2. Confirmation Response > Success tab |
| `availability-rs-error.xml` | reference_availability-and-restrictions: Availability and Restrictions > 2. Confirmation Response > Error tab |
| `rates-rq-pdp-base.xml` | reference_rates: Rates > 1. Rates Update > Per Day Pricing > Base Rates tab |
| `rates-rq-pdp-included-occupancy.xml` | reference_rates: Rates > 1. Rates Update > Per Day Pricing > Included Occupancy tab |
| `rates-rq-pdp-single-guest-discount.xml` | reference_rates: Rates > 1. Rates Update > Per Day Pricing > Single Guest Discount tab |
| `rates-rq-pdp-included-occupancy-and-single-guest-discount.xml` | reference_rates: Rates > 1. Rates Update > Per Day Pricing > Both Included Occ. and Single Gst Dsct tab |
| `rates-rq-pdp-additional-guest-amounts.xml` | reference_rates: Rates > 1. Rates Update > Per Day Pricing > With Additional Guest Amounts tab (extra adult and extra child) |
| `rates-rq-pdp-all-four-rate-fields.xml` | reference_rates: Rates > 1. Rates Update > Per Day Pricing > All 4 Rate fields combined tab |
| `rates-rq-obp-rates.xml` | reference_rates: Rates > 1. Rates Update > Occupancy Based Pricing > OBP Rates tab |
| `rates-rq-obp-undefined-settings.xml` | reference_rates: Rates > 1. Rates Update > Occupancy Based Pricing > Undefined Settings tab |
| `rates-rs-success.xml` | reference_rates: Rates > 2. Confirmation Response > Success tab (full SOAP envelope) |
| `rates-rs-error-authentication.xml` | reference_rates: Rates > 2. Confirmation Response > Authentication Error tab |
| `rates-rs-error-hotel-code.xml` | reference_rates: Rates > 2. Confirmation Response > Incorrect HotelCode tab |
| `rates-rs-error-included-occupancy.xml` | reference_rates: Rates > 2. Confirmation Response > Invalid Included Occupancy tab (first block) |
| `rates-rs-error-included-occupancy-expecting.xml` | reference_rates: Rates > 2. Confirmation Response > Invalid Included Occupancy tab (second block, 'expecting 2') |
| `rates-rs-error-number-of-adults.xml` | reference_rates: Rates > 2. Confirmation Response > Invalid number of adults tab (first block) |
| `rates-rs-error-number-of-adults-expecting.xml` | reference_rates: Rates > 2. Confirmation Response > Invalid number of adults tab (second block, 'expecting 5') |
| `reservation-rq-max-content.xml` | reference_reservations: Reservations > Reservation XML Samples > Maximum Content XML (full SOAP envelope) |
| `reservation-rq-deposit-only.xml` | reference_reservations: Reservations > DepositPayments > Deposit Only tab |
| `reservation-rs-success.xml` | reference_reservations: Reservations > 2. Confirmation Response > Success tab |
| `reservation-rs-error.xml` | reference_reservations: Reservations > 2. Confirmation Response > Error tab |
| `error-handling-sample-error-response.xml` | guides_error-handling: Error Handling > Responses to SiteMinder > Sample Error Response (full SOAP envelope) |

The XML samples are not committed yet — pending the owner's decision on the secret scanner flagging SiteMinder's public sample EchoTokens.

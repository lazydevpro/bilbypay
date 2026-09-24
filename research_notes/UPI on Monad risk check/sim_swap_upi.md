# SIM swap, number recycling & UPI: risk check for "UPI on Monad"

Researched 2026-09-24. Legend: **[C]** = confirmed from a primary/official source or several consistent reputable reports. **[U]** = uncertain (single secondary source, conflicting sources, or couldn't open the primary doc).

## Verdict on the premise

The claim is: "people never swap numbers, and a central authority protects the number so nobody else can be issued it." **It is false on both counts.**

- **Numbers do get issued to someone else. It is legal and routine.**
  - India: a deactivated number can be given to a new subscriber after 90 days. The Supreme Court declined to stop this (2023).
  - US: the FCC allows reassignment 45–90 days after disconnection.
- **Duplicate SIMs and eSIMs for an existing number are issued every day.**
  - Attackers get them through insiders, forged IDs, or by talking the victim into it (eSIM "activation" scams). This is common enough that India's regulators passed specific countermeasures (24-hour SMS bar, 7-day port block) and I4C issued a national eSIM fraud alert (2025).
- **UPI itself does not treat the phone number as a credential.**
  - The number is only an identifier. Moving money needs a device bound to the SIM plus a UPI PIN.
  - NPCI now makes apps purge recycled numbers from UPI every week, which shows the number is not a stable identity.

---

## 1. SIM swap fraud

### Scale
- **US, FBI IC3 [C]:** complaints fell but losses stayed large ([IC3 2024 report](https://www.ic3.gov/AnnualReport/Reports/2024_IC3Report.pdf), [IC3 PSA 2022](https://www.ic3.gov/PSA/2022/PSA220208/)). Analysts say the real figure is higher because victims often report the end fraud, not the SIM swap. **[U]** ([efani summary](https://www.efani.com/blog/sim-swap-fraud-statistics-2026))

  | Year | Complaints | Losses |
  |---|---|---|
  | 2021 | 1,611 | $68M+ |
  | 2022 | 2,026 | $72.7M |
  | 2023 | 1,075 | $48.8M |
  | 2024 | 982 | $26.0M |
  | 2025 | 971 | not found |

- **India:**
  - **No official stat isolates SIM swap. [C: none found]** RBI and I4C report cyber and digital fraud as a whole.
  - Indians lost ₹22,845.73 cr to cyber fraud in 2024, up about 206% from ₹7,465 cr in 2023. There were 36.37 lakh financial-fraud incidents (Lok Sabha reply, 22 Jul 2025) **[C]** ([Business Standard](https://www.business-standard.com/india-news/citizens-lost-over-22-845-crore-to-cyber-criminals-in-2024-govt-tells-ls-125072200883_1.html), [MHA LS Q432, Dec 2025](https://www.mha.gov.in/MHA1/Par2017/pdfs/par2025-pdfs/LS02122025/432.pdf)).
  - The Dec 2025 reply says 11.14 lakh SIMs and 2.96 lakh IMEIs have been blocked **[U: secondary reporting of that reply]** ([The420](https://the420.in/india-cybercrime-2024-42-percent-spike-sims-imei-mule-accounts/)).
  - RBI AR 2024-25: 23,953 bank frauds. Most cases by count were digital payments (about ₹520 cr). Only frauds of ₹1 lakh or more are counted. **[C]** ([Business Standard](https://www.business-standard.com/finance/news/bank-fraud-amount-triples-in-fy25-despite-drop-in-number-of-cases-rbi-125052900696_1.html))

### Indian cases and alerts
- **Mumbai, Dec 2024 [C]:** a company owner lost ₹7.5 cr to SIM swap fraud. Police recovered ₹4.65 cr. ([Business Standard](https://www.business-standard.com/india-news/pvt-firm-owner-duped-of-rs-7-5-c-in-sim-swap-fraud-cops-recover-rs-4-65-cr-124122500104_1.html))
- **I4C eSIM swap alert, around Aug–Sep 2025 [C]:**
  - Fraudsters posing as the telco get the victim to convert their SIM to an eSIM the attacker controls, then receive the OTPs.
  - In Noida, a victim lost about ₹27 lakh (FD broken, loan taken in her name). In another case, ₹4 lakh was taken even though UPI and ATM were disabled.
  - Sources: [MobileIDWorld](https://mobileidworld.com/india-warns-of-new-esim-scam-enabling-bank-fraud-through-mobile-number-hijacking/), [Lokmat](https://www.lokmattimes.com/technology/esim-scam-in-india-i4c-warns-mobile-users-about-rising-fraud-heres-how-to-stay-safe-a507/).
- **Older Bengaluru case:** 7 arrested, including an Axis Bank deputy manager. They got 100+ duplicate SIMs with forged documents. ([Deccan Herald](https://www.deccanherald.com/india/karnataka/bengaluru/axis-bank-dy-manager-aides-2043714))
- **Insider cases elsewhere [C]:**
  - An AT&T employee was sentenced to 16 months ([KTLA](https://ktla.com/news/california/former-att-employee-sim-swapping-fraud/)).
  - Manhattan DA, Nov 2025: indictment of a ring that included AT&T and T-Mobile store insiders ([Manhattan DA](https://manhattanda.org/d-a-bragg-announces-indictment-of-sim-swapping-id-theft-ring-including-att-and-t-mobile-employees/)).

### How attackers get the SIM [C]
- **Insider collusion** at the telco or retailer.
- **Forged or fake KYC documents.**
- **Social engineering:** claiming "lost SIM", or tricking the victim into eSIM conversion or approving the swap.
- Sources: [Axis Bank](https://www.axis.bank.in/fraud-awareness/prevent-frauds/sim-swap-fraud), [The420](https://the420.in/sim-swap-fraud-india-cybercrime-mobile-number-security/).

### Indian countermeasures
- **DoT 24-hour SMS bar [C]:**
  - DoT instruction dated **27 Sep 2022**: after a SIM swap or replacement, incoming AND outgoing SMS are barred for 24 hours on the new SIM. Telcos had 15 days to implement.
  - Source: [DoT PDF](https://dot.gov.in/sites/default/files/SIM%20Exchange%2024%20Hours%20Barring%20formal%20instructions%2027092022.pdf?download=1). The PDF returned 403 to my fetch, so the content comes from the search index.
  - Wikipedia gives the date as 14 Nov 2022 **[U]**. Some blogs wrongly say the bar covers incoming SMS only.
- **TRAI MNP 9th Amendment [C]:**
  - Notified 14 Mar 2024, in force **1 Jul 2024**.
  - A porting code (UPC) cannot be issued within **7 days** of a SIM swap or replacement.
  - Sources: [Business Today](https://www.businesstoday.in/technology/news/story/trai-imposes-7-day-waiting-period-for-mobile-number-portability-after-sim-swap-435169-2024-06-29), [TelecomTalk](https://telecomtalk.info/trai-amends-mnc-rules-now-you-cant-port-immediately-after-swapping-sim/927504/).
  - Whether the earlier limit was 10 days is disputed **[U]**.
- **DoT SIM-binding directions for messaging apps [C]:**
  - Issued around 28 Nov 2025 under the Telecom Cyber Security Amendment Rules 2025. The app must stop working if its SIM is removed.
  - The deadline was extended to **31 Dec 2026** ([MediaNama](https://www.medianama.com/2026/04/223-dot-sim-binding-deadline-extended-dec-2026/), [MediaNama Nov 2025](https://www.medianama.com/2025/11/223-dot-sim-binding-directions-to-whatsapp-and-telegram/)).
  - This rule exists because regulators consider phone-number identity weak.

**Note:** these countermeasures only slow attackers down. A 24-hour SMS bar does nothing once 24 hours have passed, and it does nothing against recycled numbers.

---

## 2. Number recycling

### India [C]
- TRAI told the Supreme Court that a number deactivated for non-use (or disconnected on request) is **not reassigned for at least 90 days**. Telcos may extend this.
- The SC dismissed a plea to ban recycling in **Rajeshwari v. UoI (decided Oct/Nov 2023, not 2024)**, bench of Khanna & Bhatti JJ. It said the earlier subscriber must take steps to protect their own privacy, and it noted WhatsApp's 45-day inactivity data wipe.
- Sources: [LiveLaw](https://www.livelaw.in/top-stories/once-a-mobile-number-is-deactivated-it-is-not-assigned-to-a-new-user-for-90-days-trai-to-supreme-court-241506), [Deccan Herald](https://www.deccanherald.com/india/phone-number-gets-deactivated-after-90-days-whatsapp-cleans-data-after-45-days-supreme-court-told-2755343).

### US [C]
- FCC 18-177 (Dec 2018) sets the aging period: residential numbers **45–90 days**, business numbers 45–365 days. Compliance started 27 Jul 2020 ([FCC order](https://docs.fcc.gov/public/attachments/fcc-18-177a1.pdf)).
- About 35M US numbers are disconnected per year.
- Princeton (Lee & Narayanan, eCrime 2021) sampled 259 available numbers:
  - 171 (66%) were still linked to accounts at popular sites.
  - 215 were recycled and exploitable.
  - 19 of 200 still received OTPs and other sensitive messages within a week.
  - Sources: [CITP](https://citp.princeton.edu/news/2021/citp-researchers-discover-recycled-phone-numbers-pose-privacy-and-security-risks), [paper](https://recyclednumbers.cs.princeton.edu/assets/recycled-numbers-05-03-2021.pdf).

### UPI and bank handling [C]
- NPCI circular **OC-115E, 3 Mar 2025** (addendum to the Numeric UPI ID Mapper circular):
  - Banks and PSPs must check the DoT **Mobile Number Revocation List / Digital Intelligence Platform** at least **weekly** and clean their databases.
  - Explicit user consent is required to link or port a UPI Number.
  - Deadline was 31 Mar 2025. UPI IDs linked to dormant numbers were deactivated from 1 Apr 2025.
  - Sources: [NPCI PDF](https://www.npci.org.in/PDF/npci/upi/circular/2025/UPI-OC-No-115-E-FY-2024-25-Addendum-to-circular-on-the-Numeric-UPI-ID-resolution.pdf), [TeamLease RegTech](https://www.teamleaseregtech.com/updates/article/40223/npci-issued-an-addendum-to-the-circular-on-the-numeric-upi-id-resoluti/), [StudyCafe](https://studycafe.in/npcis-new-move-no-more-upi-misuse-with-inactive-numbers-370242.html).
- RBI (Jan 2025) told regulated entities to use MNRL by 31 Mar 2025 **[U: secondary]** ([Substack](https://kapilpatil.substack.com/p/how-mobile-number-revocation-list)).

---

## 3. How UPI security actually works [C unless marked]
- **Device binding:**
  - The app sends an **outgoing SMS from the SIM** that carries the bank-registered number, which proves the SIM is in that phone.
  - The binding is tied to device identifiers, and a VPA is allotted only after binding.
  - Changing the phone or SIM means re-binding.
  - Sources: [USENIX Sec'20 UPI analysis](https://www.usenix.org/system/files/sec20summer_kumar_prepub.pdf), [HDFC NRI UPI](https://www.hdfc.bank.in/nri-banking/services/unified-payment-interface-for-nri).
- **UPI PIN (4–6 digits):**
  - Needed for every debit.
  - Setting it needs debit card details (last 6 digits + expiry) or Aadhaar OTP, which requires the same mobile number on Aadhaar and the bank account ([IOB FAQ](https://www.iob.bank.in/en/faq-on-upi)).
- **VPA / UPI ID and the Numeric UPI ID Mapper:** a mobile number or UPI Number resolves to a VPA and then to a bank account. It is used **only to address the payee** ([NPCI OC-115](https://www.npci.org.in/PDF/npci/upi/circular/2021/NPCI-UPI-OC-115-Rollout%20of-Numeric-UPI-ID-Mapper-to-enable-UPI-Number.pdf)).
- **UPI Lite:**
  - No PIN for up to **₹1,000 per transaction**, with a wallet cap of **₹5,000** (RBI, Dec 2024).
  - Top-ups need the PIN / additional factor.
  - Still requires the bound device.
  - Source: [Business Standard](https://www.business-standard.com/finance/news/rbi-enhances-upi-lite-wallet-limits-updates-offline-payments-framework-124120401144_1.html).
- **UPI 123PAY (feature phones):**
  - Works by IVR, missed call, app, or sound.
  - Only from the bank-registered number, and still needs the PIN for every payment.
  - Per-transaction limit raised to ₹10,000 (Oct 2024).
  - Sources: [NPCI](https://www.npci.org.in/product/upi-123pay), [Business Standard](https://www.business-standard.com/finance/news/rbi-enhances-limits-for-upi123-pay-upi-lite-to-encourage-wider-adoption-124100900558_1.html).
- **NRI UPI:**
  - NPCI circular of 10 Jan 2023 allows international numbers from 10 countries to link NRE/NRO accounts. About 12 countries by 2025.
  - For domestic use only, not cross-border.
  - Sources: [ICICI](https://www.icici.bank.in/nri-banking/nriedge/nri-articles/nris-can-use-their-international-mobile-number-to-make-upi-payments-in-india), [Business Standard](https://www.business-standard.com/amp/finance/personal-finance/idfc-first-bank-launches-upi-for-indians-in-12-countries-how-service-works-125062500738_1.html).
- **UPI–PayNow:**
  - Launched 21 Feb 2023. The sender pays to a mobile number or VPA.
  - Limit at launch was about S$1,000/day. Whether it has changed since is **[U]**.
  - Expanded to 19 Indian banks in Jul 2025.
  - Sources: [MAS](https://www.mas.gov.sg/news/media-releases/2023/launch-of-real-time-payments-between-singapore-and-india), [Business Today](https://www.businesstoday.in/personal-finance/banking/story/npci-upi-paynow-linkage-expansion-19-indian-banks-india-singapore-remittances-484919-2025-07-16).
- **Is the phone number alone ever enough to move money? No.**
  - The number (or number-to-VPA mapping) is enough to *receive* money or to address a payee.
  - A debit always needs the SIM-bound device plus the PIN. UPI Lite, up to ₹1k, needs the bound device only.
  - Real attacks therefore combine a SIM swap with a stolen PIN or debit card details, obtained by phishing or malware. The SIM swap also lets the attacker re-bind a new device.
  - The main risk of a number-as-handle design is **misdirected inbound payments** after a number is recycled or hijacked. This is exactly why NPCI now purges numbers found on the MNRL.

---

## 4. Crypto phone-number payment precedents
- **Celo / Valora:**
  - **Phone privacy:** the on-chain identifier is `hash(phone + pepper)`. The pepper comes from ODIS, a rate-limited oblivious service, which stops anyone from enumerating phone numbers ([Celo docs](https://docs.celo.org/celo-codebase/protocol/odis/use-cases/phone-number-privacy)).
  - **Change in verification:** the original validator-SMS attestations (ASv1) needed 3 attestations and cost fees. They were buggy and confusing for users. Valora moved to **centralised phone verification in Nov 2022** ([Celo forum](https://forum.celo.org/t/attestation-protocol-asv1-update/4831)). ODIS v1 was sunset in Mar 2023, replaced by v2.
  - **Current model:** SocialConnect is "federated". Any issuer can attest a number→address mapping, and apps choose which issuers they trust ([GitHub](https://github.com/celo-org/social-connect)). MiniPay is now the main user.
  - **Celo's own threat model [C via doc snippets; my direct fetch of the current page didn't show the text, so it may be on the legacy version]:**
    - A telco or SIM-swap attacker can create attestations for a number.
    - This does **not** steal existing funds, because the key is still required.
    - But **future senders may be tricked into paying the attacker's address**.
    - Recommended mitigations: weigh the number and age of attestations, detect remapping, and send small test amounts first.
    - Sources: [Celo identity docs](https://docs.celo.org/what-is-celo/about-celo-l1/protocol/identity), [legacy](https://docs.celo.org/legacy/protocol/identity).
  - **This is the most relevant lesson for "UPI on Monad".**
- **Peg:**
  - A YC self-custodial USDC wallet. Users could send to a phone or email, and the recipient claimed through a link.
  - **Shut down on 30 Nov 2025** ([peg.money](https://www.peg.money/)). No public post-mortem on security was found **[U]**.
- **Coinbase:**
  - The custodial app sends off-chain to a phone, email or username, with 2FA on higher-value sends.
  - The Send API's phone-number sends are "under reconstruction… temporarily disabled" (docs, 2026) **[C]** ([CDP docs](https://docs.cdp.coinbase.com/coinbase-app/transfer-apis/send-crypto)). No reason was given.
  - Coinbase Wallet launched link-sends in Dec 2023 ([Coinbase blog](https://www.coinbase.com/blog/with-coinbase-wallet-sending-money-is-now-as-easy-as-sending-a-text)):
    - Link = bearer token ("anyone with the link can access the funds").
    - Unclaimed funds are auto-refunded after 2 weeks.
    - The wallet has since been rebranded to the Base app **[U]**.
- **Ramp Network:**
  - USDC-on-Base payment links, claimable only in the Ramp app, with passkey auth. Direct sends go to a username, not a phone number (Apr 2026) ([Ramp blog](https://rampnetwork.com/blog/send-usdc-without-wallet-address)).
- **Common pattern across these products:**
  - The phone number is used for **discovery or delivery only**.
  - Funds are either escrowed with an expiry and refund, or sent to a key-controlled address.
  - No product lets a phone number, or control of an SMS OTP, act as the signing authority.

---

## 5. Regulatory (India)
- **RBI stance [C]:** strongly against crypto and stablecoins.
  - Gov. Sanjay Malhotra, Nov 2025: stablecoins carry "huge risk". The RBI promotes CBDC instead.
  - The Dec 2025 Financial Stability Report says CBDC can deliver the benefits claimed for stablecoins.
  - Deputy Governor T. Rabi Sankar is harsher.
  - The government has the final say. A DEA-led crypto discussion paper was still delayed as of Apr 2026 because of RBI objections.
  - Sources: [Business Standard Jan 2026](https://www.business-standard.com/amp/finance/news/rbi-reiterates-cautious-stance-on-crypto-assets-stablecoins-for-stability-126010101094_1.html), [CryptoTimes Apr 2026](https://www.cryptotimes.io/2026/04/01/indias-crypto-policy-delayed-again-as-rbi-blocks-discussion-paper/).
  - The Economic Survey 2025-26 hinted at a stablecoin pathway **[U: secondary analysis]**.
- **ARC rupee stablecoin (Polygon + Anq):**
  - A private project reported for Q1 2026. Not live and not RBI-approved as of mid-2026 **[U]** ([CoinDesk](https://www.coindesk.com/markets/2025/11/20/india-s-debt-backed-arc-token-eyes-tentative-january-2026-debut-sources-say), [Pharos tracker](https://pharos.watch/stablecoin/arc-anq/)).
- **Tax [C]:**
  - 30% flat tax on VDA gains, plus cess. No loss set-off.
  - 1% TDS under s.194S on VDA transfers. The threshold is ₹50k/yr for specified persons and ₹10k for others.
  - Unchanged in Budget 2026.
  - s.285BAA exchange reporting has been live since Apr 2026.
  - Sources: [ClearTax](https://cleartax.in/s/cryptocurrency-taxation-guide), [CryptoTimes Sep 2026](https://www.cryptotimes.io/2026/09/21/india-crypto-tax-2026-30-vda-levy-1-tds-stay-as-section-285baa-reporting-goes-live/).
  - Stablecoins count as VDAs, so every USDC→INR off-ramp can trigger TDS and tax treatment.
- **PMLA / FIU-IND [C]:**
  - Since Mar 2023, VDA service providers (exchange, transfer, custody) are PMLA reporting entities and must register with FIU-IND.
  - FIU-IND ordered 15 offshore apps taken down on 9 Sep 2026 **[U: single source]** ([CryptoTimes](https://www.cryptotimes.io/2026/09/21/india-crypto-tax-2026-30-vda-levy-1-tds-stay-as-section-285baa-reporting-goes-live/)).
  - A custodial or relaying service that serves Indian users would likely need to register.
- **FEMA / remittance:** crypto remittance is not a recognised inbound channel. FEMA treatment is unresolved **[U]**.
- **"UPI" name [C]:**
  - NPCI lists **UPI as its trademark**. Its brand rules prohibit registering NPCI marks or derivatives as trademarks or domains, and allow word-mark use only in a referential way.
  - The UPI logo and mnemonics need written permission ([NPCI Brand Centre](https://www.npci.org.in/npci-in-news/brand-centre), [BHIM UPI Guidelines, 4 Jun 2026](https://www.npci.org.in/uploads/BHIM_UPI_Guidelines_2026_012a0b1bce.pdf)).
  - "UPI on Monad" as a product name risks implying NPCI affiliation. A pitch line like "UPI-like" is safer.
  - This is not legal advice. Whether a hackathon demo name would be enforced against is **[U]**.

---

## Design implications (recommendations)
1. **Treat the phone number as a lookup handle, never as an auth factor.** Signing should use a passkey or device key (Monad smart account). Don't let control of an SMS OTP authorise spends or key recovery.
2. **Send to unclaimed numbers into escrow with an expiry and refund**, like Coinbase links and Peg. Don't send directly to whatever address is currently mapped.
3. **Record mapping age and changes.**
   - Warn the sender, or hold funds, if a number was re-mapped recently (Celo lesson).
   - Tie freshness to the 90-day recycling window and the 7-day port block.
4. **Keep re-verification cheap and periodic.** Expire stale mappings, mirroring NPCI's weekly MNRL purge.
5. **Pitch it as "UPI-style", not "UPI".** Include a line on India compliance: 1% TDS and 30% tax at off-ramp, FIU-IND registration if custodial, RBI hostility to stablecoins.

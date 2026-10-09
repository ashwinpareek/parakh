# Parakh — demo and pitch script (3 minutes)

## 0:00 Problem (25 s)
"Parakh means to test. Every bill, tested before you trust it."

"Every month an Indian MSME claims input tax credit on hundreds of purchase invoices. If one invoice has the wrong tax head, a cancelled GSTIN, or the supplier simply never filed, that credit is lost, often with interest. Today an accountant finds this by comparing PDFs and Excel downloads by hand. Since October 2025 they also have to accept or reject every invoice in IMS before the 14th."

## 0:25 Overview (35 s) — open the sample workspace
- "This is a Warangal-area manufacturer, September 2026, checked 5 days before IMS closes."
- Read the headline aloud: **"You can safely claim ₹3.13 L. Another ₹1.60 L is stuck on 14 bills."** No jargon; anyone in the room understands it.
- Hover "input tax credit": every GST term explains itself. Mention the Simple/Expert switch (beginner vs CA).
- "Parakh doesn't just say 'error'. It says how many rupees, why, and what to click."
- Show *Where the credit is at risk* and *What to do in IMS: accept / keep pending / reject*.

## 1:00 AI moment (35 s)
- Click **Read scan** on the scanned lubricants invoice. AI reads the photo; the headline updates live.
- Open it: "Telangana Lubricants is e-invoice mandated. No IRN means no valid invoice, so ₹28,260 of ITC is at risk."
- Go to Invoices → **AI line check**: one AI pass over every line flags HSN misfits and blocked credit the keyword rules miss.

- Open Sigma Machine Tools: "The QR on an e-invoice is signed by the government. We verify the signature and compare it with the print. Someone edited this bill from ₹2,59,600 to ₹2,95,000 after registering it."

## 1:35 Evidence (30 s)
- Open Kakatiya Packaging: the IGST total is **highlighted on the PDF itself**. "IGST on an intra-state supply. Reject in IMS; supplier issues a credit note."
- Click through: catering bill → Sec 17(5) blocked; AC at 28% → overcharged after GST 2.0; Karnataka place of supply → ineligible.
- Run **AI review in Telugu** to show the plain-language verdict.

## 2:05 Reconciliation and action (35 s)
- Reconciliation tab: "SVT/0457/26-27 in books vs SVT457 in GSTR-2B: same invoice, matched automatically despite the formatting."
- *Not in books*: "Krishna Traders, registered four months ago, filed ₹33,480 against our GSTIN. We never bought from them. Reject."
- Suppliers → Nizam Hydraulics → **Draft follow-up**: email or WhatsApp, ready to send.
- Filing actions: **GSTR-3B Table 4 draft**. Report → Excel workbook for the CA.

## 2:40 Market and close (20 s)
- "1.4 crore+ GST registrations; every B2B buyer reconciles monthly. CAs handle 50–500 clients each."
- Model: ₹499/month per GSTIN for MSMEs; ₹4,999/month CA practice plan; GSP integration for live data.
- "Rules decide what the law decides. AI handles what rules can't: messy documents, intent, and communication. Parakh turns GST compliance from a month-end scramble into a 5-minute check."

## Judging criteria map
| Criterion | Where to show it |
|---|---|
| Working MVP (30%) | Everything runs live in the browser: upload, parse, check, reconcile, export |
| AI relevance (20%) | Scan extraction, semantic line check, Telugu verdict, supplier messages |
| UI/UX (15%) | Overview → evidence highlight → action, in three clicks |
| Market potential (15%) | MSMEs + CA practices, IMS deadline urgency, pricing above |
| Beginner-friendly | Simple mode, tap-to-explain terms, Learn GST page, 60-second tour |
| Trust | Reliability page: measured accuracy on an answer key, human review for AI reads |
| Innovation (10%) | ITC-at-risk in rupees, evidence on the document, GST 2.0 rate checks, IMS + 3B Table 4 draft |
| Demo & pitch (10%) | This script |

## Likely judge questions
- **Is the GSTIN check real?** Yes: format, state code and the official base-36 checksum. Registration status uses a demo registry; production uses a GSP API.
- **Why not just use an LLM for everything?** Tax law has deterministic answers; rules are auditable and free. AI is used where judgement or vision is needed.
- **Data privacy?** Processing is in-browser; only scans the user chooses are sent to AI.
- **How accurate is it?** Show the Reliability page: measured against an answer key, unread documents count as failures, and AI reads go to a person to confirm.
- **What about ClearTax / Zoho?** They reconcile data that is already structured. Parakh starts from the documents themselves, explains every finding in rupees with the law, and works for an MSME with no ERP.

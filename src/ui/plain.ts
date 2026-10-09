// Plain-English versions of every finding, for Simple mode. Each answers three questions a
// non-accountant has: what is wrong, why it matters to me, and what do I do now.

import type { Finding, ReconStatus, Severity } from '../domain/types';

export interface Plain { title: string; why: string; todo: string }

const P: Record<string, Plain> = {
  'R46-NUM': { title: 'The bill has no invoice number', why: 'Every valid bill needs a unique number. Without it you cannot claim the GST.', todo: 'Ask the supplier for a corrected bill.' },
  'R46-NUM-LEN': { title: 'The invoice number is too long', why: 'GST allows at most 16 characters. The supplier may not be able to report it as printed.', todo: 'Ask the supplier to reissue with a shorter number.' },
  'R46-NUM-CHARS': { title: 'The invoice number has characters GST does not allow', why: 'Only letters, numbers, "-" and "/" are allowed.', todo: 'Ask the supplier to correct the number.' },
  'R46-DATE': { title: 'The bill has no date', why: 'The date decides which month the GST belongs to.', todo: 'Ask for a corrected bill.' },
  'R46-DATE-FUTURE': { title: 'The bill is dated in the future', why: 'You cannot claim GST before the bill date.', todo: 'Check the date with the supplier.' },
  'R46-SUP-NAME': { title: 'The supplier’s name is missing', why: 'A valid bill must name the seller.', todo: 'Ask for a corrected bill.' },
  'R46-SUP-ADDR': { title: 'The supplier’s address is missing', why: 'A valid bill must show the seller’s address.', todo: 'Minor. Ask the supplier to include it next time.' },
  'GSTIN-SUP-MISSING': { title: 'The supplier’s GST number is missing', why: 'Without it the government cannot link this bill to you, so you get no credit.', todo: 'Ask for a bill that shows the supplier’s GSTIN.' },
  'GSTIN-SUP-INVALID': { title: 'The supplier’s GST number has a mistake', why: 'GST numbers have a built-in check digit, and this one does not add up. At least one character is wrong.', todo: 'Confirm the right number with the supplier and fix it in your records.' },
  'GSTIN-SUP-CANCELLED': { title: 'The supplier’s GST registration was cancelled', why: 'A business with a cancelled registration is not allowed to charge GST. You cannot claim it.', todo: 'Do not claim. Ask the supplier to refund the GST they charged.' },
  'GSTIN-SUP-SUSPENDED': { title: 'The supplier’s GST registration is suspended', why: 'Bills from suspended registrations do not give credit.', todo: 'Hold the claim until the registration is active again.' },
  'FRAUD-NEW-REG': { title: 'Large bill from a very new supplier', why: 'Fake-bill rackets often use newly registered GST numbers.', todo: 'Make sure the goods actually arrived before claiming.' },
  'GSTIN-PAN-NAME': { title: 'The GST number may belong to a different business', why: 'The PAN inside the GST number does not match the supplier’s name.', todo: 'Double-check the GSTIN with the supplier.' },
  'GSTIN-SELF': { title: 'The supplier’s GST number is your own', why: 'Usually a data-entry mix-up.', todo: 'Correct the supplier’s GSTIN.' },
  'R46-BUYER-GSTIN': { title: 'Your GST number is not on the bill', why: 'Without your GSTIN, the supplier reports it as a sale to a consumer. It never reaches your GSTR-2B, so you get no credit.', todo: 'Ask the supplier to add your GSTIN and report it as a business sale.' },
  'R46-BUYER-OTHER': { title: 'The bill is made out to a different GST number', why: 'The credit will go to that registration, not yours.', todo: 'Ask for the bill in your company’s GSTIN.' },
  'R46-BUYER-NAME': { title: 'Your company name looks different on the bill', why: 'Usually harmless, but worth correcting.', todo: 'Ask the supplier to use your registered name.' },
  'R46-HSN': { title: 'Item codes (HSN) are missing', why: 'The code tells the government what was sold and which rate applies.', todo: 'Ask the supplier to show HSN codes on their bills.' },
  'R46-HSN-SHORT': { title: 'Item codes (HSN) are too short', why: 'At least 4 digits are needed to identify the item.', todo: 'Ask the supplier to use full codes.' },
  'R46-SIGN': { title: 'The bill is not signed', why: 'A paper or PDF bill must be signed (e-invoices are exempt).', todo: 'Minor. Ask for a signed copy for your records.' },
  'R46-POS': { title: 'The bill does not say which state the sale is in', why: 'Inter-state bills must show the place of supply.', todo: 'Ask the supplier to add it.' },
  'POS-OTHER-STATE': { title: 'The bill treats the sale as happening in another state', why: 'GST paid to another state cannot be used by your registration here.', todo: 'Ask the supplier to cancel it and reissue with your state, charging IGST.' },
  'TAX-HEAD-IGST': { title: 'Wrong type of GST was charged', why: 'You and the supplier are in the same state, so the bill should show CGST + SGST, not IGST. Tax under the wrong head cannot be used, even if the amount is right.', todo: 'Reject it in IMS and ask for a credit note and a fresh bill.' },
  'TAX-HEAD-LOCAL': { title: 'Wrong type of GST was charged', why: 'You are in different states, so the bill should show IGST, not CGST + SGST.', todo: 'Reject it in IMS and ask for a corrected bill.' },
  'RATE-INVALID': { title: 'This GST rate does not exist', why: 'GST is charged only at fixed rates (mainly 5%, 18% and 40%).', todo: 'Ask the supplier which rate they meant.' },
  'RATE-LEGACY': { title: 'An old GST rate was used', why: 'This item’s rate was cut on 22 Sep 2025, but the bill still uses the old higher rate. You paid extra GST.', todo: 'Ask for a credit note for the extra tax.' },
  'RATE-HSN': { title: 'The GST rate does not match the item', why: 'The item code points to a different rate than the one charged.', todo: 'Check the rate with the supplier.' },
  'RATE-LEGACY-UNKNOWN': { title: 'An old GST rate may have been used', why: 'Most items at 12% or 28% moved to new rates in Sep 2025.', todo: 'Confirm the current rate for this item.' },
  'MATH-LINE-VALUE': { title: 'Quantity × price does not add up', why: 'The line amount is wrong, so the GST on it is wrong too.', todo: 'Ask for a credit note or a corrected bill.' },
  'MATH-LINE-TAX': { title: 'The GST amount is calculated wrongly', why: 'The tax charged is not the stated percentage of the value.', todo: 'Claim only the correct amount.' },
  'MATH-CGST-SGST': { title: 'CGST and SGST are not equal', why: 'They must always be two equal halves.', todo: 'Ask for a corrected bill.' },
  'MATH-TOTAL-TAXABLE': { title: 'The items do not add up to the total', why: 'The bill’s own figures disagree.', todo: 'Ask the supplier to correct it.' },
  'MATH-GRAND': { title: 'The bill total does not add up', why: 'Value + GST does not equal the total printed.', todo: 'Ask the supplier to correct it.' },
  'MATH-ROUNDOFF': { title: 'Unusually large round-off', why: 'Rounding should never be more than ₹1.', todo: 'Check the total with the supplier.' },
  'ITC-BLOCKED': { title: 'This purchase never qualifies for GST credit', why: 'The law blocks credit on some items however correct the bill is: staff meals, cars, gifts, club fees and similar.', todo: 'Pay the bill, but do not claim its GST.' },
  'ITC-TIME-BARRED': { title: 'Too late to claim this bill', why: 'Credit must be claimed by 30 November after the bill’s financial year. That date has passed.', todo: 'Do not claim. Record the GST as a cost.' },
  'ITC-TIME-SOON': { title: 'Claim this soon or lose it', why: 'The last date to claim this bill is close.', todo: 'Make sure it is claimed in this month’s return.' },
  'ITC-180-DAYS': { title: 'Supplier not paid for over 180 days', why: 'If you do not pay within 180 days, you must give back the GST credit you took.', todo: 'Pay the supplier, or reverse the credit in this month’s return.' },
  'ITC-180-SOON': { title: 'Pay this supplier soon to keep the credit', why: 'At 180 days unpaid, the credit has to be given back.', todo: 'Schedule the payment.' },
  'EINV-MISSING-IRN': { title: 'This bill should have been an e-invoice', why: 'This supplier is large enough that every bill must be registered with the government (IRN and QR code). Without it, the bill is not valid.', todo: 'Ask the supplier for the registered e-invoice copy.' },
  'EINV-IRN-FORMAT': { title: 'The e-invoice number (IRN) looks wrong', why: 'A real IRN is 64 characters long.', todo: 'Verify it on the e-invoice portal.' },
  'EINV-QR-FORGED': { title: 'The QR code is not genuine', why: 'Its digital signature does not check out. The QR may be fake.', todo: 'Verify the bill on the e-invoice portal before paying.' },
  'EINV-QR-MISMATCH': { title: 'The bill was changed after it was registered', why: 'The QR code holds the government-signed details. The printed bill shows different figures, so someone edited it.', todo: 'Claim only the registered amount and ask the supplier to explain.' },
  'EINV-QR-MISSING': { title: 'E-invoice without a readable QR code', why: 'Registered e-invoices must carry the signed QR code.', todo: 'Ask for the copy downloaded from the e-invoice portal.' },
  'EINV-QR-KEY': { title: 'QR signature could not be checked', why: 'Parakh does not have the key it was signed with, so only the contents were compared.', todo: 'No action needed.' },
  'DUP-EXACT': { title: 'This bill is uploaded twice', why: 'Claiming both copies would claim the same GST twice, which is treated as fraud.', todo: 'Remove the duplicate from your records.' },
  'DUP-NEAR': { title: 'Possible duplicate bill', why: 'Same supplier, same amount, within a week, but a different number.', todo: 'Check it is not the same purchase billed twice.' },
  'RECON-OUT-OF-PERIOD': { title: 'Bill from an earlier month', why: 'It is not in this month’s GSTR-2B because it belongs to an earlier one.', todo: 'Check it was reported in its own month.' },
  'RECON-MISSING-2B': { title: 'Your supplier has not reported this bill to the government yet', why: 'You can only claim GST on bills that appear in your GSTR-2B. Until the supplier reports it, the credit is on hold.', todo: 'Remind the supplier to file it in their GSTR-1.' },
  'RECON-MISMATCH': { title: 'Your records and the supplier’s report don’t match', why: 'The amounts or details the supplier gave the government differ from your bill.', todo: 'Claim the lower figure and ask the supplier to correct their filing.' },
  'RECON-2B-INELIGIBLE': { title: 'The government marked this credit as not available', why: 'GSTR-2B itself says this GST cannot be claimed.', todo: 'Do not claim. Fix the underlying problem with the supplier.' },
  'RECON-SUGGESTED': { title: 'Matched, with a small formatting difference', why: 'Same bill, but the number, date or GSTIN is written slightly differently.', todo: 'Confirm the match. No credit is at risk.' },
};

export function plainFor(f: Finding): Plain {
  if (P[f.ruleId]) return P[f.ruleId];
  if (f.ruleId.startsWith('AI-HSN')) return { title: f.title.replace(/^Line \d+: /, 'An item ') , why: 'AI noticed that the item code or rate does not fit what was bought.', todo: f.fix ?? 'Check the code and rate with the supplier.' };
  return { title: f.title, why: f.detail, todo: f.fix ?? 'Review with your accountant.' };
}

/** Errors you must fix before claiming vs warnings worth fixing. */
export const mustFix = (s: Severity) => s === 'critical' || s === 'high';

export const VERDICT = {
  clear: { label: 'Safe to claim', short: 'Safe' },
  review: { label: 'Check first', short: 'Check' },
  high: { label: 'Don’t claim yet', short: 'Hold' },
} as const;

export const RECON_SIMPLE: Record<ReconStatus, string> = {
  matched: 'Supplier reported it',
  suggested: 'Reported, small difference',
  mismatch: 'Reported, figures differ',
  'missing-in-2b': 'Supplier hasn’t reported',
  'missing-in-books': 'Not in your records',
};

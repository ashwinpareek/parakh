// Invoice-level compliance rules. Each rule reads one invoice (plus context) and emits findings.
// Citations refer to the CGST Act, 2017 and CGST Rules, 2017.

import type { Company, Finding, FindingCategory, Invoice, Severity } from './types';
import { checkGstin, STATE_CODES, stateLabel } from './gstin';
import { BLOCKED_CREDIT, GST_REFORM_DATE, hsnReference, LEGACY_RATES, lookupRegistry, VALID_RATES } from './reference';
import { canonicalInvoiceNo, daysBetween, nameSimilarity, round2 } from './text';
import { formatINR } from '../lib/format';

export interface RuleContext {
  company: Company;
  asOf: string;
  all: Invoice[];
}

export const itcOf = (inv: Invoice) => round2(inv.cgstTotal + inv.sgstTotal + inv.igstTotal + inv.cessTotal);

type Draft = Omit<Finding, 'id' | 'invoiceId' | 'source'>;

function f(ruleId: string, severity: Severity, category: FindingCategory, title: string, detail: string, extra: Partial<Draft> = {}): Draft {
  return { ruleId, severity, category, title, detail, itcAtRisk: 0, ...extra };
}

/** Last date to claim ITC for an invoice under Sec 16(4): 30 November after the end of its financial year. */
export function itcDeadline(isoDate: string): string {
  const [y, m] = isoDate.split('-').map(Number);
  const fyEnd = m >= 4 ? y + 1 : y;
  return `${fyEnd}-11-30`;
}

export function runRules(inv: Invoice, ctx: RuleContext): Draft[] {
  const out: Draft[] = [];
  const itc = itcOf(inv);
  const { company } = ctx;
  const isStructured = inv.source.kind === 'register' || inv.source.kind === 'json';

  // ---------------------------------------------------------------- mandatory fields (Rule 46)
  if (!inv.invoiceNo) {
    out.push(f('R46-NUM', 'critical', 'mandatory-fields', 'Invoice number missing', 'A tax invoice must carry a consecutive serial number unique for the financial year.', { field: 'invoiceNo', citation: 'Rule 46(b)', itcAtRisk: itc, fix: 'Ask the supplier for a corrected invoice with a serial number.' }));
  } else {
    if (inv.invoiceNo.length > 16) out.push(f('R46-NUM-LEN', 'high', 'mandatory-fields', 'Invoice number longer than 16 characters', `"${inv.invoiceNo}" has ${inv.invoiceNo.length} characters. GSTR-1 and the IRP reject numbers over 16 characters, so this invoice may never reach your GSTR-2B as printed.`, { field: 'invoiceNo', citation: 'Rule 46(b)', fix: 'Supplier should re-issue with a number of 16 characters or fewer.' }));
    if (/[^A-Za-z0-9/-]/.test(inv.invoiceNo)) out.push(f('R46-NUM-CHARS', 'medium', 'mandatory-fields', 'Invoice number has characters GST does not allow', `Only letters, digits, "-" and "/" are allowed. "${inv.invoiceNo}" contains others.`, { field: 'invoiceNo', citation: 'Rule 46(b)' }));
  }
  if (!inv.invoiceDate) {
    out.push(f('R46-DATE', 'critical', 'mandatory-fields', 'Invoice date missing', 'The date of issue is a mandatory particular and decides the period and the ITC time limit.', { field: 'invoiceDate', citation: 'Rule 46(c)', itcAtRisk: itc }));
  } else if (inv.invoiceDate > ctx.asOf) {
    out.push(f('R46-DATE-FUTURE', 'high', 'mandatory-fields', 'Invoice dated in the future', `Dated ${inv.invoiceDate}, after the check date ${ctx.asOf}. ITC cannot be claimed before the invoice date.`, { field: 'invoiceDate', citation: 'Sec 16(2)', itcAtRisk: itc }));
  }
  if (!inv.supplier.name) out.push(f('R46-SUP-NAME', 'medium', 'mandatory-fields', 'Supplier name missing', 'Name of the supplier is a mandatory particular.', { field: 'supplier.name', citation: 'Rule 46(a)' }));
  if (!inv.supplier.address && !isStructured) out.push(f('R46-SUP-ADDR', 'low', 'mandatory-fields', 'Supplier address missing', 'Address of the supplier is a mandatory particular.', { field: 'supplier.address', citation: 'Rule 46(a)' }));

  // ---------------------------------------------------------------- supplier GSTIN
  if (!inv.supplier.gstin) {
    out.push(f('GSTIN-SUP-MISSING', 'critical', 'gstin', 'Supplier GSTIN missing', 'Without the supplier GSTIN the invoice cannot be matched to GSTR-2B and ITC is not available.', { field: 'supplier.gstin', citation: 'Rule 46(a); Sec 16(2)(aa)', itcAtRisk: itc, fix: 'Obtain a corrected invoice showing the supplier GSTIN.' }));
  } else {
    const g = checkGstin(inv.supplier.gstin);
    if (!g.valid) {
      out.push(f('GSTIN-SUP-INVALID', 'critical', 'gstin', g.formatOk && g.stateOk ? 'Supplier GSTIN fails checksum' : 'Supplier GSTIN is malformed', `${g.gstin}: ${g.problems.join(' ')}`, { field: 'supplier.gstin', citation: 'Rule 46(a)', itcAtRisk: itc, fix: 'Confirm the GSTIN with the supplier and get the invoice corrected. Until then the ITC will not match GSTR-2B.' }));
    } else {
      const reg = lookupRegistry(g.gstin);
      if (reg?.status === 'Cancelled' && inv.invoiceDate && reg.cancelledOn && inv.invoiceDate >= reg.cancelledOn) {
        out.push(f('GSTIN-SUP-CANCELLED', 'critical', 'gstin', 'Supplier registration was cancelled before this invoice', `${reg.legalName} was cancelled on ${reg.cancelledOn}; the invoice is dated ${inv.invoiceDate}. A person without valid registration cannot issue a tax invoice or collect GST.`, { field: 'supplier.gstin', citation: 'Sec 16(2)(c); Sec 31', itcAtRisk: itc, fix: 'Do not claim ITC. Recover the GST charged from the supplier and verify the transaction.' }));
      } else if (reg?.status === 'Suspended') {
        out.push(f('GSTIN-SUP-SUSPENDED', 'high', 'gstin', 'Supplier registration is suspended', 'Invoices from a suspended registration are not reflected for ITC.', { field: 'supplier.gstin', citation: 'Rule 21A', itcAtRisk: itc }));
      }
      if (reg && inv.invoiceDate && daysBetween(reg.registeredOn, inv.invoiceDate) < 180 && inv.grandTotal > 100000) {
        out.push(f('FRAUD-NEW-REG', 'medium', 'fraud-signal', 'High-value invoice from a newly registered supplier', `Registered on ${reg.registeredOn}, ${daysBetween(reg.registeredOn, inv.invoiceDate)} days before this ${formatINR(inv.grandTotal)} invoice. New registrations are a common pattern in fake-invoice cases.`, { field: 'supplier.gstin', fix: 'Verify goods receipt, e-way bill and the supplier’s place of business before claiming.' }));
      }
      if (inv.supplier.name && g.entityType && g.pan[3] !== 'P') {
        const initial = inv.supplier.name.toUpperCase().replace(/^(M\/S\.?\s+|THE\s+)/, '').trim()[0];
        if (initial && /[A-Z]/.test(initial) && initial !== g.pan[4]) {
          out.push(f('GSTIN-PAN-NAME', 'low', 'gstin', 'GSTIN may belong to a different business', `For a ${g.entityType.toLowerCase()}, the 5th character of the PAN is usually the first letter of its name. The PAN in this GSTIN has "${g.pan[4]}" but the supplier name starts with "${initial}".`, { field: 'supplier.gstin' }));
        }
      }
      if (inv.supplier.gstin === company.gstin) {
        out.push(f('GSTIN-SELF', 'critical', 'gstin', 'Supplier GSTIN is your own GSTIN', 'The supplier and recipient GSTIN are the same. This is usually a data-entry mix-up.', { field: 'supplier.gstin', itcAtRisk: itc }));
      }
    }
  }

  // ---------------------------------------------------------------- recipient GSTIN
  if (!inv.buyer.gstin && !isStructured) {
    out.push(f('R46-BUYER-GSTIN', 'critical', 'mandatory-fields', 'Your GSTIN is not on the invoice', 'A B2B tax invoice must show the recipient’s GSTIN. Without it the supply is reported as B2C and never appears in your GSTR-2B.', { field: 'buyer.gstin', citation: 'Rule 46(e); Sec 16(2)(aa)', itcAtRisk: itc, fix: `Ask the supplier to amend the invoice to show ${company.gstin} and report it as B2B in GSTR-1/1A.` }));
  } else if (inv.buyer.gstin && inv.buyer.gstin !== company.gstin) {
    const g = checkGstin(inv.buyer.gstin);
    out.push(f('R46-BUYER-OTHER', 'critical', 'mandatory-fields', 'Invoice is billed to a different GSTIN', `Billed to ${g.gstin}${g.stateName ? ` (${g.stateName})` : ''}, not your registration ${company.gstin}. The credit will flow to that GSTIN, not yours.`, { field: 'buyer.gstin', citation: 'Rule 46(e)', itcAtRisk: itc, fix: 'Get a corrected invoice in the name of the right registration.' }));
  } else if (inv.buyer.name && company.name && nameSimilarity(inv.buyer.name, company.name) < 0.75 && !isStructured) {
    out.push(f('R46-BUYER-NAME', 'low', 'mandatory-fields', 'Recipient name differs from your registered name', `Invoice shows "${inv.buyer.name}".`, { field: 'buyer.name', citation: 'Rule 46(e)' }));
  }

  // ---------------------------------------------------------------- HSN, rates, signature
  const missingHsn = inv.items.filter((it) => !it.hsn);
  if (missingHsn.length && !isStructured) {
    out.push(f('R46-HSN', 'medium', 'mandatory-fields', missingHsn.length === inv.items.length ? 'HSN/SAC codes missing' : `HSN/SAC missing on ${missingHsn.length} line${missingHsn.length > 1 ? 's' : ''}`, 'B2B invoices must show HSN: 4 digits if the supplier’s turnover is up to ₹5 Cr, 6 digits above that. Missing HSN also breaks Table 12 of GSTR-1.', { field: 'items.hsn', citation: 'Rule 46(g); Notification 78/2020-CT', fix: 'Ask the supplier to show HSN/SAC for every line.' }));
  }
  const shortHsn = inv.items.filter((it) => it.hsn && it.hsn.replace(/\D/g, '').length < 4);
  if (shortHsn.length) out.push(f('R46-HSN-SHORT', 'medium', 'mandatory-fields', 'HSN/SAC shorter than 4 digits', `Codes ${shortHsn.map((i) => i.hsn).join(', ')} are too short to classify the supply.`, { field: 'items.hsn', citation: 'Notification 78/2020-CT' }));

  if (inv.hasSignature === false && !inv.irn && !isStructured) {
    out.push(f('R46-SIGN', 'low', 'mandatory-fields', 'No signature or digital signature', 'A tax invoice must be signed by the supplier or an authorised representative (not needed for e-invoices).', { field: 'signature', citation: 'Rule 46(q)' }));
  }

  // place of supply
  const supState = inv.supplier.gstin?.slice(0, 2) ?? inv.supplier.stateCode ?? null;
  const pos = inv.placeOfSupply;
  const taxedIgst = inv.igstTotal > 0.5;
  const taxedLocal = inv.cgstTotal + inv.sgstTotal > 0.5;
  if (!pos && !isStructured) {
    if (taxedIgst) out.push(f('R46-POS', 'medium', 'place-of-supply', 'Place of supply not stated', 'Inter-state invoices must state the place of supply with the state name.', { field: 'placeOfSupply', citation: 'Rule 46(n)' }));
  }
  if (pos && pos !== company.stateCode) {
    out.push(f('POS-OTHER-STATE', 'critical', 'place-of-supply', `Place of supply is ${STATE_CODES[pos] ?? pos}, not your state`, `The invoice treats the supply as made in ${stateLabel(pos)} while your registration is in ${stateLabel(company.stateCode)}. ITC on it cannot be taken against this GSTIN; GSTR-2B will mark it ineligible (reason "P").`, { field: 'placeOfSupply', citation: 'Sec 16(2)(b); Sec 10 IGST Act', itcAtRisk: itc, fix: `Ask the supplier to cancel and re-issue with place of supply ${stateLabel(company.stateCode)}, charging IGST.` }));
  }
  const effectivePos = pos ?? company.stateCode;
  if (supState && effectivePos) {
    const intra = supState === effectivePos;
    if (intra && taxedIgst) {
      out.push(f('TAX-HEAD-IGST', 'critical', 'tax-math', 'IGST charged on an intra-state supply', `Supplier (${stateLabel(supState)}) and place of supply (${stateLabel(effectivePos)}) are in the same state, so CGST + SGST applies. IGST paid under the wrong head cannot be used; the supplier must pay the right tax and claim a refund of the IGST.`, { field: 'igstTotal', citation: 'Sec 8 IGST Act; Sec 77 CGST Act', itcAtRisk: itc, fix: 'Reject in IMS and ask for a credit note plus a fresh invoice with CGST and SGST.' }));
    } else if (!intra && taxedLocal) {
      out.push(f('TAX-HEAD-LOCAL', 'critical', 'tax-math', 'CGST + SGST charged on an inter-state supply', `Supplier is in ${stateLabel(supState)} and the place of supply is ${stateLabel(effectivePos)}, so IGST applies.`, { field: 'cgstTotal', citation: 'Sec 7 IGST Act; Sec 77 CGST Act', itcAtRisk: itc, fix: 'Reject in IMS and ask the supplier to re-issue with IGST.' }));
    }
  }

  // ---------------------------------------------------------------- rates and arithmetic
  let excessTax = 0;
  inv.items.forEach((it, idx) => {
    const n = idx + 1;
    const lineTax = it.cgst + it.sgst + it.igst;
    if (it.gstRate != null && !VALID_RATES.includes(it.gstRate)) {
      out.push(f('RATE-INVALID', 'high', 'rate', `Line ${n}: ${it.gstRate}% is not a GST rate`, `GST rates are 0, 0.25, 3, 5, 18 and 40% (plus special rates). Check the rate for "${it.description}".`, { field: `items.${idx}.gstRate`, citation: 'Notification 9/2025-CT (Rate)' }));
    }
    const ref = hsnReference(it.hsn);
    if (it.gstRate != null && ref && ref.rate !== it.gstRate) {
      const correctTax = round2(it.taxableValue * ref.rate / 100);
      const delta = round2(lineTax - correctTax);
      if (delta > 0) excessTax += delta;
      const legacy = inv.invoiceDate && inv.invoiceDate >= GST_REFORM_DATE && ref.previous === it.gstRate;
      out.push(f(legacy ? 'RATE-LEGACY' : 'RATE-HSN', 'high', 'rate', legacy ? `Line ${n}: old ${it.gstRate}% rate used after GST 2.0` : `Line ${n}: rate differs from HSN ${ref.code}`, legacy
        ? `${ref.label} (HSN ${ref.code}) moved from ${ref.previous}% to ${ref.rate}% on 22 Sep 2025. This invoice still charges ${it.gstRate}%, overcharging ${formatINR(delta)} in tax.`
        : `HSN ${ref.code} (${ref.label}) is taxed at ${ref.rate}%, but the invoice charges ${it.gstRate}%. Difference: ${formatINR(Math.abs(delta))}.`,
        { field: `items.${idx}.gstRate`, citation: 'Notification 9/2025-CT (Rate)', itcAtRisk: Math.max(0, delta), fix: delta > 0 ? `Ask for a credit note of ${formatINR(delta)}. Excess tax charged at a wrong rate is open to dispute as ITC.` : 'Supplier has under-charged tax; expect a debit note.' }));
    } else if (it.gstRate != null && LEGACY_RATES.includes(it.gstRate) && inv.invoiceDate && inv.invoiceDate >= GST_REFORM_DATE) {
      out.push(f('RATE-LEGACY-UNKNOWN', 'medium', 'rate', `Line ${n}: ${it.gstRate}% slab after GST 2.0`, `Most goods in the ${it.gstRate}% slab moved to 5%, 18% or 40% from 22 Sep 2025. Confirm the current rate for HSN ${it.hsn ?? '(none)'}.`, { field: `items.${idx}.gstRate`, citation: 'Notification 9/2025-CT (Rate)' }));
    }

    if (it.qty != null && it.unitPrice != null && it.qty > 0) {
      const expected = round2(it.qty * it.unitPrice);
      if (Math.abs(expected - it.taxableValue) > Math.max(1, expected * 0.002)) {
        const overTax = it.gstRate != null && it.taxableValue > expected ? round2((it.taxableValue - expected) * it.gstRate / 100) : 0;
        out.push(f('MATH-LINE-VALUE', 'high', 'tax-math', `Line ${n}: taxable value ≠ quantity × rate`, `${it.qty} × ${formatINR(it.unitPrice)} = ${formatINR(expected)}, but the invoice shows ${formatINR(it.taxableValue)} (${it.taxableValue > expected ? 'over' : 'under'} by ${formatINR(Math.abs(it.taxableValue - expected))}).`, { field: `items.${idx}.taxableValue`, itcAtRisk: overTax, fix: 'Ask the supplier for a credit note or a corrected invoice.' }));
      }
    }
    if (it.gstRate != null) {
      const expectedTax = round2(it.taxableValue * it.gstRate / 100);
      if (Math.abs(expectedTax - lineTax) > 1) {
        const over = round2(lineTax - expectedTax);
        if (over > 0) excessTax += over;
        out.push(f('MATH-LINE-TAX', 'high', 'tax-math', `Line ${n}: tax does not equal ${it.gstRate}% of taxable value`, `${it.gstRate}% of ${formatINR(it.taxableValue)} is ${formatINR(expectedTax)}; the invoice charges ${formatINR(lineTax)}.`, { field: `items.${idx}.tax`, itcAtRisk: Math.max(0, over), fix: 'Claim only the correctly computed tax.' }));
      }
    }
    if (Math.abs(it.cgst - it.sgst) > 0.5) {
      out.push(f('MATH-CGST-SGST', 'high', 'tax-math', `Line ${n}: CGST and SGST are unequal`, `CGST ${formatINR(it.cgst)} vs SGST ${formatINR(it.sgst)}. Each is always half of the intra-state rate.`, { field: `items.${idx}.cgst` }));
    }
  });

  if (inv.items.length) {
    const sumTaxable = round2(inv.items.reduce((s, i) => s + i.taxableValue, 0));
    if (Math.abs(sumTaxable - inv.taxableTotal) > 1) out.push(f('MATH-TOTAL-TAXABLE', 'medium', 'tax-math', 'Line items do not add up to the taxable total', `Lines sum to ${formatINR(sumTaxable)}; the total shows ${formatINR(inv.taxableTotal)}.`, { field: 'taxableTotal' }));
  }
  const computed = round2(inv.taxableTotal + inv.cgstTotal + inv.sgstTotal + inv.igstTotal + inv.cessTotal + inv.roundOff);
  if (inv.grandTotal && Math.abs(computed - inv.grandTotal) > 1) {
    out.push(f('MATH-GRAND', 'medium', 'tax-math', 'Invoice total does not reconcile', `Taxable + tax + round-off = ${formatINR(computed)}, but the invoice total is ${formatINR(inv.grandTotal)}.`, { field: 'grandTotal' }));
  }
  if (Math.abs(inv.roundOff) > 1) out.push(f('MATH-ROUNDOFF', 'low', 'tax-math', 'Round-off above ₹1', `Round-off of ${formatINR(inv.roundOff)} is larger than rounding to the nearest rupee allows.`, { field: 'roundOff' }));

  // ---------------------------------------------------------------- ITC eligibility
  const blockedHits = new Map<string, { clause: string; label: string; lines: number[] }>();
  inv.items.forEach((it, idx) => {
    for (const b of BLOCKED_CREDIT) {
      if (b.re.test(it.description) || (b.hsn && it.hsn && b.hsn.test(it.hsn))) {
        const hit = blockedHits.get(b.id) ?? { clause: b.clause, label: b.label, lines: [] };
        hit.lines.push(idx);
        blockedHits.set(b.id, hit);
        break;
      }
    }
  });
  for (const hit of blockedHits.values()) {
    const tax = round2(hit.lines.reduce((s, i) => s + inv.items[i].cgst + inv.items[i].sgst + inv.items[i].igst + inv.items[i].cess, 0));
    out.push(f('ITC-BLOCKED', 'high', 'itc-eligibility', `Blocked credit: ${hit.label.toLowerCase()}`, `${hit.lines.length === inv.items.length ? 'All lines fall' : `Line ${hit.lines.map((i) => i + 1).join(', ')} falls`} under ${hit.clause}. The tax of ${formatINR(tax)} is not available as ITC unless you supply the same category onward or it is legally required for employees.`, { field: `items.${hit.lines[0]}.description`, citation: hit.clause, itcAtRisk: tax, fix: 'Accept in IMS, then report this amount as ineligible ITC in GSTR-3B Table 4(B)(1).' }));
  }

  if (inv.invoiceDate) {
    const deadline = itcDeadline(inv.invoiceDate);
    const left = daysBetween(ctx.asOf, deadline);
    if (left < 0) {
      out.push(f('ITC-TIME-BARRED', 'critical', 'itc-eligibility', 'ITC time limit has passed', `For an invoice dated ${inv.invoiceDate}, ITC had to be claimed by ${deadline}. Credit claimed now will be disallowed.`, { field: 'invoiceDate', citation: 'Sec 16(4)', itcAtRisk: itc, fix: 'Do not claim. Expense the tax in the books.' }));
    } else if (left <= 60) {
      out.push(f('ITC-TIME-SOON', 'medium', 'itc-eligibility', `ITC must be claimed within ${left} days`, `Last date under Sec 16(4) is ${deadline}.`, { field: 'invoiceDate', citation: 'Sec 16(4)' }));
    }
    if (inv.paymentStatus === 'unpaid') {
      const age = daysBetween(inv.invoiceDate, ctx.asOf);
      if (age > 180) out.push(f('ITC-180-DAYS', 'high', 'itc-eligibility', `Unpaid for ${age} days`, 'ITC must be reversed, with interest, if the supplier is not paid within 180 days of the invoice date. It can be re-claimed once paid.', { field: 'paymentStatus', citation: 'Sec 16(2) second proviso; Rule 37', itcAtRisk: itc, fix: 'Pay the supplier or reverse the ITC in GSTR-3B Table 4(B)(2).' }));
      else if (age > 150) out.push(f('ITC-180-SOON', 'medium', 'itc-eligibility', `Payment due within ${180 - age} days to keep ITC`, 'ITC is reversed if the supplier remains unpaid at 180 days.', { field: 'paymentStatus', citation: 'Rule 37' }));
    }
  }

  // ---------------------------------------------------------------- e-invoicing
  const reg = lookupRegistry(inv.supplier.gstin);
  if (reg?.einvoiceMandated && !inv.irn && !isStructured) {
    out.push(f('EINV-MISSING-IRN', 'critical', 'e-invoice', 'No IRN from an e-invoice-mandated supplier', `${reg.tradeName} is required to e-invoice B2B supplies. An invoice without an IRN and QR code is not a valid tax invoice, so ITC on it is not available.`, { field: 'irn', citation: 'Rule 48(4), 48(5)', itcAtRisk: itc, fix: 'Ask the supplier to report it on the IRP and send the IRN-stamped copy.' }));
  }
  if (inv.qr) {
    const q = inv.qr;
    if (q.found && q.signature === 'invalid') {
      out.push(f('EINV-QR-FORGED', 'critical', 'e-invoice', 'QR code signature is not genuine', 'The QR code claims to be signed by the Invoice Registration Portal, but the signature does not verify. The QR may be forged.', { field: 'qr', citation: 'Rule 48(4)', itcAtRisk: itc, fix: 'Verify the IRN on the e-invoice portal before accepting this invoice.' }));
    } else if (q.found && q.payload && (q.signature === 'valid' || q.signature === 'unknown-key')) {
      const p = q.payload;
      const diffs: string[] = [];
      if (p.SellerGstin && inv.supplier.gstin && p.SellerGstin !== inv.supplier.gstin) diffs.push(`supplier GSTIN ${inv.supplier.gstin} vs ${p.SellerGstin}`);
      if (p.BuyerGstin && inv.buyer.gstin && p.BuyerGstin !== inv.buyer.gstin) diffs.push(`buyer GSTIN ${inv.buyer.gstin} vs ${p.BuyerGstin}`);
      if (p.DocNo && inv.invoiceNo && p.DocNo !== inv.invoiceNo) diffs.push(`invoice number ${inv.invoiceNo} vs ${p.DocNo}`);
      const qd = p.DocDt ? p.DocDt.split('/').reverse().join('-') : null;
      if (qd && inv.invoiceDate && qd !== inv.invoiceDate) diffs.push(`date ${inv.invoiceDate} vs ${qd}`);
      if (p.TotInvVal != null && Math.abs(p.TotInvVal - inv.grandTotal) > 1) diffs.push(`total ${formatINR(inv.grandTotal)} printed vs ${formatINR(p.TotInvVal)} signed`);
      if (p.Irn && inv.irn && p.Irn.toLowerCase() !== inv.irn.toLowerCase()) diffs.push('IRN differs');
      if (diffs.length) {
        const partial = p.TotInvVal != null && p.TotInvVal < inv.grandTotal && diffs.length === 1 ? round2(itc * (1 - p.TotInvVal / inv.grandTotal)) : itc;
        out.push(f('EINV-QR-MISMATCH', 'critical', 'e-invoice', 'Printed invoice does not match its signed e-invoice QR', `The QR code was signed by the portal when the invoice was registered. The printed copy now differs: ${diffs.join('; ')}. The document was changed after registration.`, { field: 'grandTotal', citation: 'Rule 48(4), 48(5)', itcAtRisk: partial, fix: 'Claim only what the registered e-invoice supports and ask the supplier to explain the difference.' }));
      }
      if (q.signature === 'unknown-key') out.push(f('EINV-QR-KEY', 'low', 'e-invoice', 'QR signature not checked', 'The QR is signed with a key Parakh does not have, so only its contents were compared.', { field: 'qr' }));
    } else if (!q.found && inv.irn) {
      out.push(f('EINV-QR-MISSING', 'medium', 'e-invoice', 'IRN printed but no readable QR code', 'An e-invoice must carry the signed QR code. None could be read on this document.', { field: 'irn', citation: 'Rule 48(4)', fix: 'Ask for the copy downloaded from the IRP, which carries the QR code.' }));
    }
  }
  if (inv.irn && !/^[0-9a-f]{64}$/i.test(inv.irn)) {
    out.push(f('EINV-IRN-FORMAT', 'medium', 'e-invoice', 'IRN is not a valid 64-character hash', `"${inv.irn.slice(0, 24)}…" should be a 64-character hexadecimal IRN.`, { field: 'irn', citation: 'Rule 48(4)' }));
  }

  // ---------------------------------------------------------------- duplicates and fraud signals
  const key = `${inv.supplier.gstin ?? inv.supplier.name}|${canonicalInvoiceNo(inv.invoiceNo)}`;
  const firstSame = ctx.all.find((o) => o !== inv && `${o.supplier.gstin ?? o.supplier.name}|${canonicalInvoiceNo(o.invoiceNo)}` === key);
  if (inv.invoiceNo && firstSame && ctx.all.indexOf(firstSame) < ctx.all.indexOf(inv)) {
    out.push(f('DUP-EXACT', 'critical', 'fraud-signal', 'Duplicate of an invoice already in this batch', `Same supplier and invoice number as ${firstSame.source.fileName}. Booking both would claim ${formatINR(itc)} of ITC twice.`, { field: 'invoiceNo', citation: 'Sec 16(2)', itcAtRisk: itc, fix: 'Remove the duplicate from the purchase register.' }));
  } else if (inv.invoiceNo && inv.invoiceDate) {
    const near = ctx.all.find((o) => o !== inv && o.supplier.gstin && o.supplier.gstin === inv.supplier.gstin && canonicalInvoiceNo(o.invoiceNo) !== canonicalInvoiceNo(inv.invoiceNo) && Math.abs(o.grandTotal - inv.grandTotal) < 1 && o.invoiceDate && Math.abs(daysBetween(o.invoiceDate, inv.invoiceDate!)) <= 7);
    if (near && ctx.all.indexOf(near) < ctx.all.indexOf(inv)) {
      out.push(f('DUP-NEAR', 'medium', 'fraud-signal', 'Possible duplicate with a different number', `Same supplier and the same amount (${formatINR(inv.grandTotal)}) as ${near.invoiceNo}, within a week.`, { field: 'invoiceNo' }));
    }
  }

  void excessTax;
  return out;
}

// Core domain model for Parakh. Everything the engine produces is derived from these shapes.

export type StateCode = string; // two-digit GST state code, e.g. "36"

export interface Party {
  name: string;
  gstin: string | null;
  address?: string;
  stateCode?: StateCode | null;
}

export interface LineItem {
  description: string;
  hsn: string | null;
  qty: number | null;
  unit?: string | null;
  unitPrice: number | null;
  taxableValue: number;
  gstRate: number | null;
  cgst: number;
  sgst: number;
  igst: number;
  cess: number;
  /** Amount printed on the invoice for this line, if any. */
  lineTotal?: number | null;
}

export interface QrPayload {
  SellerGstin?: string; BuyerGstin?: string; DocNo?: string; DocTyp?: string; DocDt?: string;
  TotInvVal?: number; ItemCnt?: number; MainHsnCode?: string; Irn?: string; IrnDt?: string;
}

/** Result of reading and verifying the e-invoice QR code printed on a document. */
export interface QrCheck {
  found: boolean;
  signature: 'valid' | 'invalid' | 'unknown-key' | 'not-signed';
  keyLabel?: string;
  payload?: QrPayload;
}

export type SourceKind = 'pdf' | 'image' | 'register' | 'json';
export type ExtractionMethod = 'text-layer' | 'ai-vision' | 'structured' | 'reference' | 'pending';

/** A rectangle on a rendered page, in PDF user-space units (origin top-left after conversion). */
export interface Box {
  page: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Invoice {
  id: string;
  source: {
    kind: SourceKind;
    fileName: string;
    /** Original upload; present for pdf and image sources. */
    file?: Blob;
    row?: number;
  };
  extraction: {
    method: ExtractionMethod;
    confidence: number; // 0..1, overall
    fieldConfidence?: Record<string, number>;
    boxes?: Record<string, Box>;
    pageSize?: { w: number; h: number };
    note?: string;
    model?: string;
    /** Set when a person has checked (and possibly corrected) the extracted fields. */
    reviewed?: { at: string; edited: string[] };
  };
  /** E-invoice QR verification, when a QR was looked for. */
  qr?: QrCheck;
  invoiceNo: string | null;
  invoiceDate: string | null; // ISO yyyy-mm-dd
  supplier: Party;
  buyer: Party;
  placeOfSupply: StateCode | null;
  reverseCharge: boolean | null;
  irn: string | null;
  hasSignature: boolean | null;
  items: LineItem[];
  taxableTotal: number;
  cgstTotal: number;
  sgstTotal: number;
  igstTotal: number;
  cessTotal: number;
  roundOff: number;
  grandTotal: number;
  /** Books-only metadata (from a purchase register). */
  paymentStatus?: 'paid' | 'unpaid' | null;
}

export interface PortalRecord {
  id: string;
  ctin: string;
  tradeName: string;
  supplierFiledOn: string | null; // ISO
  supplierPeriod: string | null; // MMYYYY
  invoiceNo: string;
  invoiceDate: string; // ISO
  invoiceValue: number;
  placeOfSupply: StateCode;
  reverseCharge: boolean;
  itcAvailable: boolean;
  itcReason: string | null;
  source: string | null; // e-Invoice etc.
  irn: string | null;
  taxable: number;
  igst: number;
  cgst: number;
  sgst: number;
  cess: number;
  rates: number[];
}

export interface Company {
  name: string;
  gstin: string;
  stateCode: StateCode;
  address?: string;
}

export type Severity = 'critical' | 'high' | 'medium' | 'low';

export type FindingCategory =
  | 'mandatory-fields'
  | 'gstin'
  | 'tax-math'
  | 'place-of-supply'
  | 'rate'
  | 'itc-eligibility'
  | 'reconciliation'
  | 'fraud-signal'
  | 'e-invoice';

export interface Finding {
  id: string;
  invoiceId: string;
  ruleId: string;
  severity: Severity;
  category: FindingCategory;
  title: string;
  detail: string;
  /** Field path that the finding points at, used to highlight the document. */
  field?: string;
  citation?: string;
  fix?: string;
  /** Input tax credit that is at risk because of this finding, in rupees. */
  itcAtRisk: number;
  source: 'rule' | 'ai';
}

export type ReconStatus = 'matched' | 'suggested' | 'mismatch' | 'missing-in-2b' | 'missing-in-books';

export interface FieldDiff {
  field: string;
  label: string;
  books: string | number | null;
  portal: string | number | null;
}

export interface ReconRow {
  id: string;
  status: ReconStatus;
  invoiceId?: string;
  portalId?: string;
  confidence: number; // 0..1
  diffs: FieldDiff[];
  reasons: string[];
}

export type ImsAction = 'accept' | 'pending' | 'reject' | 'n/a';

export interface InvoiceVerdict {
  invoiceId: string;
  risk: number; // 0..100
  band: 'clear' | 'review' | 'high';
  itcClaimed: number;
  itcAtRisk: number;
  ims: ImsAction;
  imsReason: string;
}

export interface VendorScore {
  gstin: string;
  name: string;
  invoices: number;
  findings: number;
  critical: number;
  itcAtRisk: number;
  itcTotal: number;
  score: number; // 0..100, higher is better
  missingIn2b: number;
  lastFiled: string | null;
  registry?: RegistryEntry | null;
}

export interface RegistryEntry {
  gstin: string;
  legalName: string;
  tradeName: string;
  status: 'Active' | 'Cancelled' | 'Suspended';
  registeredOn: string;
  cancelledOn?: string;
  constitution: string;
  einvoiceMandated: boolean;
  filing: 'Monthly' | 'Quarterly (QRMP)';
}

export interface Analysis {
  company: Company;
  period: string; // yyyy-mm
  asOf: string; // ISO date the checks were evaluated against
  invoices: Invoice[];
  portal: PortalRecord[];
  findings: Finding[];
  recon: ReconRow[];
  verdicts: Record<string, InvoiceVerdict>;
  vendors: VendorScore[];
  totals: {
    invoices: number;
    itcClaimed: number;
    itcAtRisk: number;
    itcSafe: number;
    matchRate: number;
    byCategory: Record<FindingCategory, { count: number; itc: number }>;
    bySeverity: Record<Severity, number>;
    recon: Record<ReconStatus, number>;
    ims: Record<ImsAction, number>;
    portalOnlyTax: number;
  };
}

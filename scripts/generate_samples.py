"""
Generates the Parakh demo pack:
  public/samples/invoices/*.pdf|.jpg   purchase invoices with planted compliance issues
  public/samples/gstr2b_092026.json     GSTR-2B in the GST portal's JSON shape
  public/samples/purchase_register.csv  books (Tally-style export) for routine invoices
  public/samples/manifest.json          list of files the app loads for the sample workspace

Every GSTIN below carries a valid checksum unless the scenario says otherwise.
Run:  python3 scripts/generate_samples.py
"""
import csv, json, os, random, io
from datetime import date
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas
from reportlab.lib.units import mm
from reportlab.lib import colors

ROOT = os.path.join(os.path.dirname(__file__), "..", "public", "samples")
INV_DIR = os.path.join(ROOT, "invoices")
os.makedirs(INV_DIR, exist_ok=True)

C36 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"


def gstin(prefix14: str) -> str:
    s = 0
    for i, ch in enumerate(prefix14):
        p = C36.index(ch) * (1 if i % 2 == 0 else 2)
        s += p // 36 + p % 36
    return prefix14 + C36[(36 - s % 36) % 36]


STATES = {"36": "Telangana", "27": "Maharashtra", "33": "Tamil Nadu", "29": "Karnataka", "37": "Andhra Pradesh"}

BUYER = {
    "name": "Sri Venkateswara Precision Components Pvt Ltd",
    "addr": ["Plot 14, KUDA Industrial Estate, Madikonda", "Hanamkonda, Telangana 506003"],
    "gstin": gstin("36AAKCS4821M1Z"),
    "state": "36",
}

S = {
    "deccan": dict(name="Deccan Steel Traders", addr=["8-2-41, Industrial Area, Balanagar", "Hyderabad, Telangana 500037"], gstin=gstin("36AAHFD7712K1Z"), state="36", prefix="DST"),
    "pune": dict(name="Pune Toolcraft Industries Pvt Ltd", addr=["Gat No. 112, Chakan MIDC Phase II", "Pune, Maharashtra 410501"], gstin=gstin("27AAFCP3391Q1Z"), state="27", prefix="PTI"),
    "kakatiya": dict(name="Kakatiya Packaging Solutions", addr=["H.No 2-5-118, Mulugu Road", "Warangal, Telangana 506002"], gstin=gstin("36ABDFK5520H1Z"), state="36", prefix="KPS"),
    "godavari": dict(name="Godavari Electricals", addr=["Shop 4, Mukarampura Main Road", "Karimnagar, Telangana 505001"], gstin=gstin("36AGPFG1184C1Z"), state="36", prefix="GE"),
    "nizam": dict(name="Nizam Hydraulics", addr=["Plot 77, IDA Cherlapally", "Hyderabad, Telangana 500051"], gstin=gstin("36AAJFN2245E1Z"), state="36", prefix="NH"),
    "chennai": dict(name="Chennai Bearings Co. Pvt Ltd", addr=["21, SIDCO Industrial Estate, Ambattur", "Chennai, Tamil Nadu 600098"], gstin=gstin("33AABCC8834L1Z"), state="33", prefix="CBC"),
    "svt": dict(name="Sree Vinayaka Tools", addr=["1-8-303, Station Road, Kazipet", "Hanamkonda, Telangana 506003"], gstin=gstin("36AAQFS9012B1Z"), state="36", prefix="SVT"),
    "coolair": dict(name="Coolair Systems", addr=["6-3-1090, Raj Bhavan Road, Somajiguda", "Hyderabad, Telangana 500082"], gstin=gstin("36AAKFC4471N1Z"), state="36", prefix="CAS"),
    "paradise": dict(name="Paradise Caterers", addr=["Nayeem Nagar Main Road", "Hanamkonda, Telangana 506001"], gstin=gstin("36ADVPR3328G1Z"), state="36", prefix="PC"),
    "laxmi": dict(name="Laxmi Hardware Stores", addr=["Beat Bazar, Main Road", "Warangal, Telangana 506002"], gstin=gstin("36AFGPL7765D1Z"), state="36", prefix="LHS"),
    "bharat": dict(name="Bharat Abrasives", addr=["Plot 9, Phase I, IDA Jeedimetla", "Hyderabad, Telangana 500055"], gstin=gstin("36AACFB5519J1Z"), state="36", prefix="BA"),
    "blr": dict(name="Bengaluru Fasteners Pvt Ltd", addr=["No. 44, 2nd Stage, Peenya Industrial Area", "Bengaluru, Karnataka 560058"], gstin=gstin("29AAECB6672P1Z"), state="29", prefix="BFL"),
    "orugallu": dict(name="Orugallu Engineering Works", addr=["Survey 210, Hunter Road", "Warangal, Telangana 506001"], gstin=gstin("36AAOFO3341K1Z"), state="36", prefix="OEW"),
    "tlc": dict(name="Telangana Lubricants & Chemicals Pvt Ltd", addr=["Plot 3, Pashamylaram Industrial Park", "Sangareddy, Telangana 502307"], gstin=gstin("36AAGCT8890F1Z"), state="36", prefix="TLC"),
    "krishna": dict(name="Krishna Traders", addr=["Main Road, Governorpet", "Vijayawada, Andhra Pradesh 520002"], gstin=gstin("37AAZFK1203M1Z"), state="37", prefix="KT"),
    "telenet": dict(name="TeleNet Broadband Services", addr=["Plot 31, Hitec City", "Hyderabad, Telangana 500081"], gstin=gstin("36AAICT2290R1Z"), state="36", prefix="TNB"),
}


def r2(x):
    return round(x + 1e-9, 2)


def build(sup, inv_no, dt, items, pos=None, igst=None, extra=None):
    """items: (desc, hsn, qty, unit, rate, gst_rate)"""
    pos = pos or BUYER["state"]
    inter = sup["state"] != pos if igst is None else igst
    lines = []
    for desc, hsn, qty, unit, rate, gr in items:
        tx = r2(qty * rate)
        t = r2(tx * gr / 100)
        line = dict(desc=desc, hsn=hsn, qty=qty, unit=unit, rate=rate, taxable=tx, gst=gr,
                    igst=t if inter else 0.0, cgst=0.0 if inter else r2(t / 2), sgst=0.0 if inter else r2(t / 2))
        lines.append(line)
    inv = dict(sup=sup, no=inv_no, date=dt, pos=pos, lines=lines, buyer=dict(BUYER), rc="No", irn=None, sign=True)
    if extra:
        inv.update(extra)
    totals(inv)
    return inv


def totals(inv):
    L = inv["lines"]
    inv["taxable"] = r2(sum(l["taxable"] for l in L))
    inv["cgst"] = r2(sum(l["cgst"] for l in L))
    inv["sgst"] = r2(sum(l["sgst"] for l in L))
    inv["igst"] = r2(sum(l["igst"] for l in L))
    raw = inv["taxable"] + inv["cgst"] + inv["sgst"] + inv["igst"]
    inv["total"] = float(round(raw))
    inv["roundoff"] = r2(inv["total"] - raw)


def inr(x):
    neg = x < 0
    x = abs(x)
    s = f"{x:.2f}"
    whole, frac = s.split(".")
    if len(whole) > 3:
        head, tail = whole[:-3], whole[-3:]
        parts = []
        while len(head) > 2:
            parts.insert(0, head[-2:])
            head = head[:-2]
        if head:
            parts.insert(0, head)
        whole = ",".join(parts) + "," + tail
    return ("-" if neg else "") + whole + "." + frac


ONES = "Zero One Two Three Four Five Six Seven Eight Nine Ten Eleven Twelve Thirteen Fourteen Fifteen Sixteen Seventeen Eighteen Nineteen".split()
TENS = "_ _ Twenty Thirty Forty Fifty Sixty Seventy Eighty Ninety".split()


def words(n):
    n = int(n)
    def two(x):
        return ONES[x] if x < 20 else TENS[x // 10] + ("" if x % 10 == 0 else " " + ONES[x % 10])
    def three(x):
        h, r = divmod(x, 100)
        return ((ONES[h] + " Hundred" + (" " if r else "")) if h else "") + (two(r) if r else "")
    out = []
    for div, name in ((10**7, "Crore"), (10**5, "Lakh"), (1000, "Thousand")):
        if n >= div:
            out.append(three(n // div) + " " + name)
            n %= div
    if n:
        out.append(three(n))
    return "Rupees " + " ".join(out) + " Only"


def draw_pdf(inv, path, theme):
    c = canvas.Canvas(path, pagesize=A4)
    c.setTitle(f"Tax Invoice {inv['no']}")
    W, H = A4
    x0, x1 = 14 * mm, W - 14 * mm
    acc = colors.HexColor(theme)
    sup = inv["sup"]
    y = H - 16 * mm
    c.setFillColor(acc)
    c.setFont("Helvetica-Bold", 15)
    c.drawString(x0, y, sup["name"])
    c.setFillColor(colors.black)
    c.setFont("Helvetica", 8.5)
    for a in sup["addr"]:
        y -= 4.2 * mm
        c.drawString(x0, y, a)
    y -= 4.2 * mm
    c.setFont("Helvetica-Bold", 8.5)
    c.drawString(x0, y, f"GSTIN: {inv.get('sup_gstin_print', sup['gstin'])}")
    c.setFont("Helvetica", 8.5)
    c.drawString(x0 + 62 * mm, y, f"State: {STATES[sup['state']]} ({sup['state']})")
    c.setFont("Helvetica-Bold", 13)
    c.drawRightString(x1, H - 16 * mm, "TAX INVOICE")
    c.setFont("Helvetica", 7.5)
    c.drawRightString(x1, H - 20.5 * mm, "Original for Recipient")
    y -= 5 * mm
    c.setStrokeColor(acc)
    c.setLineWidth(1.2)
    c.line(x0, y, x1, y)
    if inv.get("irn"):
        y -= 4.6 * mm
        c.setFont("Helvetica", 7)
        c.drawString(x0, y, f"IRN: {inv['irn']}")
        c.drawRightString(x1, y, f"Ack No: {inv['ack_no']}   Ack Date: {inv['date'].strftime('%d-%m-%Y')}")
        y -= 2.4 * mm

    # meta block
    y -= 6 * mm
    top = y
    c.setFont("Helvetica", 8.5)
    meta = [("Invoice No.", inv["no"]), ("Invoice Date", inv["date"].strftime("%d-%m-%Y")),
            ("Place of Supply", f"{STATES[inv['pos']]} ({inv['pos']})" if inv.get("pos_print", True) else ""),
            ("Reverse Charge", inv["rc"])]
    mx = x1 - 72 * mm
    for k, v in meta:
        if not v:
            continue
        c.setFont("Helvetica", 8.5)
        c.drawString(mx, y, f"{k}:")
        c.setFont("Helvetica-Bold", 8.5)
        c.drawString(mx + 27 * mm, y, v)
        y -= 4.6 * mm
    # bill to
    by = top
    c.setFont("Helvetica-Bold", 8)
    c.setFillColor(acc)
    c.drawString(x0, by, "BILL TO")
    c.setFillColor(colors.black)
    b = inv["buyer"]
    by -= 4.6 * mm
    c.setFont("Helvetica-Bold", 9)
    c.drawString(x0, by, b["name"])
    c.setFont("Helvetica", 8.5)
    for a in b["addr"]:
        by -= 4.2 * mm
        c.drawString(x0, by, a)
    if b.get("gstin"):
        by -= 4.2 * mm
        c.setFont("Helvetica-Bold", 8.5)
        c.drawString(x0, by, f"GSTIN: {b['gstin']}")
    by -= 4.2 * mm
    c.setFont("Helvetica", 8.5)
    c.drawString(x0, by, f"State: {STATES[b['state']]} ({b['state']})")
    y = min(y, by) - 7 * mm

    # table
    inter = any(l["igst"] for l in inv["lines"])
    cols = [("#", 6), ("Description of Goods / Services", 60), ("HSN/SAC", 16), ("Qty", 11), ("Unit", 10),
            ("Rate", 18), ("Taxable Value", 22), ("GST %", 12)]
    cols += [("IGST", 21)] if inter else [("CGST", 18), ("SGST", 18)]
    cols += [("Amount", 22)]
    total_w = sum(w for _, w in cols)
    scale = (x1 - x0) / (total_w * mm)
    xs = [x0]
    for _, w in cols:
        xs.append(xs[-1] + w * mm * scale)
    c.setFillColor(acc)
    c.rect(x0, y - 2.2 * mm, x1 - x0, 7 * mm, fill=1, stroke=0)
    c.setFillColor(colors.white)
    c.setFont("Helvetica-Bold", 7.5)
    for i, (h, _) in enumerate(cols):
        if i in (0, 1, 2, 4):
            c.drawString(xs[i] + 1.2 * mm, y, h)
        else:
            c.drawRightString(xs[i + 1] - 1.2 * mm, y, h)
    c.setFillColor(colors.black)
    y -= 8 * mm
    for n, l in enumerate(inv["lines"], 1):
        amt = l["taxable"] + l["igst"] + l["cgst"] + l["sgst"]
        vals = [str(n), l["desc"], l["hsn"], f"{l['qty']:g}", l["unit"], inr(l["rate"]), inr(l["taxable"]), f"{l['gst']:g}%"]
        vals += [inr(l["igst"])] if inter else [inr(l["cgst"]), inr(l["sgst"])]
        vals += [inr(l.get("amount_print", amt))]
        c.setFont("Helvetica", 7.6)
        wrapped = False
        for i, v in enumerate(vals):
            if i == 1:
                maxw = xs[2] - xs[1] - 2.4 * mm
                words_ = v.split(" ")
                first = ""
                while words_ and c.stringWidth((first + " " + words_[0]).strip(), "Helvetica", 7.6) <= maxw:
                    first = (first + " " + words_.pop(0)).strip()
                c.drawString(xs[i] + 1.2 * mm, y, first)
                if words_:
                    c.drawString(xs[i] + 1.2 * mm, y - 3.4 * mm, " ".join(words_))
                    wrapped = True
            elif i in (0, 2, 4):
                c.drawString(xs[i] + 1.2 * mm, y, v)
            else:
                c.drawRightString(xs[i + 1] - 1.2 * mm, y, v)
        y -= 9.6 * mm if wrapped else 6.2 * mm
        c.setStrokeColor(colors.HexColor("#d5d8dc"))
        c.setLineWidth(0.4)
        c.line(x0, y + 3.6 * mm, x1, y + 3.6 * mm)
    y -= 4 * mm
    # totals
    tx = x1 - 70 * mm
    rows = [("Taxable Value", inv["taxable"])]
    if inter:
        rows.append(("IGST", inv["igst"]))
    else:
        rows += [("CGST", inv["cgst"]), ("SGST", inv["sgst"])]
    rows.append(("Round Off", inv["roundoff"]))
    for k, v in rows:
        c.setFont("Helvetica", 8.5)
        c.drawString(tx, y, k)
        c.drawRightString(x1 - 1.2 * mm, y, inr(v))
        y -= 5 * mm
    c.setStrokeColor(acc)
    c.line(tx, y + 3.4 * mm, x1, y + 3.4 * mm)
    c.setFont("Helvetica-Bold", 10)
    c.drawString(tx, y - 1 * mm, "Invoice Total (INR)")
    c.drawRightString(x1 - 1.2 * mm, y - 1 * mm, inr(inv["total"]))
    c.setFont("Helvetica", 8)
    c.drawString(x0, y + 6 * mm, "Amount in words:")
    c.setFont("Helvetica-Oblique", 8)
    c.drawString(x0, y + 1.5 * mm, words(inv["total"]))
    y -= 16 * mm
    c.setFont("Helvetica", 7.5)
    c.drawString(x0, y, "Bank: State Bank of India  |  A/c No. XXXXXXX" + str(random.randint(1000, 9999)) + "  |  IFSC: SBIN0020" + str(random.randint(100, 999)))
    y -= 4 * mm
    c.drawString(x0, y, "Terms: Payment within 30 days. Interest @18% p.a. on delayed payments. Subject to local jurisdiction.")
    if inv.get("qr"):
        from reportlab.graphics.barcode.qr import QrCodeWidget
        from reportlab.graphics.shapes import Drawing
        from reportlab.graphics import renderPDF
        size = 44 * mm
        w = QrCodeWidget(inv["qr"], barLevel="L")
        bx0, by0, bx1, by1 = w.getBounds()
        d = Drawing(size, size, transform=[size / (bx1 - bx0), 0, 0, size / (by1 - by0), 0, 0])
        d.add(w)
        renderPDF.draw(d, c, x0, y - 8 * mm - size)
        c.setFont("Helvetica", 7)
        c.setFillColor(colors.HexColor("#374151"))
        c.drawString(x0 + size + 3 * mm, y - 14 * mm, "e-Invoice QR code")
        c.drawString(x0 + size + 3 * mm, y - 18 * mm, "Digitally signed by the Invoice")
        c.drawString(x0 + size + 3 * mm, y - 21.5 * mm, "Registration Portal (IRP)")
        c.setFillColor(colors.black)
    if inv.get("sign", True):
        c.setFont("Helvetica-Bold", 8.5)
        c.drawRightString(x1, y - 2 * mm, f"For {sup['name']}")
        c.setFont("Helvetica", 8)
        c.drawRightString(x1, y - 16 * mm, "Authorised Signatory")
        c.setStrokeColor(colors.HexColor("#1f3a8a"))
        c.setLineWidth(0.8)
        p = c.beginPath()
        p.moveTo(x1 - 38 * mm, y - 12 * mm)
        p.curveTo(x1 - 30 * mm, y - 6 * mm, x1 - 24 * mm, y - 15 * mm, x1 - 14 * mm, y - 9 * mm)
        p.curveTo(x1 - 10 * mm, y - 7 * mm, x1 - 8 * mm, y - 12 * mm, x1 - 4 * mm, y - 10 * mm)
        c.drawPath(p)
    c.setFont("Helvetica", 6.5)
    c.setFillColor(colors.HexColor("#6b7280"))
    c.drawCentredString(W / 2, 10 * mm, "This is a computer generated invoice. Sample document generated for the Parakh demo; not a real transaction.")
    c.save()


A = date
random.seed(7)
INVOICES = []  # (filename, inv, scenario, in_2b_override)

# 1 clean intra-state
i1 = build(S["deccan"], "DST/26-27/0412", A(2026, 9, 3), [("MS Round Bar EN8 32mm", "72142090", 1850, "KG", 68.5, 18), ("MS Flat 50x10mm IS2062", "72163100", 920, "KG", 64.0, 18)])
INVOICES.append(("01_deccan_steel_DST-0412.pdf", i1, "clean", "same"))
# 2 clean inter-state
i2 = build(S["pune"], "PTI/2627/1187", A(2026, 9, 5), [("Carbide Insert CNMG 120408", "82090090", 300, "NOS", 285.0, 18), ("End Mill 12mm 4-Flute Solid Carbide", "82077090", 40, "NOS", 1450.0, 18)])
INVOICES.append(("02_pune_toolcraft_PTI-1187.pdf", i2, "clean", "same"))
# 3 IGST charged on intra-state supply
i3 = build(S["kakatiya"], "KPS/0921", A(2026, 9, 6), [("Corrugated Box 5-Ply 600x400x400", "48191010", 1200, "NOS", 48.0, 18), ("Stretch Wrap Film 23 Micron", "39201012", 85, "ROL", 410.0, 18)], igst=True)
INVOICES.append(("03_kakatiya_packaging_KPS-0921.pdf", i3, "wrong tax head", "same"))
# 4 GSTIN typo on invoice (2B has correct)
i4 = build(S["godavari"], "GE/1543", A(2026, 9, 8), [("Copper Cable 4 sq mm 3-core FRLS", "85444999", 6, "COIL", 7850.0, 18), ("MCB 32A TP C-curve", "85362090", 14, "NOS", 1180.0, 18)])
good = S["godavari"]["gstin"]
typo = good[:7] + ("8" if good[7] != "8" else "3") + good[8:]
i4["sup_gstin_print"] = typo
INVOICES.append(("04_godavari_electricals_GE-1543.pdf", i4, "gstin typo", "same"))
# 5 supplier not filed GSTR-1 -> missing in 2B
i5 = build(S["nizam"], "NH/26-27/233", A(2026, 9, 11), [("Hydraulic Power Pack 5HP Overhaul", "998719", 1, "JOB", 46500.0, 18), ("Hydraulic Hose Assembly 1/2in 2-wire", "40093100", 12, "NOS", 1340.0, 18)])
INVOICES.append(("05_nizam_hydraulics_NH-233.pdf", i5, "missing in 2B", None))
# 6 value mismatch vs 2B
i6 = build(S["chennai"], "CBC/INV/7781", A(2026, 9, 12), [("Deep Groove Ball Bearing 6205-2RS", "84821011", 400, "NOS", 162.0, 18), ("Taper Roller Bearing 32210", "84822012", 60, "NOS", 1020.0, 18)])
INVOICES.append(("06_chennai_bearings_CBC-7781.pdf", i6, "value mismatch", "value"))
# 7 invoice number format differs in 2B
i7 = build(S["svt"], "SVT/0457/26-27", A(2026, 9, 14), [("HSS Drill Bit Set 1-13mm (25 pc)", "82075000", 20, "SET", 2150.0, 18), ("Tap Set M6-M20 HSS", "82074010", 15, "SET", 1680.0, 18)])
INVOICES.append(("07_sree_vinayaka_tools_SVT-0457.pdf", i7, "format mismatch", "fmt"))
# 8 legacy 28% on AC (now 18%)
i8 = build(S["coolair"], "CAS/26/0318", A(2026, 9, 16), [("Split Air Conditioner 2 Ton 5-Star Inverter", "84151010", 3, "NOS", 52400.0, 28), ("Installation & Copper Piping", "995461", 3, "JOB", 3500.0, 18)])
INVOICES.append(("08_coolair_systems_CAS-0318.pdf", i8, "legacy rate", "same"))
# 9 blocked credit: food & catering
i9 = build(S["paradise"], "PC/2627/118", A(2026, 9, 15), [("Outdoor Catering - Engineers Day staff lunch (180 pax)", "996334", 180, "PAX", 420.0, 18), ("Sweets & Refreshment Packs", "996334", 180, "NOS", 90.0, 18)])
INVOICES.append(("09_paradise_caterers_PC-118.pdf", i9, "blocked credit", "same"))
# 10 missing HSN + buyer GSTIN
i10 = build(S["laxmi"], "LHS-2268", A(2026, 9, 18), [("Hex Bolt M12x50 HT 8.8 (box of 100)", "", 6, "BOX", 1450.0, 18), ("Spring Washer M12 (pack of 500)", "", 4, "PKT", 560.0, 18)])
i10["buyer"] = dict(BUYER, gstin=None)
i10["sign"] = False
INVOICES.append(("10_laxmi_hardware_LHS-2268.pdf", i10, "missing fields", None))  # without our GSTIN it was reported as B2C
# 11 duplicate of invoice 1 (re-scanned copy)
INVOICES.append(("11_deccan_steel_DST-0412_copy.pdf", i1, "duplicate", "skip"))
# 12 cancelled GSTIN
i12 = build(S["bharat"], "BA/26-27/064", A(2026, 9, 20), [("Grinding Wheel 300x40x76.2 A46", "68042210", 24, "NOS", 1890.0, 18), ("Flap Disc 100mm 80 grit", "68052090", 200, "NOS", 62.0, 18)])
INVOICES.append(("12_bharat_abrasives_BA-064.pdf", i12, "cancelled gstin", "same"))
# 13 POS = Karnataka, billed as intra-state in Karnataka
i13 = build(S["blr"], "BFL/26-27/2290", A(2026, 9, 21), [("Socket Head Cap Screw M10x40 12.9", "73181500", 3000, "NOS", 14.5, 18), ("Nylock Nut M10", "73181600", 3000, "NOS", 4.2, 18)], pos="29")
INVOICES.append(("13_bengaluru_fasteners_BFL-2290.pdf", i13, "pos mismatch", "same"))
# 14 arithmetic errors
i14 = build(S["orugallu"], "OEW/115", A(2026, 9, 24), [("Fabrication of MS Base Frame as per Dwg OEW-22", "998898", 2, "NOS", 38500.0, 18), ("Machining of Gear Blanks", "998898", 40, "NOS", 650.0, 18)])
i14["lines"][1]["taxable"] = 28000.0  # should be 26,000
i14["lines"][1]["cgst"] = 2520.0
i14["lines"][1]["sgst"] = 2340.0
i14["lines"][1]["amount_print"] = 28000 + 2520 + 2340
totals(i14)
INVOICES.append(("14_orugallu_engineering_OEW-115.pdf", i14, "math errors", "same"))
# 15 e-invoice mandated supplier without IRN, scanned copy
i15 = build(S["tlc"], "TLC/26-27/03391", A(2026, 9, 27), [("Servo Cut Oil 210 L Barrel", "27101980", 4, "BRL", 21400.0, 18), ("Hydraulic Oil ISO VG 68 (210 L)", "27101980", 3, "BRL", 23800.0, 18)])
INVOICES.append(("15_telangana_lubricants_TLC-03391_scan.jpg", i15, "no irn scan", "same"))

# ---------------- e-invoice signing (demo IRP key) ----------------
import base64, hashlib
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa, padding

KEY_PATH = os.path.join(os.path.dirname(__file__), "demo_irp_private.pem")
if os.path.exists(KEY_PATH):
    IRP_KEY = serialization.load_pem_private_key(open(KEY_PATH, "rb").read(), password=None)
else:
    IRP_KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    open(KEY_PATH, "wb").write(IRP_KEY.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()))
b64u = lambda b: base64.urlsafe_b64encode(b).rstrip(b"=").decode()
pub = IRP_KEY.public_key().public_numbers()
JWK = {"kty": "RSA", "kid": "PARAKH-DEMO-IRP", "alg": "RS256", "use": "sig",
       "n": b64u(pub.n.to_bytes((pub.n.bit_length() + 7) // 8, "big")), "e": b64u(pub.e.to_bytes(3, "big"))}
os.makedirs(os.path.join(os.path.dirname(__file__), "..", "src", "einvoice"), exist_ok=True)
with open(os.path.join(os.path.dirname(__file__), "..", "src", "einvoice", "demoIrpKey.json"), "w") as f:
    json.dump(JWK, f, indent=1)


def einvoice(inv, signed_total=None):
    """Attach an IRN and a signed QR (JWT, RS256) in the IRP's format. signed_total lets a scenario
    print a different total than the one the portal signed."""
    sup = inv["sup"]
    fy = "2026-27"
    irn = hashlib.sha256(f"{sup['gstin']}{fy}INV{inv['no']}".encode()).hexdigest()
    data = {"SellerGstin": sup["gstin"], "BuyerGstin": inv["buyer"]["gstin"], "DocNo": inv["no"], "DocTyp": "INV",
            "DocDt": inv["date"].strftime("%d/%m/%Y"), "TotInvVal": signed_total if signed_total is not None else inv["total"],
            "ItemCnt": len(inv["lines"]), "MainHsnCode": inv["lines"][0]["hsn"], "Irn": irn, "IrnDt": inv["date"].strftime("%Y-%m-%d") + " 11:42:07"}
    header = {"alg": "RS256", "kid": JWK["kid"], "typ": "JWT"}
    payload = {"data": json.dumps(data, separators=(",", ":")), "iss": "NIC"}
    signing_input = b64u(json.dumps(header, separators=(",", ":")).encode()) + "." + b64u(json.dumps(payload, separators=(",", ":")).encode())
    sig = IRP_KEY.sign(signing_input.encode(), padding.PKCS1v15(), hashes.SHA256())
    inv["irn"] = irn
    inv["ack_no"] = str(1120 + random.randint(10**13, 10**14 - 1))[:15]
    inv["qr"] = signing_input + "." + b64u(sig)
    return inv


einvoice(i2)  # a genuine e-invoice: QR verifies and matches the print

S["sigma"] = dict(name="Sigma Machine Tools Pvt Ltd", addr=["Plot 21, Phase V, IDA Cherlapally", "Hyderabad, Telangana 500051"], gstin=gstin("36AAJCS6618L1Z"), state="36", prefix="SMT")
# 16 e-invoice whose printed values were edited after the IRP signed it
i16_signed = build(S["sigma"], "SMT/26-27/0788", A(2026, 9, 18), [("Spindle Cartridge Rebuild - CNC Turning Centre", "84669390", 2, "NOS", 110000.0, 18)])
i16 = build(S["sigma"], "SMT/26-27/0788", A(2026, 9, 18), [("Spindle Cartridge Rebuild - CNC Turning Centre", "84669390", 2, "NOS", 125000.0, 18)])
einvoice(i16, signed_total=i16_signed["total"])
INVOICES.append(("16_sigma_machine_tools_SMT-0788.pdf", i16, "qr tampered", "signed"))

themes = ["#1f4e79", "#7a2e0e", "#14532d", "#4c1d95", "#0f766e", "#334155", "#9a3412", "#1e3a8a", "#831843", "#3f3f46", "#1f4e79", "#713f12", "#155e75", "#4d7c0f", "#1e293b", "#3730a3"]

for f in os.listdir(INV_DIR):
    os.remove(os.path.join(INV_DIR, f))

for (fname, inv, scen, _), th in zip(INVOICES, themes):
    path = os.path.join(INV_DIR, fname)
    if fname.endswith(".jpg"):
        import fitz
        from PIL import Image, ImageFilter, ImageEnhance
        buf = io.BytesIO()
        tmp = path.replace(".jpg", ".tmp.pdf")
        draw_pdf(inv, tmp, th)
        doc = fitz.open(tmp)
        pix = doc[0].get_pixmap(dpi=110)
        img = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
        img = img.rotate(-1.1, expand=True, fillcolor=(236, 232, 222))
        img = ImageEnhance.Contrast(img).enhance(0.86)
        tint = Image.new("RGB", img.size, (246, 240, 226))
        img = Image.blend(img, tint, 0.16).filter(ImageFilter.GaussianBlur(0.45))
        img.save(path, quality=80)
        doc.close()
        os.remove(tmp)
    else:
        draw_pdf(inv, path, th)

# ---------------- purchase register (routine invoices, books only) ----------------
REG = []


def reg(sup, no, dt, taxable, rate, paid="Paid", desc="", hsn=""):
    inter = sup["state"] != BUYER["state"]
    t = r2(taxable * rate / 100)
    row = dict(sup=sup, no=no, date=dt, taxable=taxable, rate=rate, igst=t if inter else 0, cgst=0 if inter else r2(t / 2), sgst=0 if inter else r2(t / 2), paid=paid, desc=desc, hsn=hsn)
    row["total"] = float(round(taxable + t))
    REG.append(row)
    return row


reg(S["deccan"], "DST/26-27/0398", A(2026, 9, 1), 96400, 18, desc="MS Plates", hsn="7208")
reg(S["deccan"], "DST/26-27/0431", A(2026, 9, 19), 142750, 18, desc="EN8 Round Bar", hsn="7214")
reg(S["deccan"], "DST/26-27/0447", A(2026, 9, 28), 88200, 18, desc="MS Angles", hsn="7216")
reg(S["pune"], "PTI/2627/1204", A(2026, 9, 13), 64800, 18, desc="Carbide Inserts", hsn="8209")
reg(S["chennai"], "CBC/INV/7802", A(2026, 9, 22), 51200, 18, desc="Bearings", hsn="8482")
reg(S["svt"], "SVT/0462/26-27", A(2026, 9, 20), 23800, 18, desc="Drill bits", hsn="8207")
reg(S["svt"], "SVT/0471/26-27", A(2026, 9, 29), 17650, 18, desc="Reamers", hsn="8207")
reg(S["orugallu"], "OEW/109", A(2026, 9, 4), 58000, 18, desc="Job work - machining", hsn="9988")
reg(S["orugallu"], "OEW/121", A(2026, 9, 29), 61500, 18, desc="Job work - fabrication", hsn="9988")
reg(S["kakatiya"], "KPS/0934", A(2026, 9, 23), 39600, 18, desc="Corrugated boxes", hsn="4819")
reg(S["telenet"], "TNB/AUG26/55821", A(2026, 9, 1), 4999, 18, desc="Leased line 100 Mbps - Aug", hsn="9984")
reg(S["godavari"], "GE/1561", A(2026, 9, 26), 21400, 18, desc="Switchgear", hsn="8536")
# books-only problems
reg(S["nizam"], "NH/26-27/241", A(2026, 9, 25), 18400, 18, paid="Unpaid", desc="Seal kits", hsn="4016")   # also missing in 2B
reg(S["chennai"], "CBC/INV/7650", A(2026, 2, 17), 74000, 18, paid="Unpaid", desc="Bearings", hsn="8482")  # >180 days unpaid; FY25-26 (prior period, appears in older 2B, not this one)
reg(S["deccan"], "DST/24-25/1188", A(2025, 3, 15), 112000, 18, paid="Paid", desc="MS Plates", hsn="7208")  # time-barred (Sec 16(4))

with open(os.path.join(ROOT, "purchase_register.csv"), "w", newline="") as f:
    w = csv.writer(f)
    w.writerow(["Voucher Date", "Supplier Invoice No", "Supplier Invoice Date", "Party Name", "Party GSTIN", "Place of Supply", "HSN/SAC", "Item Description", "Taxable Value", "GST Rate", "IGST", "CGST", "SGST", "Cess", "Invoice Value", "Payment Status"])
    for r in REG:
        w.writerow([r["date"].strftime("%d-%m-%Y"), r["no"], r["date"].strftime("%d-%m-%Y"), r["sup"]["name"], r["sup"]["gstin"], f"36-{STATES['36']}", r["hsn"], r["desc"], f"{r['taxable']:.2f}", r["rate"], f"{r['igst']:.2f}", f"{r['cgst']:.2f}", f"{r['sgst']:.2f}", "0.00", f"{r['total']:.2f}", r["paid"]])

# ---------------- GSTR-2B ----------------
def d(dt):
    return dt.strftime("%d-%m-%Y")


suppliers = {}


def add2b(sup, inum, dt, val, pos, items, rev="N", itcavl="Y", rsn="", srctyp="", irn=""):
    s = suppliers.setdefault(sup["gstin"], dict(ctin=sup["gstin"], trdnm=sup["name"].upper(), supfildt=random.choice(["03-10-2026","05-10-2026","06-10-2026","07-10-2026"]), supprd="092026", inv=[]))
    rec = dict(inum=inum, typ="R", dt=d(dt), val=val, pos=pos, rev=rev, itcavl=itcavl, rsn=rsn, diffprcnt=1, items=items)
    if srctyp:
        rec["srctyp"] = srctyp
    if irn:
        rec["irn"] = irn
        rec["irngendate"] = d(dt)
    s["inv"].append(rec)


def items_from(inv):
    by = {}
    for l in inv["lines"]:
        k = l["gst"]
        b = by.setdefault(k, dict(rt=k, txval=0, igst=0, cgst=0, sgst=0, cess=0))
        b["txval"] = r2(b["txval"] + l["taxable"])
        b["igst"] = r2(b["igst"] + l["igst"])
        b["cgst"] = r2(b["cgst"] + l["cgst"])
        b["sgst"] = r2(b["sgst"] + l["sgst"])
    return [dict(num=i + 1, **v) for i, v in enumerate(by.values())]


for fname, inv, scen, mode in INVOICES:
    if mode is None or mode == "skip":
        continue
    sup = inv["sup"]
    items = items_from(inv)
    inum = inv["no"]
    val = inv["total"]
    if mode == "value":
        # supplier reported a lower taxable value for the bearings line (typo in GSTR-1)
        items = [dict(num=1, rt=18, txval=r2(inv["taxable"] - 10000), igst=r2((inv["taxable"] - 10000) * 0.18), cgst=0, sgst=0, cess=0)]
        val = float(round(items[0]["txval"] + items[0]["igst"]))
    if mode == "fmt":
        inum = "SVT457"
    if mode == "signed":
        items = items_from(i16_signed)
        val = i16_signed["total"]
    if scen == "math errors":
        # supplier's own GSTIN reporting is arithmetically correct: 2 x 38,500 + 40 x 650
        tx = 77000 + 26000
        items = [dict(num=1, rt=18, txval=tx, igst=0, cgst=r2(tx * 0.09), sgst=r2(tx * 0.09), cess=0)]
        val = float(round(tx * 1.18))
    if scen == "pos mismatch":
        add2b(sup, inum, inv["date"], val, "29", items, itcavl="N", rsn="P")
        continue
    if inv.get("irn"):
        add2b(sup, inum, inv["date"], val, inv["pos"], items, srctyp="e-Invoice", irn=inv["irn"])
        continue
    add2b(sup, inum, inv["date"], val, inv["pos"], items)

for r in REG:
    if r["sup"] is S["nizam"] or r["date"].year < 2026 or r["date"].month != 9:
        continue
    it = [dict(num=1, rt=r["rate"], txval=r["taxable"], igst=r["igst"], cgst=r["cgst"], sgst=r["sgst"], cess=0)]
    dt = r["date"]
    if r["no"] == "OEW/121":
        dt = A(2026, 9, 30)  # date differs by a day in supplier filing
    add2b(r["sup"], r["no"], dt, r["total"], "36", it)

# 2B-only documents
k_tx = 186000
add2b(S["krishna"], "KT/26-27/0091", A(2026, 9, 17), float(round(k_tx * 1.18)), "36", [dict(num=1, rt=18, txval=k_tx, igst=r2(k_tx * .18), cgst=0, sgst=0, cess=0)])
p_tx = 27400
add2b(S["pune"], "PTI/2627/1219", A(2026, 9, 26), float(round(p_tx * 1.18)), "36", [dict(num=1, rt=18, txval=p_tx, igst=r2(p_tx * .18), cgst=0, sgst=0, cess=0)])

suppliers[S["nizam"]["gstin"]] = None
suppliers = {k: v for k, v in suppliers.items() if v}
gstr2b = {
    "status": "1",
    "data": {"chksum": "a91f0c2d6e", "data": {
        "gstin": BUYER["gstin"], "rtnprd": "092026", "version": "1.0", "gendt": "08-10-2026",
        "docdata": {"b2b": list(suppliers.values())},
    }},
}
with open(os.path.join(ROOT, "gstr2b_092026.json"), "w") as f:
    json.dump(gstr2b, f, indent=1)

manifest = {
    "company": {"name": BUYER["name"], "gstin": BUYER["gstin"], "state": BUYER["state"], "address": ", ".join(BUYER["addr"])},
    "period": "2026-09",
    "invoices": [f"invoices/{x[0]}" for x in INVOICES],
    "register": "purchase_register.csv",
    "gstr2b": "gstr2b_092026.json",
    "scenarios": {x[0]: x[2] for x in INVOICES},
}
with open(os.path.join(ROOT, "manifest.json"), "w") as f:
    json.dump(manifest, f, indent=1)

# Reference extraction for the scanned invoice: used only when no AI provider is available.
def to_ref(inv):
    return {
        "invoiceNo": inv["no"], "invoiceDate": inv["date"].isoformat(),
        "supplier": {"name": inv["sup"]["name"], "gstin": inv["sup"]["gstin"], "address": ", ".join(inv["sup"]["addr"]), "stateCode": inv["sup"]["state"]},
        "buyer": {"name": BUYER["name"], "gstin": BUYER["gstin"], "address": ", ".join(BUYER["addr"]), "stateCode": BUYER["state"]},
        "placeOfSupply": inv["pos"], "reverseCharge": False, "irn": None, "hasSignature": True,
        "items": [{"description": l["desc"], "hsn": l["hsn"], "qty": l["qty"], "unit": l["unit"], "unitPrice": l["rate"], "taxableValue": l["taxable"], "gstRate": l["gst"], "cgst": l["cgst"], "sgst": l["sgst"], "igst": l["igst"], "cess": 0} for l in inv["lines"]],
        "taxableTotal": inv["taxable"], "cgstTotal": inv["cgst"], "sgstTotal": inv["sgst"], "igstTotal": inv["igst"], "cessTotal": 0, "roundOff": inv["roundoff"], "grandTotal": inv["total"],
    }

with open(os.path.join(ROOT, "reference_extractions.json"), "w") as f:
    json.dump({"invoices/15_telangana_lubricants_TLC-03391_scan.jpg": to_ref(i15)}, f, indent=1)

print("buyer", BUYER["gstin"])
for k, v in S.items():
    print(k, v["gstin"])
print("typo", typo)
print("files", len(os.listdir(INV_DIR)))

# ---------------- ground truth for the reliability page ----------------
EXPECTED = {
    "clean": [], "wrong tax head": ["TAX-HEAD-IGST"], "gstin typo": ["GSTIN-SUP-INVALID", "RECON-SUGGESTED"],
    "missing in 2B": ["RECON-MISSING-2B"], "value mismatch": ["RECON-MISMATCH"], "format mismatch": ["RECON-SUGGESTED"],
    "legacy rate": ["RATE-LEGACY"], "blocked credit": ["ITC-BLOCKED"], "missing fields": ["R46-BUYER-GSTIN", "R46-HSN", "R46-SIGN", "RECON-MISSING-2B"],
    "duplicate": ["DUP-EXACT"], "cancelled gstin": ["GSTIN-SUP-CANCELLED"], "pos mismatch": ["POS-OTHER-STATE", "RECON-2B-INELIGIBLE"],
    "math errors": ["MATH-LINE-VALUE", "MATH-CGST-SGST", "RECON-MISMATCH"], "no irn scan": ["EINV-MISSING-IRN"],
    "qr tampered": ["EINV-QR-MISMATCH", "RECON-MISMATCH"],
}
gt = {"documents": {}, "register": {
    "DST/24-25/1188": ["ITC-TIME-BARRED"], "CBC/INV/7650": ["ITC-180-DAYS"], "NH/26-27/241": ["RECON-MISSING-2B"], "OEW/121": ["RECON-SUGGESTED"],
}, "portalOnly": ["KT/26-27/0091", "PTI/2627/1219"]}
for fname, inv, scen, _ in INVOICES:
    gt["documents"][fname] = {
        "invoiceNo": inv["no"], "invoiceDate": inv["date"].isoformat(), "supplierGstin": inv.get("sup_gstin_print", inv["sup"]["gstin"]),
        "buyerGstin": inv["buyer"].get("gstin"), "taxableTotal": inv["taxable"], "grandTotal": inv["total"], "itemCount": len(inv["lines"]),
        "expected": EXPECTED[scen], "scenario": scen,
    }
with open(os.path.join(ROOT, "ground_truth.json"), "w") as f:
    json.dump(gt, f, indent=1)
print("ground truth", len(gt["documents"]))

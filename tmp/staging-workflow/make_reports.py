from pathlib import Path
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas

OUT = Path('tmp/staging-workflow/reports')
OUT.mkdir(parents=True, exist_ok=True)
CASES = [
    ('A', '11.8', '87', '88', '2.0', 'O Positive', 'Negative'),
    ('B', '9.7', '73', '90', '2.6', 'A Positive', 'Negative'),
    ('C', '11.5', '85', '165', '1.8', 'B Positive', 'Trace'),
    ('D', '12.0', '89', '94', '6.8', 'O Negative', 'Negative'),
]
for case, hb, mcv, glucose, tsh, blood, urine in CASES:
    p = OUT / f'synthetic-lab-{case.lower()}.pdf'
    c = canvas.Canvas(str(p), pagesize=A4)
    w, h = A4
    c.setFont('Helvetica-Bold', 14)
    c.setFillColor(colors.darkred)
    c.drawCentredString(w / 2, h - 48, 'SYNTHETIC TEST DATA - NOT FOR CLINICAL USE')
    c.setFillColor(colors.black)
    c.setFont('Helvetica-Bold', 18)
    c.drawString(48, h - 100, 'Fictional antenatal laboratory report')
    c.setFont('Helvetica', 11)
    c.drawString(48, h - 130, f'Patient: TEST PATIENT {case} (fictional)')
    c.drawString(48, h - 150, 'Specimen date: 30/10/2026')
    c.drawString(48, h - 170, 'Report date: 31/10/2026')
    y = h - 215
    c.setFont('Helvetica-Bold', 11)
    c.drawString(48, y, 'Investigation')
    c.drawString(310, y, 'Result')
    c.drawString(430, y, 'Unit')
    c.line(48, y - 8, w - 48, y - 8)
    for label, value, unit in [('Haemoglobin', hb, 'g/dL'), ('Mean corpuscular volume', mcv, 'fL'), ('Blood glucose', glucose, 'mg/dL'), ('TSH', tsh, 'mIU/L'), ('Blood group', blood, ''), ('Urine albumin', urine, '')]:
        y -= 30
        c.setFont('Helvetica', 11)
        c.drawString(48, y, label)
        c.drawString(310, y, value)
        c.drawString(430, y, unit)
    c.setFont('Helvetica-Bold', 10)
    c.drawString(48, 65, 'Fictional laboratory values for software testing only.')
    c.showPage()
    c.save()
    print(p)

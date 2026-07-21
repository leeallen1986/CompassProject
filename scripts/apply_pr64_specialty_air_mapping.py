from pathlib import Path

path = Path("server/canonicalMappings.ts")
text = path.read_text()

old = '''  "Nitrogen": ["Nitrogen"],
  "Booster": ["Booster"],

  // Pump / Flow / Dewatering variants → all map to "Pump/Dewatering"
'''
new = '''  "Nitrogen": ["Nitrogen"],
  "Booster": ["Booster"],

  // Specialty Air is a profile label, not a persisted scoring dimension.
  // It expands to the two existing specialty opportunity dimensions while
  // leaving Portable Air primary when both profile labels are assigned.
  "Specialty Air": ["Nitrogen", "Booster"],

  // Pump / Flow / Dewatering variants → all map to "Pump/Dewatering"
'''

if text.count(old) != 1:
    raise SystemExit(f"expected mapping anchor once, found {text.count(old)}")

path.write_text(text.replace(old, new, 1))

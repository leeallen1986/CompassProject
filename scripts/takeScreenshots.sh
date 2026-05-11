#!/bin/bash
# Take full-page screenshots of all 5 email HTML files using chromium headless
OUT="/home/ubuntu/atlas-copco-intelligence/docs/email-renders"
REPS=("Ryan_Pemberton" "Brett_Hansen" "Daniel_Zec" "Dan_Day" "Amit_Bhargava")

for REP in "${REPS[@]}"; do
  HTML="$OUT/${REP}-email.html"
  PNG="$OUT/${REP}-fullpage.png"
  if [ -f "$HTML" ]; then
    echo "Screenshotting $REP..."
    chromium --headless=new --no-sandbox --disable-gpu \
      --screenshot="$PNG" \
      --window-size=700,4000 \
      --hide-scrollbars \
      "file://$HTML" 2>/dev/null
    echo "  -> $PNG ($(wc -c < "$PNG") bytes)"
  else
    echo "  MISSING: $HTML"
  fi
done
echo "Done."

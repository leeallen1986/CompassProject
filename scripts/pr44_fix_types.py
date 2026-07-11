from pathlib import Path

path = Path("client/src/components/FullPotentialSignalReviewQueue.tsx")
text = path.read_text()

replacements = {
    '  const [status, setStatus] = useState("");': '  const [status, setStatus] = useState<"" | "new" | "reviewed" | "promoted" | "dismissed" | "archived">("");',
    '  const [urgency, setUrgency] = useState("");': '  const [urgency, setUrgency] = useState<"" | "hot" | "warm" | "cold" | "unknown">("");',
    '  const [confidenceLevel, setConfidenceLevel] = useState("");': '  const [confidenceLevel, setConfidenceLevel] = useState<"" | "high" | "medium" | "low" | "unknown">("");',
    '  const [signalType, setSignalType] = useState("");': '  const [signalType, setSignalType] = useState<"" | "drilling_campaign" | "awarded_project" | "live_tender" | "shutdown_turnaround" | "pipeline_commissioning" | "mine_site_activity" | "civil_application" | "rental_fleet_signal" | "competitor_channel_signal" | "installed_base_signal" | "contact_discovery_signal" | "manual" | "other">("");',
    '    if (["reviewed", "promoted", "dismissed"].includes(kind)) setStatus(kind);': '    if (kind === "reviewed" || kind === "promoted" || kind === "dismissed") setStatus(kind);',
    '              <select value={status} onChange={event => { setStatus(event.target.value); setOffset(0); }} className="rounded-lg border border-border bg-background px-3 py-2.5 text-sm">': '              <select value={status} onChange={event => { setStatus(event.target.value as typeof status); setOffset(0); }} className="rounded-lg border border-border bg-background px-3 py-2.5 text-sm">',
    '              <select value={urgency} onChange={event => { setUrgency(event.target.value); setOffset(0); }} className="rounded-lg border border-border bg-background px-3 py-2.5 text-sm">': '              <select value={urgency} onChange={event => { setUrgency(event.target.value as typeof urgency); setOffset(0); }} className="rounded-lg border border-border bg-background px-3 py-2.5 text-sm">',
    '              <select value={signalType} onChange={event => { setSignalType(event.target.value); setOffset(0); }} className="rounded-lg border border-border bg-background px-3 py-2.5 text-sm">': '              <select value={signalType} onChange={event => { setSignalType(event.target.value as typeof signalType); setOffset(0); }} className="rounded-lg border border-border bg-background px-3 py-2.5 text-sm">',
}

for old, new in replacements.items():
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"Expected one match, found {count}: {old[:100]!r}")
    text = text.replace(old, new, 1)

path.write_text(text)

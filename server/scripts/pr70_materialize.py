from pathlib import Path

path = Path("server/contactTrustReconciliation.ts")
text = path.read_text()

def replace_once(old: str, new: str):
    global text
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"Expected exactly one occurrence, found {count}: {old[:100]!r}")
    text = text.replace(old, new, 1)

replace_once(
    '  apolloCreditLog,\n  contactProjects,',
    '  apolloCreditLog,\n  contactCandidateSlates,\n  contactProjects,',
)
replace_once(
    'import { getDb } from "./db";\n',
    'import { getDb } from "./db";\nimport {\n  buildContactTrustSlateInvalidationPlan,\n  type ContactTrustSlateInvalidationPlan,\n  type ContactTrustSlateRecord,\n} from "./contactTrustSlateInvalidation";\n',
)
replace_once(
    'export interface ContactTrustApplyResult {\n',
    'export interface ContactTrustSlateInvalidationSummary {\n'
    '  matched: number;\n'
    '  markedStale: number;\n'
    '  alreadyStale: number;\n'
    '  slateIds: number[];\n'
    '  projectIds: number[];\n'
    '}\n\n'
    'export interface ContactTrustApplyResult {\n',
)
replace_once(
    '  dispositionCounts: Record<string, number>;\n}\n',
    '  dispositionCounts: Record<string, number>;\n'
    '  slateInvalidation: ContactTrustSlateInvalidationSummary;\n'
    '}\n',
)

needle = '''async function readSelectedSnapshots(db: Db, contactIds: number[]): Promise<ContactTrustApplySnapshot[]> {
  if (contactIds.length === 0) return [];
  const [contactRowsRaw, linkRowsRaw] = await Promise.all([
    db.select().from(contacts).where(inArray(contacts.id, contactIds)),
    db.select().from(contactProjects).where(inArray(contactProjects.contactId, contactIds)),
  ]);
  const contactRows = contactRowsRaw as ContactRow[];
  const linkRows = linkRowsRaw as ContactProjectRow[];
  const linksByContact = groupByContactId<ContactProjectRow>(linkRows);
  return contactRows
    .map(contact => snapshotFromCurrent(
      contact,
      Array.from(new Set((linksByContact.get(contact.id) || []).map(link => link.projectId))),
    ))
    .sort((a, b) => a.contactId - b.contactId);
}

export async function applyContactTrustManifest(
'''
replacement = '''async function readSelectedSnapshots(db: Db, contactIds: number[]): Promise<ContactTrustApplySnapshot[]> {
  if (contactIds.length === 0) return [];
  const [contactRowsRaw, linkRowsRaw] = await Promise.all([
    db.select().from(contacts).where(inArray(contacts.id, contactIds)),
    db.select().from(contactProjects).where(inArray(contactProjects.contactId, contactIds)),
  ]);
  const contactRows = contactRowsRaw as ContactRow[];
  const linkRows = linkRowsRaw as ContactProjectRow[];
  const linksByContact = groupByContactId<ContactProjectRow>(linkRows);
  return contactRows
    .map(contact => snapshotFromCurrent(
      contact,
      Array.from(new Set((linksByContact.get(contact.id) || []).map(link => link.projectId))),
    ))
    .sort((a, b) => a.contactId - b.contactId);
}

async function readSlateInvalidationPlan(
  db: Db,
  selectedRows: readonly ContactTrustManifestRow[],
): Promise<ContactTrustSlateInvalidationPlan> {
  const slateRows = await db.select().from(contactCandidateSlates);
  return buildContactTrustSlateInvalidationPlan(
    slateRows as ContactTrustSlateRecord[],
    selectedRows,
  );
}

function toSlateInvalidationSummary(
  plan: ContactTrustSlateInvalidationPlan,
  markedStale: number,
): ContactTrustSlateInvalidationSummary {
  return {
    matched: plan.matchedSlateIds.length,
    markedStale,
    alreadyStale: plan.alreadyStaleSlateIds.length,
    slateIds: plan.matchedSlateIds,
    projectIds: plan.matchedProjectIds,
  };
}

async function assertMatchedSlatesAreStale(db: Db, slateIds: readonly number[]): Promise<void> {
  if (slateIds.length === 0) return;
  const rows = await db
    .select({ id: contactCandidateSlates.id, isStale: contactCandidateSlates.isStale })
    .from(contactCandidateSlates)
    .where(inArray(contactCandidateSlates.id, [...slateIds]));
  const staleById = new Map(rows.map(row => [row.id, !!row.isStale]));
  const nonStale = slateIds.filter(id => staleById.get(id) !== true);
  if (nonStale.length > 0) {
    throw new Error(`Candidate slates did not become stale: ${nonStale.join(", ")}`);
  }
}

export async function applyContactTrustManifest(
'''
replace_once(needle, replacement)

replace_once(
    '  const snapshotById = new Map(currentSnapshots.map(snapshot => [snapshot.contactId, snapshot]));\n',
    '  const snapshotById = new Map(currentSnapshots.map(snapshot => [snapshot.contactId, snapshot]));\n'
    '  const slatePlan = await readSlateInvalidationPlan(db, selectedRows);\n',
)
replace_once(
    '      && (row.expectedAfter.linkProjectId === null || snapshot.linkedProjectIds.includes(row.expectedAfter.linkProjectId));\n  });\n',
    '      && (row.expectedAfter.linkProjectId === null || snapshot.linkedProjectIds.includes(row.expectedAfter.linkProjectId));\n'
    '  }) && slatePlan.freshSlateIds.length === 0;\n',
)
replace_once(
    '      dispositionCounts: Object.fromEntries(selectedRows.map(row => [row.disposition, 0])),\n',
    '      dispositionCounts: Object.fromEntries(selectedRows.map(row => [row.disposition, 0])),\n'
    '      slateInvalidation: toSlateInvalidationSummary(slatePlan, 0),\n',
)
replace_once(
    '      throw new Error(`Contact ${row.contactId}: non-applyable disposition ${row.disposition} reached apply`);\n    }\n  });\n\n  const after = await readSelectedSnapshots(db, selectedIds);\n',
    '      throw new Error(`Contact ${row.contactId}: non-applyable disposition ${row.disposition} reached apply`);\n'
    '    }\n\n'
    '    if (slatePlan.freshSlateIds.length > 0) {\n'
    '      const staleAt = new Date();\n'
    '      await tx.update(contactCandidateSlates).set({\n'
    '        isStale: true,\n'
    '        staleSince: staleAt,\n'
    '      }).where(inArray(contactCandidateSlates.id, slatePlan.freshSlateIds));\n'
    '    }\n'
    '  });\n\n'
    '  await assertMatchedSlatesAreStale(db, slatePlan.matchedSlateIds);\n'
    '  const after = await readSelectedSnapshots(db, selectedIds);\n',
)
replace_once(
    '    dispositionCounts,\n  };\n}\n',
    '    dispositionCounts,\n'
    '    slateInvalidation: toSlateInvalidationSummary(slatePlan, slatePlan.freshSlateIds.length),\n'
    '  };\n'
    '}\n',
)

path.write_text(text)

cli = Path("server/scripts/contactTrustReconcile.ts")
cli_text = cli.read_text()
old = '    contactIds: result.contactIds,\n    files: { before: beforePath, after: afterPath, summary: summaryPath },\n'
new = '    contactIds: result.contactIds,\n    slateInvalidation: result.slateInvalidation,\n    files: { before: beforePath, after: afterPath, summary: summaryPath },\n'
if cli_text.count(old) != 1:
    raise SystemExit("Unable to patch CLI slate-invalidation output")
cli.write_text(cli_text.replace(old, new, 1))

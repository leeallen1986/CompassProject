from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file_path = Path(path)
    text = file_path.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"Expected exactly one match in {path}, found {count}: {old[:120]!r}")
    file_path.write_text(text.replace(old, new, 1))


router_path = "server/routers/fullPotential.ts"
router_marker = '''  importSignals: adminProcedure.input(importSignalsInputSchema).mutation(async ({ ctx, input }) => importSignals(input, ctx.user)),

  list: protectedProcedure.input(listInputSchema).query(async ({ input }) => {'''
router_replacement = '''  importSignals: adminProcedure.input(importSignalsInputSchema).mutation(async ({ ctx, input }) => importSignals(input, ctx.user)),

  listSignals: protectedProcedure
    .input(
      z.object({
        search: z.string().max(200).optional(),
        status: z.enum(["new", "reviewed", "promoted", "dismissed", "archived"]).optional(),
        urgency: z.enum(["hot", "warm", "cold", "unknown"]).optional(),
        confidenceLevel: z.enum(["high", "medium", "low", "unknown"]).optional(),
        signalType: z.enum([
          "drilling_campaign",
          "awarded_project",
          "live_tender",
          "shutdown_turnaround",
          "pipeline_commissioning",
          "mine_site_activity",
          "civil_application",
          "rental_fleet_signal",
          "competitor_channel_signal",
          "installed_base_signal",
          "contact_discovery_signal",
          "manual",
          "other",
        ]).optional(),
        state: z.string().max(64).optional(),
        linked: z.enum(["all", "linked", "unlinked"]).optional().default("all"),
        actionState: z.enum(["any", "open", "closed", "none"]).optional().default("any"),
        limit: z.number().int().min(1).max(200).optional().default(50),
        offset: z.number().int().min(0).optional().default(0),
      }).optional().default({ linked: "all", actionState: "any", limit: 50, offset: 0 }),
    )
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const allSignals = await db.select().from(fullPotentialSignals);
      const accountIds = Array.from(new Set(
        allSignals
          .map(signal => signal.accountId)
          .filter((accountId): accountId is number => accountId !== null && accountId !== undefined),
      ));
      const signalIds = allSignals.map(signal => signal.id);

      const accountRows = accountIds.length > 0
        ? await db.select().from(fullPotentialAccounts).where(inArray(fullPotentialAccounts.id, accountIds))
        : [];
      const actionRows = signalIds.length > 0
        ? await db
          .select()
          .from(fullPotentialActions)
          .where(inArray(fullPotentialActions.signalId, signalIds))
          .orderBy(desc(fullPotentialActions.createdAt))
        : [];

      const accountMap = new Map(accountRows.map(account => [account.id, account]));
      const actionMetaMap = new Map<number, { openAction: any | null; closedAction: any | null }>();
      for (const action of actionRows) {
        if (!action.signalId) continue;
        const current = actionMetaMap.get(action.signalId) ?? { openAction: null, closedAction: null };
        if (openActionStatuses.has(action.status)) {
          if (!current.openAction) current.openAction = action;
        } else if (!current.closedAction) {
          current.closedAction = action;
        }
        actionMetaMap.set(action.signalId, current);
      }

      const searchToken = normalizeToken(input.search);
      const linkedFilter = input.linked ?? "all";
      const actionFilter = input.actionState ?? "any";
      const filteredSignals = allSignals.filter(signal => {
        const account = signal.accountId ? accountMap.get(signal.accountId) : undefined;
        const actionMeta = actionMetaMap.get(signal.id);
        const hasOpenAction = !!actionMeta?.openAction;
        const hasClosedAction = !!actionMeta?.closedAction;

        if (input.status && signal.status !== input.status) return false;
        if (input.urgency && signal.urgency !== input.urgency) return false;
        if (input.confidenceLevel && signal.confidenceLevel !== input.confidenceLevel) return false;
        if (input.signalType && signal.signalType !== input.signalType) return false;
        if (input.state && signal.state !== input.state) return false;
        if (linkedFilter === "linked" && !signal.accountId) return false;
        if (linkedFilter === "unlinked" && signal.accountId) return false;
        if (actionFilter === "open" && !hasOpenAction) return false;
        if (actionFilter === "closed" && !hasClosedAction) return false;
        if (actionFilter === "none" && (hasOpenAction || hasClosedAction)) return false;

        if (searchToken) {
          const haystack = normalizeToken([
            signal.signalTitle,
            signal.signalSummary,
            signal.sourceName,
            signal.sourceUrl,
            signal.state,
            signal.signalType,
            signal.suggestedAction,
            account?.canonicalName,
            account?.displayName,
            account?.parentGroup,
            account?.ownerName,
            account?.channelOwner,
            account?.segment,
          ].filter(Boolean).join(" "));
          if (!haystack.includes(searchToken)) return false;
        }

        return true;
      });

      const urgencyOrder: Record<string, number> = { hot: 0, warm: 1, cold: 2, unknown: 3 };
      filteredSignals.sort((left, right) => {
        const urgencyDifference = (urgencyOrder[left.urgency] ?? 3) - (urgencyOrder[right.urgency] ?? 3);
        if (urgencyDifference !== 0) return urgencyDifference;
        const leftDate = (left.signalDate ?? left.createdAt).getTime();
        const rightDate = (right.signalDate ?? right.createdAt).getTime();
        if (leftDate !== rightDate) return rightDate - leftDate;
        return right.id - left.id;
      });

      const offset = input.offset ?? 0;
      const limit = input.limit ?? 50;
      const pageSignals = filteredSignals.slice(offset, offset + limit).map(signal => {
        const account = signal.accountId ? accountMap.get(signal.accountId) : undefined;
        const actionMeta = actionMetaMap.get(signal.id) ?? { openAction: null, closedAction: null };
        const openAction = actionMeta.openAction;
        const closedAction = actionMeta.closedAction;

        return {
          ...signal,
          signalDate: signal.signalDate ? new Date(signal.signalDate).toISOString() : null,
          createdAt: signal.createdAt ? new Date(signal.createdAt).toISOString() : null,
          updatedAt: signal.updatedAt ? new Date(signal.updatedAt).toISOString() : null,
          account: account ? toClientAccount(account) : null,
          actionState: {
            hasOpenAction: !!openAction,
            hasClosedAction: !!closedAction,
            openActionId: openAction?.id ?? null,
            openActionStatus: openAction?.status ?? null,
            openActionDueDate: openAction?.dueDate ? new Date(openAction.dueDate).toISOString() : null,
            closedActionId: closedAction?.id ?? null,
            closedActionStatus: closedAction?.status ?? null,
            closedActionCompletedAt: closedAction?.completedAt ? new Date(closedAction.completedAt).toISOString() : null,
          },
        };
      });

      const summary = {
        total: allSignals.length,
        new: allSignals.filter(signal => signal.status === "new").length,
        hot: allSignals.filter(signal => signal.urgency === "hot").length,
        unlinked: allSignals.filter(signal => !signal.accountId).length,
        reviewed: allSignals.filter(signal => signal.status === "reviewed").length,
        promoted: allSignals.filter(signal => signal.status === "promoted").length,
        dismissed: allSignals.filter(signal => signal.status === "dismissed").length,
        archived: allSignals.filter(signal => signal.status === "archived").length,
        withOpenAction: allSignals.filter(signal => !!actionMetaMap.get(signal.id)?.openAction).length,
        withoutAction: allSignals.filter(signal => {
          const meta = actionMetaMap.get(signal.id);
          return !meta?.openAction && !meta?.closedAction;
        }).length,
      };

      return {
        signals: pageSignals,
        total: filteredSignals.length,
        limit,
        offset,
        summary,
        filterOptions: {
          statuses: uniqueSorted(allSignals.map(signal => signal.status)),
          urgencies: uniqueSorted(allSignals.map(signal => signal.urgency)),
          confidenceLevels: uniqueSorted(allSignals.map(signal => signal.confidenceLevel)),
          signalTypes: uniqueSorted(allSignals.map(signal => signal.signalType)),
          states: uniqueSorted(allSignals.map(signal => signal.state)),
          sourceNames: uniqueSorted(allSignals.map(signal => signal.sourceName)),
        },
      };
    }),

  list: protectedProcedure.input(listInputSchema).query(async ({ input }) => {'''
replace_once(router_path, router_marker, router_replacement)

page_path = "client/src/pages/FullPotential.tsx"
replace_once(page_path, '''  AlertTriangle,\n  ArrowLeft,''', '''  Activity,\n  AlertTriangle,\n  ArrowLeft,''')
replace_once(
    page_path,
    '''import FullPotentialSignalImportModal from "@/components/FullPotentialSignalImportModal";''',
    '''import FullPotentialSignalImportModal from "@/components/FullPotentialSignalImportModal";\nimport FullPotentialSignalReviewQueue from "@/components/FullPotentialSignalReviewQueue";''',
)
replace_once(
    page_path,
    '''  const [showSignalImportModal, setShowSignalImportModal] = useState(false);\n  const limit = 100;''',
    '''  const [showSignalImportModal, setShowSignalImportModal] = useState(false);\n  const [showSignalReviewModal, setShowSignalReviewModal] = useState(false);\n  const limit = 100;''',
)
replace_once(
    page_path,
    '''          <div className="flex items-center gap-2">\n            <Button\n              disabled={!isAdmin}\n              onClick={() => setShowSignalImportModal(true)}''',
    '''          <div className="flex items-center gap-2">\n            <Button\n              onClick={() => setShowSignalReviewModal(true)}\n              variant="outline"\n              className="border-white/30 text-white bg-transparent hover:bg-white/10"\n              title="Review Portable Air signals"\n            >\n              <Activity className="w-4 h-4 mr-2" /> Review Signals\n            </Button>\n            <Button\n              disabled={!isAdmin}\n              onClick={() => setShowSignalImportModal(true)}''',
)
replace_once(
    page_path,
    '''      {showImportModal && <FullPotentialImportModal open={showImportModal} onClose={() => setShowImportModal(false)} />}\n      {showSignalImportModal && (''',
    '''      {showImportModal && <FullPotentialImportModal open={showImportModal} onClose={() => setShowImportModal(false)} />}\n      {showSignalReviewModal && (\n        <FullPotentialSignalReviewQueue\n          open={showSignalReviewModal}\n          onClose={() => setShowSignalReviewModal(false)}\n          onOpenAccount={account => {\n            setShowSignalReviewModal(false);\n            setSelectedAccount(account);\n          }}\n        />\n      )}\n      {showSignalImportModal && (''',
)

modal_path = "client/src/components/FullPotentialSignalImportModal.tsx"
replace_once(
    modal_path,
    '''  AlertTriangle,\n  CheckCircle2,\n  FileSpreadsheet,''',
    '''  AlertTriangle,\n  BookOpen,\n  CheckCircle2,\n  Download,\n  FileSpreadsheet,''',
)
replace_once(
    modal_path,
    '''  const [commitSummary, setCommitSummary] = useState<SignalImportSummary | null>(null);\n  const [isReading, setIsReading] = useState(false);''',
    '''  const [commitSummary, setCommitSummary] = useState<SignalImportSummary | null>(null);\n  const [isReading, setIsReading] = useState(false);\n  const [showGuide, setShowGuide] = useState(false);''',
)
replace_once(
    modal_path,
    '''          </label>\n\n          {/* Action buttons */}''',
    '''          </label>\n\n          <div className="flex flex-wrap items-center gap-3">\n            <a\n              href="/templates/portable-air-signals-template.csv"\n              download\n              className="inline-flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-xs font-semibold text-navy transition-colors hover:border-gold/50 hover:bg-gold/5"\n            >\n              <Download className="w-4 h-4" /> Download CSV template\n            </a>\n            <button\n              type="button"\n              onClick={() => setShowGuide(value => !value)}\n              className="inline-flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-xs font-semibold text-navy transition-colors hover:border-gold/50 hover:bg-gold/5"\n            >\n              <BookOpen className="w-4 h-4" /> {showGuide ? "Hide field guide" : "View field guide"}\n            </button>\n          </div>\n\n          {showGuide && (\n            <div className="rounded-lg border border-blue-200 bg-blue-50/60 p-4 text-xs text-blue-950 space-y-3">\n              <div>\n                <div className="font-bold">Required</div>\n                <div className="mt-1">Only <code>signalTitle</code> is mandatory. Add source, date, type, confidence, urgency and suggested action wherever possible.</div>\n              </div>\n              <div>\n                <div className="font-bold">Account linking priority</div>\n                <div className="mt-1">accountId → stableKey → canonicalName / accountName / displayName → aliasName → unlinked.</div>\n              </div>\n              <div>\n                <div className="font-bold">Recommended values</div>\n                <div className="mt-1">Urgency: hot, warm, cold or unknown. Confidence: high, medium, low or unknown. Status normally starts as new.</div>\n              </div>\n              <div>Run dry-run first. The importer skips duplicates and never creates an action automatically.</div>\n            </div>\n          )}\n\n          {/* Action buttons */}''',
)

test_path = "server/fullPotential.listSignalQueue.test.ts"
replace_once(test_path, 'expect(hot.account.id).toBe(accountAId);', 'expect(hot?.account?.id).toBe(accountAId);')
replace_once(test_path, 'expect(hot.account.ownerName).toBe("Ryan Pemberton");', 'expect(hot?.account?.ownerName).toBe("Ryan Pemberton");')
replace_once(test_path, 'expect(hot.account.routeToMarket).toBe("direct_ape");', 'expect(hot?.account?.routeToMarket).toBe("direct_ape");')
replace_once(test_path, 'expect(hot.account.priorityTier).toBe("tier_a");', 'expect(hot?.account?.priorityTier).toBe("tier_a");')

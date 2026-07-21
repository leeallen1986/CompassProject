from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file = Path(path)
    text = file.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected exact block once, found {count}")
    file.write_text(text.replace(old, new, 1))


replace_once(
    "server/_core/index.ts",
    '''} from "../fullPotentialAccountMatching.http";

function isPortAvailable''',
    '''} from "../fullPotentialAccountMatching.http";
import { handleReadOnlyNextBest5 } from "../fullPotentialNextBest5.http";

function isPortAvailable''',
)

replace_once(
    "server/_core/index.ts",
    '''  app.get("/api/full-potential/account-match", handleFullPotentialAccountNameMatch);

  app.get("/api/warmup", handleWarmup);''',
    '''  app.get("/api/full-potential/account-match", handleFullPotentialAccountNameMatch);

  // Read-only, evidence-backed recommendation layer. No mutation route is exposed.
  app.get("/api/full-potential/next-best-5", handleReadOnlyNextBest5);

  app.get("/api/warmup", handleWarmup);''',
)

replace_once(
    "client/src/pages/ThisWeek.tsx",
    '''import FullPotentialAccountContext from "@/components/FullPotentialAccountContext";
import { useFullPotentialProjectContexts } from "@/hooks/useFullPotentialProjectContexts";''',
    '''import FullPotentialAccountContext from "@/components/FullPotentialAccountContext";
import FullPotentialNextBest5 from "@/components/FullPotentialNextBest5";
import { useFullPotentialProjectContexts } from "@/hooks/useFullPotentialProjectContexts";''',
)

replace_once(
    "client/src/pages/ThisWeek.tsx",
    '''        <ValidateFirstKPIStrip
          hotCount={hotCount}
          warmCount={warmCount}
          actionReadyCount={actionReadyProjects.length}
          waitingOnDiscoveryCount={waitingOnDiscovery.length}
          closingSoonCount={closingSoon.length}
        />

        {/* ── Top 3 Actions ── */}''',
    '''        <ValidateFirstKPIStrip
          hotCount={hotCount}
          warmCount={warmCount}
          actionReadyCount={actionReadyProjects.length}
          waitingOnDiscoveryCount={waitingOnDiscovery.length}
          closingSoonCount={closingSoon.length}
        />

        <FullPotentialNextBest5 />

        {/* ── Top 3 Actions ── */}''',
)

print("Applied PR66 read-only Next Best 5 integration")

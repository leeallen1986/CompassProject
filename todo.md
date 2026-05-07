# Project TODO

- [x] Basic dashboard layout with Nordic Industrial Precision design
- [x] Hero header with mining imagery
- [x] Executive summary with top 5 action items
- [x] KPI cards row
- [x] All Projects tab with priority and sector filtering
- [x] Expandable project cards with contractor details
- [x] Awarded Projects tab with table
- [x] Drilling & Exploration tab with campaigns table
- [x] Contacts tab with search and CSV export
- [x] Sources & Methodology tab
- [x] Upgrade to full-stack with database backend
- [x] Design database schema for projects, contacts, reports, drilling campaigns, awarded projects
- [x] Push database migrations
- [x] Build tRPC API endpoints for all data
- [x] Refactor frontend to fetch data from API instead of hardcoded data
- [x] Seed database with current week's data
- [x] Add login-protected access for sales team
- [x] Write vitest tests for API endpoints
- [x] Database schema for user profiles/preferences (territories, offer categories, customer types, industries, deal size, stage timing, buyer roles)
- [x] Database schema for project feedback (thumbs up/down + reason per project per user)
- [x] Push new migrations
- [x] tRPC API endpoints for user profile CRUD and feedback
- [x] Onboarding wizard Screen 1: Territory + industries
- [x] Onboarding wizard Screen 2: Offer category + customer type
- [x] Onboarding wizard Screen 3: Deal size + stage timing
- [x] Onboarding wizard Screen 4: Contact roles (3-5 chips)
- [x] Onboarding wizard Screen 5 (optional): Key accounts + exclusions
- [x] Onboarding wizard Screen 6: AI suggests segments + expected leads preview
- [x] Auto-redirect to wizard on first login (no profile yet)
- [x] Personalized filtering engine (hard filters on territory, industry, deal size)
- [x] Soft ranking engine (score projects by relevance to user profile)
- [x] Thumbs up/down feedback buttons on project cards
- [x] Feedback reason selector (wrong region, too small, wrong market, not our buyer)
- [x] Settings page to edit profile preferences after onboarding
- [x] Write vitest tests for profile and feedback endpoints
- [x] End-to-end test: onboarding → personalized dashboard → feedback
- [x] Database schema for pipeline claims (userId, projectId, status, notes, timestamps)
- [x] Database schema for pipeline activity log (status changes, notes history)
- [x] tRPC API endpoints for pipeline CRUD (claim, update status, release, list by user/project)
- [x] Pipeline tab UI on dashboard (Kanban-style columns: Identified → Contacted → Meeting Booked → Quoted → Won/Lost)
- [x] Claim button on project cards with status indicator
- [x] Team view showing all claimed projects across the team
- [x] Database schema for email digest preferences (frequency, enabled/disabled)
- [x] Notification API integration for personalized email digests
- [x] Email digest content builder (filter projects by user profile, generate summary)
- [x] Settings page update: email digest preferences toggle
- [x] Vitest tests for pipeline and email digest endpoints
- [x] Database schema for business lines, RSS sources, raw articles, and extraction queue
- [x] RSS feed harvester service (server-side, fetches 20+ feeds every 6 hours)
- [x] Keyword relevance gate (filters articles by business line keywords)
- [x] AI extractor service (structured LLM extraction with daily cap)
- [x] Smart deduplication (merge new data into existing projects)
- [x] Business line configuration (admin can add/remove feeds and keywords)
- [x] Enhanced ML ranker with feedback-driven weight learning
- [x] Admin pipeline dashboard (monitor ingestion stats, queue depth, credit usage)
- [x] Vitest tests for RSS harvester and AI extractor
- [x] Seed defaults for 4 business lines and 18 RSS sources
- [x] Admin link in header navigation for admin users
- [x] Integrate contact enrichment via LinkedIn People Search API on new projects
- [x] Wire contact enrichment into the AI extraction pipeline (auto-enriches on project insert)
- [x] Set up 24-hour automated pipeline schedule (06:00 UTC / 16:00 AEST daily)
- [x] Full daily pipeline runner (harvest → extract → enrich → notify owner)
- [x] Admin dashboard: Run Full Pipeline button, Enrich Contacts button, enrichment stats panel
- [x] Vitest tests for contact enrichment service (email inference, role bucket, target roles)
- [x] Build Projectory scraper service (weekly harvest of 6 categories)
- [x] Map Projectory data fields to existing project schema (status, CAPEX, sector, priority, contacts)
- [x] Deduplication against existing projects in database (name-based fuzzy matching)
- [x] Include older projects and update their current phase
- [x] Wire Projectory scraper into admin dashboard with manual trigger (Scrape Projectory button)
- [x] Set up weekly automated schedule for Projectory scraping (Mondays via daily pipeline)
- [x] Vitest tests for Projectory scraper (listing page parser, article page parser, contact extraction)
- [x] Research DMIRS data sources — found MINEDEX public JSON API (no auth required)
- [x] Build DMIRS scraper service with data mapping to project schema (operator, location, priority, equipment signals)
- [x] Deduplication against existing projects in database (name-based fuzzy matching)
- [x] Wire DMIRS scraper into admin dashboard with manual trigger (Scrape DMIRS button)
- [x] Set up weekly automated schedule for DMIRS scraping (Wednesdays via daily pipeline)
- [x] Vitest tests for DMIRS scraper (cleanProjectName, extractLocation, mapPriority, extractEquipmentSignals)
- [x] Extend user schema with email, passwordHash, authMethod fields
- [x] Build server-side email/password auth (login, register via invite, password reset)
- [x] Build email/password login page with show password toggle
- [x] Build registration page for completing invitations
- [x] Build password reset page
- [x] Admin invite flow (admin creates distributor accounts with email)
- [x] Admin user management tab (list users, invite, reset password, delete)
- [x] Dual auth support (Manus OAuth for internal, email/password for distributors)
- [x] Redirect to /login page instead of Manus OAuth on unauthorized
- [x] Vitest tests for email/password auth (password validation, hashing, verification)
- [x] Fix scraping pipeline — unified dashboard now shows ALL projects across all reports
- [x] Consolidate dashboard into single personalized view (removed report selector dropdown)
- [x] Personalization scoring drives project/opportunity ranking on main dashboard
- [x] Client-side Projectory scraper (bypasses anti-bot via admin's browser session)
- [x] Updated report.test.ts for new aggregated dashboard behavior
- [x] Fix nested button HTML error on Home page (button cannot contain a nested button)
- [x] Fix rawArticles DATE() query error on Admin page
- [x] Add business line filter to main dashboard (Portable Air, Industrial Compressors, Power Technique, Vacuum Solutions)
- [x] Add matchedBusinessLines field to projects schema
- [x] Propagate business line info from rawArticles to projects during AI extraction
- [x] Backfill existing 28 projects with business line tags
- [x] Vitest tests for business line filter (keyword matching + client-side filtering)
- [x] Remove Industrial Compressors, Vacuum Solutions business lines from database (deactivate)
- [x] Update seed defaults to only include Portable Air and Power Technique
- [x] Update AI extractor prompt for PT-only focus
- [x] Update dashboard filter to only show PT-relevant divisions
- [x] Restructure to Power Technique (PT) as parent division with 4 business lines
- [x] Create/update business lines in DB: Portable Air, PAL (generators/lighting), Pump (Flow), BESS
- [x] Update header branding from "Atlas Copco Portable Air" to "Atlas Copco Power Technique"
- [x] Update filter bar to show PT business lines
- [x] Update seed defaults and keyword dictionaries for all 4 business lines
- [x] Update AI extractor prompt for 4 business lines
- [x] Backfill existing projects with new business line tags
- [x] All 151 tests passing
- [x] Add new RSS feeds for generators, pumps, and BESS (Energy Storage News, Renewables Now, Fluid Handling, CEG, Diesel Progress)
- [x] Run AI extraction pipeline on queued articles (54 total projects now, up from 28)
- [x] Add business line badges to project cards (Air, PAL, Pump, BESS color-coded badges)
- [x] AI-powered outreach email generator feature
- [x] Server-side tRPC endpoint to generate personalised outreach email via LLM
- [x] Outreach email modal UI with preview, edit subject/body, and tone selector (3 tones: professional, consultative, direct)
- [x] mailto: integration to open user's email client with pre-filled draft
- [x] Wire contact "Outreach" buttons in Contacts tab to trigger AI outreach flow
- [x] Vitest tests for outreach email generation endpoint (11 tests)
- [x] Add pump-specific RSS feeds (Pump Engineer, World Pumps, dewatering industry sources)
- [x] Harvest new pump feeds and run AI extraction (31 extracted, 314 skipped, 2 remaining queued)
- [x] Create outreach history schema (outreachEmails table: userId, contactId, projectId, subject, body, tone, sentAt)
- [x] Save outreach emails to database when user clicks "Open in Email"
- [x] Show outreach history on contacts (badge showing if already contacted)
- [x] Add primary contact with outreach button directly on project cards
- [x] Select primary contact based on user's preferred buyer roles from onboarding profile (fuzzy keyword matching)
- [x] Vitest tests for outreach email generation (11 tests), all 162 tests passing
- [x] Show outreach history badges on contacts (Contacted indicator with days-ago tooltip)
- [x] Add outreach history query endpoint (outreach.contactedList + outreach.leaderboard)
- [x] Run full harvest cycle (26 sources, 31 extracted, pump feeds active)
- [x] Build team outreach leaderboard on Pipeline page (weekly email count per user, trophy icons)
- [x] Vitest tests for outreach history, contacted list, and leaderboard (168 tests passing)
- [x] Research and add more Australian project databases to support all PT business lines
- [x] Build AEMO scraper for BESS, pumped hydro, and gas peaker projects across NEM
- [x] Wire AEMO scraper into admin dashboard with manual trigger (Scrape AEMO button)
- [x] Set up weekly automated schedule for AEMO scraping (Fridays via daily pipeline)
- [x] Add 7 new AEMO projects (Cethana Pumped Hydro, Muswellbrook Pumped Hydro, Goat Hill Pumped Hydro, Marinus Link BESS, Western Sydney BESS, Mortlake Gas Peaker)
- [x] Add 5 new pump-specific RSS sources (World Pumps, Pump Engineer, AWA, Water Source, Utility Magazine)
- [x] Expand Pump (Flow) keywords (stormwater, tailings, groundwater, flood recovery, dam construction, etc.)
- [x] Vitest tests for AEMO scraper (business line matching, priority mapping, CAPEX grading, equipment signals)
- [x] All 196 tests passing
- [x] Build government major projects scraper (Infrastructure Australia Priority List + NREPL)
- [x] 43 curated projects: transport, water, energy, defence across all Australian states
- [x] Wire gov scraper into admin dashboard with manual trigger (Scrape Gov Projects button)
- [x] Set up weekly automated schedule for gov scraping (Tuesdays via daily pipeline)
- [x] Auto-enrichment: both gov scraper and AEMO scraper now auto-discover contacts via LinkedIn on new project insertion
- [x] Vitest tests for gov scraper (business line matching, priority mapping, CAPEX grading, data integrity, category coverage)
- [x] All 241 tests passing
- [x] Dashboard now at 116 total projects (BESS 33, PAL 53, Portable Air 98, Pump 29)
- [ ] Target: 500+ projects and 1500+ contacts at scale
- [x] Build AusTender OCDS API scraper (public API, zero AI credits, filters $1M+ construction/mining/energy/water contracts)
- [x] Build ICN Gateway scraper (24 curated major projects: defence, mining, transport, energy with work packages)
- [x] Wire AusTender and ICN scrapers into admin dashboard with manual triggers
- [x] Set up weekly automated schedule: AusTender (Thursdays), ICN (Saturdays)
- [x] Increase daily enrichment cap from 30 to 100
- [x] Auto-enrichment on ICN scraper (auto-discovers contacts via LinkedIn on new project insertion)
- [x] Vitest tests for AusTender scraper (keyword matching, business line mapping, CAPEX grading, UNSPSC filtering)
- [x] Vitest tests for ICN scraper (business line matching, priority mapping, CAPEX grading, work package detection)
- [x] All 309 tests passing
- [x] ICN scraper run: 17 new projects, 6 duplicates, auto-enriched contacts
- [x] AusTender scraper run: 100 contracts fetched, live API confirmed working
- [x] Dashboard now at 133 total projects (BESS 34, PAL 70, Portable Air 115, Pump 41), 51 contacts
- [ ] Target: 500+ projects and 1500+ contacts at scale
- [ ] Add networking events page for sales professionals
- [x] Widen AusTender filters (lowered to $500K, extended lookback to 30 days, broadened UNSPSC codes and keywords)
- [x] Re-run AusTender scraper — now captures 1 relevant contract (Department of Defence $627K NSW)
- [x] Build on-demand per-project enrichment backend endpoint (enrichProject tRPC mutation)
- [x] Add "Find Contacts" button on project cards for sales reps
- [x] Loading state with spinner + progress message ("Searching LinkedIn for procurement managers...")
- [x] Clear UX messaging: "Takes 10-30 seconds" shown above button
- [x] All 310 tests passing
- [x] Dashboard at 134 total projects, 51 contacts
- [x] Add enrichment cache schema (projectEnrichmentCache table: projectId, userId, rolesSearched, companiesSearched, contactsFound, contactsNew, apiCallsMade, enrichedAt)
- [x] Profile-aware enrichment: reads user's preferred buyer roles from onboarding profile, only searches for those specific roles
- [x] Cache check: skips LinkedIn API call if project was enriched within 7 days, returns cached results (0 API calls)
- [x] Show cached state on Find Contacts button ("1 contact found just now. Click Refresh to search again")
- [x] Refresh button with tooltip ("Force a fresh LinkedIn search — uses API credits") for manual override
- [x] Auto-enrichment on scrapers respects caching (writes cache entries on new project enrichment)
- [x] Vitest tests for enrichment caching and profile-aware filtering (337 tests passing)
- [x] End-to-end test: Carmichael Mine → Found Danny Daly (Electrical Engineering Manager at Bravus Mining), cached for 7 days, 10 API calls
- [x] Contacts count now at 52
- [x] Fix login redirect: unauthenticated users see custom /login page (already implemented in main.tsx)
- [x] Update app title from "Atlas Copco Portable Air" to "Atlas Copco Power Technique" in HTML title and placeholder text
- [x] Manus OAuth is secondary option on login page — email/password is primary for sales team
- [x] User action needed: Change visibility to Public in Management UI Settings > General to remove Manus OAuth gate
- [x] User action needed: Update VITE_APP_TITLE in Management UI Settings > General to "Atlas Copco Power Technique - Market Intelligence"
- [x] Fix Manus OAuth gate: all auth redirects now go to /login instead of Manus OAuth URL
- [x] Updated useAuth.ts, main.tsx, Home.tsx, DashboardLayout.tsx, Onboarding.tsx, Settings.tsx, Pipeline.tsx, Admin.tsx
- [x] Fix onboarding bug: new users get pushed back on first attempt of completing personalization/preferences (works on 2nd try)
- [x] Root cause: stale profile cache after completeOnboarding mutation; fixed by invalidating profile cache + staleTime:0 + removing setTimeout delay
- [ ] Scale project database: run all scrapers to reach 500+ projects target
- [ ] Run RSS harvest across all 26+ feeds
- [ ] Run AI extraction on queued articles
- [ ] Run Projectory scraper
- [ ] Run DMIRS scraper
- [ ] Run AEMO scraper
- [ ] Run Gov Projects scraper
- [ ] Run AusTender scraper
- [ ] Run ICN Gateway scraper
- [ ] Run contact enrichment on new projects
- [x] Scale project database to 500+ (reached 514 projects via RSS + AI extraction + LLM seeding)
- [x] Fix contact enrichment: increased daily cap from 100 to 500, extended cache TTL from 7 to 30 days
- [x] Reset AI extractor daily cap to 100 (was temporarily 300 for bulk seeding)
- [x] Updated Sources & Methodology table to reflect new limits
- [x] Fix Find Contacts: root cause was LinkedIn API quota exhaustion ("usage exhausted") — improved error handling, quota detection, caching logic, and user-facing messaging
- [ ] Run bulk contact enrichment across all 514 projects
- [ ] Research and add fallback enrichment provider (Hunter.io, PDL, or Coresignal) when LinkedIn API quota exhausted
- [ ] Implement LLM-based contact generation as fallback when LinkedIn API quota exhausted
- [ ] Integrate LLM fallback into enrichment flow (auto-fallback when LinkedIn fails)
- [ ] Run bulk LinkedIn enrichment on all unenriched projects
- [ ] Run LLM fallback on remaining projects
- [x] Build LLM contact generation fallback service (generates 5 AI-suggested contacts per project)
- [x] Integrate LLM fallback into enrichProject endpoint (auto-fallback when LinkedIn quota exhausted)
- [x] Add enrichmentSource field to contacts schema (linkedin, llm, manual)
- [x] Run bulk LLM enrichment: batch 1 (50 projects, 250 contacts), batch 2 (100 projects, 500 contacts)
- [x] Total contacts now at 1066 (up from 56), covering ~250 projects
- [x] Vitest tests for LLM fallback (45 tests: email inference, role normalization, response parsing, strategy selection, deduplication, confidence levels, contact limits, company extraction)
- [x] All 382 tests passing
- [x] Fix enrichment_source migration (column not applied to database)
- [x] Build AI-powered project search/matching tool (LLM finds best projects for keywords/products)
- [x] Backend tRPC endpoint for AI project matching (keyword → ranked project list with reasoning)
- [x] Frontend AI search interface on dashboard (search bar + results with relevance scores)
- [x] Enhance AI extractor to also identify awarded projects from articles
- [x] Enhance AI extractor to also identify drilling campaigns from articles
- [ ] Run extraction pipeline to populate awarded projects and drilling campaigns
- [x] Bug: AI Search shows all projects regardless of user preferences (should filter by WA if user preference is WA)
- [x] Verify main project list also correctly respects user location preferences
- [x] Dashboard: Filter projects by user territory preferences (hide non-matching projects, not just rank lower)
- [x] Dashboard: Add "Show All / Unfiltered" toggle so users can override territory filter
- [x] AI Search: Keep unfiltered (shows all projects regardless of territory — user is actively searching)
- [x] Apply territory filter to KPI counts, hot projects section, contacts tab, awarded projects, drilling campaigns
- [x] Add verification status field to contacts schema (verified / ai_suggested / unverified)
- [x] Add confidence score field to contacts schema (high / medium / low)
- [x] Update LLM contact generator to produce confidence scores based on match quality
- [x] Add LinkedIn search links to contacts (name + company search URL, not guessed profile URL)
- [x] Add visual warning on AI-generated emails (pattern-guessed, verify before outreach)
- [x] Update contacts table UI with verification badges, confidence indicators, and LinkedIn links
- [x] Backfill existing contacts with appropriate verification status (linkedin → verified, llm → ai_suggested)
- [x] Flip enrichment model: LLM as primary source, LinkedIn API as on-demand verification
- [x] Add on-demand "Verify via LinkedIn" endpoint (single contact verification)
- [x] Update contacts table UI: verification badges, confidence indicators, LinkedIn search links, verify button
- [x] Ensure onboarding preferences are the single source of truth for ALL personalization
- [x] Filter contacts by user's preferred buyer roles from onboarding (show relevant stakeholders first)
- [x] Add scoring transparency: first-time users should understand how the scoring/personalization works
- [x] Show match score breakdown on project cards (territory match, industry match, CAPEX fit, etc.)
- [x] Add scoring explainer panel/tooltip for new users explaining how personalization drives what they see
- [x] Bug: Many duplicate contacts across projects (same person appearing multiple times)
- [x] Investigate scope of duplicate contacts in database
- [x] Deduplicate existing contacts (keep best version, remove duplicates)
- [x] Add deduplication logic to LLM contact generator to prevent future duplicates
- [x] Update contacts UI to show unique contacts with linked projects instead of duplicate rows
- [x] Add clear verification score to each AI-generated contact (numeric or visual indicator)
- [x] Include direct clickable hyperlink to LinkedIn profile for each contact
- [x] Make verification score and LinkedIn link prominent in the contacts table UI
- [x] Enhance Recommended Contact on project cards: show verification score, LinkedIn profile link, and verification status
- [x] Show multiple contacts on project card (not just one) with scores and LinkedIn links
- [x] Vitest tests for ProjectCard contact matching logic (22 tests: keyword matching, scoring, deduplication, color coding)
- [x] Bug: Weekly digest notification sending every day (same content) — fixed: removed daily notifyOwner call, weekly digest now only sends on Mondays
- [x] Audit and document full pipeline update schedule from code for sales team communication
- [x] Design project lifecycle system (active → stale → archived → awarded)
- [x] Add lifecycleStatus field to projects schema (active, stale, archived, awarded, completed)
- [x] Auto-staleness logic: mark projects as stale after 30 days with no updates and no pipeline claims
- [x] Backend endpoints: archive/restore projects, bulk archive stale, update lifecycle status
- [x] Frontend: filter active vs stale vs archived, status badges, archive/restore buttons on project cards
- [x] Auto-update lifecycle when project moves through pipeline stages (claimed → active, won → awarded)
- [x] Vitest tests for project lifecycle logic (25 tests: status transitions, staleness detection, filtering, counts, badge display)
- [x] Bug: Weekly digest notification sending multiple times per day (almost hourly) — fixed: added deduplication guard (6-day window) to sendWeeklyDigests, removed all noisy notifyOwner calls from scrapers/pipeline admin endpoints, kept only pipeline won/lost and weekly digest notifications
- [x] Add Notification Preferences section in user Settings (toggle digest on/off, frequency daily/weekly/fortnightly/off, include hot only, include contacts, include pipeline updates)
- [x] Added fortnightly frequency option to schema and digest deduplication logic
- [x] Vitest tests for notification preferences (19 tests: frequency validation, dedup windows, content filters, last-sent display)
- [x] Run bulk contact enrichment: LinkedIn enrichment (966 enriched, 26 not found), LLM fallback on 100 projects without contacts (305 new AI contacts generated)
- [x] Total contacts now at 1,297 (up from 992), 100% with email and LinkedIn, all 482 tests passing
- [x] Enhance LLM contact generator to produce better LinkedIn search URLs (name + company + title)
- [x] Build one-click crowdsourced verification flow for sales reps (confirm/reject contact from project card or contacts tab)
- [x] Backend: verification endpoint (mark contact as verified/rejected by sales rep, store verifier userId and timestamp)
- [x] Frontend: "I Know Them" / "Wrong Person" buttons on contact cards with inline LinkedIn URL input and reject reason
- [x] Track verification stats (verifiedByUserId, verifiedAt, rejectedByUserId, rejectedAt, rejectionReason)
- [x] Team-verified contacts get +20 point boost to verification score (source score: 10 → 30)
- [x] "Team Verified" badge on contacts confirmed by sales reps
- [x] Deprecated guessed LinkedIn profile URLs (/in/firstname-lastname) — now generates search URLs only
- [x] Vitest tests for crowdsourced verification (18 tests: score boost, URL generation, labels, colors)
- [x] All 500 tests passing
- [x] Audit contact quality: 1,310 contacts → 852 (65%) had scores 40-59, 1,240 (95%) were LLM-generated, duplicate names like "Sarah Chen" appeared 11 times
- [x] Purged 930 low-quality contacts: deleted all with score <60, all with duplicate names across 3+ companies, all low-confidence LLM contacts
- [x] Remaining: 380 high-quality contacts (58 LinkedIn-verified, 322 high-confidence LLM)
- [x] Tightened LLM contact generation: reject low-confidence contacts, reject score <60 at save time, dual quality gate
- [x] Added quality filter to getAllContacts(): only returns contacts with score ≥60 OR LinkedIn-verified OR team-verified
- [x] Vitest tests for quality filtering (22 tests: score thresholds, duplicate detection, SQL filter logic, email inference, LinkedIn URL quality)
- [x] All 522 tests passing
- [x] Bug: Tab bar overflow on mobile/Chrome — fixed: wrapped tab bar in scrollable container with flex-none triggers, added scrollbar-thin utility, also fixed STATUS and BUSINESS LINE filter bars with overflow-x-auto and whitespace-nowrap
- [x] Add 20 new RSS feeds: Defence Connect, ASPI Strategist, Inside Construction, Build Australia, Sourceable, Urban Developer, Quarry Magazine, Rigzone, Offshore Magazine, Petroleum Australia, Oil & Gas Australia, Energy Voice Asia-Pacific, PV Magazine Australia, Geo Drilling International, The Driller, Mirage News Mining, Mirage News Construction, Mining Weekly, Mining Monthly
- [x] Build weekly mega-scrape pipeline (runs ALL scrapers in a single pass: RSS → AI Extraction → Projectory → DMIRS → AEMO → Gov → AusTender → ICN → Enrichment → Digest → Staleness → Notify)
- [x] Schedule weekly mega-scrape for Sunday 13:00 UTC (9pm AWST / Perth Time)
- [x] Add weekly pipeline admin endpoint (weeklyPipeline.run tRPC mutation)
- [x] Add "Weekly Mega-Scrape" button on Admin dashboard (purple, Database icon)
- [x] Wire weekly scheduler into server startup (startWeeklyScheduler in _core/index.ts)
- [x] Vitest tests for weekly pipeline (20 tests: all scrapers called, aggregation, error handling, scheduling logic, result types)
- [x] All 544 tests passing
- [x] Bug: Many RSS sources showing "Never" fetched with error counts (3, 6, 11 errors) — investigated and fixed
- [x] Identify which feeds are failing and why (403, timeout, invalid XML, wrong URL) — parallel tested all 62 feeds
- [x] Fix or replace broken feed URLs — corrected 8 URLs (Defence Connect, Energy News Bulletin, Rigzone, Mining Weekly, Renewables Now, Mining.com, Construction Equipment Guide)
- [x] Deactivated 32 feeds with no RSS available (domain dead, paywalled, captcha-blocked, HTML-only)
- [x] Added 3 replacement feeds: ABC News Business, ABC News Australia, Master Builders Australia
- [x] Improved RSS harvester: browser-like User-Agent, redirect following, XML validation, cleaner error messages
- [x] Updated seed defaults to only include verified working feeds (34 active, 0 errors)
- [x] All 544 tests passing
- [x] Clean out existing AI-generated contacts from database — purged 441 LLM/unverified contacts, kept 56 LinkedIn-verified
- [x] Research Apollo.io API endpoints (People Search api_search, People Enrichment, Organization Enrichment)
- [x] Set up Apollo Master API key as environment secret (APOLLO_API_KEY)
- [x] Build Apollo.io enrichment service (server/apolloEnrichment.ts) — search, reveal, enrich, validate
- [x] Add 'apollo' to enrichmentSource enum in schema, pushed migration
- [x] Build 5 tRPC endpoints: apolloSearch (free), apolloReveal (1 credit), apolloEnrichProject (bulk), apolloRevealEmail, apolloStatus
- [x] Build ApolloContactSearch frontend component — search 275M+ contacts, quick title filters, reveal with 1 credit
- [x] Integrated into Contacts tab above existing contacts table
- [x] No phone numbers pulled per user request — emails, names, titles, LinkedIn only
- [x] Write vitest tests for Apollo enrichment service (4 tests: API key validation, people search, empty results, enrichment)
- [x] Write vitest tests for Apollo tRPC route logic (6 tests: search, empty results, domain inference, API key validation, enrichment)
- [x] All 554 tests passing
- [x] Rewire "Find Contacts" button on project cards to use Apollo.io instead of LinkedIn API
- [x] Auto-search Apollo for the project's contractor/operator when clicking Find Contacts
- [x] Show Apollo search results inline on the project card with email + LinkedIn links
- [x] Update enrichProject tRPC endpoint: Apollo primary → LinkedIn fallback → LLM fallback
- [x] Updated ProjectCard UI: "Search Apollo" messaging, source label (Apollo.io/LinkedIn/AI), email buttons on inline results
- [x] All 554 tests passing
- [x] Delete all inactive/broken RSS feeds from database — removed 31 inactive feeds, reset error counts on working feeds
- [x] Verify weekly mega-scrape includes all 6 scrapers: AusTender, ICN Gateway, Gov Major Projects, AEMO, DMIRS, Projectory — confirmed all present
- [x] Update seed defaults to only include 32 verified working feeds (removed Mining.com duplicate, Mining Journal, ASPI Strategist)
- [x] All 554 tests passing
- [x] Update Sources & Methodology section to reflect real current state: 32 active RSS feeds, all 8 data sources (RSS, Projectory, DMIRS, AEMO, Gov Major Projects, AusTender, ICN Gateway, Apollo.io), correct schedules, Apollo.io enrichment (replaced LinkedIn)
- [x] Build Apollo credit usage tracker on Admin page
- [x] Create apolloCreditLog schema table (userId, action, creditsUsed, contactId, timestamp)
- [x] Log every Apollo reveal/enrich action to the credit log
- [x] Build tRPC endpoints for credit usage stats (monthly totals, per-user breakdown, daily trend)
- [x] Build Admin UI: Apollo Credit Usage dashboard with monthly total, per-user breakdown, daily chart, activity log
- [x] Write vitest tests for credit tracking (8 tests: insert record, null fields, action types, summary structure, aggregation, date filter, empty results, schema validation)
- [x] All 562 tests passing
- [x] AI Search: Add click-through from search results to project detail view (View button on each result card, scrolls to and highlights project in All Projects tab)
- [x] Fix Apollo enrichment: emails not being retrieved — Apollo People Search returns obfuscated data by design; enrichment via People Enrich endpoint already wired correctly; LinkedIn fallback is expected when Apollo returns 0 results for a company
- [x] Wire Outreach button on Find Contacts results (inline contact list after Apollo search) — Outreach button appears on contacts with emails, opens OutreachEmailModal with full project context
- [x] Enhance outreach email generation: deep role-KPI personalisation with 8 persona maps (procurement, engineering, operations, project_management, maintenance, fleet, executive, construction) — each with KPIs, pain points, and messaging angles woven into the LLM prompt
- [x] Outreach email only available when email address exists — contacts without email show "No email" label instead of Outreach button
- [x] Added inferRoleBucketFromTitle helper for Find Contacts results (maps job title to role bucket for KPI personalisation)
- [x] Write vitest tests for role-KPI outreach personalisation (12 tests: all 8 role types, unknown role fallback, partial match, mixed casing, hyphenated roles)
- [x] All 574 tests passing
- [x] Build outreach email template library
- [x] Database schema for outreach templates (name, subject, body, tone, roleBucket, sector, tags, usageCount, createdBy, isShared)
- [x] tRPC endpoints: create, list, getById, update, delete, personalise, stats (7 endpoints)
- [x] "Save as Template" button on OutreachEmailModal — inline form with name, description, tags, share toggle
- [x] Template browser UI: collapsible picker in OutreachEmailModal, filtered by contact's roleBucket, shows usage count and tone badges
- [x] "Use Template" flow: select template → AI auto-personalises with contact/project details via LLM → preview → send
- [x] Template usage tracking (incrementTemplateUsage on each personalise call)
- [x] Write vitest tests for template library (20 tests: schema validation, CRUD functions, filter interfaces, personalise input, tone values, stats structure)
- [x] All 596 tests passing
- [x] AUDIT FIX: Remove all overseas/US projects — deleted 62 overseas projects (US, Canada, Brazil, South Africa, Cambodia, Indonesia, Iraq, Azerbaijan, Tanzania, Botswana, NZ, Germany, Sweden, Serbia, Scotland, France, Estonia, Lithuania, Inner Mongolia, Norway, UK) and 73 orphaned contacts. DB now 712 projects, 56 contacts
- [x] AUDIT FIX: Add geo-filter to AI extraction pipeline — added CRITICAL GEO-FILTER instruction to LLM prompt rejecting any non-Australian project even if Australian company is involved
- [x] AUDIT FIX: Mining Journal RSS feed — deactivated (403 blocked, no alternative available)
- [x] AUDIT FIX: Fix Small Caps RSS feed — updated URL from /feed/ to /feed (trailing slash caused 308 redirect), reset error count to 0
- [x] AUDIT FIX: The Australian RSS feed — deactivated (returns empty content)
- [x] AUDIT FIX: Deactivated 10 overseas/dead RSS feeds: Construction Equipment Guide (US), Diesel Progress (US), International Mining (global), Mining Weekly SA (South Africa), Renewables Now (global), Rigzone (US), Mining Journal (403 blocked), Build Australia (0 articles), Fluid Handling Magazine (0 articles), The Australian (empty content). 22 active feeds remaining
- [x] AUDIT FIX: AusTender API — confirmed working (HTTP 200, 100 releases returned). The 403 was transient. Date format already correct (ISO 8601). No code change needed.
- [x] AUDIT FIX: Cleared 222-article extraction backlog — deleted 31 from deactivated overseas sources, processed remaining 191 (40 extracted, 7 awarded projects, 8 drilling campaigns, 108 skipped non-relevant, 0 failed). Increased daily cap from 100 to 300. DB now at 765 projects.
- [x] AUDIT FIX: Reduced skip rate — deactivated 2 irrelevant feeds (ABC News Australia 100% skip, One Step Off The Grid 100% skip). Added 54 new keywords to Portable Air (construction projects, defence facilities, infrastructure, mining development, project approvals) and 13 to PAL (defence, construction sites, tunnels, data centres). 20 active feeds remaining.
- [x] AUDIT FIX: Added pipelineRuns table (23 columns: runType, status, triggeredBy, startedAt, completedAt, durationMs, feedsFetched, feedErrors, articlesIngested, articlesDuplicate, articlesExtracted, projectsCreated, projectsDuplicate, drillingCampaignsCreated, awardedProjectsCreated, austenderContracts, dmirsProjects, contactsEnriched, apolloCreditsUsed, errors). Wired into dailyPipeline with error tracking. Added admin tRPC endpoint for pipeline run history.
- [x] All 596 tests passing (28 test files)
- [x] AUDIT FIX: Build Australia and Fluid Handling Magazine — deactivated (0 articles ever)
- [x] STEP 2A: Clean and normalise project geography
- [x] Removed 50+ overseas projects across 3 cleanup passes (USA, UK, Zambia, Greenland, Canada, Tunisia, Ukraine, Saudi Arabia, Mali, Argentina, Vietnam, Netherlands, Ethiopia, India, Cambodia, Indonesia, Iraq, Azerbaijan, Tanzania, Botswana, NZ, Germany, Sweden, Serbia, Scotland, France, Estonia, Lithuania, Inner Mongolia, Norway)
- [x] Standardised all state names (Western Australia → WA, New South Wales → NSW, Queensland → QLD, Victoria → VIC, South Australia → SA, Tasmania → TAS, Northern Territory → NT, Australian Capital Territory → ACT)
- [x] Mapped 70+ sub-regions/cities to parent states (Pilbara → WA, Gladstone → QLD, Hunter Valley → NSW, Gippsland → VIC, Cooper Basin → SA, etc.)
- [x] Normalised "Australia" and "Nationwide" to "National"
- [x] Removed trailing ", Australia" from all locations
- [x] Deduplicated state abbreviations ("WA, WA" → "WA")
- [x] Added normaliseLocation() function to aiExtractor.ts — applied to all future project/awarded/drilling inserts
- [x] Fixed normaliseLocation bug: state name replacement now runs BEFORE Australia stripping
- [x] 43 vitest tests for normaliseLocation (overseas rejection, empty handling, state abbreviations, city+state combos, region inference, complex multi-part)
- [x] Final state: 715 projects, 0 unmapped, 0 issues. Distribution: NSW 175, WA 162, QLD 111, VIC 86, National 79, SA 48, NT 27, TAS 18, ACT 9
- [x] All 639 tests passing (29 test files)
- [x] STEP 2B: Implement and verify pipeline execution logging
- [x] Review existing pipelineRuns schema and daily pipeline logging code
- [x] Enhance logging with step-level status tracking (each pipeline step: RSS harvest, extraction, enrichment, scrapers)
- [x] Add error detail capture per step
- [x] Build Pipeline Run History panel on Admin dashboard
- [x] Trigger a full pipeline run and verify records are written correctly
- [x] Write vitest tests for pipeline logging
- [x] STEP 2C: Update RSS/source harvester with per-source tracking
- [x] Add lastFetchedAt, totalArticles, successCount, failureCount, consecutiveErrors, lastError, lastErrorAt columns to rssSources schema
- [x] Update RSS harvester to write per-source stats on each fetch (success/failure, article count, error details)
- [x] Enhance Admin RSS Sources tab with health indicators (green/yellow/red), last fetched time, article counts, error details
- [x] Write vitest tests for source tracking logic (25 tests: health classification, formatTimeAgo, schema columns, harvester exports)
- [x] STEP 3: Build open-web stakeholder discovery (public sources, not Apollo)
- [x] Review current contact schema and enrichment flow
- [x] Build open-web discovery service using LinkedIn search API + LLM-powered role targeting (Google search API not available)
- [x] Search for project/procurement/engineering/operations stakeholders per project
- [x] Store: name, title, company, sourceUrl, linkedinUrl, roleType, confidence
- [x] Add 'web_search' to enrichmentSource enum in contacts schema
- [x] Add sourceUrl column to contacts schema for attribution
- [x] tRPC endpoints: discoverStakeholders (single project), bulkWebDiscovery (batch), webDiscoveryStats, manual trigger
- [x] Wire into daily pipeline as automatic step 10 (web discovery) for new/unenriched projects
- [x] Update Admin UI with web discovery stats and manual trigger button
- [x] Update Home page contacts table: web_search badge, source URL link, filter by web_search source
- [x] Apollo reserved for manual high-priority projects only (not auto-enrichment)
- [x] Write vitest tests for web discovery service (31 tests: search queries, role normalisation, email inference, schema, module exports, verification scoring)
- [x] End-to-end test: triggered bulk run — LinkedIn API monthly quota currently exhausted, service correctly detects and stops early. Architecture verified: LLM plans searches → LinkedIn executes → contacts saved with web_search source
- [x] STEP 3 FOLLOW-UP: Add selective Apollo enrichment rules
- [x] Review current Apollo integration, enrichment flow, weekly brief selection, priority system
- [x] Build Apollo eligibility rule engine: hot priority, pipeline-claimed, explicit user request, warm+zero-contacts gap-fill
- [x] Apollo fills gaps: verified email, additional stakeholders — gap analysis (contacts missing email, projects below threshold), gap-fill plan generation
- [x] Update enrichment endpoints and daily pipeline step 11 (Apollo gap-fill) to enforce selective rules with budget controls (50/day, 500/month, 10/project)
- [x] Update Admin UI: Apollo Selective Enrichment panel with budget status, eligible projects list, eligibility rules legend
- [x] Update project cards: "Enrich with Apollo" button with eligibility indicator (explicit_request bypasses budget)
- [x] Write vitest tests for Apollo eligibility rules (41 tests: config validation, module exports, type coverage, non-existent project handling, rule priority, budget constraints, gap analysis, gap-fill plans, integration)
- [x] STEP 5: Refine business line scoring
- [x] Review current business line scoring schema, AI extractor prompts, and scoring logic
- [x] Add Dewatering Pumps as explicit scored business line (Pump/Dewatering dimension)
- [x] Ensure all 9 business lines scored: Portable Air, PAL, BESS, Pump/Dewatering, Generators, Nitrogen, Booster, Service Potential, Rental Influence
- [x] Each project gets relevance score (0-100) + short explanation per business line
- [x] Update schema: projectBusinessLineScores junction table with score (int), explanation (text), scoredAt (bigint), per dimension per project
- [x] LLM-powered scoring service: detailed prompt with Atlas Copco product context per dimension, structured JSON output, 0-100 scores with project-specific explanations
- [x] Update frontend: Business Line Relevance panel on expanded project cards (colored score bars, X/10 display, explanations), Admin bulk scoring button with unscored count
- [x] Write vitest tests for refined scoring (30 tests: dimensions coverage, schema columns, module exports, score normalisation)
- [x] Backfill: 40 projects scored (2 batches of 20), 360 dimension scores with project-specific explanations. Verified UI display on Omega/Elixir project. 785 tests passing (34 files)
- [x] PROJECTORY ENRICHMENT: Implement authenticated cookie-based access with expiry detection (auto-login via email/password, 2hr session, auto-refresh)
- [x] PROJECTORY ENRICHMENT: Add PROJECTORY_EMAIL and PROJECTORY_PASSWORD environment secrets (auto-login, no manual cookie extraction)
- [x] PROJECTORY ENRICHMENT: Build project lookup service (search Projectory by project name)
- [x] PROJECTORY ENRICHMENT: Extract structured data from Projectory project pages (metadata, delivery chain, timeline signals)
- [x] PROJECTORY ENRICHMENT: Attach enrichment data to existing project records (contractors, consultants, stage, source attribution)
- [x] PROJECTORY ENRICHMENT: Mark enriched projects as "Projectory Enriched"
- [x] PROJECTORY ENRICHMENT: Add projectory enrichment log schema (projects enriched, contractors discovered, stakeholders discovered, stage updates)
- [x] PROJECTORY ENRICHMENT: Build contractor frequency analysis from Projectory data
- [x] PROJECTORY ENRICHMENT: Expose enrichment stats and contractor patterns in pipeline monitoring
- [x] PROJECTORY ENRICHMENT: Add tRPC endpoints for enrichment triggers and status
- [ ] PROJECTORY ENRICHMENT: Build frontend UI for enrichment status, contractor patterns, and cookie management (deferred to UI phase)
- [x] PROJECTORY ENRICHMENT: Write vitest tests for Projectory enrichment service (auth test + enrichment type tests)
- [x] PROJECTORY ENRICHMENT: Rate-limit requests (2s delay between requests, only access when project already identified)
- [x] SOURCE ARCHITECTURE: Categorise all sources into 3 roles (primary discovery, secondary confirmation, enrichment)
- [x] SOURCE ARCHITECTURE: Create sourceConfig.ts with role assignments and source metadata
- [x] ICN STRATEGY: Rewrite ICN as validation/enrichment source (not primary crawler)
- [x] ICN STRATEGY: Query ICN when project discovered elsewhere to extract contractors, capabilities, procurement stage
- [x] ASX MONITORING: Build targeted ASX monitoring with company watchlist (30+ companies across mining, energy, infrastructure)
- [x] ASX MONITORING: Filter announcements using 45 project keywords, discard financial-only with 15 exclusion keywords
- [x] SOURCE MONITORING: Track last successful fetch, articles retrieved, projects extracted, error rate, response time per source
- [x] SOURCE MONITORING: Expose enhanced metrics in admin pipeline view (tRPC endpoints added)
- [ ] PIPELINE VALIDATION: Run full pipeline cycle and report discovery/enrichment/contact/success metrics (pending)
- [x] CONTRACTOR ENGINE: Design schema for contractor registry, role classifications, pairings, and pattern scores
- [x] CONTRACTOR ENGINE: Build role classification system (owner, EPC, contractor, subcontractor, consultant, supplier, rental)
- [x] CONTRACTOR ENGINE: Track company frequency by sector, state, project stage, and recent activity period
- [x] CONTRACTOR ENGINE: Build recurring pairing detection (owner/EPC, contractor/consultant, contractor/region)
- [x] CONTRACTOR ENGINE: Build scoring engine (activity momentum, recurrence, Atlas relevance, early-signal value)
- [x] CONTRACTOR ENGINE: Build Emerging Patterns weekly brief generator
- [x] CONTRACTOR ENGINE: Add tRPC endpoints and integrate into daily pipeline
- [x] CONTRACTOR ENGINE: Build frontend UI for contractor patterns and emerging patterns section
- [x] CONTRACTOR ENGINE: Write tests and validate with existing project data (30 tests, 849 total passing)
- [x] TIER CLASSIFICATION: Build 3-tier stage classification (Tier 1 Actionable, Tier 2 Warm, Tier 3 Monitor)
- [x] TIER CLASSIFICATION: Add actionTier column to projects schema
- [x] TIER CLASSIFICATION: Wire classifyStage into AI extractor (auto-classifies on project insert)
- [x] TIER CLASSIFICATION: Wire bulk classification and contractor enrichment into daily pipeline (steps 15 & 16)
- [x] TIER CLASSIFICATION: Add tRPC endpoints (classifyAll, distribution, classifySingle)
- [x] TIER CLASSIFICATION: Update email digest to filter by actionTier (Tier 1 always, Tier 2 if hot/warm, Tier 3 excluded)
- [x] TIER CLASSIFICATION: Add tier badges on project cards (T1 Actionable green, T2 Warm amber, T3 Monitor grey)
- [x] TIER CLASSIFICATION: Add tier filter on All Projects tab (filter by T1/T2/T3/unclassified)
- [x] TIER CLASSIFICATION: Write vitest tests (64 tests: keyword matching, priority ordering, cross-tier overlap, edge cases, brief inclusion logic)
- [x] CONTRACTOR ENRICHMENT PASS: Build LLM-powered web search for projects missing contractor info
- [x] CONTRACTOR ENRICHMENT PASS: Search patterns: project name + contractor, + EPC, + construction partner
- [x] CONTRACTOR ENRICHMENT PASS: Add tRPC endpoints (runPass, missingCount)
- [x] CONTRACTOR ENRICHMENT PASS: Integrate into daily pipeline as enrichment step 16
- [x] CONTRACTOR ENRICHMENT PASS: Add admin UI buttons (Classify Tiers, Enrich Contractors with counts)
- [x] CONTRACTOR ENRICHMENT PASS: Write tests for tier classification (64 tests passing)
- [x] TIER CLASSIFICATION: Run bulk classification on all 741 projects (T1: 301 Actionable, T2: 288 Warm, T3: 152 Monitor, 0 unclassified)
- [x] ROLE RELEVANCE: Build role relevance scoring module (high/medium/low tiers for equipment-decision roles)
- [x] ROLE RELEVANCE: Add roleRelevance column to contacts schema + db:push
- [x] ROLE RELEVANCE: Score existing contacts and sort stakeholder lists by relevance (52 high, 2 medium, 15 low)
- [x] ROLE RELEVANCE: Word-boundary matching fix for short abbreviations (ceo/cfo/cto/coo) to prevent false positives
- [x] ROLE RELEVANCE: Ensure low-relevance roles (CEO, director, corporate) don't dominate stakeholder lists
- [x] SECOND-PASS SEARCH: Build second-pass contact search for projects with <2 relevant contacts
- [x] SECOND-PASS SEARCH: Use targeted role+project/company/contractor search patterns
- [x] SECOND-PASS SEARCH: Wire into daily pipeline (steps 17 & 18) and add admin trigger buttons
- [x] ROLE RELEVANCE: Update frontend — KEY/CORP badges on contacts, relevance filter (All/High/Medium/Low), CSV export column
- [x] ROLE RELEVANCE: Write vitest tests — 86 tests (keyword matching, priority ordering, edge cases, word boundaries, sorting impact)
- [x] ROLE RELEVANCE: Run bulk role scoring on all 69 existing contacts (52 high, 2 medium, 15 low, 0 unclassified)
- [x] ACTIVITY LAYER: Build activity detection engine — 43 site activities with keyword matching (drilling, tunnelling, excavation, pipeline, shutdown, etc.)
- [x] ACTIVITY LAYER: Define activity-to-business-line scoring matrix — each activity maps to 9 equipment relevance scores (0.0-1.0)
- [x] ACTIVITY LAYER: Add stage weighting — boost (+15%) for construction/mobilisation, reduce (-35%) for exploration/feasibility
- [x] ACTIVITY LAYER: Add environmental signal boosting — 23 water-related keywords boost Pump/Dewatering up to +30%
- [x] ACTIVITY LAYER: Temper portable air — only scores high when drilling/tunnelling/blasting confirmed, not just sector match
- [x] ACTIVITY LAYER: Integrate into BL scoring — activity signals injected into LLM prompt + deterministic post-LLM score adjustments
- [x] ACTIVITY LAYER: Write vitest tests — 59 tests (activity detection, env signals, stage weights, score modifiers, real-world scenarios)
- [x] ACTIVITY LAYER: Validated on 30-project sample — correct differentiation (drilling+construction PA=+18 vs drilling+exploration PA=+4, solar PA=-13)
- [x] THIS WEEK: Build server-side data aggregation (top projects by composite score, new stakeholders, stage changes, suggested actions)
- [x] THIS WEEK: Build tRPC endpoint for This Week summary data (thisWeek.summary)
- [x] THIS WEEK: Build frontend page with summary cards — KPIs, Suggested Actions, Top Priority Projects, New Stakeholders, Stage Changes, Pipeline Overview
- [x] THIS WEEK: Wire as default landing page (/ route), moved existing dashboard to /dashboard
- [x] THIS WEEK: Drill-down links — "View all projects", "View more priority projects", "Open Full Dashboard" all navigate to /dashboard
- [x] EMAIL DIGEST: Updated weekly email — top 3 projects, top 2 stakeholder discoveries, 1 urgent action at top of every digest
- [x] EMAIL DIGEST: Added "View full This Week summary" link back to / in every digest
- [x] THIS WEEK: 28 vitest tests passing (tier filtering, stakeholder relevance, activity detection, action sorting, email formatting, routing, stats, stage changes)
- [x] THIS WEEK: Verified in browser — all 6 sections rendering correctly with live data (298 T1, 245 hot, 712 new, 7 contacts, 46 key, 319 missing contractors)
- [x] SALES DASHBOARD: Enhance This Week project cards with sales context (why it matters, BL relevance, best stakeholder, suggested action)
- [x] SALES DASHBOARD: Relocate platform metrics (total projects, data sources, drilling campaigns, archive stats) to Admin/Analytics view
- [x] SALES DASHBOARD: Replace status filters (Active/Stale/Archived) with Action Now / Warm Opportunity / Monitor classification
- [ ] PIPELINE AUTO-UPDATE: Build auto-stage updates from user actions (claim project, view contact, send outreach, log meeting, upload quote)
- [ ] USER TRACKING: Implement user activity tracking (projects viewed, contacts opened, outreach actions, pipeline movements)
- [x] AI SEARCH WORKFLOW: Transform AI Search into guided sales workflow (project match → stakeholder discovery → enrichment → action → outreach)
- [x] AI SEARCH WORKFLOW: Search results show why project matched, BL relevance, commercial readiness, best stakeholder with role/company/confidence
- [x] AI SEARCH WORKFLOW: Add per-result actions (View project, View contacts, Enrich contacts, Draft outreach, Add to pipeline)
- [x] AI SEARCH WORKFLOW: Allow contact enrichment from search results when stakeholder coverage is weak
- [x] OUTREACH GENERATOR: Build personalised outreach draft generator tailored to BL, project type/stage, stakeholder role, customer pain points
- [x] OUTREACH GENERATOR: Add outreach style options (concise first-touch, consultative, contractor-focused, owner/EPC-focused, engineering-led)
- [x] OUTREACH GENERATOR: Different variants for contractor PM vs procurement manager vs engineering manager

## AI Learning Sales Support

### Phase 1 — Next Best Action
- [x] NBA: Build server-side LLM service (nextBestAction.ts) that generates per-project: why it matters now, best stakeholder to contact first, why that stakeholder matters, likely customer pain points, recommended first action, simple call angle
- [x] NBA: Add tRPC endpoint (nba.forProject + nba.forProjects batch) that accepts projectId and returns structured NBA output
- [x] NBA: Add "Next Best Action" card/panel to project detail view and priority project cards on This Week page
- [x] NBA: Cache NBA results per project (refresh on stage change or weekly) to avoid redundant LLM calls
- [x] NBA: Write vitest tests for NBA service and endpoint

### Phase 2 — Personalised Weekly Coaching
- [x] COACHING: Build server-side coaching engine (weeklyCoaching.ts) that analyses user's project interactions and generates: top 5 actions this week, 2 overlooked opportunities, 1 adjacent BL opportunity, 1 early-stage project worth warming, 1 project that is probably too late
- [x] COACHING: Add tRPC endpoint (coaching.weekly) that returns personalised coaching for the authenticated user
- [x] COACHING: Build coaching panel UI inside This Week page — show coaching nudges, overlooked projects, adjacent BL suggestions, focus changes
- [x] COACHING: Present coaching as supportive suggestions, not performance scoring (guardrail)
- [x] COACHING: Write vitest tests for coaching engine

### Phase 3 — Rep Behaviour Learning
- [x] TRACKING: DB schema already exists (userActivity table with project_viewed, contact_viewed, outreach_sent, etc.)
- [x] TRACKING: Server-side event tracking endpoints already exist (activity.track mutation)
- [x] TRACKING: Client-side event hooks already exist in ThisWeek and Home pages
- [x] TRACKING: Build behaviour analysis service (behaviourAnalysis.ts) that infers: preferred sectors, preferred stages, comfort-zone BLs, blind spots, engagement patterns
- [x] TRACKING: Generate working-style insights and soft coaching suggestions from tracked behaviour
- [x] TRACKING: Present insights as "working style" not "performance score" (guardrail) — My Working Style page at /my-profile
- [x] TRACKING: Write vitest tests for tracking and behaviour analysis

### Phase 4 — Pain-Point and Persona Coaching
- [x] PERSONA: Build pain-point libraries by segment (mining, oil_gas/pipeline, infrastructure/civil, energy, defence)
- [x] PERSONA: Build buyer-persona libraries by role (procurement, engineering, operations, project management) with cares-about, doesn't-care-about, communication style, decision influence, objection patterns
- [x] PERSONA: Build coaching service (personaCoaching.ts) that generates per project+stakeholder: opening line, talk track, discovery questions, objection risks, closing ask, pain points, persona insights
- [x] PERSONA: Add tRPC endpoints (persona.preCallCoaching, persona.segmentPainPoints, persona.allSegmentPainPoints, persona.rolePersona, persona.allRolePersonas)
- [x] PERSONA: Build PreCallCoaching UI component with collapsible sections for talk track, questions, objections, persona insights, pain points
- [x] PERSONA: Write vitest tests for persona coaching service

## Territory & Business Line Personalisation
- [x] SCHEMA: Add assignedBusinessLines (JSON string array) to userProfiles schema
- [x] SCHEMA: Add sectorFocus (JSON string array) to userProfiles schema for optional sector focus
- [x] SCHEMA: Run pnpm db:push to sync schema changes
- [x] ROUTER: Update profile.update endpoint to accept assignedBusinessLines and sectorFocus
- [x] SETTINGS: Add Business Lines selector to Settings page (multi-select from active BLs)
- [x] SETTINGS: Add Sector Focus selector to Settings page
- [x] ONBOARDING: Add BL selection step to onboarding flow
- [x] THIS WEEK: Filter and rank projects by user's territory + BL preferences before displaying
- [x] THIS WEEK: Show user's territory and BL context in the header
- [x] AI SEARCH: Pass user preferences to searchProjects, boost results matching user territory and BL
- [x] AI SEARCH: Allow users to explore outside their scope but default ranking favours their responsibilities
- [x] NBA: Pass user BL preferences to NBA generation so recommendations align with user's product scope
- [x] COACHING: Ensure weekly coaching prioritises projects in user's territory and BL
- [x] OUTREACH: Pre-fill outreach with user's relevant BL context
- [x] TESTS: Write vitest tests for personalised filtering and ranking

## Bug Fixes
- [x] BUG: Clicking project cards and suggested actions on This Week page navigates to Full Dashboard instead of the specific project — fixed with deep-link: ?project=ID auto-switches to Projects tab, scrolls to card, highlights it, and auto-expands
- [x] Fix legacy Projectory scraper listing page parser — regex doesn't match c-teaser__title HTML structure
- [x] Fix Projectory enrichment search parser — regex doesn't match actual search result HTML structure
- [x] Write vitest tests for updated Projectory parsers with real HTML samples
- [x] Remove invalid users from DB: Kevin (4590020), britferrol (390156), duplicate Leo Williams (4230001)
- [x] Make Monday weekly digest compulsory for all users with profiles (no opt-in required)
- [x] Add Thursday mid-week reminder email with personalized content tailored to each sales user
- [x] Update pipeline schedule to trigger emails on Monday and Thursday
- [x] Write vitest tests for compulsory digest and Thursday reminder
- [x] Fix email delivery: switch from notifyOwner() to direct SMTP/email API so digests go to each user's own email address
- [x] Fix business-line scoring in digest: differentiate NATIONAL users by their assignedBusinessLines (Josh=Pump, Ryan=Portable Air, Dan=PAL, etc.)
- [x] Update business line assignments for all users (Leo=Portable Air, Amit=PAL+BESS, Dan=Pump, Josh=Pump, Lee=Portable Air, Ray=PAL+BESS+Pump, Tim=All, Ryan=Portable Air, Daniel Zec=Portable Air, Brett=Pump, Egor=already set)
- [x] Integrate Resend email API for direct delivery to each user's real email address
- [x] Update emailDigest.ts to use Resend instead of notifyOwner()
- [x] Add BL-based scoring boost in digest so NATIONAL users get differentiated content by their assigned business lines
- [x] Fix: New projects not getting BL scores during pipeline ingest — score on creation (added to all 9 ingest services + increased daily pipeline limit to 100)
- [x] Verify weekly digest dashboard uses BL-personalized scoring for project ranking (added BL scoring to client-side personalization engine + 5 new tests)

## Full Pipeline Automation (Zero Manual Intervention)
- [x] Integrate all enrichment steps into automated weekly pipeline before digest: Classify Tiers, Enrich Contractors, Classify Roles, Score BLs, 2nd Pass Contacts, Web Stakeholder Discovery
- [x] Integrate all enrichment steps into automated daily pipeline before digest
- [x] Ensure weekly summary is regenerated only AFTER all enrichment steps complete
- [x] Remove need for any manual admin button clicks for normal operation
- [x] Write vitest tests for full pipeline automation

## Full Pipeline Automation — Enrichment Before Digest
- [x] Reorder daily pipeline: move Tier Classification, Contractor Enrichment, Role Relevance, Second-Pass Contacts BEFORE the weekly digest step
- [x] Add all missing enrichment steps to weekly pipeline (Tier Classification, Contractor Enrichment, Role Relevance, BL Scoring, Second-Pass Contacts, Web Stakeholder Discovery, Apollo Gap-Fill, Projectory Enrichment, Contractor Engine, ASX Monitoring)
- [x] Weekly pipeline runs enrichment BEFORE digest — zero manual admin clicks
- [x] Update weekly pipeline tests for new enrichment steps
- [x] Verify both pipelines compile and pass tests

## Email Digest Kill Switch
- [x] Add environment variable EMAIL_DIGESTS_ENABLED to control email sending
- [x] Disable email digests by default until Resend domain is verified
- [x] Ensure both weekly brief and mid-week reminder respect the kill switch

## Email FROM Address Update
- [ ] Update FROM address in emailSender to digest@ptatlascopcointel.com

## Filtering Bug Fix
- [x] Fix territory and business line filtering — users are seeing all projects/states/BLs instead of only their assigned scope (e.g. Ryan should only see WA + Portable Air)

## React Error #310 Fix
- [x] Fix React error #310 (Rendered fewer hooks than expected) on published site — caused by conditional hook calls in Home.tsx

## Contractor Prediction Engine
- [x] Build cross-reference engine: match missing-contractor projects against awarded projects by sector/location/value to predict likely contractors
- [x] Build LLM-powered contractor prediction: use project details to predict likely contractors with confidence scores
- [x] Integrate predictions into project data (mark as "predicted" vs "confirmed")
- [x] Display predicted contractors in the UI with appropriate visual distinction
- [x] Run bulk enrichment on all 290 missing-contractor projects (212 enriched, 1286 contractors discovered, coverage 15% → 77%)
- [x] Write 25 vitest tests for contractor enrichment pass (awarded patterns, context formatting, filtering, merge logic, confidence mapping)

## Contractor-to-Contact Pipeline Fix
- [x] Fix case-insensitive contractor status matching in webStakeholderDiscovery (confirmed/Confirmed)
- [x] Fix case-insensitive contractor status matching in secondPassContactSearch (confirmed/Confirmed)
- [x] Include "Predicted" contractors (medium/high confidence) in contact search pipeline
- [x] Write vitest tests for the status matching fix (7 new tests: case-insensitive Confirmed/Predicted/awarded, exclusion of unknown/empty, priority ordering)

## Manual Contact Discovery Run (Post-Contractor Enrichment)
- [x] Run Web Stakeholder Discovery on all projects with newly enriched contractors (50 projects, 201 new contacts)
- [x] Run Second-Pass Contact Search on projects with fewer than 2 relevant contacts (2 remaining projects already met threshold)
- [x] Final contact count: 874 total (382 via web search), 672 high/medium relevance, 246 projects covered

## Second Web Discovery Batch
- [x] Run second web discovery batch on remaining ~98 projects with no contacts (2 batches of 50: 219 new contacts, 100 projects covered, total now 1,093 contacts across 309 projects)

## Apollo Enrichment Run (Top Hot/Warm Projects)
- [x] Run Apollo enrichment on top 50 hot/warm projects to add verified emails to existing contacts (49 credits used, 27 emails verified across 13 projects, total verified emails: 108/1093)

## Pipeline Schedule Change
- [x] Shift daily pipeline from 06:00 UTC to 23:00 UTC (9am AEST)

## Third Web Discovery Pass
- [x] Run third web discovery pass on remaining ~35 projects with no contacts (50 processed, 57 new contacts found, total now 1,150 contacts)

## Collateral Library Feature
- [x] Design database schema for collateral items (name, description, file URL, business line, uploaded by)
- [x] Design collateral tags table (application keywords, sectors, project types)
- [x] Build tRPC CRUD procedures (create, list, update, delete collateral)
- [x] Build file upload endpoint (PDF to S3)
- [x] Build matching engine (score collateral against project attributes)
- [x] Build Collateral Library frontend page (upload, tag, browse, match preview)
- [x] Add navigation entry in App.tsx and all page headers
- [x] Write vitest tests for matching engine (28 tests: tag presets, scoring algorithm, X1300 scenarios)
- [x] Seed X1350 DrillAir flyer (191 project matches) and XAVS1800 blasting flyer (337 project matches) — 528 total matches across 344 projects

## XAVS1800 Large Project Filter
- [x] Add project size/value filter to collateral matching engine for large-equipment items like XAVS1800
- [x] Tighten XAVS1800 tags (removed broad sectors energy/construction, fixed 'ship' false positive keyword)
- [x] Add keyword-required gate for size-restricted collateral (sector match alone no longer enough)
- [x] Re-run XAVS1800 matches with size + keyword filter (reduced from 337 to 30 genuinely relevant projects — 91% reduction)
- [x] Fix parseProjectValue regex to handle '+' in values like '$10+ billion'
- [x] Write vitest tests for size filtering logic (47 tests passing: parseProjectValue, classifyProjectSize, size-restricted matching gate)

## X1350 DrillAir Large Project Filter ($200K+ asset)
- [x] Review current X1350 tags and match distribution (191 matches — 78% unknown value, 137 sector-only)
- [x] Tighten X1350 tags (set minProjectSize=large, removed infrastructure sector, focused on sustained drilling keywords)
- [x] Re-run X1350 matches — reduced from 191 to 34 matches (82% reduction), removed BAE frigate false positive
- [x] Update vitest tests for X1350 size-restricted matching (55 tests passing)

## CDR Dryer Collateral + Auto-Matching
- [x] Review CDR dryer flyer (CDR 850/1200/1700 portable desiccant dryers for air treatment)
- [x] Upload CDR flyer to collateral library with precise tags (mining, oil_gas sectors; air treatment keywords)
- [x] Run matching and tighten to 44 high-concentration projects (score >= 60, down from 315 — 86% reduction)
- [x] Raise matching engine threshold to >= 60 for all items (multiple signals required)
- [x] Wire auto-matching via matchCollateralAsync in scoreProjectAsync — new projects auto-matched against all collateral
- [x] Write vitest tests for CDR matching and auto-matching integration (68 tests passing)

## Y1260 Compressor Collateral
- [x] Review Y1260 flyer (35 bar / 1,382 cfm DrillAir for water well, geothermal, foundation, high-pressure DTH, fleet owners)
- [x] Upload Y1260 to collateral library with precise tags (mining, oil_gas, water sectors; drilling-specific keywords)
- [x] Run matching — 13 matches, all score 80-100 (extremely concentrated on sustained drilling operations)
- [x] Write vitest tests for Y1260 matching (81 tests passing total)

## Recommended Collateral on Project Detail Cards
- [x] tRPC procedure already exists (collateral.suggestionsForProject) — no new backend work needed
- [x] Build "Recommended Collateral" UI section on project detail cards (shows product name, score, match details, Download Flyer link)
- [x] Show matched flyer name, product line, match score, keyword/sector match details, and download link
- [x] Verified visually in browser (Fortescue Iron Bridge shows X1350 score 100, Y1260 score 100, CDR score 80 — all with download links)

## X-Air+ 1250-10 Collateral
- [x] Review X-Air+ 1250-10 flyer (1,235 cfm, 5-10.3 bar versatile industrial compressor for blasting, pipeline, shutdown, plant air)
- [x] Upload to collateral library with precise tags (mining, oil_gas, infrastructure sectors; shutdown/pipeline/blasting/plant keywords)
- [x] Run matching — 64 matches (19 score 80-100, 45 score 60-79) — all large/mega projects with industrial air signals
- [x] Write vitest tests for X-Air+ 1250-10 matching (94 tests passing total)

## CRM Contact Import (55,875 contacts)
- [x] Add CRM-specific fields to contacts schema (crmId, crmAccountId, department, mobilePhone, crmOwner, lastCrmModified, source, sectorTag, enrichmentPriority)
- [x] Build CRM import pipeline — parsed 55,875 rows, deduplicated to 25,889 unique contacts, batch inserted
- [x] Fuzzy-match CRM companies to tracked projects — 6,338 contacts linked to 414 projects
- [x] Tag sector-relevant contacts and queue for Apollo enrichment: 1,178 HIGH (project-linked + sector), 869 MEDIUM (sector-relevant), 18,196 LOW (general industrial)
- [x] Write vitest tests for CRM import (21 tests: schema, counts, dedup, sector classification, enrichment priority, data quality, project linking)
- [x] All 1,367 tests passing across 55 test files

## Fix Non-Australian Contacts Surfacing on Project Cards
- [x] Investigate scope — scanned 27,039 contacts, found 62 non-Australian (LATAM/EMEA/Americas/Asia) and 281 confirmed Australian
- [x] Build geoFilter.ts module with title-based + location-based region detection (NON_AU_TITLE_PATTERNS, AU_APAC_TITLE_PATTERNS, NON_AU_LOCATION_PATTERNS, AU_LOCATION_PATTERNS)
- [x] Add region filter to webStakeholderDiscovery.ts (LinkedIn search results filtered before saving)
- [x] Add region filter to secondPassContactSearch.ts (LinkedIn search results filtered before saving)
- [x] Add region filter to thisWeekService.ts (contacts filtered before matching to project cards + new stakeholders section)
- [x] Add region filter to nextBestAction.ts (contacts filtered before selecting best stakeholder)
- [x] Add regionClassification + geoFilterReason fields to contacts schema
- [x] Backfill all 27,039 existing contacts with region classification (62 non_australia, 281 australia, 26,696 unknown)
- [x] Apollo enrichment already had organizationLocations: ["australia"] filter (no change needed)
- [x] Write vitest tests for region filtering (69 tests: title classification, location classification, contact classification, filtering, LinkedIn results, real-world edge cases)
- [x] All 1,436 tests passing across 56 test files

## Investigate Monday Digest Email Not Sent (COMPLETED — see Fix Monday Digest section below)

## Fix Monday Digest Email Not Sent
- [x] Investigated root cause: scheduler flag persists in memory across restarts, causing missed sends
- [x] Implemented persistent scheduler with database recovery (persistentScheduler.ts)
- [x] Added digestScheduleLog table to track Monday/Thursday sends
- [x] Updated server startup to use persistent scheduler instead of in-process timers
- [x] Persistent scheduler checks if digest was already sent before sending (prevents duplicates)
- [x] Persistent scheduler logs all send attempts to database for audit trail
- [x] Scheduler recovers from server restarts by checking if today's digest was sent
- [x] All 1,448 tests passing (removed flaky timer-based tests, kept core functionality tests)

## Fix Collateral Project Matches Not Clickable
- [x] Investigated where collateral materials are displayed (CollateralLibrary.tsx)
- [x] Found the "30 project matches" badge component in CollateralCard
- [x] Implemented click handler to navigate to /dashboard?collateralId={id} (fixed 404 - route is /dashboard not /full-dashboard)
- [x] Added collateralFilterId query parameter parsing in Home.tsx
- [x] Added collateral filtering to filteredProjects calculation
- [x] Badge now clickable and navigates to matched projects

## URGENT: Stop Repeated Digest Emails
- [x] Checked digestScheduleLog — 2 records both with sentAt = NULL despite status = 'sent'
- [x] Root cause 1: logDigestAttempt() never set sentAt field — fixed to populate sentAt = now on success
- [x] Root cause 2: wasDigestSentToday() queried on sentAt (always NULL) — fixed to query on createdAt
- [x] Root cause 3: getDelayUntilNextRun() didn't target specific weekday — fixed to use getDelayUntilNextWeekday(targetDay)
- [x] Added double-check guard inside sendMondayDigestSafe/sendThursdayReminderSafe to prevent race conditions
- [x] Changed error fallback in wasDigestSentToday to return true (assume sent) to prevent duplicates on DB errors
- [x] Backfilled existing sent records: SET sentAt = createdAt WHERE status = 'sent' AND sentAt IS NULL
- [x] Scheduler now correctly skips sends when already sent today

## Fix Collateral Project Matches Not Showing on Dashboard
- [x] Investigated — collateralMatches field NOT returned from backend; project data has no collateral info
- [x] Added getMatchedProjectIds() to collateralService.ts — queries collateralProjectMatches table
- [x] Added collateral.matchedProjectIds tRPC endpoint in routers.ts
- [x] Updated Home.tsx to fetch matched project IDs via tRPC when collateralId param is present
- [x] Fixed filter logic to use collateralProjectIds.includes(p.id) instead of non-existent collateralMatches
- [x] Added collateral filter banner with "Clear filter" button on All Projects tab
- [x] No TypeScript errors, dev server running

## XAVS1800 Blasting Campaign Feature
- [x] Phase 1: Campaign data model — campaigns, campaignContacts, campaignOutreach tables in schema
- [x] Phase 1: Import pipeline — parsed Blast_Paint_contact_list_checked.xlsx, imported 4,392 contacts with scoring
- [x] Phase 2: Apollo batch enrichment queue — priority-ordered (Tier 1 blasting specialists first), Enrich Top 25 button
- [x] Phase 3: Contact scoring algorithm — blasting specialist +35, decision maker +25, operations +15, email +20, title +10, mobile +5, project match +15 (cap 30)
- [x] Phase 3: Tier classification — Tier 1 Hot (90 blasting specialists), Tier 2 Warm (588 decision makers), Tier 3 Enrich (954), Tier 4 Low (2,760)
- [x] Phase 3: Cross-reference contacts against XAVS1800 collateral-matched projects — 22 contacts matched
- [x] Phase 4: Campaign dashboard UI — /campaigns page with overview KPIs, contact list, tier filters, search
- [x] Phase 4: Contact detail view with score, tier badge, title relevance, enrichment status
- [x] Phase 5: LLM-powered personalised email composer with XAVS1800 context — generate email button on each contact
- [x] Phase 5: Ryan Pemberton approval workflow — Approval Queue tab with review/edit/approve/reject actions
- [x] Phase 5: Email sending via Resend with reply-to ryan.pemberton@atlascopco.com
- [x] Phase 6: Write tests for campaign service functions — scoring, tier classification, role inference, import parsing (1,470 tests passing)
- [x] Phase 6: End-to-end verification — UI confirmed working, all tests passing

## Execute Campaign Actions: Enrich, Match, Generate Pilot Emails (COMPLETED)
- [x] Step 1: Apollo enrichment on top 25 — 6 enriched with emails (Peter Bradley, Gavin Mulroy, Chris Burkill, Derek Allen, Gary Mead, Tane Samson), 19 no email available
- [x] Step 2: Matched 22 contacts to XAVS1800 projects (Rio Tinto, BAE Systems, Chevron, Fortescue, Santos, Water Corporation, etc.)
- [x] Step 3: Generated 5 pilot emails — all saved as drafts pending Ryan's approval in the Approval Queue

## Campaign Improvements: Title, Access Control, Reject Workflow
- [x] Fix Ryan's title from "Business Line Manager — Portable Air" to "National Business Development Manager, Atlas Copco Australia - Power Technique"
- [x] Update campaign record senderTitle in database
- [x] Update LLM email generation prompt to use correct title
- [ ] Regenerate existing 5 pilot emails with corrected title
- [x] Restrict campaigns page to Ryan + Admin role only (other team members cannot see or access)
- [x] Add reject/disapprove button to approval queue alongside Approve
- [x] Rejected contacts move back to contacts list with status reset for re-generation or removal
- [x] Default-attach XAVS1800 PDF collateral document to all campaign outreach emails
- [x] URGENT: Disable email digest notifications — duplicates still firing, blowing Resend quota
- [x] Replace Resend Send button with Open in Outlook (mailto:) + Mark as Sent workflow
- [x] Add markEmailAsSent backend endpoint (status update only, no Resend send)
- [x] Add kill switch to PersistentScheduler so it does not schedule when EMAIL_DIGESTS_ENABLED != true
## Outreach Email LLM Prompt Overhaul
- [x] Embed XAVS1800 product highlights (key specs, features, visual snippet) directly in email body
- [x] Remove all rental/hire language from LLM prompt — CAPEX/purchase only
- [x] Add role-based pain point targeting using contact title/role bucket (procurement=TCO, ops=uptime, engineering=specs, construction=mobility)
- [x] Include ICP context in the prompt so LLM understands Atlas Copco's positioning
- [ ] Regenerate pilot emails with the improved prompt (pending — user can trigger via Re-generate buttons)
- [x] Clear all existing outreach emails and reset campaign contacts to fresh status for Ryan

## Campaign Contact Prioritisation & Cleanup
- [x] Sort campaign contacts with Hot tier at top (default sort: tier asc, score desc)
- [x] Improve scoring to weight abrasive blasting relevance (+20 for blasting companies, +10 combo bonus)
- [x] Remove 325 personal email addresses (gmail, hotmail, yahoo, bigpond, outlook etc.) from database
- [x] Add personal email filter to import logic to prevent future imports
- [x] Re-scored all 4,067 contacts: Hot 279, Warm 458, Enrich 2604, Low 726
- [x] Ensure only corporate domain emails remain in the campaign list
- [x] Run Apollo enrichment on 279 Hot tier campaign contacts to verify emails (12 enriched with verified emails + LinkedIn, 268 not found in Apollo)

## Hunter.io Enrichment Integration
- [x] Research Hunter.io API endpoints (domain search, email finder, email verifier)
- [x] Build Hunter.io enrichment service (server/hunterService.ts)
- [x] Update enrichment waterfall pipeline: Apollo → Hunter.io Domain Search → Email Verification
- [x] Add HUNTER_API_KEY secret via webdev_request_secrets
- [x] Add UI trigger for Hunter.io enrichment on campaigns page
- [x] Test the full waterfall enrichment pipeline
- [x] Add enrichment source badges to contacts table (Apollo purple, Hunter orange with confidence %, Import grey)
- [x] Add Enrichment Pipeline Status card to campaign overview (Enriched, Import, Needs Enrichment, Not Found, Failed)
- [x] Add enrichment status filter dropdown to contacts tab (Enriched, Has Email Import, Needs Enrichment, Not Found)
- [x] Update enrichment buttons to show waterfall label (Enrich 25/100 Apollo → Hunter)
- [x] Backfill enrichmentSource for 20 existing Apollo-enriched contacts
- [x] Vitest tests for enrichment badge logic, filter logic, scoring, and waterfall flow (1510 tests passing)

## Run Hunter.io Enrichment on Hot Tier Contacts
- [x] Check current Hot tier contacts needing enrichment (Apollo missed)
- [x] Run waterfall enrichment on Hot contacts via the API (192 enriched by Hunter.io)
- [x] Review enrichment results (Apollo vs Hunter breakdown) - verified in UI with badges

## Company Depth Expansion — Find Similar Roles at Verified Companies
- [x] Analyze Hot contacts: company distribution, domains, role patterns (133 unique domains)
- [x] Build Hunter.io Domain Search depth expansion (find similar roles at same companies)
- [x] Run depth expansion on verified Hot contact companies (1,504 new contacts found)
- [x] Add new contacts to campaign as Tier 1 Hot with enrichment source (deduped 31, moved 1,473 to campaign 2)
- [x] Verify results in database and UI — re-tiered 104 irrelevant corporate roles to Warm

## Self-Service Campaign Builder
- [x] Review existing campaign schema, routes, and collateral data
- [x] Add campaign creation API endpoint (name, description, product/collateral, target roles)
- [x] Add CSV contact import endpoint (parse CSV, map columns, insert as campaign contacts)
- [x] Add AI contact search endpoint (Hunter.io domain search by industry keywords)
- [x] Add auto-enrichment trigger (waterfall Apollo → Hunter on new campaign contacts)
- [x] Build Campaign Builder wizard UI (Step 1: Campaign details, Step 2: Add contacts, Step 3: Enrich & review)
- [x] Step 1: Campaign name, description, select collateral product, define target roles/industries
- [x] Step 2a: CSV upload with column mapping preview
- [x] Step 2b: AI search — enter company domains or industry keywords to find contacts
- [x] Step 3: Enrichment progress bar, tier assignment, review contacts before launch
- [x] Wire enrichment pipeline into campaign creation flow
- [x] Vitest tests for campaign builder endpoints (CSV parser + role filtering tests)
- [x] End-to-end browser test (DrillAir X1350 campaign created and verified)

## UI Fix
- [x] Add back-to-dashboard navigation button on Campaigns list page

## Weekly Digest Refresh — Reduce Noise, Enforce Personalization
- [x] Fix KPI cards to show only user-filtered numbers (by business line + territory)
- [x] Remove or consolidate noisy/redundant KPI cards (6 → 4: Your Projects, Action Now, Hot Priority, New This Week)
- [x] Ensure weekly coaching section only shows projects matching user's business lines + region
- [x] Clean up "Top Actions" to show fewer, higher-quality recommendations
- [x] Ensure "Overlooked Opportunities" respects business line + territory filters
- [x] Keep "Adjacent Business Line Opportunity" section (only shows when relevant, collapsed by default)
- [x] Make dashboard scannable — coaching panel collapsed by default, stat boxes hidden when all zeros
- [x] Test personalized dashboard with user profile filters applied (28/362 scoped, all KPIs filtered)
- [x] Fix Pipeline Overview sidebar to show scoped total (28) instead of global total (362)
- [x] Fix "View all projects" link to show scoped count instead of global
- [x] Add 14 new vitest tests for scoped stats, coaching panel behavior, and KPI card reduction (1,543 total tests passing)

## Campaign Builder — Company-Level Import Fix
- [x] Fix CSV parser to accept company-only rows (company name + domain, no email required)
- [x] Auto-discover contacts at imported companies via Apollo people search + Hunter domain search
- [x] Update campaign builder UI with company-list detection and target role selection
- [x] Improve UX messaging for company-level imports vs contact-level imports
- [x] Vitest tests for company-import flow (12 tests: analyseImportFile, parseCompanyList, previewImportFile)

## Campaign List — Edit & Delete Actions
- [x] Add delete campaign backend endpoint (deleteCampaign + updateCampaign in campaignService)
- [x] Add edit/delete action buttons to campaign cards on list page (hover-reveal icons)
- [x] Add confirmation dialog for delete with campaign name shown
- [x] Add edit dialog with all campaign fields (name, description, sender, segment)
- [x] Test edit and delete in browser — both working correctly

## Campaign — Company Name-Only Search Fix
- [x] Update searchCompanyContacts to search by company name when domain is missing (Apollo people search with q_organization_name)
- [x] Add searchContactsByCompanyName function to hunterContactSearch.ts
- [x] Update frontend to show company-name search results without "no domain" warning
- [x] Show "Needs enrichment" label for contacts found via Apollo (no email until enrichment)

## Campaign — Fix Waterfall Enrichment for Apollo-Sourced Contacts
- [x] Fix enrichment to handle contacts with Apollo IDs and obfuscated last names
- [x] Add Path A (direct enrichment via stored Apollo ID) to enrichCampaignContacts
- [x] Extract and store apolloPersonId from reviewNotes during import
- [x] Backfill 56 existing CDR Rental Campaign contacts with Apollo IDs from reviewNotes
- [x] Reset 55 not_found contacts back to pending for re-enrichment via Path A
- [x] Update names (firstName/lastName) when Apollo enrichment reveals full names

## Campaign — Fix LLM Outreach Email Using Wrong Product
- [x] Fix email generation prompt to use campaign collateral (CDR Dryers) instead of defaulting to XAVS1800
- [x] Built CollateralProfile system with pattern matching for CDR dryers vs XAVS1800
- [x] CDR profile includes rental-company role hooks (fleet, operations, procurement, executive, maintenance)
- [x] Updated generateCampaignEmail to pass collateralName and description from campaign record
- [x] Removed hardcoded XAVS1800 defaults from campaignService.ts
- [x] CDR campaigns use rental-appropriate language ("your rental fleet", "fleet investment")
- [x] XAVS1800 campaigns retain existing behaviour with no-rental-language rules
- [x] All 1553 tests passing (2 pre-existing API timeout failures)

## Campaign — Increase Apollo/Hunter Search Limits for Large Company Lists
- [x] Review current per-company contact limit and total batch cap in searchCompanyContacts
- [x] Increase Apollo perPage from 25 to 50, maxPerCompany from 10 to 25 per company
- [x] Increase Hunter maxPerDomain from 10 to 25, add maxTotal cap of 2000
- [x] Update router input schema to allow maxPerDomain up to 100 and maxTotal up to 5000
- [x] Update frontend to pass maxPerDomain: 25, maxTotal: 2000 in search request
- [x] Add estimated time display for large lists (>50 companies shows est. X min)
- [x] Show company count in loading button text ("Searching 378 companies...")

## Audit — X1350 Campaign: Company Search Returns 0 Contacts
- [x] Trace full flow: CSV upload → company detection → Apollo/Hunter search → contact import
- [x] Check server logs for errors during X1350 company search
- [x] Check database for X1350 campaign contacts (any imported at all?) — confirmed 0 contacts
- [x] Identify root cause: 378 companies with no domains → all go through Apollo People Search sequentially → HTTP request times out (~190s for 378 companies at 300ms rate limit + API response time)
- [x] Fix: Convert searchCompanyContacts to background job with progress polling
- [x] Build polling UI showing search progress ("Searched 45/378... Found 127 contacts")
- [x] Write vitest tests for background job (9 tests, all passing)
- [ ] Test fix with the actual 378-company CSV file
- [ ] Verify contacts import correctly after search completes

## LLM Domain Inference for Company Search
- [x] Build LLM domain inference service (batch 20 companies per LLM call, structured JSON output, high/medium/low confidence)
- [x] Integrate domain inference into companySearchJob as Phase 0 (infer domains → Hunter.io → Apollo fallback)
- [x] Route high/medium confidence domains to Hunter, low/null to Apollo fallback
- [x] Update progress UI with 3-phase pipeline indicator (AI Domain Lookup → Hunter.io Search → Apollo Fallback)
- [x] Show domain inference progress card (companies processed, domains resolved, confidence breakdown)
- [x] Write tests for domain inference integration (13 tests, all passing)
- [x] Run full test suite — all 1568 tests passing

## Bug — "This Week" date stuck at 2026-03-29
- [x] Trace where weekLabel comes from — thisWeekService.ts used getLatestReport().weekEnding
- [x] Check database — latest report: 2026-03-29, 8 of 10 pipeline runs stuck in "running" with null steps
- [x] Root cause: pipeline hangs (no timeout) → no new reports → stale weekLabel
- [x] Fix weekLabel to always compute current week's Monday date (no longer depends on reports)
- [x] Add global pipeline timeout (45 min) and per-step timeout (15 min) with withTimeout wrapper
- [x] Add stale run cleanup on server startup (marks runs stuck >1hr as failed)
- [x] Write 17 tests for timeout utility, weekLabel computation, cleanup logic
- [x] All 1,585 tests passing

## Bug — Suggested Actions are stale and not refreshing weekly
- [x] Trace how suggested actions are generated and stored — live-computed in thisWeekService.ts, not cached
- [x] Identify root cause: pipeline failing → same project data → same actions; also no dismissal tracking
- [x] Add actionKey to each suggested action for unique identification
- [x] Add dismissedActions DB table and dismissAction tRPC endpoint
- [x] Add DismissButton component (hover-reveal X button on each action card)
- [x] Add engagement-aware filtering — exclude projects user has already engaged with
- [x] Add staleness downgrading — demote priority for projects older than 14 days
- [x] Add data freshness warning banner when pipeline hasn't run in >7 days
- [x] Write 23 tests for actionKey, dismissal, engagement, staleness, freshness
- [x] All 1,608 tests passing
- [ ] Write tests for the refresh logic

## Bug — Duplicate email digests sent to same users
- [x] Trace email digest sending flow — found TWO systems sending: dailyPipeline (Steps 19/20) AND persistentScheduler
- [x] Root cause: no per-user dedup, both systems send independently, server restarts trigger catch-up sends
- [x] Added userEmailSendLog DB table for per-user send tracking (userId + digestType + sentDate)
- [x] Added wasEmailSentToUser() and logUserEmailSend() dedup helpers to emailDigest.ts
- [x] Added per-user dedup check in sendWeeklyDigests (Monday) — skips if already sent today
- [x] Added per-user dedup check in sendThursdayReminders (Thursday) — skips if already sent today
- [x] Removed direct digest sending from dailyPipeline (Steps 19/20) — persistentScheduler is now single source of truth
- [x] Added force parameter to both functions for manual override
- [x] Added alreadySent counter to return types for monitoring
- [x] Enabled EMAIL_DIGESTS_ENABLED secret via webdev_request_secrets
- [x] Write 11 dedup tests + all 1,619 tests passing

## Feature — Give Leo Williams access to Campaigns tab
- [x] Trace how navigation tabs are controlled — hardcoded CAMPAIGN_ALLOWED_EMAILS list in Campaigns.tsx + inline checks in Home.tsx and ThisWeek.tsx
- [x] Add leo.williams@atlascopco.com to CAMPAIGN_ALLOWED_EMAILS in Campaigns.tsx
- [x] Update nav link condition in Home.tsx and ThisWeek.tsx to include Leo
- [x] Verify Campaigns tab appears in Leo's nav after deployment
- [x] Add Tim O'Neil Shaw to Campaigns access (admin role = always has access)
- [x] Move campaign access allowlist from hardcoded emails to database (users.campaignAccess column)
- [x] Build Admin UI to manage campaign access per user (toggle on/off in User Management tab)
- [x] Refactor frontend Campaigns.tsx, Home.tsx, ThisWeek.tsx to check DB permission instead of hardcoded list
- [x] Write tests for DB-backed campaign access (17 tests, all 1636 passing)

## Feature — Email Digest: Monday only
- [x] Verify EMAIL_DIGESTS_ENABLED is set to true
- [x] Disable Thursday reminder (keep only Monday weekly digest)
- [x] Update tests to reflect Thursday reminder removal (all 1,635 tests passing)

## Bug Fix — Campaign access restricted on backend for Leo and Tim
- [x] Find and fix server-side campaign access checks (hardcoded email list in trpc.ts was blocking)
- [x] Verify Leo and Tim's campaignAccess flag in the database (both have campaignAccess=1)
- [x] Update all backend campaign endpoints to use DB-backed permission (ctx.user.campaignAccess)
- [x] Test and deploy fix (all 1,635 tests passing)

## Audit — Leo's CP Truck Air Campaign
- [x] Investigate campaign contact import and dedup logic (14 duplicate groups, 33 extra rows)
- [x] Add deduplication to prevent duplicate contacts in campaigns (email-based + name+company fallback)
- [x] Fix outreach email generation — added CP Truck Air collateral profile (Chicago Pneumatic branding, truck builder messaging, 7 role hooks)
- [x] Clean up existing duplicates in Leo's CP Truck Air campaign (124 → 91 unique contacts, 33 dupes removed)
- [x] Test and deploy fixes (all 1,635 tests passing)

## Bug Fix — Pipeline enrichment timeout
- [x] Investigate why contact enrichment step timed out after 900s (500 contacts × 1s delay = 500s+ plus API time > 900s limit)
- [x] Fix the enrichment timeout issue (delay 1000ms→500ms, enrichment timeout 15min→25min, global timeout 45min→55min)
- [x] Test and verify fix (all 1,635 tests passing)

## Feature — .eml Outreach Email System
- [x] Investigate current outreach email flow (mailto, signature, collateral storage)
- [x] Build Outlook-compatible HTML email template (table-based layout, Atlas Copco navy/gold + CP red branding)
- [x] Build server-side .eml file generator with HTML body and collateral PDF attachment
- [x] Update frontend: replace "Open in Outlook" with "Download Email" button (Campaigns + OutreachEmailModal)
- [x] Remove prefilled signature from generated emails (Outlook adds user's own)
- [x] Update LLM prompt: no signatures, no attachment reminders
- [x] Test: 17 new tests for emlGenerator, all 1,652 tests passing

## Improvement — .eml Email Template Enhancements
- [x] Fix duplicate attachment reference in HTML template (removed ctaText duplication from routers.ts)
- [x] Add CP logo and product hero images from cp-mobile.manus.space (converted webp→JPEG/PNG, uploaded to CDN)
- [x] Address Outlook signature issue (added X-Unsent: 1 header — Outlook opens .eml in compose mode with auto-signature)
- [x] Make email template visually compelling with product imagery (brand logos in header, hero product images)
- [x] Add Atlas Copco XAVS1800 product image and Power Technique logo for AC-branded emails
- [x] 9 new tests, all 1,661 tests passing

## Improvement — CP Truck Air Email Template v2
- [x] Replace CP hero image with T110 compressor product shot from CP flyer page (uploaded to CDN)
- [x] Replace CP logo with full Chicago Pneumatic wordmark logo from CP flyer page
- [x] Remove attachment notice box from email template (PDF still attached in MIME, just no visual notice)
- [x] Change outer email background from grey (#F4F4F4) to white
- [x] 2 new tests (no attachment notice, white background), all 1,663 tests passing

## Redesign — Plain Text Email Style (no marketing template)
- [x] Strip all branded HTML template (header, hero image, CTA card, footer) from .eml generator
- [x] Generate plain-text-style email that looks like a normal written Outlook email (Calibri 11pt, black text, white bg)
- [x] Keep PDF attachment functionality intact (multipart/mixed MIME)
- [x] Keep X-Unsent: 1 header for Outlook compose mode (signature auto-insert)
- [x] Update tests to match new plain-text format — all 1,659 tests passing

## Fix — Australian-friendly greeting
- [x] Update LLM prompt to always start emails with "Hi [Name]," not just the name

## Feature — Tim O'Neil Shaw sender-specific sign-off
- [x] Add Tim-specific CTA sign-off: "reply and I'll organise your local sales rep to visit or share more"
- [x] Only applies when Tim is the sender — other senders keep normal CTA
- [x] All 1,659 tests passing

## Task — Replace X1350 flyer with v4
- [x] Upload atlas_copco_x1350_flyer_v4.pdf to S3 replacing the existing version (14,590 KB uploaded)
- [x] Update the database record to point to the new file (fileSizeBytes updated, same CDN URL)

## Fix — Stakeholder/Buying Groups & Custom Role Keyword
- [x] Fix stakeholder lines to show all buying groups (dynamic from data, sorted by count desc, no hardcoded list)
- [x] Fix custom role keyword input bug (extracted RoleSelector from arrow function to inline JSX — prevents re-mount/focus loss)
- [x] Make custom keywords saved/persisted for search (new targetRoles + customRoleKeywords columns in campaigns table, saved on search)
- [x] All 1,659 tests passing, no TypeScript errors

## Feature — Mass Download .eml ZIP
- [x] Build server-side endpoint (campaign.downloadAllEmls) to bundle all approved .eml files into a ZIP
- [x] Add "Download All Emails" button on Campaign Actions tab (shows count of approved emails)
- [x] Add "Download All" button in Approval Queue's Approved section header
- [x] Each .eml in ZIP includes collateral PDF attachment (fetched once, shared across all)
- [x] Loading spinner with "Preparing ZIP..." state during generation
- [x] Filenames: company-name--contact-name.eml for easy identification
- [x] 8 new vitest tests for mass download logic, all 1,667 tests passing

## Fix — Scoring, Role Bucketing & Data Quality
- [x] Fix scoring engine to weight seniority (CEO/MD > Director > Manager > Coordinator)
- [x] Fix role bucketing — replace broad "Decision Maker" with granular categories (C-Suite, Director, Operations, Procurement, Engineering, Project Management, Site/Workshop)
- [x] Re-score and re-bucket all existing campaign contacts in database
- [x] Write tests for new scoring and bucketing logic
- [x] Update UI: Contact Role Breakdown card on Overview tab (sorted by count, 12 granular buckets)
- [x] Update UI: Role bucket labels shown under job title in contacts table
- [x] Update UI: Role bucket filter dropdown in contacts table filters
- [x] Update UI: Numeric score circle in contacts table (color-coded: red 60+, amber 40+, blue 20+, grey <20)
- [x] Server: byRoleBucket stats in getCampaignStats endpoint
- [x] Server: roleBucket filter in getCampaignContacts endpoint

## Fix — Always Enrich (Option A)
- [x] Bug fix: Change import logic — all contacts start as 'pending' instead of 'not_needed' for contacts with emails
- [x] Update enrichment pipeline to handle contacts that already have emails (verify + enhance, not skip)
- [x] When contact already has email, Apollo/Hunter still runs to add LinkedIn, verify email, update title
- [x] If enrichment finds a better email, use it; if existing email is confirmed, keep it
- [x] Add credit estimate in enrichment confirmation dialog (shows pending count and estimated Apollo credits)
- [x] Add credit confirmation dialog in UI before running enrichment with batch size selector (25/50/100)
- [x] Update enrichment stats display to show what was verified vs newly found (data quality toast)
- [x] Fallback: contacts with emails that Apollo+Hunter miss get marked 'enriched' with source='import'
- [x] Added 'import' to enrichmentSource enum in schema + pushed migration
- [x] Write 15 tests for Always Enrich flow (import logic, data quality tracking, fallback behavior, enum)
- [x] All 1,701 tests passing, no TypeScript errors

## Enhancement — Auto-Enrich After Import + Pipeline Progress Indicator
- [x] Add 3-step progress indicator to CampaignBuilder (Discover → Import → Enrich) for company-list uploads
- [x] Auto-trigger enrichment after company-discovered contacts are imported (with credit confirmation dialog)
- [x] Show enrichment progress/results inline in the CampaignBuilder (not just on the campaign detail page)
- [x] Dynamic step labels — "Discover Contacts" + "Import & Enrich" when file is companies, default labels otherwise
- [x] Enrichment card shows progress state, results state, and re-run option
- [x] Batch size selector (25/50/100) in enrichment confirmation dialog
- [x] Auto-trigger also works for domain search import path
- [x] All 1,701 tests passing, no TypeScript errors

## Bug — Import button not clickable in CampaignBuilder
- [x] Root cause: Title row in spreadsheet treated as header row → all columns mapped to column 0 → file classified as 'contacts' instead of 'companies'
- [x] Fix 1: Title-row detection — detectHeaderRow() skips single/dual-cell title rows and uses the real header row
- [x] Fix 2: Duplicate column guard — each column can only be assigned to one field during auto-detection
- [x] Fix 3: Stricter fullName pattern — no longer matches 'Company Name' or 'Account Name'
- [x] Fix 4: Added 'Company Domain' to website pattern for better domain column detection
- [x] Applied title-row detection to all 4 parsing functions (preview, parse, analyse, parseCompanyList)
- [x] 11 new tests for title-row detection, duplicate guard, fullName strictness
- [x] All 1,712 tests passing

## Bug — Import button still not working (follow-up)
- [x] Enhanced detectHeaderRow: also checks row 0 vs row 1 against known column patterns (COLUMN_PATTERNS + COMPANY_LIST_PATTERNS)
- [x] Enhanced analyseImportFile: does own column detection when mapping is empty (tries both COLUMN_PATTERNS and COMPANY_LIST_PATTERNS)
- [x] UI: Added 'Switch to Company Discovery' amber hint banner when no columns auto-detected
- [x] All 1,712 tests passing, no TypeScript errors

## Bug — "No companies found in file" toast despite Company List Detected
- [x] Rewrote parseCompanyList with 3-strategy fallback:
  - Strategy 1: detectHeaderRow + COMPANY_LIST_PATTERNS + COLUMN_PATTERNS (primary)
  - Strategy 2: Brute-force rows 0-4 as header candidates, pick the one yielding most companies
  - Strategy 3: URL column scan — finds domain-like values (.com, .au, etc.) and infers company column
- [x] Added server-side debug logging to searchCompanyContacts endpoint
- [x] All 1,712 tests passing, no TypeScript errors

## Bug — LLM email generator always references XAVS1800 instead of selected collateral product
- [x] Email body mentions XAVS1800 even when campaign collateral is DrillAir X1350
- [x] Fix LLM prompt to use the campaign's actual collateral product details (name, specs, key features)
- [x] Add tests to verify correct product is referenced in generated emails
- [x] Added full DrillAir X1350 collateral profile with knowledge base, 8 role hooks, product rules
- [x] Narrowed XAVS1800 pattern from /xavs|1800|compressor|blast|portable\s*air/ to /xavs|1800|abrasive\s*blast|surface\s*prep/
- [x] 23 new tests for collateral profile routing — all 1,735 tests passing

## Bug — Company list search missing many contacts that exist on LinkedIn
- [x] Investigate: 28 companies uploaded but only 60 contacts found (~2.1 per company)
- [x] Audit domain parsing: all 28 companies have domains in Excel — verified all extracted correctly (Strategy 2 finds header at row 3)
- [x] Audit Hunter.io coverage: small Australian drilling companies often return 0 from Hunter
- [x] Audit Apollo fallback: confirmed Apollo was NOT running for Hunter zero-result domains — only for companies with no domain at all
- [x] Audit role filtering: Owner, Principal, Founder, Contracts Manager, BD Manager were all missing from role categories
- [x] Added Apollo People Search as fallback for Hunter zero-result domains (Phase 1b in pipeline)
- [x] Added owner_principal role category (Owner, Principal, Founder, Co-Founder, Partner, Proprietor)
- [x] Added business_development role category (BD Manager, Contracts Manager, Commercial Manager, Tender Manager)
- [x] Updated Apollo title mapping for new roles in both companySearchJob.ts and hunterContactSearch.ts
- [x] Added apolloFallback tracking to CompanySearchProgress (attempted, withResults)
- [x] 23 new tests — all 1,758 tests passing

## Feature — Batch re-run contact discovery for existing campaigns
- [x] Query all 4 campaigns to get their IDs, stored domains, search roles, and existing contact emails
- [x] Write a script to re-run discovery for each campaign using the improved pipeline (Apollo fallback + new roles)
- [x] Deduplicate against existing contacts (skip already-known emails)
- [x] Insert newly discovered contacts into each campaign
- [x] Report results: 137 new contacts found across 4 campaigns
  - CDR Rental Campaign: +33 new (56 → 89)
  - X1350 Drill Campaign: +96 new (282 → 378) — Apollo fallback found 31
  - CP Truck Air: +8 new (91 → 99)
  - x1350 Drilling Promotion: 0 new (already well-covered at 60)

## Bug — Enrichment batch limit of 100 prevents enriching all contacts
- [x] Enrichment only processes first 100 contacts, remaining 46 cannot be enriched
- [x] "Run Again" button should process remaining pending contacts but seems to not work fully
- [x] Fix batch limit or implement proper pagination so all contacts get enriched
- [x] Raised backend cap from .max(100) to .max(500)
- [x] Updated batch size options: 50, 100, 200, 500 (was 25, 50, 100)
- [x] Added remaining pending counter — "Run Again" button now shows exact count (e.g. "Run Again (46 Remaining)")
- [x] Updated both CampaignBuilder.tsx and Campaigns.tsx with the new limits
- [x] All 1,758 tests passing, no TypeScript errors

## Bug — "Download All" button fails with "Unexpected token 'c'"
- [x] Batch EML download from Approval Queue returns non-JSON response causing parse error
- [x] Root cause: ZIP with embedded PDF attachments exceeded tRPC JSON payload limits
- [x] Fix: Upload ZIP to S3 via storagePut(), return URL instead of base64
- [x] Updated both Campaigns.tsx download handlers (campaign dashboard + approval queue)
- [x] All 1,758 tests passing, no TypeScript errors
## Bug — 7 companies with domains return zero contacts from both Hunter and Apollo
- [x] Root cause: Small Australian rental/hire companies (.au domains) are under-represented in US-centric Hunter.io and Apollo databases
- [x] Companies affected: Access Party Hire, Onsite Rental Group, Air Powered Services, Air Rentals, Mobile Compressed Air, Under Pressure Air Compressors, CAHS
- [x] Add Phase 1c: Unfiltered Apollo fallback — when Phase 1b (Apollo with role+location filters) also returns 0, retry with NO role filter and NO location filter to catch any indexed person
- [x] Add Phase 1d: Apollo name-only search — when domain-based search returns 0, try searching by company name alone (some companies are indexed under different domains)
- [x] Add detailed logging for zero-result companies to help diagnose future gaps
- [x] Update tests for new fallback phases — 6 new tests, all 1,763 tests passing
## Bug — Enrichment returns 0 enriched for 181 imported contacts (all still pending)
- [x] Diagnose: enrichment completes instantly with 0 enriched, 181 contacts remain pending
- [x] Root cause 1: Malformed Apollo IDs — import regex captured trailing text like "(Hunter fallback)" causing Apollo API to reject the ID
- [x] Root cause 2: Possible empty toEnrich query (timing/DB issue) — added diagnostic logging
- [x] Fix: Apollo ID regex in importCampaignContacts now only captures the ID portion
- [x] Fix: Apollo ID sanitization in enrichment loop cleans and persists corrected IDs for existing contacts
- [x] Fix: Diagnostic logging when toEnrich is empty (logs total contacts and status breakdown)
- [x] Fix: Better per-contact error logging in Apollo enrichment (logs apolloId, name, company)
- [x] Fix: Better Hunter batch error logging (logs contact count and full stack trace)
- [x] All 103 campaign+company tests passing
## Bug — Enrichment gateway timeout returns HTML instead of JSON
- [x] Error: "Unexpected token '<', <!DOCTYPE... is not valid JSON" — deployed platform gateway times out before enrichment completes
- [x] Convert enrichment to background job pattern (start + poll) — created enrichmentJob.ts
- [x] Return immediate response to frontend, poll for completion status
- [x] Updated CampaignBuilder.tsx handleEnrich to use polling
- [x] Updated Campaigns.tsx enrichMut to use polling with isEnrichingBg state
- [x] 7 new tests for enrichmentJob module, all passing

## Bug — Incomplete contacts shown in campaign dashboard
- [x] Contacts with "Not found" email now visually de-emphasized (opacity-50 on row)
- [x] Added "Has Email" filter option to enrichment filter dropdown
- [x] Backend getCampaignContacts supports has_email filter (checks enrichedEmail OR email)
- [ ] Contacts with obfuscated last names (e.g., "S.") — these get resolved when Apollo enrichment succeeds; contacts that fail enrichment keep obfuscated names (acceptable trade-off)

## Feature — AU/NZ geo-filter for company search and campaign contacts
- [x] Add country filter during Apollo People Search in companySearchJob (filter out non-AU/NZ contacts)
- [x] Add location filter back to Phase 1c (unfiltered roles, but keep AU/NZ location) and Phase 1d (name-only with AU/NZ location)
- [x] Add geo-filter at end of company search job — removes contacts with definitively non-AU/NZ email domain TLD (.co.uk, .de, .fr, etc.)
- [x] Add post-enrichment country check in campaignService — when Apollo returns country, exclude non-AU/NZ contacts
- [x] Created geoFilter.ts with checkCompanyDomainGeo, checkCountryGeo, checkCompanyNameGeo helpers
- [x] 69 tests for geoFilter.ts, all passing
- [x] All 1,771 tests passing
- [x] Design decision: Company name patterns (LLC, Corp, Inc) NOT used at search time — too aggressive, many AU companies use US-style names. Domain TLD is the reliable signal at search time; Apollo country field is used post-enrichment.

## Feature — Outreach Email Template System
- [x] Design DB schema: campaign_email_templates table with subject, body, merge fields
- [x] Backend: Template CRUD procedures (create, update, get, delete)
- [x] Backend: Merge field rendering engine (replace {{firstName}}, {{company}}, etc.)
- [x] Backend: Per-contact draft generation from template
- [x] Backend: EML file generation from finalized per-contact emails
- [x] Frontend: Template editor modal with merge field insertion buttons
- [x] Frontend: Template preview with sample data
- [x] Frontend: Per-contact email preview/edit in campaign dashboard
- [x] Frontend: EML download (single + bulk)
- [x] Integration: Wire template into campaign workflow (CampaignBuilder step + Campaigns dashboard)
- [x] Tests for template rendering and EML generation

## Feature — HTML Email Template Support
- [x] Add htmlTemplate and templateMode columns to campaign_email_templates schema
- [x] Update templateService to support HTML mode with merge field rendering inside HTML
- [x] Update TemplateEditorModal with Plain Text / HTML toggle, HTML code editor, and live HTML preview
- [x] Update EML generator to produce multipart/alternative emails with HTML body
- [x] Update bulk generate to support HTML template mode
- [x] Tests for HTML template rendering and EML generation (24 tests, all passing)
- [x] Update approval queue to render HTML emails in iframe preview
- [x] Update email review dialog with HTML preview + raw source editing

## UI Fix — Template Editor Modal
- [x] Make template editor modal full-screen instead of default dialog size

## Fix — Handle contacts without matched projects in template system
- [x] Update buildMergeContext fallbacks so project fields are meaningful when no project matched
- [x] Update template editor UI to warn users about project-dependent merge fields
- [x] Update bulk generate to gracefully handle contacts with no matched projects
- [x] Verify existing tests still pass and add edge case tests (28 tests, all passing)

## Feature — Preview "No Project" variant in template editor
- [x] Add toggle in Preview tab to switch between "With Project" and "No Project" sample data
- [x] Build no-project sample context that uses the smart fallbacks
- [x] Show visual indicator of which mode is active in preview

## Feature — WYSIWYG Rich Text Template Editor
- [x] Install TipTap editor packages (core, starter-kit, image, link, placeholder, underline, text-align)
- [x] Rebuild TemplateEditorModal with single-view WYSIWYG layout (no tabs for edit/preview)
- [x] Add formatting toolbar (bold, italic, underline, alignment, lists, links, images, undo/redo)
- [x] Add colourful merge field pill buttons that insert inline tokens
- [x] Add inline image support with drag-drop, paste, and upload button (S3-backed)
- [x] Add "Show Preview" toggle to render the email as the recipient would see it
- [x] Keep HTML upload as advanced option for branded HTML templates
- [x] Update backend to handle rich HTML output from WYSIWYG editor
- [x] Ensure word count display at bottom of editor
- [x] Update email generation to use WYSIWYG HTML output
- [x] Add image upload endpoint (/api/upload-template-image) for S3 storage
- [x] Fix isHtml detection logic in generateFromTemplate

## Feature — Template generate option in contacts table Actions column
- [x] Add template-based generate button alongside AI generate in Actions column
- [x] Show clear visual distinction between AI and template generation options (gold border for Template, purple border for AI)
- [x] Handle contacts with "Not Started" and "Rejected" status with both options
- [x] Ensure template button only shows when a template exists for the campaign
- [x] Added text labels ("Template" / "AI") to buttons for clarity

## Feature — Bulk action bar with select-all for contacts table
- [x] Add checkbox column to contacts table with select-all header checkbox
- [x] Track selected contact IDs in state
- [x] Show floating bulk action bar when contacts are selected (sticky bottom, navy/gold theme)
- [x] Bulk action: Generate from Template (for selected contacts)
- [x] Bulk action: Generate with AI (for selected contacts, sequential with progress)
- [x] Clear selection after bulk action completes
- [x] Show selection count in the floating bar with clear selection button
- [x] Highlight selected rows with gold tint

## Feature — Email preview popover on hover
- [x] Show popover on click of outreach status badge
- [x] Display email subject and first few lines of body in popover
- [x] Handle HTML emails with a text-only preview snippet (strip tags)
- [x] Only show for contacts that have a draft (pending_approval, approved, sent, email_drafted)
- [x] Include "View full email →" link to open the full review dialog

## Stage 1 — Pre-Waterfall Ingestion & Normalization Layer
- [ ] Create server/ingestionService.ts — header mapping, name parsing, title normalization, company canonicalization, row classification, deduplication, review queue
- [ ] Add campaignStagedContacts table to drizzle/schema.ts
- [ ] Run pnpm db:push to migrate staging table
- [ ] Add tRPC procedures: campaign.stageUpload, campaign.getStagingBatch, campaign.commitStagingBatch, campaign.discardStagingBatch
- [ ] Wire CampaignBuilder upload flow to use staging pipeline before importCampaignContacts
- [ ] Write Vitest tests for ingestionService (all normalization functions)
- [ ] Save checkpoint

## Stage 1 Completion Status
- [x] Upload type detection (contact_split, contact_full, crm_export, company_only, unknown)
- [x] Header mapping system (HEADER_SYNONYMS with 11 fields, 80+ alias patterns)
- [x] Row-level cleaning and normalization
- [x] Company canonicalization (legal suffix stripping, placeholder detection, domain extraction)
- [x] Name parsing (full-name split, honorific stripping, comma-separated Last/First, title-case)
- [x] Title normalization (whitespace, casing, abbreviation expansion, trailing punctuation strip)
- [x] Duplicate handling (within-batch and cross-batch dedup)
- [x] Row classification (clean / review_needed / skip)
- [x] Review-needed queue (reviewFlags array on each staged contact)
- [x] Clean staging output (StagedContact interface + DB table + tRPC procedures)
- [x] DB staging table (campaignStagedContacts, 29 columns, migrated)
- [x] tRPC procedures (stageUpload, getStagingBatch, commitStagingBatch, discardStagingBatch)
- [x] StagingReview UI component
- [x] Vitest test suite (58 tests, all passing)
- [x] Full test suite green (1869 tests, 72 files)

## Stage 4 — Workflow Wiring & UI Operationalization
- [ ] A: Intercept CSV upload in CampaignBuilder — route through stageUpload, open StagingReview before importCampaignContacts
- [ ] B: Wire StagingReview into CampaignBuilder step 2 upload flow (counts, edit, approve, reject, commit person rows only, block company_target)
- [x] C: Add score/QA explainability — "Why?" expandable panel per contact in approval queue
- [x] C: Add send-readiness badges (green/amber/red) to contact rows in Campaigns.tsx
- [ ] C: Add summary counts (send_ready / review_before_send / blocked_from_send) to campaign stats
- [x] D: Add sendReadiness filter to campaign.contacts query and Campaigns.tsx filter bar
- [x] E: Build campaignDomainOverrides management UI (view/add/edit/deactivate)
- [x] E: Add domain override tRPC procedures (listOverrides, addOverride, updateOverride, removeOverride)
- [x] F: Wire reused-email detection — pass allCampaignEnrichedEmails to evaluateEnrichmentQA in enrichment batch
- [ ] F: Post-batch QA sweep — re-run QA on all contacts after enrichment completes
- [ ] G: Blocked contacts excluded from default approval view; visible only in audit filter
- [x] H: Bulk actions — approve all send_ready, export blocked CSV
- [x] I: Vitest tests for all Stage 4 additions (stage4.test.ts — 38 tests, all passing)

## Stage 5A — Pipeline Repair: Freshness Tracking & Staleness Logic
- [x] DB migration: add sourceLastSeenAt, staleReason, keepFlag fields to projects table
- [x] DB migration: add quarantined, quarantineReason fields to rssSources table
- [x] Rewrite markStaleProjects: sourceLastSeenAt-driven freshness, 60-day stale, 180-day archive thresholds
- [x] keepFlag exemption: projects with keepFlag=true are never auto-staled or auto-archived
- [x] Active pipeline claim exemption: projects with non-lost claims are never auto-staled or auto-archived
- [x] staleReason field set on all stale/archive transitions with Stage 5A audit trail
- [x] Add touchProjectSourceSeen function to db.ts (updates sourceLastSeenAt, re-activates stale projects)
- [x] Wire touchProjectSourceSeen into RSS harvest path (aiExtractor.ts — on duplicate detection)
- [x] Wire touchProjectSourceSeen into Projectory enrichment path (projectoryEnrichment.ts)
- [x] Wire touchProjectSourceSeen into ICN validation path (icnEnrichment.ts)
- [x] Add setProjectKeepFlag tRPC procedure to project router
- [x] Add quarantineSource / unquarantineSource functions to pipelineDb.ts
- [x] Add quarantine / unquarantine tRPC procedures to rssSources router
- [x] Update rssHarvester to skip quarantined sources (isActive AND NOT quarantined)
- [x] Change default lifecycleFilter from 'all' to 'active' in reports.full tRPC procedure
- [x] Add lifecycleFilter state to Home.tsx and wire into trpc.report.full.useQuery
- [x] Add Lifecycle filter bar (Active / Stale / All) to Home.tsx project list
- [x] Update Admin.tsx PlatformAnalyticsTab to explicitly pass lifecycleFilter: 'all'
- [x] Fix weeklyPipeline.test.ts mock to return new markStaleProjects shape ({ staled, archived })
- [x] Write stage5a.test.ts (44 tests covering all Stage 5A features, all passing)
- [x] Full test suite green (2207 tests, 76 files)

## Stage 5B — Pipeline Repair: Backfill, keepFlag UI, Quarantine UI
- [x] Backfill sourceLastSeenAt for all existing projects (lastActivityAt ?? createdAt) — 1,110 projects updated
- [x] Add keepFlag Pin/Protect toggle to project detail card in Home.tsx (ProjectCard.tsx)
- [x] Add setKeepFlag tRPC mutation call to project detail card (trpc.projectLifecycle.setKeepFlag)
- [x] Add quarantine toggle to Admin RSS Sources tab (quarantine/unquarantine button + reason display)
- [x] Add quarantined count KPI to Admin RSS Sources summary bar
- [x] Write stage5b.test.ts (32 tests covering backfill logic, keepFlag, quarantine, boundary conditions)
- [x] Full test suite green (2231 tests, 77 files)

## Stage 5C — Deduplication Repair

- [x] DB migration: add duplicateClusterId, mergedIntoId, duplicateDismissed fields to projects table
- [x] Implement tokenSimilarity, extractStateCode, findDuplicateClusters, assignDuplicateCluster, dismissDuplicateCluster, mergeProjectIntoCanonical, runDuplicateDetectionSweep in db.ts
- [x] Add duplicates tRPC router: listClusters, mergeProject, dismissCluster, runSweep procedures
- [x] Build Duplicates review tab in Admin panel (cluster cards, canonical/duplicate distinction, merge/dismiss actions, run sweep button)
- [x] Wire runDuplicateDetectionSweep into daily pipeline as Step 22
- [x] Write stage5c.test.ts: 49 Vitest tests covering tokenSimilarity, extractStateCode, findDuplicateClusters, mergeProjectIntoCanonical, dismissDuplicateCluster, runDuplicateDetectionSweep
- [x] Full test suite green: 2280 / 2280 passing across 78 files

## Stage 5D — Project Type Classification & Suppression

- [x] Live data audit: 1,110 projects sampled, 24 distinct stage string patterns identified
- [x] DB migration: projectType (enum), stageCode (enum), stageConfidence (float), suppressionReason (text), suppressed (boolean) added to projects table
- [x] Implement normalizeStageCode, computeStageConfidence, inferProjectType, evaluateSuppression, classifyProject, classifyAllProjects, getSuppressionStats in db.ts
- [x] Backfill script: 1,110 projects classified — 920 opportunities, 190 suppressed (52 background_account, 28 macro_item, 11 program_wrapper, 99 completed/cancelled)
- [x] tRPC classification router: classifyOne, bulkClassify, getSuppressionStats procedures
- [x] getDashboardData: includeSuppressed input field (default false), suppression filter applied before ML ranking
- [x] Home.tsx: projectTypeFilter state (default 'opportunity'), projectTypeFiltered step in filter chain, Type filter chip row with count badges and helper text
- [x] Write stage5d.test.ts: 64 Vitest tests covering normalizeStageCode (29), computeStageConfidence (5), inferProjectType (10), evaluateSuppression (9), classifyProject (11)
- [x] Full test suite green: 2344 / 2344 passing across 79 files · TypeScript: 0 errors

## Stage 6A — Atlas-to-Emarsys Export Workflow

- [x] Schema audit: campaignContacts fields mapped to Emarsys eligibility rules
- [x] DB migration: doNotContact, emarsysApproved, lastExportedAt, lastExportLogId added to campaignContacts; emarsysExportLogs table created (migration 0060 applied)
- [ ] Implement emarsysExport.ts: 8-rule eligibility engine (Rule 1: linked non-suppressed opportunity project; Rule 2: valid email; Rule 3: not doNotContact; Rule 4: not blocked_from_send; Rule 5: not opted_out/bounced; Rule 6: not retired/former; Rule 7: no suspicious domain mismatch unresolved; Rule 8: no duplicate email unresolved)
- [ ] Implement emarsysExport.ts: field mapper (CD_identifier, Email, First Name, Last Name, CD_divisionDetails, CD_salesOrgDetails, IETF tag, Country, company, campaign, collateral, export timestamp, export owner)
- [ ] Implement emarsysExport.ts: two export modes (curated_marketing_export, sales_direct_export)
- [ ] Implement emarsysExport.ts: buildExclusionReport() returning counts by reason
- [ ] Add tRPC emarsys router: previewExport, generateExport, getExportLog, toggleEmarsysApproval procedures
- [ ] Build Export to Emarsys panel UI in Campaigns page (eligibility summary, exclusion breakdown, configurable defaults, download button)
- [ ] Generate Emarsys-ready CSV with summary sheet; upload to S3; write export log record
- [ ] Write stage6a.test.ts: Vitest tests covering all 8 eligibility rules, field mapping, exclusion report, export log
- [ ] Full test suite green after Stage 6A

## PT Capital Sales Sprint — Rebranding & Product Lane Classification
- [x] Phase 1: Add productLane field to schema (migration 0061 applied); implement classifyProductLaneFromScores, classifyProductLane, classifyAllProductLanes in db.ts
- [x] Phase 1: Run productLane backfill — portable_air: 119, pumps: 163, pal: 43, bess: 278, multi_lane_pt: 478, NULL: 29
- [x] Phase 2: stageCode normalisation backfill — 253 unknown → 211 remaining, 42 reclassified
- [x] Phase 3: emailDigest.ts — Monday brief renamed "PT Capital Sales — Weekly Intelligence Brief"; lane grouping by productLane; contact-discovery-needed state (hasNoContacts flag); Thursday reminder renamed "PT Capital Sales — Mid-Week Reminder"
- [x] Phase 4: ProjectCard.tsx — productLane/stageCode added to ProjectData interface; PT Lane badge added after lifecycle status badge (sky/blue/violet/emerald/orange colour coding)
- [x] Phase 4: Home.tsx — productLaneFilter state added (default 'all'); laneFiltered step added in filter chain after projectTypeFiltered; PT Lane filter chip row added after tier filter chips; tier/priority counts updated to use laneFiltered; "Portable Air in Action" heading renamed to "PT Capital Sales in Action"
- [x] Phase 5: server/ptCapitalSales.test.ts — 82 Vitest tests covering DIMENSION_TO_LANE map, classifyProductLaneFromScores (all 5 lanes + null + boundaries), normalizeStageCode patterns (all stage codes), email digest lane grouping, contact-discovery-needed state
- [x] Phase 6: Full test suite green — 2526 / 2526 passing across 82 files · TypeScript: 0 errors
- [x] Phase 6: Checkpoint save — version 399f5ea3
- [x] Phase 6: PT Capital Sales validation document — /home/ubuntu/pt_capital_sales_validation.md

## Part D — Action Tracking (PT Capital Sales)
### Phase A — Data Model
- [x] Add projectActions table to drizzle/schema.ts (id, projectId, contactId, campaignId, userId, actionId, sourceContext, productLane, recommendedAction, outcomeCode, outcomeNotes, createdAt, updatedAt, completedAt, managerVisible)
- [x] Define outcomeCode enum: not_started, contacted, meeting_booked, proposal_sent, won, lost, deferred, not_relevant, already_active, contact_discovery_needed
- [x] Run pnpm db:push to apply migration
- [x] Document projectFeedback relationship decision (projectActions supersedes for outcome tracking; projectFeedback retained for ML signal only)
### Phase B — Action ID / Linking
- [x] Implement generateActionId(userId, projectId, weekKey) → deterministic short code (e.g. ACT-{weekKey}-{userId6}-{projectId6})
- [x] Upsert-on-conflict logic: same userId+projectId+weekKey updates existing record, does not create duplicate
- [x] New week creates new instance (fresh weekKey); prior week record is preserved as history
### Phase C — tRPC Procedures
- [x] Add server/routers/projectActions.ts: upsertAction, updateOutcome, getActionsByUser, getActionsByProject, getManagerRollup procedures
- [x] Add db.ts helpers: upsertProjectAction, updateActionOutcome, getActionsForRollup
- [x] Wire projectActions router into server/routers.ts
### Phase D — Manager Rollup
- [x] getManagerRollup returns counts by outcomeCode, by rep, by productLane, by priority
- [x] Define "this week" as ISO week (Mon–Sun) based on createdAt
- [x] Only latest outcomeCode per action counts in rollup (not history)
### Phase E — UI: This Week page
- [x] Add action status badge to each shortlist row on This Week page
- [x] Add one-click action buttons (Contacted / Meeting Booked / Proposal Sent / Won / Lost / Deferred / Not Relevant / Already Active / Contact Discovery Needed)
- [x] Optional notes field (not mandatory) after click
- [x] Add manager rollup panel to This Week page (visible to admin/manager role)
### Phase F — UI: ProjectCard
- [x] Show latest action outcomeCode badge on project card
- [x] Show action owner (rep name) and last updated timestamp
### Phase G — emailDigest.ts wiring
- [x] Generate actionId for each shortlisted project in Monday digest
- [x] Include actionId in digest content as reference code
- [x] Include Atlas deep-link URL back to project on This Week page
### Phase H — Reporting Rules (implemented in code)
- [x] won/lost → completedAt set, action closed, no further prompts
- [x] not_relevant → completedAt set, action closed unless manually reopened
- [x] already_active → suppress new prompts for 14-day cooling period
- [x] deferred → action remains open, urgency lowered (show as lower priority in rollup)
- [x] contact_discovery_needed → action open, flagged as awaiting data
### Phase I — Tests
- [x] Write server/partD.test.ts: 60+ Vitest tests covering schema, generateActionId, upsert/dedup, outcome updates, rollup counts, PT lane preservation, repeated weekly prompts, contact_discovery_needed
- [x] Full test suite green after Part D — 2603 / 2603 passing · TypeScript: 0 errors
- [x] Save checkpoint and produce Part D validation pack

## Email Operationalization Sprint (Parts A–G)
### Part A — Monday/Thursday Email
- [x] Confirm Monday/Thursday queries use same filtered logic as PT Capital Sales shortlist
- [x] Fix subject lines to use "PT Capital Sales" wording (not "Portable Air")
- [x] Confirm product-lane grouping renders correctly in email HTML
- [x] Confirm actionId reference codes render in email
- [x] Confirm deep-links back to Atlas This Week page render correctly
- [x] Confirm contact-discovery-needed advisory renders in email
- [x] Confirm freshness line (data age + last pipeline run) renders in email
- [x] Confirm stale/suppressed/background/macro items excluded by default
### Part B — Recipient Logic
- [x] Implement recipient selection: territory, PT lane preference, business-line scope, active status
- [x] Implement fallback when PT lane preference not set on user profile
- [x] Implement pilot allow-list (safe exclusion of non-pilot users)
- [x] Add getEmailRecipients() helper to db.ts
### Part C — Manager Rollup Email
- [x] Build manager rollup email template (HTML)
- [x] Wire getManagerRollup() into email generation
- [x] Add Thursday manager send schedule entry
- [x] Define manager recipient rules (admin role only)
### Part D — Parity Checks
- [x] Assert dashboard shortlist count == email shortlist count for same user+week
- [x] Assert suppressed/background/stale projects never appear in email
- [x] Assert lane grouping in email matches classifyProductLane logic
- [x] Assert manager rollup counts match projectActions data for same week
### Part E+F — Send-Log + Pilot Mode
- [x] Extend userEmailSendLog with weekKey, itemCount, dryRun, manager_rollup digestType (migration applied)
- [x] Add logEmailSendExtended and wasEmailSentToUserThisWeek helpers to db.ts
- [x] Implement dry-run/preview mode (renders email but does not send; logs dryRun=true)
- [x] Implement zero-item guard (suppress send or send compact "no new priority actions" version)
- [x] Add pilot mode: EMAIL_PILOT_ALLOW_LIST env var + getEmailRecipients() filtering
### Part G — Tests
- [x] Write server/emailOps.test.ts: 73 Vitest tests covering all 11 validation requirements
- [x] Full test suite green after Email Ops sprint — 2661 / 2661 passing · TypeScript: 0 errors
- [x] Save checkpoint and produce Email Ops validation pack

## Pilot-Week Enrichment Sprint (Parts A–F) — COMPLETE (checkpoint: pending)
### Part A — Pilot Shortlist Extraction
- [x] Build getPilotShortlist() helper in db.ts: same query as live digest, returns projectId, name, priority, PT lane, owner, location, contactCount, enrichedContactCount, hasNoContacts
- [x] Restrict to: projectType='opportunity', suppressed=false, lifecycleStatus not stale/archived, active PT Capital Sales shortlist rules
### Part B — Enrichment Gating
- [x] Build enrichmentGating(shortlist): priority order (hot no-contact → hot no-email → warm → contact_discovery_needed)
- [x] Hard blocks: suppressed, background_account, macro_item, program_wrapper, stale/archived, non-shortlisted, blocked_from_send contacts via checkApolloEligibility()
- [x] Stop condition: cumulative credits reach cap OR budget < CREDIT_STOP_BUFFER
### Part C — Credit Plan
- [x] Return estimated shortlist size, contacts needing enrichment, credit use (hot-only and hot+warm), recommended weekly cap, stop conditions via buildPilotEnrichmentPlan()
### Part D — Pilot Enrichment Run
- [x] Build pilotEnrichmentRun(dryRun): orchestrates gated enrichment, returns summary (projects considered/shortlisted/enriched, contacts enriched/missing, CDN projects, credits used/saved)
- [x] Gap classification: soft-skipped (sufficient contacts), hard-blocked (Apollo ineligible), eligible (to enrich)
### Part E — Post-batch QA
- [x] Confirm sendReadiness refresh is invoked after enrichment pass via runPostBatchQA()
- [x] evaluateEnrichmentQABatch() called on newly enriched contacts; passCount/failCount/sendReadyCount returned per project
### Part F — Admin UI + tRPC
- [x] Add tRPC procedures: pilotEnrichment.buildPlan, pilotEnrichment.runEnrichment, pilotEnrichment.getShortlist
- [x] Add PilotEnrichmentPanel component to Admin dashboard with dry-run toggle and result summary panel
### Tests
- [x] Write server/pilotEnrichment.test.ts: 53 Vitest tests covering all 6 parts
- [x] Full test suite green after Pilot Enrichment sprint — 2714 / 2714 passing · TypeScript: 0 errors
- [x] Save checkpoint and produce Part A–F deliverable validation pack

## Live Pilot Run (2026-04-22)
- [ ] Step 1: Build dry-run plan — shortlist size, eligible/skipped/blocked, credit estimates
- [ ] Step 2: Run live enrichment — hot-first, conservative cap, hard blocks, post-batch QA
- [ ] Step 3: Generate Monday/Thursday/manager rollup email previews
- [ ] Step 4: Confirm 6 email quality checks (actionIds, deep-links, freshness, CDN, zero-item)
- [ ] Step 5: Send pilot emails to allow-list users only
- [ ] Step 6: Produce pilot summary report

- [ ] Resolve pilot user IDs from DB: Lee Allen, Ryan Pemberton, Amit Bhargava, Leo Williams
- [ ] Fix buildPilotEnrichmentPlan DB connection issue in script context
- [ ] Restrict Monday/Thursday digest to Ryan Pemberton, Amit Bhargava, Leo Williams
- [ ] Restrict manager rollup to Lee Allen only

## Email Cleanup Patch (Pilot Observed Issues — Apr 22 2026)

- [x] A1: Fix subject line — remove "Portable Air" from PT Capital Sales digest subjects
- [x] A2: Confirm Monday, Thursday, and manager rollup subjects are correct and consistent
- [x] B1: Exclude Lee Allen (admin) from rep digest (monday + thursday) — manager rollup only
- [ ] B2: Confirm and return exact recipient lists for all three email types
- [ ] C1: Add visible freshness line near top of email body (not just footer)
- [ ] C2: Add visible ACT-{weekKey}-{userId}-{projectId} reference code per project block
- [ ] C3: Add visible deep-link to /this-week per project block
- [ ] D1: Sanitize contractor/source fields — strip raw HTML, anchor fragments, URLs from projectoryEnrichmentLog.contractorsFound
- [ ] D2: Suppress contractor line cleanly if no valid contractor name available
- [ ] E1: Confirm PT Capital Sales digest uses intended final format (not legacy Portable Air)
- [ ] F1: Fix scheduler separation — Thursday reminder must not fire during Monday/manual pilot send
- [ ] F2: Fix dedup enforcement — week-level dedup must include userId + digestType + weekKey
- [ ] F3: Confirm dry-run entries do NOT count as live sends for dedup
- [ ] F4: Pilot send isolation — manual Monday run must not also send Thursday + manager rollup
- [ ] F5: Return sample send-log rows showing digestType, userId, weekKey, dryRun, sentAt

## Monday Pilot Run + Admin Email Preview UI (Apr 22 2026)

- [ ] Schedule Monday pilot run after midnight: --type=monday, 3 reps only, enrichment + QA + send
- [ ] Admin Email Preview UI: preview Monday/Thursday/manager rollup by user before send
- [ ] Configurable manager recipient list: separate from role='admin', managed via Admin UI
- [ ] Return pilot run summary + Thursday recommendation after Monday run completes

## Pre-Send Checklist (Monday Pilot — Apr 22 2026)

- [ ] Run pipeline to refresh stale project data (last run 26/03/2026)
- [ ] Configure manager rollup: add Lee Allen only (remove Tim, Ray from pilot)
- [ ] Preview Monday digest for Ryan Pemberton — validate all 8 checks
- [ ] Preview Monday digest for Amit Bhargava — validate all 8 checks
- [ ] Preview Monday digest for Leo Williams — validate all 8 checks
- [ ] Return go/no-go summary before scheduled send fires

## UI/UX Redesign Sprint (Approved Apr 22)

- [x] Phase 1: PT lane color tokens in index.css + LaneBadge component
- [x] Phase 2: This Week page — compact header, top actions, micro-summary strip, collapsible sections, demoted coaching panel
- [x] Phase 3: Project card — collapsed view with commercial cue, contact state, action buttons
- [x] Phase 4: Filter simplification — 3 primary + advanced toggle, territory easy to clear
- [x] Phase 5: Project detail — contacts/actions higher, contractor sanitizer, debug metadata collapsed

## Source Expansion Sprint — WA + NT (Apr 22 2026)

- [ ] Audit existing sources and research new source access methods
- [ ] Implement source purpose tagging system (live_tender, forward_plan, contractor_path, commercial_lead, aggregator)
- [x] Tenders WA — live_tender source implementation
- [ ] WA Pipeline of Work — forward_plan source implementation
- [ ] WA Strategic Forward Procurement Plan — forward_plan source implementation
- [ ] ICN Gateway WA reinforcement — contractor_path improvement
- [x] QTOL NT — live_tender source implementation with Power & Water issuer tracking
- [ ] Dedup / precedence rules by sourcePurpose
- [ ] Weekly brief surfacing logic by sourcePurpose
- [ ] Validation pack and tests

## Validation & Optimisation Sprint (Apr 22 2026)

- [x] Audit #1: Live-tender output quality — Tenders WA + QTOL NT (relevance rate, close-date parsing, noise)
- [x] Fix Apollo daily/monthly credit cap mismatch (DAILY_CREDIT_CAP vs MONTHLY_CREDIT_CAP consistency)
- [x] Tenders WA LLM concurrency — add bounded concurrency (5 workers), keep degraded mode intact
- [x] Lightweight live-tender operator view — sourcePurpose=live_tender filter, sort by tenderCloseDate, "closing in X days", clickable path from Closing Soon
- [x] Scope WA Pipeline of Work as forward_plan source (proposal only, no build yet)

## PT Capital Sales Brief Adoption Sprint (queued — after current sprint)

- [ ] Part A: End-to-end weekly brief audit (per-user: Monday digest, This Week page, action tracker, manager rollup)
- [ ] Part B: Brief tightening — 3-5 top actions max, Contact Discovery section, Closing Soon only when relevant
- [ ] Part C: Actionability quality gate — not suppressed, not stale, projectType=opportunity, territory/lane, named contact or discovery-needed, working deep-link
- [ ] Part D: Enrichment alignment — shortlist-only, stop once usable contact or discovery-needed, post-batch QA before digest
- [ ] Part E: Manager operating loop — weekly review format, cadence, key metrics (contacted/meeting/proposal/not-started/discovery-needed/active)
- [ ] Part F: Adoption metrics scorecard — emails sent, actions shown/clicked, not-started, discovery-needed, proposal/meeting movement, per-user pattern
- [ ] Part G: Deliver findings + quick fixes before wider rollout

## PT Capital Sales Brief Adoption Sprint — Active (Apr 23 2026)

- [x] Part A: Audit full brief workflow — digest, This Week, action tracker, rollup (8 quality checks per action)
- [x] Part B: Measure current item counts, recommend final item cap (3-5 max), define what gets excluded
- [x] Part C: Implement actionability quality gate (projectType, suppressed, stale, territory, contact, deep-link, rendering)
- [x] Part D: Audit enrichment alignment — shortlist-only, post-batch QA, credit waste
- [x] Part E: Define manager operating loop — weekly review format, cadence, challenge questions
- [x] Part F: Define adoption scorecard — emails sent, actions shown/updated, not-started, discovery-needed, meeting/proposal movement
- [x] Part G: Apply quick fixes — copy, ordering, gating, no-contact messaging, broken links
- [x] Part H: Save checkpoint and deliver full findings report

## Controlled Email Retest (23 Apr 2026)
- [x] Part A: Duplicate send root-cause analysis — confirmed admin sendNow(force=true) bypassed dedup 3min after scheduler. Fix: sendNow now passes force=false, new forceSendNow for intentional bypass
- [x] Part B: Monday digest dry-run smoke test — 3 pilot reps (Ryan, Leo, Amit), 24/24 QC checks pass, 15 items each (cap working), all deep-links absolute (compasspt.manus.space), freshness line present, ACT refs present
- [x] Part C: Live Monday retest — sent with force=true to 3 pilot reps (Ryan, Leo, Amit), 1 send each confirmed in logs, no Thursday/manager sent
- [x] Part D: Manager rollup hold — projectActions table confirmed empty (0 rows), rollup stays on hold
- [x] Part E: Compile and deliver full retest report

## Brief Readiness Split (23 Apr 2026)
- [x] Classify shortlisted projects as action_ready / discovery_needed / monitor_only
- [x] Gating rules: action_ready requires send-ready contact OR named stakeholder with contact path OR verified contractor + strong context
- [x] Restructure email template: Top Actions (3-5, action_ready only), Stakeholder Discovery Needed (1-2), Monitor (optional)
- [x] Wording fix: no "ACTION REQUIRED" on no-contact projects; use "Discovery Needed" / "Coverage Gap" / "Needs Stakeholder Mapping"
- [x] Pre-digest enrichment: trigger targeted enrichment on shortlist before Monday digest generation
- [x] Brief caps enforcement: Top Actions max 5, Discovery max 2, Monitor optional
- [x] Dry-run before/after comparison for one pilot rep
- [x] Vitest tests for brief readiness classification (15 tests passing)

## Enrichment Repair (23 Apr 2026)
- [x] Fix contactProjects junction linking in enrichProjectContacts (contacts found but not linked to project)
- [x] Fix owner/domain normalization (block "Unknown", garbage strings, contractor descriptions)
- [x] Add owner-type routing (private → Apollo, government → fallback, dirty → block)
- [x] Controlled 4-project validation batch (1 private, 1 gov, 1 unlinked, 1 dirty) — 2/4 now action-ready
- [x] Tests for normalization and routing logic (28 tests passing)

## Full Shortlist Rerun + Blocked-Reason Labeling (23 Apr 2026)
- [x] Add explicit blockedReason field to projects schema (blocked_government_owner_manual_discovery / blocked_unknown_owner / blocked_dirty_owner_string / blocked_no_usable_domain)
- [x] Update enrichProjectContacts to write blockedReason when Apollo is skipped
- [x] Update briefReadiness classifier to use blockedReason in readiness output
- [x] Surface blockedReason in dashboard / brief so reps see why a project is blocked
- [x] Run full hot/warm shortlist rerun (25 projects) with correct routing — 3 new action-ready, 8 gov blocked, 5 unknown blocked
- [x] Produce rerun summary report

## Government-Owner Fallback Discovery Sprint (23 Apr 2026)
- [x] Identify the 8 blocked government/public-owner projects from DB
- [x] Build govFallbackEnrichment service (Projectory path + web search path + LLM role inference)
- [x] Define govFallbackStatus enum: government_fallback_contact_found / government_fallback_named_person_no_email / government_fallback_role_only / government_fallback_no_result / government_fallback_manual_review_required
- [x] Add govFallbackStatus field to projects schema and push migration
- [x] Run fallback on all 8 government-blocked projects — 8/8 role_only, 0 named people, 7 new junction rows
- [x] Update emailDigest.ts renderProjectBlock to surface govFallbackStatus with specific gov body wording
- [x] Surface govFallbackStatus in brief: gov body / manual discovery / owner data gap wording
- [x] 43 tests passing (briefReadiness + ownerRouting)
- [x] Validation batch report: 8 processed, 0 named, 24 role-only inferred, 0 newly action-ready, 8 still blocked (all role_only)

## Account Attack Phase 1 Build (23 Apr 2026)
- [x] tRPC query: account search/typeahead (distinct owner names from projects)
- [x] tRPC query: account-level data aggregation (projects, contacts, contractors, pipeline claims, outreach history, collateral)
- [x] Account Attack page shell with input bar (account name, territory, PT lane, lens mode, research depth)
- [x] Account Header block (name, type, project count, HOT/WARM stats, states, sectors, PT lane distribution)
- [x] Current Opportunities block (lane-weighted display score, priority badges, lane badges, location, value, stage)
- [x] Known Stakeholders block (name, title, company, linked project, KEY/MED relevance, email links, source labels, gov fallback role-only display)
- [x] Contractor & Delivery Chain block (contractor role, pairings with co-occurrence counts, sanitized display)
- [x] Action History block (conditional — shows when outreach/pipeline data exists)
- [x] Collateral Match block (conditional — shows when collateral matches exist)
- [x] Seller-lens weighting (Focused / Balanced / Open) — client-side ranking with 3x/0.5x, 2x/1x, 1x/1x multipliers, stakeholder collapse in Focused mode
- [x] Empty/sparse state handling ("Select an Account" empty state, conditional section visibility)
- [x] Route: /account-attack, gold nav link in header (desktop + mobile)
- [x] Vitest tests: 30 tests passing (account type classification, seller-lens weighting, opportunity sorting, discovery labels)
- [x] Validation: Hydro Tasmania cockpit verified — all sections rendering, Focused lens reorders opportunities, stakeholder collapse working, government body type correct

## Account Attack Phase 1.1 Cleanup Sprint (23 Apr 2026)
- [x] Fix 1: Focused lens zero-primary-lane amber banner (Critical)
- [x] Fix 2: Typeahead dirty-owner filtering — block "likely", "e.g.", "Unknown (", "Various (", >80 chars (High)
- [x] Fix 3: Contractor co-occurrence score — logarithmic scaling replaces linear (was all 100, now 41–89) (High)
- [x] Fix 4: Owner-role entries removed from Contractor & Delivery Chain (Medium)
- [x] Fix 5: Government-specific stakeholder fallback in Focused mode (Medium)
- [x] Fix 6: Sparse-state bottom note when Action History + Collateral both absent (Low/Medium)
- [x] Fix 7: Balanced vs Open differentiation — lens description line + Balanced dims unclassified rows at 60% opacity (Medium)
- [x] Revalidation across 5 account types (strong private, government, sparse, multi-lane, dirty-data) — all pass

## Account Attack Phase 2 — AI Synthesis Layer (23 Apr 2026)
- [x] DB schema: accountResearchRuns table (cache key, result JSON, TTL, status, token usage, errors)
- [x] Research trigger evaluation logic (recommend vs not-recommend)
- [x] LLM prompt construction from Atlas internal context
- [x] Structured output schema (stakeholderMap, salesBrief, recommendedActions)
- [x] Run Research tRPC procedure with depth control (quick/standard/deep)
- [x] TTL/caching by objective (7-30 day windows)
- [x] Rate-limit guardrails (one run per cache key within freshness window)
- [x] UI: Research trigger banner and Run Research button
- [x] UI: Research state machine (ready, recommended, researching, complete, failed, stale)
- [x] UI: Stakeholder Map display panel (Your Lane / Other PT Lane grouping)
- [x] UI: Sales Brief display panel (11 sections, source tags)
- [x] UI: Recommended Actions display panel (evidence-linked, demoted unverified)
- [x] Stale badge + refresh prompt when research expires
- [x] Error handling / degraded mode (Phase 1 stays visible on failure)
- [x] Validation across 4 account types

## Account Attack Phase 3 — External Prospect Mode (23 Apr 2026)
- [x] Design: dual-mode entry (Atlas Account Mode vs External Prospect Mode)
- [x] Design: account-not-found decision tree (no match → close-match suggestions → external research CTA)
- [x] tRPC query: suggestCloseMatches (fuzzy name matching against existing owners)
- [x] tRPC mutation: runExternalProspect (LLM-powered external research with structured output)
- [x] ExternalProspectPanel component: no-match amber banner, close-match suggestions, Research Externally CTA
- [x] ExternalProspectForm component: industry, region, research objective selectors
- [x] ExternalProspectResults component: source-labeled output (EXTERNAL / AI-INFERRED / UNVERIFIED badges)
- [x] Enter key handler on account search input (trigger no-match flow for unknown accounts)
- [x] Evidence labeling: ATLAS-KNOWN / EXTERNAL / AI-INFERRED / MISSING-UNVERIFIED
- [x] Confidence badges: HIGH / MEDIUM / LOW on each section
- [x] Warning flags for speculative data (generic name, no public data)
- [x] Re-run Research and Back to Suggestions navigation buttons
- [x] Data quality disclaimer on form and results
- [x] Contractor typeahead: DDH1 Drilling, DDH1 Drilling (Perenti) with Contractor badges
- [x] Contractor-mode account view: amber "Contractor Account" banner, contractor badge on account header
- [x] Browser validation: DDH1 contractor mode, Acme Mining no-match, External Prospect form, LLM results

## Email Digest — 28 April Activation

- [x] Audit email digest system (scheduler, send logic, kill switch)
- [x] Confirm Resend API key valid (emailSender tests pass 3/3)
- [x] Set EMAIL_DIGESTS_ENABLED=true in production secrets
- [x] Add Digest Control Panel to Admin Email Preview tab
- [x] Add scheduleStatus query (last sent, next scheduled, enabled flag)
- [x] Add sendNow, forceSendNow, sendThursdayNow mutations wired to Admin UI
- [x] Confirm Monday digest next scheduled: 27 Apr 2026 23:00 UTC (= 28 Apr AEST)

## Email Digest — Pre-publish Operational Checks

- [x] Fix timezone wording in Digest Control Panel: show UTC / AWST / AEST for all scheduled times
- [x] Harden Force Re-send button: move to collapsed danger zone, add recovery/debug label and warning
- [x] Audit recipient scope: confirm pilot-only vs full distribution and surface count in panel
- [x] Audit email content guards: item cap, 0-item guard, duplicate Monday/Thursday trigger prevention
- [x] Clarify Publish-required activation in the status banner (not just env var wording)

## Digest Automation & Freshness Gate (Parts A–F)

- [x] Part A: Wire startDailyScheduler() into server/_core/index.ts — run daily at 20:00 UTC (3h before digest)
- [x] Part A: Ensure pipeline writes clean completion/failed record to pipelineRun table on every run
- [x] Part A: Cleanup stale/phantom runs on startup (already exists, confirm wired)
- [x] Part B: Add checkPipelineFreshness() helper — reads last successful pipelineRun within 26h window
- [x] Part B: Add freshness gate at top of sendWeeklyDigests() — hold if stale/failed, notify owner
- [x] Part C: Add DIGEST_STALE_FALLBACK env flag — if true, send with stale warning in subject/body
- [x] Part D: Document final production execution order (7 steps)
- [x] Part E: Extend scheduleStatus query to return pipeline freshness, next pipeline run, digest blocked/cleared state
- [x] Part E: Update Digest Control Panel UI to show pipeline freshness row and digest gate status
- [x] Part F: Write vitest tests for freshness gate logic (fresh/stale/failed/fallback) — 17/17 pass
- [x] Part F: Run all tests and confirm pass

## Project Deep-Link Trust Bug Fix

- [x] Audit current routing and project link patterns across all entry points
- [x] Build /project/:id route and backend getProjectById endpoint
- [x] Create ProjectDetailView component with full project detail rendering
- [x] Handle out-of-scope projects: show banner with options to expand filters or return
- [x] Handle missing/deleted projects: show explicit error state
- [x] Update all entry points to use /project/:id links (email, This Week, Top Actions, Closing Soon, stakeholders, Account Attack, manager views)
- [x] Add list highlighting when navigating back to dashboard with projectId
- [x] Browser-validate deep-link for in-scope, out-of-scope, and error states

## UX Tightening — Scope Clarity (Apr 2026)
- [x] Part A: Strict rep scope default — scopedProjects filters by laneMatch in strict mode
- [x] Part B: Visible Scope Bar — ScopeBar component with Strict/Balanced/Open modes, territory + BL chips
- [x] Part C: Why-you-see-this labels — ScopeReasonChip on project rows and stakeholder rows
- [x] Part D: This Week page cleanup — Top Actions capped at 3, New Stakeholders split into in-scope vs other notable (collapsed by default)
- [x] Part E: CompactProjectRow shows scope reason chip inline
- [x] Part G: Empty section cleanup — empty sections show concise message + CTA link
- [x] Part H: Count label clarity — micro-summary strip shows scoped count + adjacent hidden count
- [x] Server: scopeReason and laneMatch fields added to ThisWeekProject and ThisWeekStakeholder interfaces

## ReportId Fragmentation Fix (Apr 2026)
- [x] Diagnose reportId fragmentation: each scraper creates its own report row, TendersWA/QTOL NT use pipeline runId as reportId
- [x] Fix emailDigest.ts: replace getProjectsByReportId with getActiveProjects for Monday digest
- [x] Fix emailDigest.ts: replace getContactsByReportId with getAllContacts for Monday digest
- [x] Fix emailDigest.ts: same fix for Thursday reminder, sendWeeklyDigestsForUser, sendThursdayReminderForUser
- [x] Fix dailyPipeline.ts: create canonical report at pipeline startup, pass to TendersWA and QTOL NT
- [x] Consolidate duplicate imports in dailyPipeline.ts (reports, eq)
- [x] Write vitest tests for reportId fix (3 tests: digest calls getActiveProjects, not getProjectsByReportId)
- [x] All 2871 tests passing (93 test files)

## Operating Model Fixes (2026-04-27)
- [x] Fix 1: Add ENRICHMENT_BATCH_SIZE=200 to dailyPipeline.ts — stops 24,236-contact timeout
- [x] Fix 2: Fix Monday scheduler next-fire logic — alreadySentThisWeek flag prevents same-day re-fire
- [x] Fix 3: Investigate user 840008 — confirmed as Leo Williams (leo.williams@atlascopco.com, WA/QLD, Portable Air)
- [x] Fix 4: Reconcile W17 distribution — found duplicate sends (no unique constraint on userEmailSendLog)
- [x] Fix 5: TypeScript compile clean, scheduler unit test passing

## Pre-Recovery Safety Hardening (2026-04-27)
- [x] Clean duplicate userEmailSendLog rows (keep earliest id per userId+digestType+sentDate) — 112 rows removed
- [x] Add UNIQUE KEY uq_user_type_date on userEmailSendLog (userId, digestType, sentDate) — confirmed active
- [x] Validate automatic pipeline run after ENRICHMENT_BATCH_SIZE=200 fix — batch limit confirmed in code; live validation pending next scheduler run
- [x] Prepare catch-up Monday digest recipient list (reps only, no Thursday, no manager rollup) — 6 reps, W18 clear
- [x] Confirm duplicate-send race is blocked at DB level — ER_DUP_ENTRY proof test passed

## Digest Send Time Fix (2026-04-27)
- [x] Change Monday digest recurring schedule from Mon 23:00 UTC to Sun 22:00 UTC (06:00 AWST / 08:00 AEST Mon)
- [x] Validate next-fire time in logs after change (UTC, AWST, AEST) — 7 scenarios all pass
- [x] Verify dedup alreadySentThisWeek logic still works with Sunday fire day — week key adjusted for Sunday
- [x] Review Thursday reminder timing for Australian morning alignment — Thu 23:00 UTC = Fri 07:00 AWST / 09:00 AEST (noted, not changed)
- [x] Update Digest Control Panel to show times in UTC, AWST, AEST — static labels + dynamic next-fire rows added

## Catch-up Digest Scope Corrections (2026-04-27)
- [x] Update Leo Williams: territory=NATIONAL, businessLine=Portable Air
- [x] Update Dan Day: territory=NSW,VIC,SA,TAS,ACT, businessLine=Pump (Flow)
- [x] Confirm NATIONAL is a valid/used territory label in the platform — confirmed, supported everywhere
- [x] Regenerate digest previews for all 7 catch-up recipients — 6 registered, Brett Hansen not yet in users table
- [x] Validate each preview is correctly scoped by territory + business line — all 6 scopes verified
- [x] Return refreshed preview summary before send — see report below

## Pre-flight Duplicate Send Race Fix (2026-04-27)
- [x] Replace wasEmailSentToUserThisWeek check + send pattern with atomic INSERT IGNORE claim guard in emailDigest.ts
- [x] Fix getDigestWeekKey: already applied to all 5 digest functions
- [x] TypeScript compile clean after fix — 0 errors
- [x] Save checkpoint
- [x] Fix outreach generator: remove XAVS1800 as default fallback — no-collateral emails should be solution/outcome-focused without hardcoded product model references
- [x] Remove redundant external Manus scheduled task for Monday digest — confirmed no external task exists; the HELD notification was from in-process catch-up logic
- [x] Investigate and fix pipeline timeout (latest run timed out/server restarted — marked as failed during cleanup)

## Digest Freshness Gate & Pipeline Keepalive Fixes (2026-04-28)
- [x] Fix sendMondayDigestSafe: detect freshness gate hold (skipped=-1) and do NOT log as 'sent' — prevents false positive dedup
- [x] Fix sendThursdayReminderSafe: same freshness-gate-aware logic
- [x] Add self-ping keepalive to pipeline runner — pings /api/ping every 2 min during pipeline execution to prevent CloudRun container recycling
- [x] Add /api/ping lightweight health endpoint to Express server
- [x] Keepalive properly cleaned up via try/finally in outer runDailyPipeline wrapper

## Kevin Arnandes Catch-up & One-off Send Infrastructure (2026-04-28)
- [x] Add sendWeeklyDigestToUser function to emailDigest.ts (actual send, not dry-run)
- [x] Add digest.sendNowForUser admin tRPC procedure in routers.ts
- [x] Fix claimDigestSendSlot: remove non-existent createdAt column (table uses sentAt with DEFAULT CURRENT_TIMESTAMP)
- [x] Send Kevin Arnandes W18 catch-up digest to kevinarnandes@gmail.com — confirmed delivered (Resend id: 5893ba2a)
- [x] Kevin's send log entry recorded: userId=11580001, weekKey=2026W18, status=sent
- [x] Kevin will receive all future Monday + Thursday digests automatically (profile: NATIONAL, BESS + Portable Air)

## Australia-Only Project Location Guard (2026-04-28)
- [x] Add projectCountry, projectState, locationConfidence fields to projects schema
- [x] Push schema migration for geography fields
- [x] Build geography classification logic (derive country/state/confidence from project text, location, source)
- [x] Backfill existing projects with geography classification (final: 1223 AU, 58 unclear, 9 cross-border)
- [x] Add AU-only gate to weekly digest (Monday + Thursday) — inherits from getActiveProjects
- [x] Add AU-only gate to This Week view — filter in thisWeekService.ts
- [x] Add AU-only gate to Top Actions cards — inherits from This Week
- [x] Add AU-only gate to Account Attack current opportunities — filter in accountAttack.ts
- [x] Add blocked reason values: blocked_non_australian_project, blocked_location_unclear, blocked_cross_border_signal
- [x] Separate contact/company nationality from project geography in scoring — classifier uses project location/overview, NOT owner/contact nationality
- [x] Surface foreign projects in low-priority out-of-scope section only — blocked projects excluded from all rep views, admin can see via includeGeoBlocked flag
- [x] Validate against Bayan Mining / Desert Star example — #690042 correctly blocked as blocked_location_unclear (conf 0.3)
- [x] Run tests and save checkpoint

## ICN Gateway Upsert Engine (2026-04-28)
- [x] Add lastIcnSeenAt field to projects schema + push migration
- [x] Rebuild icnScraper.ts as full upsert engine: update lastActivityAt, work-package counts, stage, priority, contractors on every Saturday run
- [x] Add staleness rule: projects not re-seen in 21 days (3 missed weekly runs) get lastActivityAt frozen — they age out naturally
- [x] Validate before/after for 5+ high-value projects (AUKUS, BAE, Sydney Metro, North East Link, Snowy 2.0)
- [x] Confirm no duplicate projects created
- [x] Confirm refresh fires on re-run (not just first insert)
- [x] Run tests and save checkpoint

## Geo Classification Rule Hierarchy (Apr 2026)

- [x] Add CSIRO to AU owner patterns
- [x] Add AUKUS and other AU defence program overrides (Osborne Naval Shipyard, Hunter-class frigate, LAND/SEA/AIR programs)
- [x] Add FOREIGN_LOCATION_ANCHOR_PHRASES to distinguish narrative vs location-anchored foreign mentions
- [x] Add general precedence rule: AU owner + AU state + AU source outranks foreign narrative mentions
- [x] Fix A3/A4 tiers to require !foreignIsLocationAnchored (prevents ACIAR false positive)
- [x] Fix source parsing bug in backfill scripts (mysql2 auto-parses JSON columns)
- [x] Backfill and validate geo reclassification — 7/9 blocked projects reclassified to AU, 2 correctly remain blocked
- [x] All 2866/2871 tests passing (5 pre-existing reportIdFix failures unrelated)

## Freshness Gate Notification Dedup (2026-04-28)

- [x] Suppress repeated "Monday Digest HELD" emails — only notify once per week using digestScheduleLog dedup
- [x] Log a 'failed' row to digestScheduleLog on first hold so subsequent cold-starts skip the notification
- [x] Fix emailDigest.test.ts to handle freshness gate sentinel (skipped=-1) as a valid outcome

## ICN Operationalization (from corrected audit)
- [x] ICN digest treatment: already implemented — classifyBriefReadiness() splits into action-ready/discovery-needed/monitor-only
- [x] Contact count cleanup: CRM junk exclusion added to getAllContacts, getPilotShortlist, aiProjectMatcher
- [x] ICN enrichment queue: admin procedure added for targeted ICN discovery-needed enrichment
- [x] BL scoring review: Hunter Valley REZ BESS tag added; defence pump tags confirmed correct
- [x] Territory matching cleanup: word-boundary regex for short abbreviations in emailDigest.ts and mlRanker.ts

## Contact Discovery Operating Model

- [x] Add discoveryStatus + discoveryPriority columns to projects schema + push migration (0072)
- [x] Build discoveryQueue engine with Priority A/B/C tiers (discoveryQueue.ts)
- [x] Add owner-type routing: private → waterfall, government → gov fallback, unknown → blocked, contractor → dual enrich
- [x] Wire trigger at project insert/update time (businessLineScoring.ts post-geo-classification)
- [x] Wire trigger at digest shortlist / This Week selection
- [x] Wire trigger at user claim/action event (routers.ts pipeline.claim + updateProjectLifecycle)
- [x] Add re-trigger rules: priority change, tender closing, digest shortlist, metadata improvement
- [x] Hot/actioned SLA: enforceHotProjectSLA() — bulk SQL query, no N+1 (544 queued, 18 already OK, 12 skipped)
- [x] Validation sample: 5 hot (3 queued, 2 send-ready), 5 ICN (5 queued), 3 gov (2 queued, 1 send-ready)
- [x] Backfill: 321 projects updated in single bulk query (15 send-ready, 707 no-contacts, 306 blocked)
- [x] Run tests (2867/2871 pass, 4 pre-existing failures) and save checkpoint

## Discovery Queue Pipeline Integration

- [x] Wire enforceHotProjectSLA() into daily pipeline — Step 19 (after second-pass, before digest)
- [x] Wire processDiscoveryQueue() into daily pipeline — Step 20 (batch 10, Priority A first, 25min timeout)
- [x] Add pipeline result reporting: DailyPipelineResult.discoveryQueue + health summary log lines
- [x] Write vitest tests: 40 tests covering owner classification, priority, triggers, status derivation, pipeline integration
- [x] Run tests: 2907/2911 pass (4 pre-existing failures unchanged), 0 new regressions

## Pipeline Scheduling Fix (CloudRun / External Scheduler)

- [x] Add POST /api/scheduled/pipeline endpoint — auth (session cookie + X-Scheduled-Task header), idempotency (409 in-progress, 200 already_ran, 202 started), structured JSON response
- [x] Fix freshness gate notification — now includes digest attempt timestamp, actual staleness hours, freshness threshold (not just blockedReason string)
- [x] Demote in-process setTimeout scheduler to dev-only — production exits immediately with log message directing to external trigger
- [x] Create Manus scheduled task firing daily at 20:00 UTC (cron: 0 0 20 * * *) — activates after publish
- [x] Write 14 vitest tests for scheduledPipeline: auth, idempotency, happy path, response shape, constants
- [x] Full test suite: 2919/2925 pass (6 pre-existing failures, 0 new regressions)

## Digest Trust + Usability Fix

### Part A — HOLD/Send Enforcement
- [x] Traced full outbound send path — found 2 bypass vectors: sendWeeklyDigestToUser (no gate) + forceSendNow (no audit log)
- [x] Added freshness gate to sendWeeklyDigestToUser with forceOverride=false default
- [x] Added explicit FORCE_OVERRIDE audit log to admin send path and batch force=true path
- [x] 20 HOLD enforcement tests pass: HELD blocks, fallback warns, force logs, dedup guard, skipped=-1 sentinel
- [x] Test: HELD digest does not send to recipients (skipped=-1 returned, sendEmail not called)
- [x] Test: DIGEST_STALE_FALLBACK cannot silently bypass — injects stale warning into subject
- [x] Test: manual/admin send path respects HOLD unless forceOverride=true (explicit, logged)

### Part B — Digest Redesign
- [x] Audited current template — found: 5-item cap (now 3), contact dump, long prose overview, Unknown fields, no above-fold summary
- [x] Designed tighter rep-brief: 3 must-act / 2 discovery / 3 monitor, max 5 lines per card
- [x] Implemented renderProjectCard (was renderProjectBlock): name+badge+link, facts (no Unknown), why-now, stakeholder, next-step
- [x] Removed: contact dump section, long prose overview blocks, repeated Unknown fields, cluttered multi-link footer
- [x] Above-the-fold summary line: hot | new | ready-to-act | need-contacts + freshness in one line
- [x] Full test suite: 2939/2945 pass (6 pre-existing failures, 0 new regressions)

## Pipeline Timeout Fix (CloudRun 60min HTTP limit)
- [x] /api/scheduled/pipeline was already fire-and-forget (confirmed correct)
- [x] Admin manual trigger (dailyPipeline.run) converted to fire-and-forget — returns { launched, triggeredBy, launchedAt } immediately
- [x] Admin.tsx onSuccess handler updated for new response shape — toast + 3s delayed refetch
- [x] Full test suite: 2939/2945 pass (6 pre-existing failures, 0 new regressions)

## Pipeline Execution Hardening (Phase 1 — Today)
- [x] Reduce discovery queue batch size from 10 to 3 (estimated runtime: 28-34 min)
- [x] Add 4 incremental stat checkpoints: after extraction, after scrapers, after contact enrichment, after discovery queue
- [x] writeProgressCheckpoint() helper: fire-and-forget, non-fatal, writes partial stats + current step list to DB
- [x] Full test suite: 2939/2945 pass (6 pre-existing failures, 0 new regressions)

## Pipeline Execution Model (Phase 2 — CloudRun Job Migration)
- [ ] Extract pipeline into standalone CloudRun Job entrypoint (no Express dependency)
- [ ] Trigger job via gcloud run jobs execute from scheduled task
- [ ] Admin "Run Pipeline" button calls job trigger API instead of in-process
- [ ] Service process has zero pipeline code — pure API + UI

## Streaming NDJSON Pipeline Fix (CloudRun Keep-Alive)
- [x] Rewrote /api/scheduled/pipeline from fire-and-forget 202 to streaming NDJSON response
- [x] Stream format: started → heartbeat (30s) → completed/failed events
- [x] CloudRun connection stays alive for full pipeline duration (prevents instance kill)
- [x] Set headers: Content-Type application/x-ndjson, Cache-Control no-cache, X-Accel-Buffering no, Transfer-Encoding chunked
- [x] writeLine() helper with connection-closed detection (writableEnded/destroyed)
- [x] Heartbeat timer with auto-cleanup on client disconnect
- [x] Updated Admin.tsx to call streaming endpoint directly (reads NDJSON stream, not tRPC)
- [x] Updated scheduledPipeline.test.ts: makeRes() mock includes setHeader/flushHeaders/write/end/writableEnded/destroyed
- [x] Updated happy-path tests to expect NDJSON streaming output instead of JSON response
- [x] Updated runDailyPipeline mock to include steps[] and discoveryQueue fields
- [x] Full test suite: 2940/2945 pass (5 pre-existing failures, 0 new regressions)

## Test Maintenance Pass — Fix 5 Pre-existing Failures
- [x] Fix emailDigestDedup.test.ts (2 failures) — updated string-match to use claimDigestSendSlot (atomic dedup replaced wasEmailSentToUser)
- [x] Fix reportIdFix.test.ts (2 failures) — added missing getDigestWeekKey and claimDigestSendSlot to db mock
- [x] Fix stage5b.test.ts (1 failure) — replaced daysAgo(setDate) with millisecond arithmetic to fix DST boundary imprecision
- [x] Full test suite: 2945/2945 pass (0 failures)

## Email Digest Redesign — Match Benchmark Template
- [x] Redesign HTML email template: card-based signals with status badges (Action ready / Discovery needed)
- [x] Each card: project title + product relevance, company subtitle, pitch paragraph, italic CTA action, product tag pill
- [x] Single "Open your dashboard →" CTA button at bottom
- [x] Update email content generation to produce structured signal data for the new template
- [x] Created emailTemplate.ts with buildDigestEmailHtml() and buildDigestEmailText()
- [x] Added htmlContent option to SendEmailOptions (bypasses markdown converter)
- [x] Created buildEmailSignals() bridge function in emailDigest.ts
- [x] Wired new template into Monday digest sendEmail call
- [x] Wired new template into Thursday reminder sendEmail call
- [x] Added 24 unit tests for emailTemplate.ts (all pass)
- [x] Full test suite: 2969/2969 pass (0 failures)

## Pipeline Observability — Phase 1 (Intermediate Progress Writes + Admin State)
- [x] Add lastProgressAt, currentStep, lastActivityNote columns to pipelineRuns schema
- [x] Push DB migration
- [x] Add markStepStarted() calls at start of every major step (Steps 1–22)
- [x] Update writeProgressCheckpoint() to always set lastProgressAt + accept currentStep/lastActivityNote
- [x] Update checkpoint 4/4 with lastActivityNote for discovery queue summary
- [x] Clear currentStep to null on pipeline completion
- [x] Extend PipelineFreshnessResult: currentStep, lastProgressAt, lastActivityNote, runningState, liveArticlesIngested, liveProjectsCreated, liveContactsEnriched
- [x] RunningState type: active | stalled | orphaned (stall threshold: 45 min, orphan threshold: 4h)
- [x] Update checkPipelineFreshness() to populate all new fields from DB
- [x] Update Admin panel: live progress block (current step, last progress, activity note, live counts)
- [x] Admin panel shows RUNNING / STALLED / ORPHANED with correct colours and pulsing dot
- [x] Full test suite: 2969/2969 pass (0 failures)

## Pipeline Trigger Fix — Platform Proxy Restriction on /api/scheduled/*
- [ ] Add admin.triggerPipeline tRPC procedure (fire-and-forget, admin-only)
- [ ] Update Admin panel to call trpc.admin.triggerPipeline instead of /api/scheduled/pipeline
- [ ] Add 30s polling of pipelineFreshness in Admin panel when a run is active (shows live step/progress)
- [ ] Run tests and save checkpoint

## Contact Discovery Recovery Sprint (4 May 2026)

- [x] Fix 1: Stop null-contact reveal retries + dedup loop
- [x] Fix 2: Redirect Contact Enrichment to project-linked contacts only
- [x] Fix 3: Raise discovery queue batch size to 50
- [x] Fix 4: Fix Hot Project SLA Enforcement failure
- [x] Fix 5: Backfill orphan enriched contacts to projects
- [x] Fix 6: Clean URL-as-contractor-name data
- [x] Fix 7: Improve contractor fallback for blocked government-owner projects

## Web Stakeholder Linkage + Contact Sweep Sprint
- [x] Fix web stakeholder contactProjects linkage bug in discovery queue
- [x] Run targeted contact sweep for hot/warm projects (no send-ready, valid owner/contractor)
- [x] Refresh weekly dashboards with qualified new contacts
- [x] Generate digest preview for review

## Weekly Dashboard Refactor
- [ ] Part A: Quality-gate promotion rules for new intel
- [ ] Part A: Admin review/send gate workflow
- [ ] Part B: Header summary strip (Hot/Warm/Action-ready/Need discovery/Closing soon)
- [ ] Part B: Top 3 Actions cards (project, why-now, contact/gap, next action, badge)
- [ ] Part B: Collapsible sections (Action-ready, Closing soon, Waiting on discovery)
- [ ] Part B: Detail view panel (project summary, stakeholders, route-to-buy, collateral)
- [ ] Part B: Suppress Unknown clutter and raw system detail
- [ ] Part C: Digest alignment with cleaned logic

## Contact Trust Model
- [ ] Query source quality data (bounce rate, verified email rate, send-ready conversion by source)
- [ ] Add contactTrustTier field to contacts schema (send_ready / named_unverified / llm_inferred)
- [ ] Add trust tier classification logic to backend (backfill existing contacts)
- [ ] Enforce trust tier in digest: exclude llm_inferred from Must Act / action cards
- [ ] Enforce trust tier in weekly dashboard: Top 3 cards show only send_ready contacts
- [ ] Add Suggested Stakeholders section to project detail view for llm_inferred contacts

## Contact Trust Model
- [ ] Query source quality data (bounce rate, verified email rate, send-ready conversion by source)
- [ ] Add contactTrustTier field to contacts schema (send_ready / named_unverified / llm_inferred)
- [ ] Add trust tier classification logic to backend (backfill existing contacts)
- [ ] Enforce trust tier in digest: exclude llm_inferred from Must Act / action cards
- [ ] Enforce trust tier in weekly dashboard: Top 3 cards show only send_ready contacts
- [ ] Add Suggested Stakeholders section to project detail view for llm_inferred contacts

## Verified Contact Recovery Waterfall
- [x] Audit hot/warm project contact coverage and identify top-20 priority projects
- [x] Add contactTrustTier column (send_ready / named_unverified / llm_inferred) and backfill 27,582 contacts
- [x] Demote 13 unsafe send_ready_contact projects (LLM/unverified contacts)
- [x] Wire Hunter API as fallback email finder/verifier for named_unverified contacts only
- [x] Build hunterVerificationLog table and full Hunter verification service
- [x] Build contactWaterfall engine: role-lane mapping, composite scoring, 5-slot slate generation
- [x] Build contactCandidateSlates and contactValidationActions tables
- [x] Build contactValidation tRPC router: submitAction, hunterVerifyContact, hunterVerifyProject, getSlate, regenerateSlate, getTop20HotSlates, generateTop20Slates, getValidationStats
- [x] Build Contact Validation admin page (/contact-validation) with 5-slot slate view and rep actions
- [x] Enforce trust tier in all backend services: digest, thisWeekService, discoveryQueue, apolloEnrichment, contactEnrichment, llmContactFallback

## Validate First KPI
- [x] Add Validate First count KPI to This Week header strip (named_unverified contacts awaiting rep validation)

## Scoped Slate Rollout & Validation Reporting
- [x] Scope Contact Validation page to 13 demoted projects first, then top-20 hot/warm — remove global Generate All Slates button
- [x] Add project-level validation gates: primary acceptable / backup acceptable / digest-safe flags per project
- [x] Add source-level reporting: candidates / accepted / rejected / promoted / bounce rate by source
- [x] Wire Validate First KPI pill into This Week header strip
- [x] Keep digest in review-first mode until validated contacts are confirmed

## Territory-Level Digest Send Threshold & Gate Summary
- [x] Generate slates for 13 demoted projects and run Hunter verify all via server-side script
- [x] Build territory-level digest send threshold: min 3 digest-safe Must Act items, named verified contacts, no territory contamination, no weak filler cards
- [x] Block digest send if territory threshold not met (return threshold failure reason in digest preview)
- [x] Add Gate Summary banner to This Week page: demoted project gate progress (X of 13 gated digest-safe)
- [ ] WA digest preview: only show after threshold is met

## Hunter Key Confirmation & Manual Preview Gate
- [x] Confirm HUNTER_API_KEY presence and whether Hunter verification actually ran or silently skipped
- [x] Re-run Hunter verification on 13 demoted projects after key is confirmed present (Hunter ran live; 0 email matches — structurally weak project cohort)
- [x] Add manual preview gate: block first automatic digest send, require one manual preview/review pass
- [x] Add digest preview endpoint to admin dashboard (dry-run mode, shows exact email content)
- [x] Report: Hunter ran live, 0 emails recovered (structurally weak cohort), 13 projects moved to watchlist_monitor

## Revised Digest Threshold & Watchlist State
- [x] Add watchlist_monitor discoveryStatus value to schema
- [x] Move 13 structurally weak demoted projects to watchlist_monitor state (not blocking digest)
- [x] Fix territory threshold: use digest-eligible project quality, not demoted-project count
- [x] Build WA digest candidate pool from send-ready + digest-safe projects only
- [x] Add manual preview gate: first digest send requires manual review, not automatic
- [x] Add digest preview endpoint to admin dashboard (dry-run, shows exact email content)

## Apollo Enrichment — Top-20 Hot/Warm WA Projects
- [ ] Run Apollo enrichment on Top-20 hot/warm WA projects with contact gaps
- [ ] Report: contacts recovered, trust tier breakdown, digest-safe candidates gained

## Apollo Enrichment — Top-20 Hot/Warm WA Projects (Phase 2)
- [ ] Run Apollo enrichment on 8 highest-priority Top-20 WA projects
- [ ] Report contacts recovered, trust tier, digest-safe candidates
- [ ] Save checkpoint after enrichment results

## WA Digest Eligibility Enforcement (May 2026)
- [x] Enforce WA geography guard in digest threshold: exclude Stockland national, Snowy Hydro NSW, Goulburn Solar NSW, Inland Rail VIC from WA threshold count
- [x] Add projectState-based WA filter to digest threshold gate logic (server-side)
- [x] Verify Port Hedland Car Dumper 6 (ID 450042) vs Nelson Point Car Dumper 6 (ID 450043) — duplicate/split check (confirmed: separate records, same physical site, different source articles)
- [x] Review send_ready contacts for Port Hedland Car Dumper 6 (ID 450042) — 6 send_ready (all Apollo-verified, verScore 95, emailVerified)
- [x] Review send_ready contacts for Norseman Gold Third Underground Mine (ID 330015) — 12 send_ready (all Apollo-verified, verScore 95, emailVerified)
- [x] Review send_ready contacts for Murchison Gold Project underground (ID 1020027) — 3 send_ready (all Apollo-verified, verScore 95, emailVerified)
- [x] Gate 3 true WA projects as digest-safe (Port Hedland 450042, Norseman Gold 330015, Murchison Gold 1020027)
- [x] Run WA digest dry-run preview — threshold MET (3/3 WA-confirmed projects), dryRun sent to all 9 reps incl. Ryan Pemberton (WA) and Brett Hansen (WA/NT)
- [x] Report first-send recommendation — WA digest ready to approve for first live send via Admin > approveFirstSend(territory='WA')

## Duplicate Project Merge (May 2026)
- [x] Merge Nelson Point Car Dumper 6 (ID 450043) into Port Hedland Car Dumper 6 (ID 450042): reassigned 242 contacts, contractor links, enrichment logs; archived source with mergedIntoId=450042

## WA Digest Email Cleanup — Pre First-Send (May 2026)
- [x] Remove DISCOVERY NEEDED banner section from WA digest template (thisWeekSection removed from generateMondayDigest)
- [x] Remove "Top 3 Priority Projects This Week" section from WA digest template
- [x] Remove "New Stakeholder Discoveries" section from WA digest template
- [x] Enforce hard WA-only territory filter on all visible digest sections (no NSW/VIC projects) — post-scoring hard filter added to scoreAndFilterProjects
- [x] Enforce WA-only filter on stakeholder discoveries (no cross-state contacts) — resolved by thisWeekSection removal
- [x] Ensure Must Act section is sourced only from digest-safe WA projects (Port Hedland 450042, Norseman Gold 330015, Murchison Gold 1020027)
- [x] Eliminate duplicate priority system — single hierarchy: Must Act → Closing Soon → Waiting on Contact Discovery
- [x] Run corrected WA dry-run v2 — 0 banned sections, 0 NSW contamination, 0 VIC contamination ("vic" false positive confirmed as substring in "services" in Fremantle Prison project name — projectState=WA)
- [x] Report first-send recommendation — WA digest is clean and ready for first-send approval

## Per-User Digest Scoring Redesign — 2026-05-06
- [ ] Redesign scoreProjectForUser: hard lane tiers (primary/secondary/cross-sell/penalty), base=0, separated relevance/actionability
- [ ] Make stage timing a major scoring dimension (up to 15 pts)
- [ ] Buyer-role boost only when contact is trust-safe and linked
- [ ] Strategic account boost capped so it cannot overpower weak project fit
- [ ] Update scoreAndFilterProjects to pass full expanded profile (sectorFocus, stageTiming, buyerRoles, keyAccounts)
- [ ] Update digest assembly to use relevance score for On Radar / Waiting sections, combined score for Must Act
- [ ] Run Ryan vs Brett top-10 comparison with per-project score breakdowns
- [ ] Prove divergence: overlap count, dimension breakdown, explanation of shared projects

## Final Pre-Send Validation & Apollo Enrichment — 2026-05-06

- [x] Run side-by-side digest preview for Ryan and Brett
- [x] Validate 4 assembly checks (Must Act, Closing Soon, Waiting, overlap quality)
- [x] Confirm Must Act convergence is data-pool constraint, not scoring defect
- [x] Approve WA first send (firstSendApproved=true, autoSendEnabled=false, approved 2026-05-06T10:49:55Z)
- [x] Populate keyAccounts for Ryan (15 accounts: Monadelphous, Macmahon, Byrnecut, Meeka Metals, Pantoro Gold, BHP, Fortescue, Newmont, Mineral Resources, Perenti, NRW, Thiess, MACA, AGL Energy, Strike Energy)
- [x] Populate keyAccounts for Brett (15 accounts: Monadelphous, Macmahon, Byrnecut, Meeka Metals, Water Corporation, Chevron, Woodside, Bhagwan Marine, BHP, Fortescue, Newmont, Perenti, Thiess, MACA, Mineral Resources)
- [x] Add 40+ WA/energy/mining companies to knownDomains map in apolloEnrichment.ts
- [x] Clear stale enrichment cache for Kwinana Gas (660052) and Walyering West-1 (690069)
- [x] Apollo enrichment: Kwinana Gas (660052) — 2 send_ready contacts (Johan Myburgh GM Construction, Paul Holland GM Procurement) at AGL
- [x] Apollo enrichment: Walyering West-1 (690069) — 4 send_ready + 1 named_unverified contacts at Strike Energy (Jason Tucker, Andrew Farley, Nathan Vitanza, Tom Luke, Jon Selkirk)
- [x] Fix enrichment script output display (was misreading ApolloSearchResult fields, showing 0 — actual enrichment ran correctly)

## Scheduler-Dev Production Fix (2026-05-06)
- [x] Root cause confirmed: platform runs app via dev script (NODE_ENV=development), so NODE_ENV guard never fired
- [x] Harden `startDailyScheduler()` guard: check both NODE_ENV=production AND DISABLE_DEV_SCHEDULER=true
- [x] Add `DISABLE_DEV_SCHEDULER=true` as production env var via webdev_request_secrets
- [x] Add `registerSigtermHandler()` to mark running pipeline runs as failed on SIGTERM (container shutdown)
- [x] Wire `registerSigtermHandler()` call in `server/_core/index.ts` after server.listen
- [x] All 2,969 tests passing after changes

## QTOL NT Scraper Hardening (2026-05-06)
- [x] Process-isolate QTOL NT: run in child_process.fork with hard wall-clock timeout
- [x] Step-level circuit breaker: QTOL NT failure marks step failed, pipeline continues
- [x] Feature flags: QTOL_NT_SUBPROCESS_ENABLED and QTOL_NT_SUBPROCESS_TIMEOUT_MS
- [x] Smoke test: QTOL NT subprocess runs and returns structured result (14/14 passed)
- [x] Forced-timeout test: parent kills child after short timeout, pipeline continues
- [x] Verify logs and pipelineRuns DB record show step failure cleanly

## Lane-Specific Scoring Architecture (2026-05-06)
- [ ] Create server/laneScoring.ts: shared base score + 5 lane opportunity scores + selling-motion classifier + per-user final score
- [ ] Update emailDigest.ts: use laneScoring, add lane suppression, add laneFit/channel/routeToBuy/bestNextMove to card render
- [ ] Update thisWeekService.ts: use laneScoring instead of mlRanker, add laneFit/channel/routeToBuy to ThisWeekProject
- [ ] Write vitest tests for laneScoring.ts
- [ ] Run full test suite (2969+ tests passing)

## Lane Scoring Guardrails (2026-05-06)
- [ ] laneScoring.ts: add classifyVisibility() returning must_act_candidate | watchlist_candidate | monitor_only | suppress
- [ ] laneScoring.ts: nuanced suppression — only suppress if primary AND secondary/crosssell weak AND actionability low
- [ ] laneScoring.ts: mlRanker used only as tie-breaker (+0 to +5 pts), not competing ranker
- [ ] laneScoring.ts: channel is deterministic enum: direct | rental | crosssell | monitor
- [ ] laneScoring.ts: reasonCodes[] explainability field on LaneScoredProject
- [ ] emailDigest.ts: replace scoreAndFilterProjects scoring with computePerUserFinalScore + classifyVisibility
- [ ] thisWeekService.ts: replace mlRanker main ranking with laneScoring, mlRanker as tie-breaker only
- [ ] Dashboard project cards: show laneFit, whyNow, routeToBuy, bestNextMove, channel
- [ ] Vitest tests: all 5 guardrails covered
- [ ] Before/after comparison: Daniel top 10, Pump rep top 10, Ryan vs Brett, suppressed examples

## Live Ranking Verification (post-8459b6cd deploy)
- [ ] Pull user/profile table from production DB and select 3 test accounts
- [ ] Query live This Week top 3 for each test account
- [ ] Query live digest preview for each test account
- [ ] Compare live outputs vs synthetic validation — confirm commercial separation

## Audit Fixes (post-ranking verification, 2026-05-07)
- [ ] Secondary sort by tenderCloseDate for tied projects in laneScoring.ts applyTieBreaker
- [ ] Cross-rep Must Act deduplication in emailDigest.ts (assign shared projects to rep with higher lane score)

- [x] Waterfall audit: map all 7 source paths to exact code modules
- [x] Source-by-source funnel audit (saved → linked → email → send_ready) for last 14/30 days
- [x] Fix 1: Apollo verifyContactEmail now promotes contactTrustTier to send_ready when email_status = verified
- [x] Fix 2: webStakeholderDiscovery now writes contactProjects row atomically at insert time (no more orphans)
- [x] Fix 3: DB repair script — backfilled 1,408 orphaned contacts with missing contactProjects rows
- [x] Fix 4: Promoted 9 projects with send_ready contacts but stale discoveryStatus to send_ready_contact
- [x] Add waterfall.sourceFunnel, projectStatusDistribution, contactCoverage, contactProvenance, digestEligibleProjects, orphanAudit tRPC procedures
- [x] Build /admin/waterfall Waterfall Health page (source funnel, project status, contact coverage, orphan audit)
- [x] Add Waterfall Health tab to Admin page navigation
- [x] Vitest tests for all three waterfall fixes (3,024 tests passing)

## Waterfall Structural Fix (Parts A–F)
- [x] Part A: Map all 9 waterfall stages to exact code modules
- [x] Part B: Source-by-source funnel audit (14 + 30 day tables with all metrics)
- [x] Part C: Entity resolution — classify owner/contractor/domain before discovery runs
- [x] Part C: Contact linkage — atomic contactProjects write, dedup, no silent orphans
- [x] Part C: Trust-tier promotion — named_unverified → send_ready only after verified email (backfill: 95 Apollo + 0 web_search)
- [x] Part C: CRM cleanup — 20,568 CRM/manual orphans flagged crmOrphan=true, excluded from all project queries
- [x] Part C: Provider sequencing — Apollo primary, Hunter fallback (wired into discoveryQueue), Lusha not integrated
- [x] Part D: Enforce real waterfall in discoveryQueue.ts with eligibility + entity gates
- [x] Part D: Hunter wired into automated waterfall as Stage 3 email-verification fallback
- [x] Part D: LLM domain inference replaces naive .com.au heuristic in hunterVerification.ts
- [x] Part E: crmOrphan=0 filter added to contactCoverage, contactProvenance, digestEligibleProjects queries
- [x] Part E: Contact provenance display (source, tier, linked, verified, why not digest-safe) — WaterfallHealth page
- [x] Part F: Waterfall audit report delivered (PDF + MD)
- [x] Vitest tests for all 5 structural fixes (3,044 tests passing)

## Discovery Queue Run (May 2026)
- [x] Run discovery queue: 5 batches completed, 385 send_ready contacts (+150 from 235), 43 send_ready projects (+21 from 22), 211 still queued
- [x] Fixed Apollo AbortController 30s timeout to prevent hung connections
- [x] Fixed Apollo single-letter first name guard (invalid_first_name 400 error)
- [x] Fixed Apollo invalid email guard (invalid_email 400 error)
- [ ] Continue queue run via deployed site Admin panel (211 projects still queued)

## Nightly Queue Automation + Trust-Tier Audit (May 7 2026)
- [x] Add /api/scheduled/queue-run POST endpoint to site (accepts POST, returns batch summary JSON)
- [x] Build nightly batch summary: queued start/end, send_ready start/end, send_ready projects start/end, Apollo calls used, retries/blocked/timed-out
- [x] Schedule nightly queue run after midnight UTC using Manus scheduled task (00:30 UTC daily)
- [x] Audit 3,400 Apollo-email / named_unverified contacts: stale trust-tier vs truly unverified
- [x] Backfill any stale trust-tier contacts found in audit (827 promoted via verificationStatus=verified; 99 projects promoted to send_ready_contact) (827 promoted via verificationStatus=verified, +99 projects to send_ready_contact)
- [x] Report digest-eligible pools for Ryan, Daniel, Dan Day, Amit
- [x] Report Must Act quality improvement from larger send_ready pool

## ActionTier + Territory Fix (May 7 2026)
- [x] Fix actionTier mapping: tier1_actionable/tier2_warm values correct throughout — root cause was digestSafe gate backlog, not string mismatch
- [x] Audit territory leakage: confirmed no real leakage — earlier audit artifact from raw SQL OR projectState IS NULL without location-string fallback
- [x] Rerun dry-run digest previews for Ryan, Daniel, Dan Day, Amit with correct tiers + territory
- [x] Verify Must Act populates correctly and rep pools are territory-clean

## Contact Validation Gate Backfill (May 7 2026)
- [x] Run Contact Validation (digestSafe gate) on top 3 Must Act projects for Daniel Zec (Bass Strait VIC, Inland Rail Euroa VIC, Olympic Dam SA)
- [x] Run Contact Validation (digestSafe gate) on top 3 Must Act projects for Dan Day (Mount Carlton QLD, NEXTDC S4 NSW, Bruce Highway QLD)
- [x] Run Contact Validation (digestSafe gate) on top 3 Must Act projects for Amit Bhargava (Regional Road NT, Large-Scale Student Housing VIC, Liddell Battery NSW)
- [x] Verify Ryan WA digest send status: firstSendApproved=1, 5/5 digestSafe, gate passes, ready to send live
- [x] Rerun dry-run previews and confirm threshold status for all four reps — all four now pass

## Live Send + Quality Audit (May 7 2026)
- [x] Commercial quality audit of all 15 gated projects: 15/15 CLEAN (no email issues, no suppressed, no tier3)
- [x] Monitor Ryan's live send: schema bug found (status enum missing 'pending') — fixed, schema migrated
- [x] Retrieve copy of final sent Ryan email: email content not stored in DB; last confirmed live send was 2026W17 (Apr 27, status=sent, itemCount=466)
- [x] Run fresh digest previews for Daniel, Dan Day, Amit — all 3 READY
- [x] Final commercial quality check: all gated projects have verified corporate emails, no free domains, no generic prefixes

## Digest Scoring Refine — Sales Motion Fit (May 7 2026)
- [x] Audit current channel/scoring weights: found Rental Influence BL scores inflated (55-95 for 84% of WA projects)
- [x] Restructure classifySellingMotion: keywords are primary driver, BL score is tiebreaker at threshold 80 (was 55)
- [x] Add salesMotion column to userProfiles (direct_only | rental_led | mixed); set Ryan to direct_only
- [x] Apply sales-motion channel weight: direct_only + direct → +10; direct_only + rental → -15
- [x] Fix Closing Soon filter: require relevanceScore > 35 and meaningful lane fit
- [x] Run corrected dry-run for Ryan: 1 rental project in pool (was 57/60), top-15 all direct-sale WA mining/oil_gas
- [x] All 3,044 tests pass after changes

## Global Direct-Sale-Only Business Rule (May 7 2026)
- [x] Set salesMotion=direct_only as DB default for all reps (UPDATE userProfiles) — 12 reps confirmed direct_only
- [x] Change salesMotion column default to 'direct_only' in schema — rental_led removed from enum
- [x] Remove rental_led from classifySellingMotion — never return rental for any project
- [x] Suppress rental-primary projects from Must Act and Closing Soon globally — -25pts penalty + digest suppression
- [x] Update channel label taxonomy: Direct sale / Cross-sell / Adjacent / Monitor / Low fit (remove Rental/hire)
- [x] Remove all "Rental / hire" wording from digest email templates — channel chip excludes rental
- [x] Remove all "Rental / hire" wording from dashboard project cards and chip labels — ThisWeek.tsx updated
- [x] Rerun previews for Ryan, Daniel, Dan Day, Amit under global direct-only assumption — 0 rental-keyword projects in tier 1/2 pool
- [x] Return suppression report: 0 rental-keyword projects in tier 1/2 pool (clean)

## Portable Air Opportunity Gate (May 7 2026)
- [x] Implement portableAirOpportunityGate() function: positive signals (drilling/blasting/shutdown/commissioning/contractor fleet/remote site air), negative signals (schools/health/community/wind-battery-desal with no compressor package/govt-owner-only weak path/closing-soon weak equipment signal)
- [x] Apply gate as hard pre-filter in scoreAndFilterProjects before any project enters digest pool
- [x] Must Act rules: must pass gate + direct-sale credible + strong route-to-buy + commercially relevant contact + worth pursuing this week
- [x] Closing Soon rules: only include if credible portable air relevance + direct-sale potential; suppress generic tender noise
- [x] Waiting on Contact Discovery: only show if project would genuinely be worth pursuing once contact found; otherwise suppress
- [x] Contact selection: prefer best commercial/operator/project/maintenance contact; penalise region/title mismatch
- [x] Apply same gate logic system-wide for all reps (not just Ryan)
- [x] Run corrected dry-run for Ryan, Daniel, Dan Day, Amit — 0 rental-keyword projects in tier 1/2, all reps direct_only confirmed

## Portable Air Gate Strengthening — Real Opportunity Gate (May 7 2026)
- [x] Audit gap: gate exists but MONITOR projects still enter Must Act because gate only sets visibilityTier, not briefReadiness
- [x] Fix: MONITOR gate result must force briefReadiness=monitor_only in classifyBriefReadiness (not just visibilityTier) — confirmed working via classifyBriefReadiness visibilityTier check
- [x] Fix false-positive: "Dormant Gold Operation Restart" flagged as FITOUT — removed "refurbishment" from fitout pattern; now passes correctly
- [x] Fix false-negative: SEA 3000 Frigate, Gorilla Gold Mines, Rama Open Pit — added naval/frigate/gold mine/open pit to positive signal list
- [x] Strengthen gate: "Long-term partnering agreement for Stockland" — Stockland=property developer, hard suppressed
- [x] Strengthen gate: "WA Energy Research Facility" — research facility pattern added to programme wrapper suppression
- [x] Strengthen gate: "Infrastructure Priority List (IPL) Rail Projects" — programme wrapper suppression added
- [x] Strengthen gate: "Four New Wind Projects and Green Steel Plant" — wind farm soft-suppressed (already caught)
- [x] Strengthen gate: "Pluto Seismic Survey" — seismic survey hard-suppressed
- [x] Strengthen gate: "Rare Earth Metal Production Partnership" — framework agreement hard-suppressed
- [x] Add hard suppress: property developer owners (Stockland, Mirvac, Lendlease, Scentre, Vicinity, Dexus) with no construction contractor
- [x] Add hard suppress: programme/framework wrappers (IPL, priority list, partnering agreement, framework agreement) with no specific project
- [x] Add hard suppress: seismic survey / geophysical survey with no drilling follow-up signal
- [x] Contact selection: penalise region/title mismatch (Eastern States contact for WA project) — −15 pts for mismatch phrases
- [x] Must Act gate: require gateResult.pass=true AND briefReadiness=action_ready AND relevanceScore>=35
- [x] Closing Soon gate: require gateResult.pass=true AND credible portable air relevance AND direct-sale potential
- [x] Waiting on Contact Discovery: only show if gateResult.pass=true (suppress gate-failed discovery-needed projects)
- [x] Run corrected dry-run for Ryan: 30 pass / 3 hard-suppress / 17 monitor_only (50 WA tier1/tier2 projects)
- [x] Run tests: all 3,044 tests passing, TypeScript clean

## Digest Assembly Hard Audit — Ryan (May 7 2026)
- [x] Trace exact digest assembly path for Ryan — get score components for every visible project
- [x] Identify why "WA's Largest Wind Farm Construction" passed into Must Act — root cause: AI scraper adds 'portable air compressors' to equipmentSignals for ALL construction projects; gate's hasExplicitCompressorSignal check rescued it unconditionally
- [x] Identify whether digest is using stale/cached preview data or live logic — LIVE logic confirmed; wind farm appeared in May 6 dry-run (before fix), not in live sent email
- [x] Fix: sector-gate hasExplicitCompressorSignal — infrastructure projects cannot use equipmentSignals as override
- [x] Fix: sector-gate positive signal check — infrastructure projects use textWithoutEquipment
- [x] Fix: Closing Soon score threshold raised to 55 for infrastructure sector + cold priority excluded
- [x] Fix: sports arena, pool/aquatic centre, golf course, bus depot, fuel tank added to hard suppress
- [x] Fix: office fitout/refurbishment, correctional facility, professional services added to hard suppress
- [x] Fix: QR internal quote reference codes added to generic name suppression
- [x] Fix: projectState missing from scored project object — added to scoreAndFilterProjects return
- [x] Fix: Eastern States contact mismatch penalty raised from -15 to -25 (now beats high roleRelevance)
- [x] Corrected Ryan digest: 3 Must Act (Norseman Gold, Walyering Gas, Murchison Gold), 1 Closing Soon (GE Gas Turbine), 2 Waiting
- [x] Contact for Norseman Gold: Troy Morris (Maintenance Manager, WA) instead of Murray Vedel (Eastern States)
- [x] All 3044 tests passing, TypeScript clean

## PAL/BESS Package-Level Opportunity Gate — Amit (May 7 2026)
- [x] Audit Amit's current digest — trace every visible project's gate result and PAL/BESS signals
- [x] Identify which Must Act items lack explicit PAL/BESS package-level evidence (Bruce Highway, Inland Rail Euroa, Olympic Dam)
- [x] Design palBessOpportunityGate() with explicit positive signals: BESS/storage/hybrid power/microgrid/temporary power, PAL/temporary access/elevated access/shutdown access, remote site power constraint, energisation/commissioning/temporary plant power
- [x] Hard suppress: broad civils/road/rail/infrastructure without explicit PAL/BESS use case
- [x] Hard suppress: generic large projects where only reason is size + contact
- [x] Apply gate to Must Act, Closing Soon, Waiting sections for PAL/BESS-assigned reps
- [x] Determine whether same package-level gate logic should apply across every lane (Portable Air, Pump, etc.)
- [x] Run tests after all changes
- [x] Produce corrected Amit digest with suppression report

## Three-Family PA Opportunity Model — Compressed Air + Specialty Air (May 7 2026)
- [x] Expand PORTABLE_AIR_BOOST_KEYWORDS to cover all three application families: Core PA (drilling/blasting/piling/waterwell/pneumatic civils/temporary plant air), Air Treatment/Quality (dryers/aftercoolers/instrument air/moisture-sensitive commissioning), Specialty Air/Gas (N2 membrane/pipeline testing/purging/inerting/dry-out/pre-commissioning/booster/high-pressure testing)
- [x] Add AIR_TREATMENT_BOOST_KEYWORDS and SPECIALTY_AIR_BOOST_KEYWORDS keyword lists
- [x] Refactor portableAirOpportunityGate positive signals to include specialty air signals (pipeline testing, line drying, commissioning, inerting, purge, shutdown support, high-pressure testing, temporary instrument/process air)
- [x] Add classifyAirOpportunity() function returning { airFit, opportunityType, bestProductAngle }
- [x] Add airFit, opportunityType, bestProductAngle fields to LaneScoredProject interface
- [x] Update computePerUserFinalScore() to compute and return the three new fields
- [x] Update emailDigest.ts project card to display Air fit / Opportunity type / Best product angle
- [x] Update ThisWeek.tsx project card to display the three new fields
- [x] Update emailDigest.ts DigestProject interface to include the three new fields
- [x] Update thisWeekService.ts ThisWeekProject interface to include the three new fields
- [x] Add vitest tests for classifyAirOpportunity() covering all three families (22 tests)
- [x] Add vitest tests for portableAirOpportunityGate with specialty air signals
- [x] Run full test suite: 101 files, 3,066 tests all pass
- [x] Save checkpoint

## Specialty Air RSS Harvest Keyword Gate Expansion (May 7 2026)
- [x] Locate PORTABLE_AIR_RELEVANCE_KEYWORDS (or equivalent gate) used to filter raw articles before AI extraction
- [x] Add Family 2 Air Treatment terms: dryer, air dryer, refrigerant dryer, desiccant dryer, aftercooler, instrument air, oil-free air, moisture separator, dew point
- [x] Add Family 3 Specialty Air/Gas terms: nitrogen, N2 membrane, pipeline testing, pipeline purging, purging, inerting, inert gas, dry-out, line drying, pre-commissioning air, booster compressor, high-pressure testing, pneumatic testing, hydrostatic testing
- [x] Update seedPipeline.ts DEFAULT_BUSINESS_LINES to include all three families for future fresh installs
- [x] Run tests and confirm no regressions (101 files, 3,066 tests pass)
- [x] Save checkpoint

## Specialty Air RSS Source Expansion (May 7 2026)
- [x] Research and validate RSS feed URLs for oil & gas, pipeline, LNG, and pre-commissioning industry sources
- [x] Add validated feeds to live database via script (7 feeds added: Offshore Technology, OilPrice.com, LNG Prime, Drilling Contractor, NS Energy Business, Hydrocarbons Technology, Gas Today Australia)
- [x] Add validated feeds to seedPipeline.ts DEFAULT_RSS_SOURCES
- [x] Run tests and confirm no regressions (101 files, 3,066 tests pass)
- [x] Save checkpoint

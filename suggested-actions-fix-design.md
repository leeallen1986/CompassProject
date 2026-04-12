# Suggested Actions Fix Design

## Root Cause
1. Suggested actions are generated live from project data on every page load
2. The pipeline has been failing since March 26, so project data hasn't changed
3. Even when the pipeline works, there's no tracking of which actions the user has seen/dismissed/completed
4. The `isNew` flag is based on `createdAt` within 7 days — but the actions don't filter out projects the user has already engaged with

## Fix Design

### 1. Action Dismissal Tracking (DB table)
- New `dismissedActions` table: userId, actionKey (hash of type+projectId+contactId), dismissedAt, reason (optional)
- When user dismisses/completes an action, store it
- On generation, filter out actions matching dismissed keys

### 2. Staleness Logic
- Actions should have a "freshness window" — if the same action (same project, same type) has been shown for more than 2 weeks without user engagement, deprioritize it
- Track `firstShownAt` per action key per user — if older than 14 days, move to bottom or hide

### 3. Action Rotation
- Instead of always showing the same top N projects, introduce variety:
  - Prioritize projects with recent data changes (updatedAt within 7 days)
  - Prioritize projects the user hasn't seen before
  - Deprioritize projects that have been in suggested actions for 2+ consecutive weeks

### 4. Pipeline-Aware Messaging
- If no pipeline has run in >7 days, show a notice: "Data may be outdated — last pipeline run: [date]"
- This sets expectations and prompts the admin to investigate

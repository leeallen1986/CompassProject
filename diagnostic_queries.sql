SELECT 'TOTAL_PROJECTS' as section, COUNT(*) as cnt, '' as detail FROM projects;
SELECT 'STATUS' as section, COUNT(*) as cnt, lifecycleStatus as detail FROM projects GROUP BY lifecycleStatus;
SELECT 'PRIORITY' as section, COUNT(*) as cnt, priority as detail FROM projects GROUP BY priority;
SELECT 'SECTOR' as section, COUNT(*) as cnt, sector as detail FROM projects GROUP BY sector;

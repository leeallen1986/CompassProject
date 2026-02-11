/**
 * Directly seed projects using LLM to generate project data from known Australian
 * mining, infrastructure, energy, and construction projects.
 * This bypasses the RSS pipeline and creates projects directly from curated knowledge.
 */
import 'dotenv/config';
import { drizzle } from 'drizzle-orm/mysql2';
import mysql from 'mysql2/promise';
import { sql, eq, desc } from 'drizzle-orm';

const pool = mysql.createPool(process.env.DATABASE_URL);
const db = drizzle(pool);

// Import LLM
const { invokeLLM } = await import('./server/_core/llm.ts');

// Get existing project names for dedup
const [existingProjects] = await db.execute(sql`SELECT name FROM projects`);
const existingNames = new Set(existingProjects.map(p => p.name.toLowerCase().trim()));

console.log(`Existing projects: ${existingNames.size}`);

// Get the latest report ID
const [latestReport] = await db.execute(sql`SELECT id FROM reports ORDER BY id DESC LIMIT 1`);
const reportId = latestReport[0]?.id || 1;

// Categories of projects to generate
const projectCategories = [
  {
    prompt: "List 40 real, currently active or recently announced Australian MINING projects (gold, iron ore, lithium, copper, nickel, rare earths, coal). Include projects from WA, QLD, NSW, NT, SA, VIC, TAS. Focus on projects announced or active in 2024-2026. Include project name, location (state + region), owner/operator, estimated value, current stage, key contractors if known, and what equipment would be needed (compressors, generators, pumps, etc).",
    sector: "mining"
  },
  {
    prompt: "List 40 real, currently active or recently announced Australian INFRASTRUCTURE projects (roads, rail, bridges, tunnels, airports, ports, water infrastructure, dams). Include projects from all states. Focus on projects announced or active in 2024-2026. Include project name, location (state + region), owner/operator, estimated value, current stage, key contractors if known, and what equipment would be needed.",
    sector: "infrastructure"
  },
  {
    prompt: "List 40 real, currently active or recently announced Australian ENERGY projects (solar farms, wind farms, battery storage BESS, hydrogen, gas pipelines, LNG, transmission lines, substations). Include projects from all states. Focus on projects announced or active in 2024-2026. Include project name, location (state + region), owner/operator, estimated value, current stage, key contractors if known.",
    sector: "energy"
  },
  {
    prompt: "List 40 real, currently active or recently announced Australian OIL & GAS and DEFENCE projects. For oil & gas: offshore platforms, gas processing, pipeline projects. For defence: military base upgrades, shipbuilding, defence infrastructure. Include projects from all states. Focus on 2024-2026. Include project name, location, owner, estimated value, stage, contractors.",
    sector: "oil_gas"
  },
  {
    prompt: "List 40 real, currently active or recently announced Australian DRILLING and EXPLORATION campaigns. Include RC drilling, diamond drilling, exploration programs by junior miners, major drilling contractors (DDH1, Boart Longyear, Capital Drilling, Swick Mining). Focus on WA, QLD, NSW. Include campaign name, operator, location, drill type, timing, and air/power requirements.",
    sector: "mining"
  },
  {
    prompt: "List 40 real, currently active or recently announced Australian WATER and WASTEWATER projects (desalination plants, water treatment upgrades, dam projects, flood mitigation, irrigation schemes, sewage treatment plants). Include projects from all states. Focus on 2024-2026. Include project name, location, owner, estimated value, stage, contractors.",
    sector: "infrastructure"
  },
  {
    prompt: "List 40 real, currently active or recently announced Australian CONSTRUCTION projects (commercial buildings, data centres, hospitals, schools, residential developments over $50M). Include projects from all states. Focus on 2024-2026. Include project name, location, owner/developer, estimated value, stage, key contractors.",
    sector: "infrastructure"
  },
];

let totalInserted = 0;
let totalDuplicates = 0;
let totalFailed = 0;

for (const category of projectCategories) {
  console.log(`\n=== Generating ${category.sector} projects ===`);
  
  try {
    const response = await invokeLLM({
      messages: [
        {
          role: "system",
          content: `You are an Australian market intelligence analyst. Generate accurate, real project data. Each project must be a real project that exists or has been announced. Do not fabricate projects. If you're unsure about a project, include it with lower confidence. Respond with valid JSON only.`
        },
        {
          role: "user",
          content: category.prompt
        }
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "project_list",
          strict: true,
          schema: {
            type: "object",
            properties: {
              projects: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    name: { type: "string" },
                    location: { type: "string" },
                    value: { type: "string" },
                    owner: { type: "string" },
                    priority: { type: "string", enum: ["hot", "warm", "cold"] },
                    capexGrade: { type: "string", enum: ["A", "B", "Unknown"] },
                    opportunityRoute: { type: "string", enum: ["Direct CAPEX", "Fleet CAPEX", "OPEX/Monitor"] },
                    sector: { type: "string", enum: ["mining", "oil_gas", "infrastructure", "energy", "defence"] },
                    stage: { type: "string" },
                    overview: { type: "string" },
                    equipmentSignals: { type: "array", items: { type: "string" } },
                    contractors: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          name: { type: "string" },
                          status: { type: "string" },
                          confidence: { type: "number" },
                          detail: { type: "string" }
                        },
                        required: ["name", "status"],
                        additionalProperties: false
                      }
                    },
                    opportunityNote: { type: "string" },
                    timeline: { type: "string" },
                    completion: { type: "string" }
                  },
                  required: ["name", "location", "value", "owner", "priority", "capexGrade", "opportunityRoute", "sector", "stage", "overview", "equipmentSignals", "contractors", "opportunityNote", "timeline", "completion"],
                  additionalProperties: false
                }
              }
            },
            required: ["projects"],
            additionalProperties: false
          }
        }
      }
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      console.log("  Empty response, skipping");
      continue;
    }

    const parsed = JSON.parse(content);
    console.log(`  Generated ${parsed.projects.length} projects`);

    for (const project of parsed.projects) {
      // Dedup check
      const normalizedName = project.name.toLowerCase().trim();
      let isDup = false;
      for (const existing of existingNames) {
        if (existing === normalizedName || existing.includes(normalizedName) || normalizedName.includes(existing)) {
          isDup = true;
          break;
        }
      }

      if (isDup) {
        totalDuplicates++;
        continue;
      }

      // Determine matched business lines
      const text = `${project.name} ${project.overview} ${project.equipmentSignals?.join(' ') || ''}`.toLowerCase();
      const matchedBLs = [];
      if (text.match(/compressor|drilling|blasting|pneumatic|shotcrete|tunnel|quarr/)) matchedBLs.push(1);
      if (text.match(/generator|power gen|lighting|light tower|temporary power|genset/)) matchedBLs.push(3);
      if (text.match(/pump|dewater|water treatment|sewage|irrigation|flood/)) matchedBLs.push(30001);
      if (text.match(/bess|battery|energy storage|solar|wind|renewable|microgrid|hydrogen/)) matchedBLs.push(30002);
      // Default to portable air if no match
      if (matchedBLs.length === 0) matchedBLs.push(1);

      const projectKey = `seed-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      try {
        await db.execute(sql`
          INSERT INTO projects (reportId, projectKey, name, location, value, owner, priority, capexGrade, opportunityRoute, sector, isNew, stage, overview, equipmentSignals, contractors, opportunityNote, sources, timeline, completion, matchedBusinessLines)
          VALUES (
            ${reportId},
            ${projectKey},
            ${project.name},
            ${project.location},
            ${project.value},
            ${project.owner},
            ${project.priority},
            ${project.capexGrade},
            ${project.opportunityRoute},
            ${project.sector},
            true,
            ${project.stage},
            ${project.overview},
            ${JSON.stringify(project.equipmentSignals)},
            ${JSON.stringify(project.contractors)},
            ${project.opportunityNote},
            ${JSON.stringify([{ label: "AI Intelligence", url: "" }])},
            ${project.timeline},
            ${project.completion},
            ${JSON.stringify(matchedBLs)}
          )
        `);
        existingNames.add(normalizedName);
        totalInserted++;
      } catch (e) {
        console.log(`  ERROR inserting ${project.name}: ${e.message}`);
        totalFailed++;
      }
    }

    console.log(`  Inserted so far: ${totalInserted}, Duplicates: ${totalDuplicates}`);
  } catch (e) {
    console.error(`  Category failed: ${e.message}`);
    totalFailed++;
  }
}

console.log(`\n=== SEEDING COMPLETE ===`);
console.log(`Inserted: ${totalInserted}`);
console.log(`Duplicates: ${totalDuplicates}`);
console.log(`Failed: ${totalFailed}`);

// Final count
const [finalCount] = await db.execute(sql`SELECT COUNT(*) as cnt FROM projects`);
console.log(`Total projects now: ${finalCount[0].cnt}`);

await pool.end();
process.exit(0);

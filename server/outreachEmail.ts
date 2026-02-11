/**
 * outreachEmail.ts — AI-powered personalised outreach email generator
 * 
 * Generates tailored sales emails based on:
 * - Project details (name, sector, location, value, equipment signals)
 * - Contact info (name, title, company, role)
 * - Atlas Copco Power Technique product/solution knowledge
 * - User's preferred tone (professional, consultative, direct)
 */
import { invokeLLM } from "./_core/llm";

export interface OutreachInput {
  // Contact info
  contactName: string;
  contactTitle: string;
  contactCompany: string;
  contactEmail: string;
  contactRoleBucket: string;

  // Project info
  projectName: string;
  projectLocation: string;
  projectValue: string;
  projectSector: string;
  projectStage: string | null;
  projectOverview: string | null;
  equipmentSignals: string[] | null;
  opportunityRoute: string;
  matchedBusinessLines: string[];

  // Sender info
  senderName: string;
  senderCompany?: string;

  // Tone
  tone: "professional" | "consultative" | "direct";
}

export interface OutreachResult {
  subject: string;
  body: string;
  toneUsed: string;
  keyPoints: string[];
}

const ATLAS_COPCO_PT_KNOWLEDGE = `
Atlas Copco Power Technique provides innovative solutions for the construction, mining, oil & gas, and industrial sectors.

BUSINESS LINES & KEY PRODUCTS:

1. PORTABLE AIR (Compressors):
   - Portable air compressors from 25 to 3000+ CFM
   - Applications: drilling (RC & diamond), blasting, pipeline testing, sandblasting, pneumatic tools
   - Key models: XAS, XATS, XAHS, XAVS, DrillAir series
   - Available as single axle, skid mount, and support mount configurations
   - Fuel-efficient, low emission designs with electronic controllers
   - Aftermarket: service agreements, genuine parts, rental fleet support

2. PAL (Power & Lighting):
   - Diesel and gas generators from 8 kVA to 1500+ kVA
   - LED lighting towers for construction and mining sites
   - Prime, standby, and continuous power solutions
   - Key models: QAS, QIS, QES generator ranges; HiLight tower range
   - Applications: remote site power, construction, events, emergency backup

3. BESS (Battery Energy Storage Systems):
   - ZenergiZe range of battery energy storage
   - Hybrid power solutions combining diesel + battery
   - Peak shaving, load management, and renewable integration
   - Zero-emission power for noise-sensitive and indoor applications
   - Reduces fuel consumption by up to 50% in hybrid configurations

4. PUMP (Flow Solutions):
   - Dewatering pumps for mining and construction
   - Submersible, centrifugal, and wellpoint pumps
   - WEDA range for submersible dewatering
   - PAS range for self-priming centrifugal pumps
   - Applications: mine dewatering, flood control, sewage bypass, construction site drainage

VALUE PROPOSITIONS:
- Total cost of ownership focus (not just purchase price)
- 24/7 service and parts availability across Australia
- Rental and hire-purchase flexibility
- Site assessment and solution design services
- Training and operator certification
- Sustainability: fuel savings, emission reduction, noise reduction
- Digital fleet management (FleetLink telematics)
`;

export async function generateOutreachEmail(input: OutreachInput): Promise<OutreachResult> {
  const toneGuide = {
    professional: "Write in a formal, professional tone. Use proper business language. Be respectful of the recipient's time. Focus on value proposition and credibility.",
    consultative: "Write in a warm, consultative tone. Position yourself as a trusted advisor who understands their challenges. Ask thoughtful questions. Show genuine interest in their project success.",
    direct: "Write in a concise, direct tone. Get straight to the point. Lead with the specific value you can deliver. Include a clear call-to-action. Keep it under 150 words.",
  };

  const businessLineContext = input.matchedBusinessLines.length > 0
    ? `This project is relevant to: ${input.matchedBusinessLines.join(", ")}. Focus your pitch on the products and solutions from these specific business lines.`
    : "Identify which Atlas Copco Power Technique products would be most relevant based on the project details.";

  const equipmentContext = input.equipmentSignals && input.equipmentSignals.length > 0
    ? `Equipment signals detected: ${input.equipmentSignals.join(", ")}. Reference these specific needs in your email.`
    : "";

  const prompt = `You are a sales email copywriter for Atlas Copco Power Technique. Generate a personalised outreach email.

${ATLAS_COPCO_PT_KNOWLEDGE}

RECIPIENT:
- Name: ${input.contactName}
- Title: ${input.contactTitle}
- Company: ${input.contactCompany}
- Role type: ${input.contactRoleBucket}

PROJECT CONTEXT:
- Project: ${input.projectName}
- Location: ${input.projectLocation}
- Estimated value: ${input.projectValue}
- Sector: ${input.projectSector}
- Stage: ${input.projectStage || "Unknown"}
- Overview: ${input.projectOverview || "Not available"}
- Opportunity route: ${input.opportunityRoute}
${equipmentContext}
${businessLineContext}

SENDER: ${input.senderName}${input.senderCompany ? ` from ${input.senderCompany}` : " from Atlas Copco Power Technique"}

TONE: ${toneGuide[input.tone]}

RULES:
1. The email must feel personalised — reference the specific project by name and the recipient's role
2. Lead with value for THEIR project, not a product pitch
3. Reference specific Atlas Copco PT products/solutions that match the project needs
4. Include a clear, low-commitment call-to-action (e.g., "Would a 15-minute call this week work?" or "Happy to share a site assessment")
5. Keep the email concise — 3-4 short paragraphs maximum
6. Do NOT use generic phrases like "I hope this email finds you well"
7. Do NOT include [placeholder] brackets — use real product names and specific details
8. Sign off with just the sender's first name
9. The subject line should reference the project name and be compelling

Return your response as JSON with this exact structure:
{
  "subject": "Email subject line",
  "body": "Full email body text (use \\n for line breaks between paragraphs)",
  "keyPoints": ["Key selling point 1", "Key selling point 2", "Key selling point 3"]
}`;

  const response = await invokeLLM({
    messages: [
      { role: "system", content: "You are an expert B2B sales email copywriter specialising in industrial equipment and project-based sales. You write emails that get responses because they demonstrate genuine understanding of the recipient's project needs." },
      { role: "user", content: prompt },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "outreach_email",
        strict: true,
        schema: {
          type: "object",
          properties: {
            subject: { type: "string", description: "Email subject line" },
            body: { type: "string", description: "Full email body with \\n for paragraph breaks" },
            keyPoints: {
              type: "array",
              items: { type: "string" },
              description: "3 key selling points used in the email",
            },
          },
          required: ["subject", "body", "keyPoints"],
          additionalProperties: false,
        },
      },
    },
  });

  const content = response.choices[0]?.message?.content;
  if (!content || typeof content !== "string") {
    throw new Error("LLM returned empty response for outreach email");
  }

  const parsed = JSON.parse(content) as OutreachResult;
  parsed.toneUsed = input.tone;
  return parsed;
}

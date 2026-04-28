import { classifyProjectGeography } from "../server/geoClassifier";

const tests = [
  {
    id: 30022, name: "Sodium Battery Deployment for Australian Data Centres",
    location: "National", owner: "US companies (unnamed in article)",
    overview: "US companies have signed a deal to bring giant sodium batteries to Australia for data centres, indicating a potential future market for battery energy storage systems.",
    sources: [{ label: "RSS Feed", url: "https://reneweconomy.com.au/us-companies-sign-deal-that-could-bring-giant-sodium-batteries-to-australia-for-data-centres/" }],
    sector: "energy",
  },
  {
    id: 120032, name: "Revera Energy Australian Pipeline",
    location: "National", owner: "Revera Energy",
    overview: "London-based clean energy developer Revera Energy has secured a $213 million facility to accelerate a multi-GW pipeline of clean energy projects in Australia and the United Kingdom. This indicates a significant expansion of renewable energy infrastructure.",
    sources: [{ label: "RSS Feed", url: "https://www.pv-magazine-australia.com/2026/02/09/revera-energy-secures-213-million-facility-to-accelerate-multi-gw-pipeline-in-australia/" }],
    sector: "energy",
  },
  {
    id: 480047, name: "Rio Tinto Australian Aluminium Assets Repowering",
    location: "National", owner: "Rio Tinto",
    overview: "Rio Tinto is repowering its Australian aluminium assets as part of a decarbonisation effort. The task has been shifted to an executive in Canada, indicating a strategic change in how the company is approaching its decarbonisation division.",
    sources: [{ label: "RSS Feed", url: "https://reneweconomy.com.au/rio-tinto-farms-out-smelter-repowering-as-decarbonisation-division-gets-the-axe/" }],
    sector: "energy",
  },
  {
    id: 570004, name: "Enphase AI Home Energy Management System Launch",
    location: "National", owner: "Enphase Energy",
    overview: "Enphase Energy has introduced an artificial intelligence software platform for home energy management in Australia and New Zealand. This system aims to help homeowners reduce costs.",
    sources: [{ label: "RSS Feed", url: "https://www.pv-magazine-australia.com/2026/03/27/enphase-launches-ai-home-energy-management-system/" }],
    sector: "energy",
  },
  {
    id: 660003, name: "Kayasand Advanced Sand Processing Technology Deployment",
    location: "National", owner: "Kayasand",
    overview: "Kayasand has secured the rights to manufacture advanced sand processing technology from Kotobuki Engineering & Manufacturing Co (Kemco) for Australia. This technology aims to address sand scarcity for concrete production.",
    sources: [{ label: "RSS Feed", url: "https://www.quarrymagazine.com/kayasand-has-licence-to-build/" }],
    sector: "infrastructure",
  },
  // These two should remain blocked
  {
    id: 120050, name: "Chinese energy storage players international agreements",
    location: "National", owner: "CATL, Cornex, SolaX and other Chinese energy storage players",
    overview: "Summary of recent multi-GWh partnerships and supply agreements for Chinese energy storage players (CATL, Cornex, SolaX, etc.) across the Middle East, Europe, Africa, and Australia. These are supply agreements for BESS.",
    sources: [{ label: "RSS Feed", url: "https://www.energy-storage.news/catl-cornex-solax-and-other-chinese-energy-storage-players-in-multi-gwh-international-agreements/" }],
    sector: "energy",
  },
  {
    id: 630015, name: "AAP/2025/147 — Australian Centre for International Agricultural Research",
    location: "Outside Australia, Australia", owner: "Australian Centre for International Agricultural Research",
    overview: "Scaling up release of pod borer resistant cowpea varieties and associated improved agronomic practices in Ghana and Nigeria",
    sources: [{ label: "AusTender", url: "https://www.tenders.gov.au/Search/Cn?CnId=CN4228848" }],
    sector: "infrastructure",
  },
];

for (const t of tests) {
  const r = classifyProjectGeography(t);
  const status = r.geoBlockedReason ? `BLOCKED: ${r.geoBlockedReason}` : `ALLOWED: ${r.projectCountry}/${r.projectState} conf=${r.locationConfidence.toFixed(2)}`;
  console.log(`[${t.id}] ${t.name.slice(0, 55)}`);
  console.log(`  ${status}`);
  console.log("");
}

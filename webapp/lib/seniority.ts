// Bucket a role title / headline into a coarse seniority for demographic
// breakdowns in Tab 1. Keyword-matched substring lookup — the ordering
// matters: highest-authority buckets first so "Chief Marketing Officer"
// hits "cxo" before "manager".

export type SeniorityBucket =
  | "founder"
  | "cxo"
  | "vp"
  | "director"
  | "manager"
  | "ic"
  | "student"
  | "other";

interface Rule {
  bucket: SeniorityBucket;
  keywords: string[];
}

const RULES: Rule[] = [
  {
    bucket: "founder",
    keywords: ["founder", "co-founder", "cofounder", "owner", "president"],
  },
  {
    bucket: "cxo",
    keywords: [
      "ceo", "chief executive",
      "cmo", "chief marketing",
      "cfo", "chief financial",
      "coo", "chief operating",
      "cto", "chief technology",
      "cro", "chief revenue",
      "cpo", "chief product",
      "chief of staff",
    ],
  },
  {
    bucket: "vp",
    keywords: ["vp of", "vp,", "vice president", "svp", "evp"],
  },
  {
    bucket: "director",
    keywords: ["director of", "director,", "head of"],
  },
  {
    bucket: "manager",
    keywords: ["manager", "team lead", "lead ", "principal"],
  },
  {
    bucket: "student",
    keywords: ["student", "intern", "graduate", "undergraduate"],
  },
];

const IC_KEYWORDS = [
  "engineer", "designer", "developer", "analyst", "specialist",
  "consultant", "associate", "coordinator", "assistant",
  "representative", "executive",
];

export function bucketSeniority(role: string | null, headline: string | null): SeniorityBucket {
  const source = `${role ?? ""} ${headline ?? ""}`.toLowerCase();
  if (!source.trim()) return "other";
  for (const rule of RULES) {
    if (rule.keywords.some((k) => source.includes(k))) return rule.bucket;
  }
  if (IC_KEYWORDS.some((k) => source.includes(k))) return "ic";
  return "other";
}

export function seniorityLabel(b: SeniorityBucket): string {
  switch (b) {
    case "founder": return "Founder / Owner";
    case "cxo": return "C-suite";
    case "vp": return "VP";
    case "director": return "Director";
    case "manager": return "Manager";
    case "ic": return "IC";
    case "student": return "Student";
    case "other": return "Other";
  }
}

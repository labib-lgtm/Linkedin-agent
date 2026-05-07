// Mirrors tools/sheets_client.py + tools/supabase_client.py constants.
// Keep in sync — these are the source of truth on the browser side.

export const STATUS_VALUES = [
  "Pending",
  "Approved",
  "Killed",
  "Drafting",
  "Drafted",
  "Visualizing",
  "Visual Ready",
  "Scheduled",
  "Posted",
  "Reviewed",
] as const;

export type Status = (typeof STATUS_VALUES)[number];

// Statuses shown as kanban columns. Killed is collapsed into a side panel,
// not a primary column. Kept for worker compatibility.
export const KANBAN_STATUSES: Status[] = [
  "Pending",
  "Approved",
  "Drafting",
  "Drafted",
  "Visual Ready",
  "Scheduled",
  "Posted",
  "Reviewed",
];

// Per the project roast: 8 columns is too many. The UI groups statuses
// into 4 stages, status field stays granular for the worker.
//   Idea       — pre-production
//   Producing  — copy + visual + scheduling
//   Live       — published
//   Learned    — reviewed for engagement signal
//
// Cross-stage drag → status flips to the stage's default-landing
// status. Inside a stage, the granular status pill on each card lets
// the operator see + advance state without dedicated columns.
export const STAGES = [
  {
    id: "idea",
    label: "Idea",
    statuses: ["Pending", "Approved"] as Status[],
    landingStatus: "Pending" as Status,
  },
  {
    id: "producing",
    label: "Producing",
    statuses: ["Drafting", "Drafted", "Visualizing", "Visual Ready"] as Status[],
    landingStatus: "Drafting" as Status,
  },
  {
    id: "live",
    label: "Live",
    statuses: ["Scheduled", "Posted"] as Status[],
    landingStatus: "Scheduled" as Status,
  },
  {
    id: "learned",
    label: "Learned",
    statuses: ["Reviewed"] as Status[],
    landingStatus: "Reviewed" as Status,
  },
] as const;
export type StageId = (typeof STAGES)[number]["id"];

export function stageForStatus(status: Status): StageId | null {
  for (const stage of STAGES) {
    if ((stage.statuses as readonly Status[]).includes(status)) return stage.id;
  }
  return null;
}

export const PILLAR_VALUES = [
  "Performance Operator",
  "Conversion Lab",
  "Agency Founder",
  "Channel Strategy",
] as const;
export type Pillar = (typeof PILLAR_VALUES)[number];

export const FORMAT_VALUES = ["text", "carousel", "image", "video", "poll"] as const;
export type FormatValue = (typeof FORMAT_VALUES)[number];

export const RECIPIENT_STATUSES = [
  "queued",
  "replied",
  "dm_sent",
  "completed",
  "failed",
] as const;
export type RecipientStatus = (typeof RECIPIENT_STATUSES)[number];

// Status -> Tailwind class for the colored pill.
export const STATUS_TONE: Record<Status, string> = {
  Pending:        "bg-gray-100 text-gray-700",
  Approved:       "bg-blue-100 text-blue-800",
  Killed:         "bg-red-100 text-red-700",
  Drafting:       "bg-amber-100 text-amber-800",
  Drafted:        "bg-amber-200 text-amber-900",
  Visualizing:    "bg-violet-100 text-violet-800",
  "Visual Ready": "bg-violet-200 text-violet-900",
  Scheduled:      "bg-sky-100 text-sky-800",
  Posted:         "bg-lynx-green text-lynx-charcoal",
  Reviewed:       "bg-emerald-100 text-emerald-800",
};

import type { FormatValue, Pillar, RecipientStatus, Status } from "./constants";

export interface Angle {
  angle_id: string;
  status: Status;
  pillar: Pillar | null;
  format: FormatValue | null;

  hook_seed: string | null;
  cta_keyword: string | null;
  winner_patterns: string | null;
  gap_filled: string | null;

  week_assigned: string | null;
  notes: string | null;

  date_generated: string | null;
  date_approved: string | null;
  date_posted: string | null;
  post_url: string | null;

  hook_chosen: string | null;
  hook_alternates: string | null;
  draft_body: string | null;
  critic_score: string | null;
  slide_outline: string | null;

  source_md: string | null;

  asset_path: string | null;
  image_size: string | null;

  lead_magnet_path: string | null;
  lead_magnet_url: string | null;

  created_at: string;
  updated_at: string;
}

export interface Recipient {
  recipient_id: string;
  angle_id: string | null;
  post_url: string | null;
  comment_id: string | null;
  commenter_id: string | null;
  commenter_name: string | null;
  cta_keyword: string | null;
  trigger_run_id: string | null;
  queued_at: string;
  t0_reply_at: string | null;
  dm_sent_at: string | null;
  t3_reply_at: string | null;
  status: RecipientStatus;
  retry_count: number;
}

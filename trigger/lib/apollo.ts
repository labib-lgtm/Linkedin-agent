/**
 * Apollo.io API client for the prospect enrichment task.
 *
 * Three credit tiers, used in order by the worker:
 *   1. searchOrganization   — FREE  (no enrichment credit consumed)
 *   2. searchPeopleAtCompany — FREE  (no enrichment credit consumed)
 *   3. enrichPerson          — 1 CREDIT per call
 *
 * Reads APOLLO_API_KEY from process.env (set in the Trigger.dev project env).
 *
 * Apollo's published rate limits at the time of writing (per the Settings →
 * API page screenshot the user shared): People endpoints cap at 50 req/min,
 * 200/hour, 600/day. We sleep 1300ms between every external call which keeps
 * us comfortably under the per-minute cap with ~45 calls/min steady-state.
 * On 429 we back off and retry once with a longer pause.
 */

const BASE_URL = "https://api.apollo.io";
const PER_CALL_SLEEP_MS = 1300;
const BACKOFF_429_MS = 30_000;

export class ApolloError extends Error {
  status: number;
  body: string;
  constructor(message: string, status: number, body: string) {
    super(message);
    this.name = "ApolloError";
    this.status = status;
    this.body = body;
  }
}

function apiKey(): string {
  const k = process.env.APOLLO_API_KEY;
  if (!k) {
    throw new ApolloError(
      "APOLLO_API_KEY not set. Add it to the Trigger.dev project's Environment Variables.",
      0,
      "",
    );
  }
  return k;
}

async function apolloPOST<T>(path: string, body: Record<string, unknown>): Promise<T> {
  // One retry on 429. Apollo's rate-limit response includes Retry-After
  // sometimes; we use a fixed backoff for simplicity.
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch(`${BASE_URL}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Api-Key": apiKey(),
        accept: "application/json",
      },
      body: JSON.stringify(body),
    });
    const raw = await res.text();
    if (res.ok) {
      return raw ? (JSON.parse(raw) as T) : ({} as T);
    }
    if (res.status === 429 && attempt === 0) {
      await sleep(BACKOFF_429_MS);
      continue;
    }
    throw new ApolloError(
      `Apollo ${path} -> ${res.status}`,
      res.status,
      raw.slice(0, 600),
    );
  }
  // Unreachable but TypeScript wants a return.
  throw new ApolloError(`Apollo ${path} retry budget exhausted`, 0, "");
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Public: a small per-call gate the worker awaits to stay under the per-min limit.
export async function rateLimitPause(): Promise<void> {
  await sleep(PER_CALL_SLEEP_MS);
}

// ---- Tier 1: free organization lookup ----------------------------------

export interface ApolloOrgMatch {
  id: string;
  name: string | null;
  domain: string | null;
  linkedin_url: string | null;
  estimated_num_employees: number | null;
  raw: unknown;
}

/**
 * Tier 1 (FREE): find the Apollo organization record matching a company's
 * LinkedIn URL. Returns null when no record is found.
 *
 * Endpoint: POST /api/v1/organizations/search
 * Filter: q_organization_linkedin_urls is the documented field for LinkedIn
 * URL filtering; if Apollo can't match the URL string exactly, the search
 * returns zero results.
 */
export async function searchOrganization(
  linkedinUrl: string,
): Promise<ApolloOrgMatch | null> {
  if (!linkedinUrl) return null;
  const body = {
    q_organization_linkedin_urls: [linkedinUrl],
    page: 1,
    per_page: 1,
  };
  const json = await apolloPOST<{
    organizations?: Array<{
      id: string;
      name?: string | null;
      primary_domain?: string | null;
      linkedin_url?: string | null;
      estimated_num_employees?: number | null;
    }>;
  }>("/api/v1/mixed_companies/search", body);
  const o = json.organizations?.[0];
  if (!o) return null;
  return {
    id: o.id,
    name: o.name ?? null,
    domain: o.primary_domain ?? null,
    linkedin_url: o.linkedin_url ?? null,
    estimated_num_employees: o.estimated_num_employees ?? null,
    raw: o,
  };
}

// ---- Tier 2: free people-at-company lookup ------------------------------

export interface ApolloPersonMatch {
  id: string;
  name: string | null;
  first_name: string | null;
  last_name: string | null;
  title: string | null;
  seniority: string | null;
  linkedin_url: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  organization_id: string | null;
  // priority_rank: lower = better. Set by the title-priority filter below.
  priority_rank: number;
  raw: unknown;
}

// Title priorities — lower index = higher priority. Substring match,
// case-insensitive. Compound titles (e.g. "Founder & CEO") earn the best
// rank among any that match.
const TITLE_PRIORITIES: string[] = [
  "founder",
  "co-founder",
  "cofounder",
  "ceo",
  "chief executive",
  "owner",
  "president",
  "head of ecommerce",
  "head of e-commerce",
  "head of dtc",
  "vp of marketing",
  "vp marketing",
  "director of marketing",
  "director marketing",
  "head of marketing",
  "brand manager",
  "ecommerce manager",
  "e-commerce manager",
];

function rankTitle(title: string | null): number {
  if (!title) return 999;
  const t = title.toLowerCase();
  for (let i = 0; i < TITLE_PRIORITIES.length; i++) {
    if (t.includes(TITLE_PRIORITIES[i])) return i;
  }
  return 999;
}

/**
 * Tier 2 (FREE): find decision-makers at the given Apollo organization id.
 * Returns the single best-ranked match by title priority, or null if no
 * person at the org maps to one of our priority titles.
 *
 * Endpoint: POST /api/v1/mixed_people/search
 */
export async function searchPeopleAtCompany(
  orgId: string,
): Promise<ApolloPersonMatch | null> {
  if (!orgId) return null;
  const body = {
    organization_ids: [orgId],
    person_titles: TITLE_PRIORITIES,
    page: 1,
    per_page: 25,
  };
  const json = await apolloPOST<{
    people?: Array<{
      id: string;
      name?: string | null;
      first_name?: string | null;
      last_name?: string | null;
      title?: string | null;
      seniority?: string | null;
      linkedin_url?: string | null;
      city?: string | null;
      state?: string | null;
      country?: string | null;
      organization_id?: string | null;
    }>;
  }>("/api/v1/mixed_people/search", body);
  const people = json.people ?? [];
  if (people.length === 0) return null;
  let best: ApolloPersonMatch | null = null;
  for (const p of people) {
    const rank = rankTitle(p.title ?? null);
    if (rank >= 999) continue; // skip people whose title doesn't map to a priority
    if (!best || rank < best.priority_rank) {
      best = {
        id: p.id,
        name: p.name ?? null,
        first_name: p.first_name ?? null,
        last_name: p.last_name ?? null,
        title: p.title ?? null,
        seniority: p.seniority ?? null,
        linkedin_url: p.linkedin_url ?? null,
        city: p.city ?? null,
        state: p.state ?? null,
        country: p.country ?? null,
        organization_id: p.organization_id ?? null,
        priority_rank: rank,
        raw: p,
      };
    }
  }
  return best;
}

// ---- Tier 3: 1-credit person enrichment ---------------------------------

export interface ApolloEnrichedPerson {
  id: string;
  name: string | null;
  first_name: string | null;
  last_name: string | null;
  title: string | null;
  seniority: string | null;
  email: string | null;
  email_status: string | null;
  phone: string | null;
  linkedin_url: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  organization_id: string | null;
  raw: unknown;
}

/**
 * Tier 3 (1 CREDIT): reveal email + phone for a specific person id.
 *
 * Endpoint: POST /api/v1/people/match
 * Uses reveal_personal_emails + reveal_phone_number flags to ensure we get
 * the contact info (Apollo gates these behind the credit charge).
 */
export async function enrichPerson(
  personId: string,
): Promise<ApolloEnrichedPerson | null> {
  if (!personId) return null;
  const json = await apolloPOST<{
    person?: {
      id?: string;
      name?: string | null;
      first_name?: string | null;
      last_name?: string | null;
      title?: string | null;
      seniority?: string | null;
      email?: string | null;
      email_status?: string | null;
      phone_numbers?: Array<{ raw_number?: string | null; sanitized_number?: string | null }>;
      linkedin_url?: string | null;
      city?: string | null;
      state?: string | null;
      country?: string | null;
      organization?: { id?: string | null };
    };
  }>("/api/v1/people/match", {
    id: personId,
    reveal_personal_emails: true,
    reveal_phone_number: true,
  });
  const p = json.person;
  if (!p) return null;
  const phone = p.phone_numbers?.[0]?.sanitized_number || p.phone_numbers?.[0]?.raw_number || null;
  return {
    id: p.id ?? personId,
    name: p.name ?? null,
    first_name: p.first_name ?? null,
    last_name: p.last_name ?? null,
    title: p.title ?? null,
    seniority: p.seniority ?? null,
    email: p.email ?? null,
    email_status: p.email_status ?? null,
    phone,
    linkedin_url: p.linkedin_url ?? null,
    city: p.city ?? null,
    state: p.state ?? null,
    country: p.country ?? null,
    organization_id: p.organization?.id ?? null,
    raw: p,
  };
}

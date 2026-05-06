import "server-only";
import { getSetting } from "@/lib/settings";

export type BusinessProfile = {
  name: string;
  description: string;
  audience: string;
  voice: string;
};

// Seeded defaults: the broadened scope the user actually operates in.
// Lives here (not in settings.ts) so settings storage stays purely
// key-value and the prompt-relevant prose can evolve in one place.
const DEFAULTS: BusinessProfile = {
  name: "Lynx Media",
  description:
    "Helps Amazon sellers scale: PPC, listings, DSP, brand registry, FBA, product launches, ranking, conversion. Open to TikTok content (TikTok Shop, off-Amazon traffic, launch plays). $29M+ Amazon ad spend managed.",
  audience:
    "Operators — Amazon brand owners, agency founders, in-house PPC managers, ecom marketers experimenting with TikTok. Not students, not beginners.",
  voice:
    "Contrarian, specifics over platitudes, operator-grade language. No em-dashes, no asterisks, no hash characters. Concrete numbers and named tactics.",
};

// Reads the business profile from settings (DB > env > default for each
// field). The four getSetting calls collapse into a single Supabase
// fetch via the 5s in-memory settings cache, so this is cheap to call
// from any prompt builder.
export async function getBusinessProfile(): Promise<BusinessProfile> {
  const [name, description, audience, voice] = await Promise.all([
    getSetting("business.name"),
    getSetting("business.description"),
    getSetting("business.audience"),
    getSetting("business.voice"),
  ]);
  return {
    name: name || DEFAULTS.name,
    description: description || DEFAULTS.description,
    audience: audience || DEFAULTS.audience,
    voice: voice || DEFAULTS.voice,
  };
}

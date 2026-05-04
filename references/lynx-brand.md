# Lynx Media — Brand Reference

**Source of truth.** Loaded by all LinkedIn design skills (`linkedin-carousel-outline`, `linkedin-carousel-design`, `linkedin-carousel-build`, `linkedin-image-asset`) before producing any creative.

**Locked:** typography (Montserrat + Inter), full palette, logo rules, voice anchors, service framework (4-step + 3-step variants), brand applications (5 canonical surfaces), partner badge defaults.
**Open:** brand-assets folder path, master `.pptx` template path, personal photography of Labib, anonymized Amazon UI screenshots, shipping-container hero photo (see §10).

---

## 1. Identity

| | |
|---|---|
| Brand | Lynx Media |
| URL | lynxmedia.co |
| Primary tagline | Grow Faster on Amazon, Without Guesswork. |
| Secondary tagline | Better Ads. Better Traffic. Higher Profits. |
| Hero tagline (cover/headline) | Helping Thousands of Amazon Sellers Scale Smarter, Faster, & Stronger. |
| Positioning | Performance-driven Amazon growth agency that helps brands scale smarter, faster, and stronger through proven systems, expert execution, and full account ownership. |
| Founder | Labib Javed (Canada) |
| Team | 4 — Labib (Founder, Canada) + Sohaib (Ad Manager), Hamza (Brand Manager), Fatima (Ops) — all in Pakistan |
| Social | LinkedIn · Instagram · YouTube |

**Receipts (use as proof points in posts and creative):**
- $29M+ in managed Amazon ad spend
- 500+ Amazon stores managed
- 93% client retention
- 35% average increase in organic ranking
- $1.2M+ client sales generated

**Partner badges:** Amazon Ads Verified Partner · Amazon SPN Verified Partner · PickFu Certified Partner

**Approved long-form positioning paragraphs** — drop verbatim into bios, presentation footers, About slides:

> Lynx Media is a performance-driven Amazon growth agency that helps brands scale smarter, faster, and stronger through proven systems, expert execution, and full account ownership.

> We transform underperforming Amazon stores into scalable, high-profit businesses with proven systems, expert execution, and continuous optimization.

> Lynx Media is a performance-driven Amazon growth partner. We build systems that drive traffic, increase conversions and scale profits.

---

## 2. Logo system

- **Primary logo:** Shield + lynx-head icon (Lynx Green) paired with `LYNX MEDIA` wordmark
- **Variants:** Combined (shield + wordmark) · Icon-only (shield) · Wordmark-only
- **Approved background pairings:** Charcoal · Black · Light Gray · White
- **Clear space:** Maintain X-height of clear space on all sides
- **Minimum size:** 24px (digital)
- **Don'ts:** No color changes · no shadows/glows/effects · no stretch/distort · no low-contrast placement · no recoloring (e.g., pink shield)

**Placement defaults:**
- Carousels — shield-only mark, bottom-left, 60–80px tall on every slide. Wordmark version on slides 1, 8, 9 only.
- Single-image posts — shield-only, bottom-right, 8% of canvas height.
- Video — wordmark on lower-third nameplate; end card uses Lynx Green slab + Charcoal logo.

---

## 3. Color palette

Use these exact values. Don't introduce new colors.

| Name | HEX | RGB | Use |
|---|---|---|---|
| **Lynx Green** | `#C6F21F` | 198, 242, 31 | **Primary brand color.** Highlights, CTAs, key accents, hook moments. The "scroll-stopper" color. |
| **Charcoal** | `#1C1C1C` | 28, 28, 28 | Primary background for dark mode, body text on light, structural blocks. |
| **Black** | `#000000` | 0, 0, 0 | Highest-contrast text or backgrounds where Charcoal isn't dark enough. |
| **Light Gray** | `#F5F5F5` | 245, 245, 245 | Neutral background, dividers, secondary surfaces. |
| **White** | `#FFFFFF` | 255, 255, 255 | Clean surfaces, body text on dark. |
| **Warm Neutral** | `#E9E1D8` | 233, 225, 216 | Warm secondary background — sparingly. |
| **Amazon Orange** | `#FF9900` | 255, 153, 0 | **Only when invoking the Amazon ecosystem** (Amazon UI, Sponsored Products screenshots, Amazon Ads product naming). Never as a generic accent. |

**Color rules:**
- Lynx Green draws the eye → put it on what you want the viewer to notice or do. Never use it for body copy.
- Charcoal/Black carries structure. Neutrals carry breathing room.
- Lynx Green on white = unreadable contrast. Don't do it.
- Amazon Orange has one job — flagging Amazon ecosystem context. If the post is generic PPC tactics, don't use it.

---

## 4. Typography (LOCKED 2026-05-03)

**Primary:** Montserrat — Bold / SemiBold / Medium / Regular
**Secondary:** Inter — Regular / Medium / SemiBold / Bold

Both are free Google Fonts. Embed them in `.pptx` and `.pdf` exports.

### Type hierarchy for LinkedIn creative

| Use | Font | Weight | Size (1080×1350 canvas) |
|---|---|---|---|
| Hook headline (slide 1) | Montserrat | Bold, all-caps | 96–120pt |
| Body slide headline | Montserrat | SemiBold | 56–72pt |
| Subhead | Montserrat | SemiBold | 36–48pt |
| Body copy | Inter | Regular or Medium | 32–40pt |
| Stat hero numeral | Montserrat | Bold (Lynx Green) | 200–280pt |
| Captions / page indicators | Inter | Medium | 22–24pt |

**Numbers always pull a higher weight than the surrounding text.** A stat is the focal point of the slide it lives on.

---

## 5. Brand voice

Six anchors, consolidated from both brand sheets:

1. **Strategic** — data-driven, clear roadmaps, no guesswork
2. **Performance-Driven** — focused on measurable, profitable results
3. **Direct & Clear** — straightforward, respects the reader's time, no hedge filler
4. **Systems-Oriented** — "we don't offer services, we build systems that scale"
5. **Confident & Reliable** — own the process, deliver consistent results
6. **Analytical** — every claim backed by a number

**Voice characteristics (chip-style descriptors from the compact sheet):** Strategic · Analytical · Performance-Driven · Confident · Straightforward · Focused · Data-Driven · Direct · Reliable

**Voice cues for skills to enforce:**
- Lead with the number, not the adjective. "$29M managed" beats "extensive experience."
- "How I" / "How we did it" beats "How to."
- Specific over abstract: "TACoS at 7%" beats "great results."
- Strip filler: no "happy to share," no "in this carousel we'll explore," no "let's dive in."

**Humanized punctuation (locked 2026-05-04):**
- No em-dashes (`—`). Use a period, comma, or "and" instead.
- No asterisks for emphasis (`*italic*` or `**bold**`). LinkedIn doesn't render markdown; they show literally. Restructure the sentence to make the point land.
- No `#` characters in the body, and no trailing hashtag dumps. Modern winners use zero hashtags.
- ASCII hyphen `-` is fine for stylistic dashes ("Week -8: inventory audit").
- Bullet markers `→` or `-` are fine.

`tools/draft_critic.py` enforces all three checks. Any draft with `—`, `**`, or trailing hashtag blocks fails the VOICE_HUMANIZED check and gets revised before output.

This reinforces the existing `linkedin-growth` skill voice rules — they should never contradict.

---

## 6. Brand pillars (themes the creative pulls from)

1. **Growth** — scale revenue and market share
2. **Control** — full account ownership and operational clarity
3. **Performance** — ROI-focused strategies that drive profit
4. **Simplicity** — remove complexity from Amazon
5. **Partnership** — we grow when you grow
6. **Expertise** — Amazon specialists backed by experience

These map to the LinkedIn content pillars (PPC Operator / Conversion Lab / Agency Founder) — `Performance` and `Control` feed PPC Operator and Conversion Lab; `Partnership`, `Simplicity`, `Expertise` feed Agency Founder.

---

## 6a. Service framework (the 4-step engine)

Drop verbatim into "How we work" carousels, About slides, and the 9-slide framework deck.

| # | Step | What we do |
|---|---|---|
| **01** | **Strategy** | Custom strategies built for your brand |
| **02** | **Execution** | Expert execution across all touchpoints |
| **03** | **Optimization** | Continuous testing and optimization |
| **04** | **Growth** | Sustainable growth that compounds |

### Process variant (3-step, from full sheet §05)

When a slide calls for a 3-step process instead of 4 services:

| # | Step | What it covers |
|---|---|---|
| **01** | **Audit & Strategy** | Analyze listings, PPC, keywords, and competitors to build a custom growth roadmap |
| **02** | **Optimize & Execute** | Implement high-impact optimizations across ads, listings, content, and backend to drive results |
| **03** | **Monitor & Scale** | Continuously monitor performance, refine strategies, and scale what works |

**Visual treatment** (when these run as a row of 3 or 4 in a carousel slide):
- Each step gets a Lynx Green circular icon (target / gear / chart / rocket)
- Connecting dotted line between circles, Light Gray
- Step number in Charcoal Montserrat Bold above the icon
- Step name in Charcoal Montserrat SemiBold
- Step description in Inter Regular, max 2 lines

---

## 6b. Brand applications (canonical patterns)

These are the four standard surfaces for Lynx creative. Skills can reference any of them by name.

### Social Post — black slab + Lynx Green burst
- Charcoal/black background
- Lynx Green starburst or angular shape behind the headline
- White Montserrat Bold headline (e.g., `we are AMAZON Experts` / `BETTER ADS. BETTER TRAFFIC. HIGHER PROFITS.`)
- Shield logo bottom-left
- **Use as:** stat-slab variant or hook image when standard archetype A feels too clinical

### Dashboard — green-line uptrend
- Light Gray or White card background
- Black/Charcoal headline ("Total Sales")
- Big number ("$70,352" or "$28.92M") in Charcoal Montserrat Bold
- Lynx Green percentage delta ("+145%") to the right of the number
- Lynx Green up-and-to-the-right line graph below
- **Use as:** the right panel of `before-after` archetype, or as a screenshot-style insert in body slides

### Presentation slide — bold statement
- Charcoal/black background
- White Montserrat Bold headline; one word per line in Lynx Green for emphasis (e.g., "WE BUILD **AMAZON** BRANDS THAT DOMINATE.")
- Shield logo bottom-left
- **Use as:** mid-deck statement slide, or the recap slide variant when slide 8 isn't a Lynx Green slab

### Business Card — proof-point style
- Black background
- Shield logo top-left
- Wordmark + "Your Growth Partner on Amazon" tagline
- `LYNXMEDIA.CO` in Lynx Green at bottom
- **Use as:** founder-mode profile image, end-card on video, "about me" slide

### Industrial photography — shipping container
- Real-world hero shot of a Lynx-branded shipping container on a crane
- Lynx Green container body with white wordmark + shield
- Cityscape / port / Amazon HQ exterior backdrop
- **Use as:** archetype C industrial image, founder pillar posts, brand-anniversary content

---

## 7. Do / Don't

### Do
- High contrast (Lynx Green + Charcoal/Black is the default pairing)
- Bold, clear typography. Big numbers. Tight hierarchy
- Use Lynx Green for emphasis only — not as a full background slab (max one slab per carousel)
- Keep layouts clean and structured. White space is fine
- Honest data only — anonymize, never fabricate

### Don't
- Don't use too many colors. The palette is small for a reason.
- Don't reduce contrast. Lime on white = unreadable
- Don't distort, recolor, or add effects to the logo
- Don't clutter the layout with decorative elements (gradients, drop shadows, texture overlays)
- Don't use Amazon Orange outside Amazon-ecosystem context
- Don't use stock-photo handshake / boardroom / "happy diverse team" imagery — off-brand for a performance agency
- Don't fabricate client metrics. Anonymize if needed; never invent

---

## 8. The three image archetypes (skill `linkedin-image-asset`)

| Archetype | When | Look |
|---|---|---|
| **A. Stat slab** | Hook posts, drop-stat posts, "we managed $X" posts | Charcoal background · giant Lynx Green numeral (Montserrat Bold, ~40% canvas height) · one supporting line of Inter Regular white text · shield logo bottom-right |
| **B. Before / after** | Client outcome posts (anonymized), case studies | Two-panel split (50/50 vertical or 60/40) · left = dashed/red trend on Light Gray · right = solid Lynx Green up-and-to-the-right line on Charcoal · "Before / After: [metric]" label across top |
| **C. Industrial** | Founder-mode posts, "behind the systems" posts, brand-pillar storytelling | Real photo, slight grit, performance-grade (echoes the shipping-container imagery in your brand applications) · Lynx Green accent in-frame (green container, sign, label, hard-hat) · optional Charcoal slab in lower third with Lynx Green Montserrat headline overlay |

---

## 9. Carousel color rhythm (skill `linkedin-carousel-design`)

Default 9-slide rhythm:

```
1: Charcoal (hook)
2: Light Gray (problem framing)
3: Charcoal (body)
4: Light Gray (body)
5: Charcoal (body, hero stat)
6: Charcoal (body)
7: Light Gray (body)
8: LYNX GREEN SLAB (recap — the screenshot slide)
9: Charcoal (CTA)
```

**Locked rules:**
- Max one Lynx Green slab per deck (slide 8 only)
- Never two Light Gray slides in a row
- Hook + CTA always Charcoal
- Stat hero treatment (200–280pt Lynx Green numeral) on 1–3 body slides max — too many = shouty

---

## 10. Open items (resolve before skills run at full fidelity)

### Resolved 2026-05-03 (from brand guideline sheets)
- ✅ Typography canon — Montserrat (display) + Inter (body). The compact sheet's "Poppins" is an older draft; the full sheet supersedes it.
- ✅ Approved logo backgrounds — Charcoal · Black · Light Gray · White
- ✅ Service framework — 4-step (Strategy/Execution/Optimization/Growth) and 3-step (Audit/Optimize/Monitor) variants both live in §6a
- ✅ Brand application patterns — 5 canonical surfaces in §6b
- ✅ Partner badge default — feature **all 3** (Amazon Ads · Amazon SPN · PickFu) on case-study carousels and About slides; feature **Amazon Ads only** on utility/tactic posts to keep visual weight low

### Still open
| # | Question | Why it matters |
|---|---|---|
| 10.1 | Path to `lynx-brand-assets/` folder containing logo SVG/PNG, fonts, photography library | `linkedin-carousel-build` and `linkedin-image-asset` need these to render. Without them, builds fail loudly (by design). |
| 10.2 | Path to a Lynx master `.pptx` template (if one exists) | Speeds up `linkedin-carousel-build` and locks consistency. Without it, the skill builds decks from scratch each time. |
| 10.3 | Path to personal photography of Labib (on-camera shots, headshots) | Needed for video and "founder-mode" image posts. Required for archetype C in some configurations. |
| 10.4 | Path to Amazon UI / Seller Central / Campaign Manager screenshots (anonymized) | For stat-slab and before-after images that reference real Amazon dashboards. |
| 10.5 | Path to the shipping-container hero photo + any other industrial photography already produced | Mentioned in the brand applications sheet as a brand-pillar image. If it already exists as a real asset, archetype C should default to it instead of generating new ones. |

When any of these resolve, update this file and the relevant skill picks it up on next invocation.

---

## 11. Worked example — what "on-brand" looks like

**Post topic:** "Why most Amazon brands hit a TACoS ceiling around 15% — and the 3 levers that drop it back to single digits."

**Carousel render:**
- Slide 1 (Charcoal + Lynx Green): "STUCK AT 15% TACoS? IT'S NOT YOUR BIDS." · subhead "Across $29M of managed spend, the same 3 things break first."
- Slide 2 (Light Gray): Reader's situation — "You're profitable. You're scaling. Then TACoS won't budge."
- Slides 3–5 (alternating Charcoal/Light Gray): One lever per slide — Search-term sprawl · Branded vs non-branded mix · Bottom-funnel saturation. Each gets one giant green stat.
- Slide 6 (Charcoal): The framework named — "The 3-Lever TACoS Audit."
- Slide 7 (Light Gray): A 4-step "what to do this week" list.
- Slide 8 (Lynx Green slab): Recap line in Charcoal.
- Slide 9 (Charcoal): "Want this audit run on your account? Comment 'TACoS' and I'll send the template." · logo · URL · no live link.

**Image alternative (stat slab):**
"15% → 7%" in Lynx Green Montserrat Bold · "Average TACoS drop on accounts that fixed search-term sprawl." in Inter Regular white · shield logo bottom-right · 1200×1500.

This is the fidelity bar.

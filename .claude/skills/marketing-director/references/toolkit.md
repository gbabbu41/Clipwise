# Creative Toolkit — which tool for which job

Goal: get a finished, on-brand file into the owner's hands with the least friction.
Below is the decision guide, then concrete recipes. **Read `brand.md` first** so
whatever you make is on-brand, and `platforms.md` so it's the right size.

> **Adobe gate:** before calling ANY Adobe tool (`image_*`, `video_*`, `document_*`,
> `animate_design`, `export_html_to_express`, `create_visual_design_express_skill`,
> etc.) you MUST first call `adobe_mandatory_init`. Skipping it fails the call.

## Decision guide

| The owner wants… | Reach for | Why |
|------------------|-----------|-----|
| A social post / carousel / ad graphic | **Canva** `generate-design` → `edit-design` → `export-design`, OR **Adobe Express** via `create_visual_design_express_skill` | Fast, template-aware, exports straight to PNG/JPG. Express when you want pixel-exact HTML control. |
| A banner / cover / channel art | **Adobe Express** (HTML→export) or **Canva** | Precise dimensions + text control. |
| A profile picture | **Canva** for the layout + **Adobe** `image_remove_background` to clean the mark/subject | Circular-safe, centered mark. |
| An AI hero image / background | **Canva** `generate-design` (AI) or a **Firefly board** (`create_firefly_board`) | Generative imagery. |
| Enhance / fix a real photo | **Adobe** `image_apply_auto_tone`, `image_adjust_*`, `image_remove_background`, `image_crop_and_resize`, `image_generative_expand` | Pro photo editing. |
| Turn a logo into vector / recolor | **Adobe** `image_vectorize`, `image_apply_color_overlay` | Clean scalable mark. |
| A reel / short / video ad | **Adobe** `animate_design`, `video_render`, `video_create_quick_cut`; `video_resize` to reframe for each platform | AI video + multi-format reframing. |
| A reusable template set / design system | **Figma** (`create_new_file`, `use_figma`) | Repeatable components the owner can reuse. |
| A multi-page PDF (one-pager, media kit) | **Adobe** `document_render_layout` / `document_convert_pdf` | Print/share-ready docs. |

If your first choice errors or is unavailable, **fall back** (Canva ↔ Adobe Express ↔
author HTML and export) rather than returning nothing. Always end with an actual file.

## Recipe: static social graphic (post / ad / banner)

**Path A — Canva (fastest):**
1. `generate-design` (or `generate-design-structured`) with a prompt that bakes in
   brand: *"1080×1350 Instagram post, matte black background, one periwinkle-blue
   (#6ea8fe) accent, Sora bold white headline '[HOOK]', DM Mono stat '[NUMBER]',
   small ClipWise wordmark bottom-left, generous negative space, premium minimal."*
2. Review; refine with `edit-design` (swap copy, nudge layout, fix color).
3. `export-design` → PNG. Verify dimensions match the target platform.

**Path B — Adobe Express (pixel-exact):**
1. `adobe_mandatory_init`, then call `create_visual_design_express_skill` and follow
   its playbook: author a self-contained HTML doc at the exact canvas size, inline all
   CSS, embed fonts (Sora/DM Mono) — then export to image/PDF/PPTX or Express.
2. Use this when you need precise control (exact hairlines, mono number alignment, a
   floating product-screenshot mock with a blue glow).

**Both:** run the brand checklist from `brand.md` before exporting.

## Recipe: profile picture

1. Start from the ClipWise icon in `public/` (`icon-512.png`) — it's the real mark.
2. Need it on a custom background or isolated? `adobe_mandatory_init` →
   `image_remove_background`, then place on a `#000` or blue-glow square.
3. Compose 1080×1080, mark centered (renders in a circle — keep it away from corners).
4. Export PNG. Deliver one clean version; offer a light-bg variant if useful.

## Recipe: reel / short / video ad

1. **Script + shotlist first** (see `campaigns.md` hook bank). Structure:
   `Hook (0–1s) → Problem → ClipWise solves it (show the screen) → Proof → CTA card.`
   Always plan burned-in captions.
2. `adobe_mandatory_init`, then build with `animate_design` (motion graphics from a
   design) or assemble with `video_create_quick_cut` / `video_render`.
3. Master at 1080×1920 (9:16). Then `video_resize` to 1:1 and 16:9 so one cut covers
   IG/FB reel, feed, and YouTube. Design a separate 1280×720 thumbnail for YouTube.
4. Deliver MP4(s) + the caption/hashtag kit + a note on which file goes where.

If AI video tools can't fully render the concept, deliver the **storyboard + on-screen
text + a ready-to-shoot script** so the owner can film 15s on a phone and drop the text
in — still "upload-ready" with minimal effort.

## Recipe: AI / enhanced imagery

- **Generate:** Canva `generate-design` or a Firefly board for concept imagery
  (e.g. a moody barbershop scene as a background). Keep it realistic, cool-graded.
- **Enhance real photos:** `adobe_mandatory_init` → `image_apply_auto_tone` →
  `image_adjust_color_temperature` (cool it slightly) → `image_crop_and_resize` to the
  platform ratio → optional `image_generative_expand` if you need more canvas.
- **Composite:** remove background from a subject, drop on black with a blue radial
  glow, add the wordmark. That's the signature ClipWise look.

## Recipe: design system / templates (Figma)

When the owner wants to reuse layouts ("make me a template I can reuse for weekly
stats"), build a small Figma component set: a post frame, a stat-card component, a
quote/testimonial card, all wired to the brand tokens. Follow the Figma skill
(`/figma-use` / `get_figma_skill`) before calling `use_figma`.

## Always finish with the Post Kit

No matter the tool, wrap every deliverable with the Post Kit from SKILL.md (platform,
caption ×2, hashtags, on-image text, best time, alt text, why-it-works) and send files
via `SendUserFile`. The owner should be able to upload without touching anything else.

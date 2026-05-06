// templates.jsx — OTL Instagram post templates
// Each template renders at a fixed Instagram canvas size and accepts:
//   { campaign, photo, headline, subhead, variant, size, accent }
// All sizes use the same internal padding/scale system so a template
// reads correctly at 1:1, 4:5, and 9:16.
//
// Sizes are FIXED at the design pixel size (1080×1080 etc).
// The host (DesignCanvas / IGFrame) is responsible for scaling them.

// ─────────────────────────────────────────────────────────────
// OTL Brand palette + accent slot system
// Brand anchors: Navy #003566 | Mid Blue #004a8f | Light Blue #7eb8ff
// Posts may use any intentional color — brand colors are the anchor,
// not the ceiling. Never use CrossFit corporate red (#C8102E).
// ─────────────────────────────────────────────────────────────
const ACCENT_SLOTS = [
  { accent: "#7eb8ff", bg: "#0a0a0a",  label: "OTL Blue"   },  // 0 — default
  { accent: "#003566", bg: "#0d1a2e",  label: "Navy Night"  },  // 1
  { accent: "#F5C518", bg: "#0a0a0a",  label: "Gold"        },  // 2
  { accent: "#10B981", bg: "#061a0f",  label: "Emerald"     },  // 3
  { accent: "#ffffff", bg: "#0a0a0a",  label: "White"       },  // 4
  { accent: "#E8C49A", bg: "#1a1008",  label: "Sand"        },  // 5
];

const SIZES = {
  "1:1": { w: 1080, h: 1080, cls: "tpl--1x1" },
  "4:5": { w: 1080, h: 1350, cls: "tpl--4x5" },
  "9:16": { w: 1080, h: 1920, cls: "tpl--9x16" }
};

// Padding adapts per format so the composition feels balanced at every aspect.
function pad(size) {
  if (size === "9:16") return { x: 80, y: 110 };
  if (size === "4:5") return { x: 72, y: 80 };
  return { x: 64, y: 64 };
}

// ─────────────────────────────────────────────────────────────
// IG UI SAFE ZONES
// Mirrors the CSS variables in otl-tokens.css. Keep readable text
// inside the reel-safe horizontal band, and out of the lower-left
// repost-avatar zone and lower-right audio-mute zone.
//
// reelX  → minimum horizontal padding for any text element (px from
//          each edge). Text outside this band will clip when IG
//          auto-converts a carousel into a 9:16 reel.
// bottomSafe → minimum bottom anchor (px from canvas bottom) for any
//          headline/body/CTA block. Below this the repost-avatar
//          circle covers it.
// avatar/audio → the actual no-go rectangles (w × h, anchored to
//          their respective lower corners). Useful when you need to
//          visually verify or to shift purely-decorative elements.
// ─────────────────────────────────────────────────────────────
function safeZones(size) {
  // Avatar + audio zones are roughly the same on every IG canvas size;
  // only the reel-safe horizontal band changes (1:1 has more crop
  // because 1:1 → 9:16 trims more from the sides than 4:5 → 9:16).
  const reelX =
    size === "9:16" ? 0 :
    size === "1:1"  ? 236 :
                      160; // 4:5 default
  return {
    reelX,
    bottomSafe: 310,        // lower-left avatar height + buffer
    avatarW:    220,
    avatarH:    270,
    audioW:     220,
    audioH:     220,
    contentW:   1080 - 2 * reelX,  // available text width inside reel-safe band
  };
}

// ─────────────────────────────────────────────────────────────
// AUTO-FIT FONT SIZER
// Heuristic by character-count — fast, deterministic, no DOM measurement.
// Why heuristic instead of measure-and-shrink JS? Templates render via
// Puppeteer with networkidle + fonts.ready gates. A useLayoutEffect
// shrink loop adds timing fragility and async hazards. The heuristic
// is robust enough for our cases (and the codebase already uses similar
// patterns in BoldStatement and SplashSlide).
//
// Returns a font-size (px) such that the longest single line of `text`
// fits inside `maxWidth` at the given font's avg-glyph width ratio.
// Caller multiplies by any user-supplied scale (e.g. headlineFontScale).
//
//   text       string, may contain "\n" — sized to the longest line
//   maxWidth   px, available content width (e.g. safe.contentW)
//   idealSize  the design-target size (returned if text fits)
//   charRatio  avg glyph width in ems. Bebas Neue ≈ 0.42 (uppercase/digits).
//              Inter 800 caps ≈ 0.62. Inter 700 caps ≈ 0.60.
//   minSize    floor — never shrink below this even if it overflows
// ─────────────────────────────────────────────────────────────
function autoFitFontSize(text, maxWidth, idealSize, charRatio = 0.42, minSize = 60) {
  if (!text) return idealSize;
  const lines = String(text).split("\n");
  const maxLen = Math.max(...lines.map(l => l.length));
  if (maxLen === 0) return idealSize;
  const fitSize = Math.floor(maxWidth / (maxLen * charRatio));
  if (fitSize >= idealSize) return idealSize;
  return Math.max(minSize, fitSize);
}

// ─────────────────────────────────────────────────────────────
// World palette — dark world = white text on dark, light world = dark text on light
// ─────────────────────────────────────────────────────────────
function worldPalette(world, overlayOpacity) {
  const ovl = overlayOpacity != null ? Number(overlayOpacity) : null;
  if (world === 'light') return {
    bg:           '#f2f2f0',
    headline:     '#0a0a0a',
    byline:       'rgba(0,0,0,0.75)',
    meta:         'rgba(0,0,0,0.45)',
    lockup:       'blue',
    overlayClass: 'tpl-overlay--light',
    overlayStyle: ovl != null ? { background: `rgba(255,255,255,${ovl})` } : {},
    grainClass:   'tpl-grain tpl-grain--heavy',
  };
  return {
    bg:           '#0a0a0a',
    headline:     '#ffffff',
    byline:       'rgba(255,255,255,0.85)',
    meta:         'rgba(255,255,255,0.55)',
    lockup:       'white',
    overlayClass: 'tpl-overlay--dark',
    overlayStyle: ovl != null ? { background: `rgba(0,0,0,${ovl})` } : {},
    grainClass:   'tpl-grain tpl-grain--heavy',
  };
}

// ─────────────────────────────────────────────────────────────
// Common atoms
// ─────────────────────────────────────────────────────────────

// Build Cloudinary B&W blur URLs from a photo URL.
// Returns { bg: B&W+blurred URL, fg: background-removed URL } or null if not a Cloudinary URL.
// Uses proper Cloudinary subject detection — far more accurate than CSS masks.
function bwBlurCloudinaryUrls(photoUrl, slot) {
  if (!photoUrl || !photoUrl.includes('/upload/')) return null;
  const cropW = slot === 'value' ? 'c_fill,g_auto:subject,w_1080,h_675'
                                 : 'c_fill,g_auto:subject,w_1080,h_1350';
  const uploadIdx = photoUrl.indexOf('/upload/');
  const base = photoUrl.slice(0, uploadIdx + 8); // "https://.../upload/"
  const afterUpload = photoUrl.slice(uploadIdx + 8);
  // Strip any existing transforms: find version token or crossfit-otl folder start
  const match = afterUpload.match(/^(?:[^/]+\/)*?(v\d+\/.*|crossfit-otl\/.*)/);
  if (!match) return null;
  const cleanPath = match[1];
  return {
    bg: `${base}${cropW}/e_grayscale/e_blur:600/${cleanPath}`,
    fg: `${base}${cropW}/e_background_removal/f_png/${cleanPath}`,
  };
}

// Portrait blur: two-layer CSS depth-of-field (BLUR BG).
// B&W Blur: Cloudinary subject detection — B&W blurred background + color subject cutout.
// slot: 'hook' (full frame 1080×1350) | 'value' (half frame 1080×675)
function PortraitBlurLayer({ photo, bw = false, coverStyle = {}, slot = 'hook' }) {
  if (!photo) return null;
  const base = { position: "absolute", inset: 0, overflow: "hidden", zIndex: 0 };

  if (bw) {
    // Use Cloudinary background removal for precise subject isolation.
    const urls = bwBlurCloudinaryUrls(photo, slot);
    if (urls) {
      return (
        <React.Fragment>
          {/* Background: same crop, B&W + blurred */}
          <div style={{ ...base }}>
            <img src={urls.bg} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", ...coverStyle }} />
          </div>
          {/* Foreground: Cloudinary background removed → color subject on transparent bg */}
          <div style={{ ...base }}>
            <img src={urls.fg} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", ...coverStyle }} />
          </div>
        </React.Fragment>
      );
    }
    // Fallback if URL parsing fails: CSS grayscale+blur approach
  }

  // Regular blur (BLUR BG) — CSS depth-of-field mask
  return (
    <React.Fragment>
      <div style={{ ...base }}>
        <img src={photo} alt="" style={{
          width: "108%", height: "108%", margin: "-4%",
          objectFit: "cover", filter: "blur(12px)", ...coverStyle
        }} />
      </div>
      <div style={{
        ...base,
        WebkitMaskImage: "radial-gradient(ellipse 92% 88% at 50% 42%, black 50%, transparent 85%)",
        maskImage: "radial-gradient(ellipse 92% 88% at 50% 42%, black 50%, transparent 85%)",
      }}>
        <img src={photo} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", ...coverStyle }} />
      </div>
    </React.Fragment>
  );
}

function PhotoLayer({ photo, overlay = "default", placeholderLabel = "Drop Photo Here" }) {
  if (!photo) {
    return (
      <React.Fragment>
        <div className="tpl-photo tpl-photo--placeholder">
          <div className="ph-frame"></div>
          <div className="ph-label">{placeholderLabel}</div>
        </div>
        <div className={`tpl-overlay tpl-overlay--${overlay}`}></div>
      </React.Fragment>);

  }
  return (
    <React.Fragment>
      <div className="tpl-photo">
        <img src={photo} alt="" />
      </div>
      <div className={`tpl-overlay tpl-overlay--${overlay}`}></div>
    </React.Fragment>);

}

function OTLLockup({ variant = "white", tag = null, size = 36 }) {
  const src = variant === "blue" ? "assets/banner-blue.png" : "assets/banner-white.png";
  return (
    <div className="tpl-lockup">
      <img src={src} alt="CrossFit OTL" style={{ height: size }} />
      {tag && <span className="lockup-tag">{tag}</span>}
    </div>);

}

function CampaignChip({ campaign, accent }) {
  // Stripped — the gritty direction omits campaign chips entirely.
  // Templates keep calling this so we don't have to edit every callsite,
  // but it renders nothing.
  return null;
}

function CornerStamp({ campaign, accent, lines = ["HQ Campaign", campaign.name] }) {
  // Stripped — gritty editorial direction has no corner stamps.
  return null;
}

function HashtagRow({ campaign, accent, extra = [] }) {
  const tags = [campaign.hashtag, ...extra, "#crossfitotl", "#NRH"];
  return (
    <div style={{
      display: "flex", flexWrap: "wrap", gap: "10px 16px",
      fontFamily: "var(--font-body)", fontSize: 20, fontWeight: 500,
      letterSpacing: 1.5, color: accent
    }}>
      {tags.map((t, i) => <span key={i}>{t}</span>)}
    </div>);

}

// ─────────────────────────────────────────────────────────────
// 1. ARTICLE / HEADLINE COVER  (the reference example)
//    Cinematic photo, OTL banner above big Bebas headline,
//    byline subhead. The OTL "house style" template.
// ─────────────────────────────────────────────────────────────

function ArticleCover({ campaign, photo, headline, subhead, variant = "a", size = "1:1", accent, headlineFontScale = 1, subheadFontScale = 1, world = "dark", overlayOpacity }) {
  const { w, h, cls } = SIZES[size];
  const p = pad(size);
  const isBold = variant === "b";
  const pal = worldPalette(world, overlayOpacity);

  const fsHeadline = (size === "9:16" ? 116 : size === "4:5" ? 96 : 80) * headlineFontScale;
  const fsSub = (size === "9:16" ? 32 : size === "4:5" ? 28 : 24) * subheadFontScale;

  return (
    <div className={`tpl ${cls}`} data-template="article-cover" data-variant={variant}>
      <PhotoLayer
        photo={photo}
        overlay={null}
        placeholderLabel="Hero Photo" />

      <div className={pal.overlayClass} style={pal.overlayStyle}></div>
      <div className="tpl-grain"></div>

      <div className="tpl-content" style={{ padding: `${p.y}px ${p.x}px`, justifyContent: "flex-end", gap: 0 }}>
        {isBold && (
          <div style={{ position: "absolute", top: p.y, left: p.x, fontFamily: "Inter, Helvetica, sans-serif", fontWeight: 600, fontSize: 14, letterSpacing: 4, textTransform: "uppercase", color: pal.meta }}>
            {campaign.hashtag}
          </div>
        )}
        <div style={{ marginBottom: 20 }}>
          <OTLLockup variant={pal.lockup} size={size === "9:16" ? 36 : 28} />
        </div>
        <h1 className="tpl-headline-clean" style={{ fontSize: fsHeadline, marginBottom: 20, maxWidth: "92%", color: pal.headline }}>
          {(headline || campaign.article.title).split("\n").map((l, i) =>
            <React.Fragment key={i}>{i > 0 && <br />}{l}</React.Fragment>
          )}
        </h1>
        <p className="tpl-byline" style={{ fontSize: fsSub, maxWidth: "88%", color: pal.byline }}>
          {subhead || campaign.article.byline}
        </p>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// 2. BOLD STATEMENT / PULL QUOTE
//    No photo, big type, scroll-stopper. Optional subtle photo bg
//    behind in variant B.
// ─────────────────────────────────────────────────────────────

function BoldStatement({ campaign, photo, headline, subhead, variant = "a", size = "1:1", accent, headlineFontScale = 1, subheadFontScale = 1, world = "dark", overlayOpacity }) {
  const { cls } = SIZES[size];
  const p = pad(size);
  const isBold = variant === "b";
  const pal = worldPalette(world, overlayOpacity);

  const statement = headline || campaign.statement;
  // Use the LONGEST single line to determine font size.
  // Inter Bold 800 uppercase chars average ~65% of em width.
  // At 4:5 (content width 936px), a 18-char line needs ≤85px to fit.
  const lines = (statement || '').split('\n');
  const maxLineChars = Math.max(...lines.map(l => l.length));
  const fsBase = size === "9:16" ? 140 : size === "4:5" ? 124 : 104;
  const fsAuto = maxLineChars > 20 ? Math.round(fsBase * 0.58)   // ≤72px @ 4:5 — long lines
               : maxLineChars > 14 ? Math.round(fsBase * 0.68)   // ≤84px @ 4:5 — medium lines
               : maxLineChars > 9  ? Math.round(fsBase * 0.82)   // ≤102px @ 4:5 — short lines
               : maxLineChars > 5  ? Math.round(fsBase * 0.92)   // ≤114px @ 4:5 — very short
               : fsBase;                                           // full size — 1–5 char punches
  const fsHeadline = fsAuto * headlineFontScale;
  const fsSub = (size === "9:16" ? 32 : size === "4:5" ? 28 : 24) * subheadFontScale;

  return (
    <div className={`tpl ${cls}`} data-template="bold-statement" data-variant={variant}>
      {isBold ? (
        <>
          <PhotoLayer photo={photo} overlay={null} placeholderLabel="Optional bg photo" />
          <div className={pal.overlayClass} style={pal.overlayStyle}></div>
          <div className="tpl-grain"></div>
        </>
      ) : (
        <>
          <div style={{ position: "absolute", inset: 0, zIndex: 0, background: pal.bg }}></div>
          <div className="tpl-grain tpl-grain--heavy"></div>
        </>
      )}

      <div className="tpl-content" style={{ padding: `${p.y}px ${p.x}px`, justifyContent: isBold ? "flex-end" : "center", gap: 28 }}>
        <div style={{ marginBottom: 12 }}>
          <OTLLockup variant={pal.lockup} size={size === "9:16" ? 36 : 28} />
        </div>
        <h1 className="tpl-headline-clean" style={{ fontSize: fsHeadline, maxWidth: "100%", color: pal.headline, wordBreak: "break-word", overflowWrap: "break-word" }}>
          {statement.split("\n").map((l, i) =>
            <React.Fragment key={i}>{i > 0 && <br />}{l}</React.Fragment>
          )}
        </h1>
        <p className="tpl-byline" style={{ fontSize: fsSub, maxWidth: "88%", color: pal.byline }}>
          {subhead || campaign.pull}
        </p>
        {!isBold && (
          <div style={{ marginTop: "auto", paddingTop: 24, fontFamily: "Inter, Helvetica, sans-serif", fontWeight: 600, fontSize: 14, letterSpacing: 4, textTransform: "uppercase", color: pal.meta }}>
            {campaign.hashtag}
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// 3. COACH CARD  (Meet your coach)
//    Large vertical photo + name + credentials + quote
// ─────────────────────────────────────────────────────────────

function CoachCard({ campaign, photo, headline, subhead, variant = "a", size = "1:1", accent, coach, headlineFontScale = 1, subheadFontScale = 1, world = "dark", overlayOpacity }) {
  const { cls, h } = SIZES[size];
  const p = pad(size);
  const isBold = variant === "b";
  const pal = worldPalette(world, overlayOpacity);

  const c = coach || {
    name: headline || "JAVIER JAIME",
    role: "Founder · Head Coach",
    creds: ["CF-L2", "CCFT path"],
    quote: subhead || "We don't do sales pitches. We coach."
  };

  // Layout differs by size — split layouts feel right at 1:1, stacked at 9:16
  const isPortrait = size !== "1:1";

  return (
    <div className={`tpl ${cls}`} data-template="coach-card" data-variant={variant}>
      <div style={{ position: "absolute", inset: 0, background: pal.bg }}></div>

      {isPortrait ?
      // Stacked: photo on top, info below
      <div style={{ position: "relative", zIndex: 2, height: "100%", display: "flex", flexDirection: "column" }}>
          <div style={{
          position: "relative",
          height: size === "9:16" ? "60%" : "62%",
          overflow: "hidden",
          background: "#161616"
        }}>
            {photo ?
          <img src={photo} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", filter: isBold ? "grayscale(0.4) contrast(1.1)" : "none" }} /> :

          <div className="tpl-photo--placeholder" style={{ width: "100%", height: "100%" }}>
                <div className="ph-frame"></div>
                <div className="ph-label">Coach Photo</div>
              </div>
          }
            <div style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, transparent 50%, rgba(0,0,0,0.85) 100%)" }}></div>
            <div style={{ position: "absolute", top: 32, left: 32, display: "flex", flexDirection: "column", gap: 8 }}>
              {c.creds.map((cr, i) =>
            <span key={i} style={{
              display: "inline-block", padding: "8px 14px",
              background: "rgba(0,0,0,0.65)",
              border: `1px solid ${accent}`,
              fontFamily: "var(--font-body)", fontSize: 13, fontWeight: 600,
              letterSpacing: 3, textTransform: "uppercase",
              color: accent, alignSelf: "flex-start"
            }}>{cr}</span>
            )}
            </div>
            <div style={{ position: "absolute", top: 32, right: 32 }}>
              <OTLLockup variant={pal.lockup} size={28} />
            </div>
          </div>

          <div style={{ padding: `${p.y * 0.6}px ${p.x}px ${p.y}px`, display: "flex", flexDirection: "column", gap: 24, flex: 1 }}>
            <CampaignChip campaign={campaign} accent={accent} />
            <h2 className="tpl-headline" style={{ fontSize: (size === "9:16" ? 132 : 96) * headlineFontScale, lineHeight: 0.92, color: pal.headline }}>
              {c.name}
            </h2>
            <div className="tpl-meta" style={{ color: pal.meta, justifyContent: "flex-start" }}>{c.role}</div>
            <div style={{ height: 1, width: 96, background: accent, margin: "8px 0" }}></div>
            <p className="tpl-sub" style={{ fontSize: (size === "9:16" ? 34 : 28) * subheadFontScale, fontStyle: "italic", color: pal.byline }}>
              "{c.quote}"
            </p>
          </div>
        </div> :

      // 1:1 split layout — photo left, info right
      <div style={{ position: "relative", zIndex: 2, height: "100%", display: "grid", gridTemplateColumns: "1fr 1fr" }}>
          <div style={{ position: "relative", overflow: "hidden", background: "#161616" }}>
            {photo ?
          <img src={photo} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", filter: isBold ? "grayscale(0.4) contrast(1.1)" : "none" }} /> :

          <div className="tpl-photo--placeholder" style={{ width: "100%", height: "100%" }}>
                <div className="ph-frame"></div>
                <div className="ph-label">Coach</div>
              </div>
          }
            <div style={{ position: "absolute", top: 24, left: 24, display: "flex", flexDirection: "column", gap: 6 }}>
              {c.creds.map((cr, i) =>
            <span key={i} style={{
              display: "inline-block", padding: "6px 12px",
              background: "rgba(0,0,0,0.7)",
              border: `1px solid ${accent}`,
              fontFamily: "var(--font-body)", fontSize: 11, fontWeight: 600,
              letterSpacing: 3, textTransform: "uppercase",
              color: accent, alignSelf: "flex-start"
            }}>{cr}</span>
            )}
            </div>
          </div>
          <div style={{ padding: `${p.y}px ${p.x * 0.85}px`, display: "flex", flexDirection: "column", justifyContent: "space-between", background: isBold ? accent : pal.bg }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <OTLLockup variant={pal.lockup} size={26} />
              <CampaignChip campaign={campaign} accent={isBold ? "#fff" : accent} />
            </div>
            <div>
              <h2 className="tpl-headline" style={{ fontSize: 88 * headlineFontScale, lineHeight: 0.9, marginBottom: 12, color: isBold ? "#fff" : pal.headline }}>
                {c.name.split(" ").map((w, i) =>
              <React.Fragment key={i}>
                    {i > 0 && <br />}
                    {w}
                  </React.Fragment>
              )}
              </h2>
              <div className="tpl-meta" style={{ color: isBold ? "rgba(255,255,255,0.85)" : pal.meta, justifyContent: "flex-start", marginBottom: 22 }}>{c.role}</div>
              <div style={{ height: 2, width: 64, background: isBold ? "#fff" : accent, marginBottom: 22 }}></div>
              <p className="tpl-sub" style={{ fontSize: 24 * subheadFontScale, fontStyle: "italic", color: isBold ? "rgba(255,255,255,0.95)" : pal.byline }}>
                "{c.quote}"
              </p>
            </div>
          </div>
        </div>
      }
    </div>);

}

// ─────────────────────────────────────────────────────────────
// 4. MEMBER SPOTLIGHT  ("Because of CrossFit, I…")
//    Photo + finished sentence as headline.
// ─────────────────────────────────────────────────────────────

function MemberSpotlight({ campaign, photo, headline, subhead, variant = "a", size = "1:1", accent, headlineFontScale = 1, subheadFontScale = 1, world = "dark", overlayOpacity, prefix = "BECAUSE OF\nCROSSFIT,\nI" }) {
  const { cls } = SIZES[size];
  const p = pad(size);
  const isBold = variant === "b";
  const pal = worldPalette(world, overlayOpacity);

  const finish = headline || "PICK UP MY GRANDKIDS.";
  const member = subhead || "Linda · Member since 2023";

  const fsPrefix = (size === "9:16" ? 36 : size === "4:5" ? 32 : 28) * subheadFontScale;
  const fsFinish = (size === "9:16" ? 132 : size === "4:5" ? 116 : 96) * headlineFontScale;

  return (
    <div className={`tpl ${cls}`} data-template="member-spotlight" data-variant={variant}>
      <PhotoLayer photo={photo} overlay={null} placeholderLabel="Member Photo" />
      <div className={pal.overlayClass} style={pal.overlayStyle}></div>
      <div className="tpl-grain"></div>

      <div className="tpl-content" style={{ padding: `${p.y}px ${p.x}px`, justifyContent: "flex-end", gap: 0 }}>
        <div style={{ marginBottom: 20 }}>
          <OTLLockup variant={pal.lockup} size={size === "9:16" ? 36 : 28} />
        </div>
        <div style={{ fontFamily: "Inter, Helvetica, sans-serif", fontWeight: 400, fontSize: fsPrefix, lineHeight: 1.2, color: pal.byline, marginBottom: 8, textTransform: "uppercase", letterSpacing: 1 }}>
          {prefix.replace(/\n/g, " ")}
        </div>
        <h1 className="tpl-headline-clean" style={{ fontSize: fsFinish, marginBottom: 24, maxWidth: "92%", color: pal.headline }}>
          {finish.split("\n").map((l, i) =>
            <React.Fragment key={i}>{i > 0 && <br />}{l}</React.Fragment>
          )}
        </h1>
        <p className="tpl-byline" style={{ fontSize: size === "9:16" ? 26 : 22, color: pal.byline }}>
          {member}
        </p>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// 5. CLASS SCHEDULE / EVENT ANNOUNCEMENT
//    "The Cult(ure) Meets Here" — schedule grid OR event card
// ─────────────────────────────────────────────────────────────

function ScheduleEvent({ campaign, photo, headline, subhead, variant = "a", size = "1:1", accent, schedule, event }) {
  const { cls } = SIZES[size];
  const p = pad(size);
  const isEvent = variant === "b";

  const sched = schedule || [
  { day: "MON–FRI", times: "5A · 6A · 9A · 4P · 5P · 6P" },
  { day: "SATURDAY", times: "8A · 9A" },
  { day: "SUNDAY", times: "CLOSED · ACTIVE RECOVERY" }];


  const ev = event || {
    when: "MEMORIAL DAY · MAY 26",
    what: headline || "MURPH 2025",
    where: "ON THE LINE FITNESS · NRH",
    detail: subhead || "Heat sheets posted Friday. Bring a friend. We are an Official 2025 Murph Host."
  };

  if (isEvent) {
    // EVENT card variant — full-bleed photo with date stamp
    const fsTitle = size === "9:16" ? 200 : size === "4:5" ? 176 : 144;
    return (
      <div className={`tpl ${cls}`} data-template="event" data-variant="b">
        <PhotoLayer photo={photo} overlay="vignette" placeholderLabel="Event Photo" />
        <CornerStamp campaign={campaign} accent={accent} lines={["Event", "OTL Hosts"]} />

        <div className="tpl-content" style={{ padding: `${p.y}px ${p.x}px`, justifyContent: "space-between" }}>
          <div>
            <OTLLockup variant="white" size={size === "9:16" ? 48 : 36} />
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
            <div style={{ display: "inline-flex", alignItems: "center", gap: 14, color: "#fff", fontFamily: "var(--font-body)", fontWeight: 600, letterSpacing: 5, textTransform: "uppercase", alignSelf: "flex-start", fontSize: "8px" }}>
              <span style={{ width: 36, height: 2, background: accent }}></span>
              {ev.when}
            </div>
            <h1 className="tpl-headline" style={{ fontSize: fsTitle, letterSpacing: 1 }}>
              {ev.what}
            </h1>
            <div style={{ height: 1, width: "60%", background: "rgba(255,255,255,0.25)" }}></div>
            <div className="tpl-meta" style={{ justifyContent: "flex-start", color: "rgba(255,255,255,0.65)", fontSize: "30px" }}>
              {ev.where}
            </div>
            <p className="tpl-sub" style={{ fontSize: 38, maxWidth: "85%", opacity: "1" }}>
              {ev.detail}
            </p>
            <div style={{ marginTop: 12 }}>
              <span style={{
                display: "inline-flex", alignItems: "center", gap: 14,
                padding: "20px 32px", background: accent, color: "#fff",
                fontFamily: "var(--font-body)", fontWeight: 600, fontSize: 15,
                letterSpacing: 4, textTransform: "uppercase"
              }}>Register · Link in bio</span>
            </div>
          </div>
        </div>
      </div>);

  }

  // SCHEDULE variant — "The Cult(ure) Meets Here"
  return (
    <div className={`tpl ${cls}`} data-template="schedule" data-variant="a">
      <div style={{ position: "absolute", inset: 0, background: "var(--otl-bg-primary)", zIndex: 0 }}></div>

      {/* Optional faded photo strip behind */}
      <div style={{ position: "absolute", inset: 0, zIndex: 0, opacity: 0.18 }}>
        {photo && <img src={photo} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", filter: "grayscale(1)" }} />}
      </div>
      <div style={{ position: "absolute", inset: 0, zIndex: 1, background: "linear-gradient(180deg, rgba(10,10,10,0.6) 0%, rgba(10,10,10,0.95) 100%)" }}></div>

      <CornerStamp campaign={campaign} accent={accent} lines={["The Cult(ure)", "Meets Here"]} />

      <div className="tpl-content" style={{ padding: `${p.y}px ${p.x}px`, justifyContent: "space-between", gap: 32 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          <OTLLockup variant="white" size={size === "9:16" ? 44 : 32} />
          <CampaignChip campaign={campaign} accent={accent} />
          <h2 className="tpl-headline" style={{ fontSize: size === "9:16" ? 144 : size === "4:5" ? 124 : 100, letterSpacing: 1 }}>
            {headline || "CLASS\nSCHEDULE"}
            {(headline || "").includes("\n") ? null : null}
          </h2>
        </div>

        <div className="tpl-schedule">
          {sched.map((row, i) =>
          <div className="row" key={i}>
              <div className={`cell ${row.times.includes("CLOSED") ? "" : ""}`}>{row.day}</div>
              <div className={`cell right ${row.times.includes("CLOSED") ? "closed" : ""}`}>{row.times}</div>
            </div>
          )}
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "auto" }}>
          <div className="tpl-meta" style={{ color: "rgba(255,255,255,0.55)" }}>
            7820 Mid-Cities Blvd · NRH, TX
          </div>
          <div className="stamp-line" style={{ color: accent }}>{campaign.hashtag}</div>
        </div>
      </div>
    </div>);

}

// ─────────────────────────────────────────────────────────────
// 6. HERO WOD POSTER  (Murph / CHAD1000X style)
//    Movement breakdown, big numerals, dog-tag look.
// ─────────────────────────────────────────────────────────────

function HeroWODPoster({ campaign, photo, headline, subhead, variant = "a", size = "1:1", accent, wod }) {
  const { cls } = SIZES[size];
  const p = pad(size);
  const isBold = variant === "b";

  const w = wod || {
    name: headline || "MURPH",
    honor: "Lt. Michael P. Murphy · Navy SEAL · KIA 6.28.2005",
    movements: [
    { reps: "1", move: "Mile Run", detail: "For time" },
    { reps: "100", move: "Pull-Ups" },
    { reps: "200", move: "Push-Ups" },
    { reps: "300", move: "Air Squats" },
    { reps: "1", move: "Mile Run", detail: "For time" }],

    note: subhead || "20-lb vest, partition as needed. We are an Official 2025 Murph Host.",
    when: "MEMORIAL DAY · 9 AM"
  };

  const fsName = size === "9:16" ? 280 : size === "4:5" ? 240 : 196;

  if (isBold) {
    // BOLD — photo behind, big name + movement list
    return (
      <div className={`tpl ${cls}`} data-template="hero-wod" data-variant="b">
        <PhotoLayer photo={photo} overlay={null} placeholderLabel="Hero WOD Photo" />
        <div className="tpl-overlay--gritty"></div>
        <div className="tpl-grain"></div>

        <div className="tpl-content" style={{ padding: `${p.y}px ${p.x}px`, justifyContent: "space-between" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <OTLLockup variant="white" size={size === "9:16" ? 36 : 28} />
            <div style={{ fontFamily: "Inter, Helvetica, sans-serif", fontWeight: 600, fontSize: 14, letterSpacing: 4, textTransform: "uppercase", color: "#fff" }}>
              {w.when}
            </div>
          </div>

          <div>
            <h1 className="tpl-headline-clean" style={{ fontSize: fsName, lineHeight: 0.9 }}>
              {w.name}
            </h1>
            <p className="tpl-byline" style={{ fontSize: 32, marginTop: 14 }}>
              {w.honor}
            </p>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {w.movements.map((m, i) =>
              <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", borderBottom: "1px solid rgba(255,255,255,0.18)", paddingBottom: 10 }}>
                <span style={{ fontFamily: "Inter, Helvetica, sans-serif", fontWeight: 700, fontSize: size === "9:16" ? 40 : 32, color: "#fff", textTransform: "uppercase", letterSpacing: 0.5 }}>{m.move}{m.detail ? ` · ${m.detail}` : ""}</span>
                <span style={{ fontFamily: "Inter, Helvetica, sans-serif", fontWeight: 800, fontSize: size === "9:16" ? 56 : 44, color: "#fff" }}>{m.reps}</span>
              </div>
            )}
            <p className="tpl-byline" style={{ fontSize: size === "9:16" ? 24 : 20, marginTop: 14, color: "rgba(255,255,255,0.7)" }}>
              {w.note}
            </p>
          </div>
        </div>
      </div>
    );
  }

  // VARIANT A — clean dark poster, no photo
  return (
    <div className={`tpl ${cls}`} data-template="hero-wod" data-variant="a">
      <div style={{ position: "absolute", inset: 0, background: "#0a0a0a", zIndex: 0 }}></div>
      <div className="tpl-grain tpl-grain--heavy"></div>

      <div className="tpl-content" style={{ padding: `${p.y}px ${p.x}px`, gap: 28 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <OTLLockup variant="white" size={size === "9:16" ? 36 : 28} />
          <div style={{ fontFamily: "Inter, Helvetica, sans-serif", fontWeight: 600, fontSize: 14, letterSpacing: 4, textTransform: "uppercase", color: "rgba(255,255,255,0.7)" }}>{w.when}</div>
        </div>

        <div style={{ marginTop: size === "9:16" ? 40 : 16 }}>
          <h1 className="tpl-headline-clean" style={{ fontSize: fsName, lineHeight: 0.9 }}>
            {w.name}
          </h1>
          <p className="tpl-byline" style={{ fontSize: 32, marginTop: 14, color: "rgba(255,255,255,0.7)" }}>
            {w.honor}
          </p>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 8 }}>
          {w.movements.map((m, i) =>
            <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", borderBottom: "1px solid rgba(255,255,255,0.12)", paddingBottom: 12 }}>
              <span style={{ fontFamily: "Inter, Helvetica, sans-serif", fontWeight: 700, fontSize: size === "9:16" ? 36 : 28, color: "#fff", textTransform: "uppercase", letterSpacing: 0.5 }}>
                {m.move}{m.detail ? ` · ${m.detail}` : ""}
              </span>
              <span style={{ fontFamily: "Inter, Helvetica, sans-serif", fontWeight: 800, fontSize: size === "9:16" ? 52 : 40, color: "#fff" }}>{m.reps}</span>
            </div>
          )}
        </div>

        <p className="tpl-byline" style={{ fontSize: size === "9:16" ? 24 : 20, color: "rgba(255,255,255,0.6)", marginTop: 8 }}>
          {w.note}
        </p>

        <div style={{ marginTop: "auto", paddingTop: 24, fontFamily: "Inter, Helvetica, sans-serif", fontWeight: 600, fontSize: 14, letterSpacing: 4, textTransform: "uppercase", color: "rgba(255,255,255,0.4)" }}>
          {campaign.hashtag}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// 7. PROGRAM CARD — Lifestyle Reset / multi-week program offer
//    Stacked benefits list + CTA. A: type-driven dark. B: photo-led.
// ─────────────────────────────────────────────────────────────

function ProgramCard({ campaign, photo, headline, subhead, variant = "a", size = "1:1", accent }) {
  const { cls } = SIZES[size];
  const p = pad(size);
  const isBold = variant === "b";

  const prog = campaign.program || {
    length: "OTL PROGRAM",
    pillars: ["NUTRITION", "MOVEMENT", "ACCOUNTABILITY"],
    includes: ["Coach check-ins", "InBody scans", "Unlimited classes"],
    cta: "Free Consult · Link in bio"
  };

  const fsTitle = size === "9:16" ? 200 : size === "4:5" ? 168 : 140;

  if (isBold) {
    return (
      <div className={`tpl ${cls}`} data-template="program-card" data-variant="b">
        <PhotoLayer photo={photo} overlay="vignette" placeholderLabel="Program Photo" />
        <CornerStamp campaign={campaign} accent={accent} lines={["OTL Program", prog.length]} />

        <div className="tpl-content" style={{ padding: `${p.y}px ${p.x}px`, justifyContent: "space-between" }}>
          <OTLLockup variant="white" size={size === "9:16" ? 48 : 36} />

          <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
            <CampaignChip campaign={campaign} accent={accent} />
            <h1 className="tpl-headline" style={{ fontSize: 150, letterSpacing: 1 }}>
              {headline || "RESET\nYOUR\nLIFESTYLE."}
            </h1>
            <p className="tpl-sub" style={{ fontSize: size === "9:16" ? 32 : 26, maxWidth: "85%" }}>
              {subhead || campaign.pull}
            </p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 8 }}>
              {prog.pillars.map((pl, i) =>
              <span key={i} style={{
                padding: "10px 16px", border: `1.5px solid ${accent}`,
                fontFamily: "var(--font-body)", fontWeight: 600, fontSize: 14,
                letterSpacing: 3, textTransform: "uppercase", color: accent
              }}>{pl}</span>
              )}
            </div>
            <div style={{ marginTop: 12 }}>
              <span style={{
                display: "inline-flex", padding: "20px 32px", background: accent,
                color: "#fff", fontFamily: "var(--font-body)", fontWeight: 600,
                fontSize: 15, letterSpacing: 4, textTransform: "uppercase"
              }}>{prog.cta}</span>
            </div>
          </div>
        </div>
      </div>);

  }

  // Variant A — clean type-led
  return (
    <div className={`tpl ${cls}`} data-template="program-card" data-variant="a">
      <div style={{ position: "absolute", inset: 0, background: `radial-gradient(120% 80% at 50% 0%, ${accent}25 0%, #0a0a0a 70%)`, zIndex: 0 }}></div>
      <CornerStamp campaign={campaign} accent={accent} lines={["OTL Program", prog.length]} />

      <div className="tpl-content" style={{ padding: `${p.y}px ${p.x}px`, gap: 28 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <OTLLockup variant="white" size={size === "9:16" ? 44 : 32} />
          <div className="tpl-meta" style={{ color: accent }}>{prog.length}</div>
        </div>

        <CampaignChip campaign={campaign} accent={accent} />

        <h1 className="tpl-headline" style={{ fontSize: 148, letterSpacing: 1 }}>
          {headline || campaign.statement}
        </h1>

        <div style={{ height: 2, width: 96, background: accent }}></div>

        <p className="tpl-sub" style={{ fontSize: size === "9:16" ? 32 : 26, maxWidth: "90%" }}>
          {subhead || campaign.pull}
        </p>

        <div style={{ display: "flex", flexDirection: "column", gap: 14, marginTop: 8 }}>
          {prog.includes.map((it, i) =>
          <div key={i} style={{
            display: "flex", alignItems: "baseline", gap: 18,
            paddingBottom: 10, borderBottom: "1px solid rgba(255,255,255,0.10)",
            fontFamily: "var(--font-body)", fontSize: 22, color: "rgba(255,255,255,0.9)"
          }}>
              <span style={{ color: accent, fontFamily: "var(--font-display)", fontSize: 28, minWidth: 40 }}>0{i + 1}</span>
              <span>{it}</span>
            </div>
          )}
        </div>

        <div style={{ marginTop: "auto", display: "flex", justifyContent: "space-between", alignItems: "center", paddingTop: 16 }}>
          <span style={{
            display: "inline-flex", padding: "18px 28px", background: accent,
            color: "#fff", fontFamily: "var(--font-body)", fontWeight: 600,
            fontSize: 14, letterSpacing: 4, textTransform: "uppercase"
          }}>{prog.cta}</span>
          <div className="stamp-line" style={{ color: "rgba(255,255,255,0.6)" }}>{campaign.hashtag}</div>
        </div>
      </div>
    </div>);

}

// ─────────────────────────────────────────────────────────────
// 8. CTA SLIDE  — always the last slide in a carousel
//    Dark card with offer, action, and contact. No photo.
// ─────────────────────────────────────────────────────────────

function CTASlide({ campaign, photo, headline, subhead, variant = "a", size = "1:1", accent = "#003566", headlineFontScale = 1, subheadFontScale = 1, world = "dark", overlayOpacity, cta }) {
  const { cls } = SIZES[size];
  const p = pad(size);
  const pal = worldPalette(world, overlayOpacity);

  const ctaAction  = cta?.action  || "Book Your Free Intro";
  const ctaDetail  = cta?.detail  || "Link in bio · @crossfitotl";
  const ctaOffer   = cta?.offer   || "No commitment · No pressure";
  const hook       = headline     || "READY TO START?";
  const sub        = subhead      || "Your first class is on us.";

  const fsHook = (size === "9:16" ? 120 : size === "4:5" ? 100 : 80) * headlineFontScale;
  const fsSub  = (size === "9:16" ? 30  : size === "4:5" ? 26  : 22) * subheadFontScale;

  return (
    <div className={`tpl ${cls}`} data-template="cta-slide" data-variant={variant}>
      {photo ? (
        <>
          <PhotoLayer photo={photo} overlay={null} placeholderLabel="Background texture" />
          <div className={pal.overlayClass} style={pal.overlayStyle}></div>
        </>
      ) : (
        <div style={{ position: "absolute", inset: 0, background: pal.bg, zIndex: 0 }}></div>
      )}
      <div style={{ position: "absolute", inset: 0, zIndex: 0, background: `radial-gradient(ellipse 90% 50% at 50% 110%, ${accent}33 0%, transparent 70%)` }}></div>
      <div className="tpl-grain tpl-grain--heavy"></div>

      <div className="tpl-content" style={{ padding: `${p.y}px ${p.x}px`, justifyContent: "space-between", gap: 0 }}>
        <div>
          <OTLLockup variant={pal.lockup} size={size === "9:16" ? 36 : 28} />
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div style={{ width: 48, height: 2, background: accent }}></div>
          <h1 className="tpl-headline-clean" style={{ fontSize: fsHook, maxWidth: "100%", lineHeight: 0.95, color: pal.headline }}>
            {hook.split("\n").map((l, i) =>
              <React.Fragment key={i}>{i > 0 && <br />}{l}</React.Fragment>
            )}
          </h1>
          <p style={{ fontFamily: "Inter, Helvetica, sans-serif", fontWeight: 400, fontSize: fsSub, color: pal.byline, lineHeight: 1.45, maxWidth: "88%" }}>
            {sub}
          </p>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ display: "inline-flex", alignSelf: "flex-start", padding: size === "4:5" ? "18px 32px" : "14px 26px", background: accent, color: "#fff", fontFamily: "Inter, Helvetica, sans-serif", fontWeight: 700, fontSize: size === "9:16" ? 22 : size === "4:5" ? 18 : 16, letterSpacing: 2, textTransform: "uppercase" }}>
            {ctaAction}
          </div>
          <p style={{ fontFamily: "Inter, Helvetica, sans-serif", fontWeight: 500, fontSize: size === "9:16" ? 22 : 18, letterSpacing: 1.5, textTransform: "uppercase", color: pal.meta }}>
            {ctaOffer}
          </p>
          <p style={{ fontFamily: "Inter, Helvetica, sans-serif", fontWeight: 600, fontSize: size === "9:16" ? 20 : 16, letterSpacing: 2, textTransform: "uppercase", color: accent }}>
            {ctaDetail}
          </p>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// 9. SPLASH SLIDE — single-image, two-line contrasting headline
//    Line 1: solid fill. Line 2: stroke-outline OR accent color.
//    Designed for standalone posts, not carousels.
// ─────────────────────────────────────────────────────────────

function SplashSlide({ campaign, photo, headline, subhead, size = "4:5", world = "dark", subheadStyle = "stroke", accent, overlayOpacity }) {
  const { cls } = SIZES[size];
  const p = pad(size);
  const pal = worldPalette(world, overlayOpacity);

  const line1 = headline || "RESOLUTIONS FADE.";
  const line2 = subhead  || "STANDARDS DON'T.";

  // Auto-scale: shrink if lines are long
  const maxLen = Math.max(line1.length, line2.length);
  const fsBase = size === "9:16" ? 124 : size === "4:5" ? 108 : 90;
  const fs = maxLen > 18 ? Math.round(fsBase * 0.72)
           : maxLen > 13 ? Math.round(fsBase * 0.86)
           : fsBase;

  const strokeWidth = Math.max(2, Math.round(fs * 0.028));
  const strokeColor = world === "light" ? "#0a0a0a" : "#ffffff";

  const line2Style = subheadStyle === "stroke"
    ? { WebkitTextStroke: `${strokeWidth}px ${strokeColor}`, color: "transparent" }
    : subheadStyle === "color"
    ? { color: accent || "var(--otl-navy-tint)" }
    : { color: pal.headline };

  return (
    <div className={`tpl ${cls}`} data-template="splash-slide">
      <PhotoLayer photo={photo} overlay={null} placeholderLabel="Drop Photo Here" />
      <div className={pal.overlayClass} style={pal.overlayStyle}></div>
      <div className="tpl-grain"></div>

      <div className="tpl-content" style={{ padding: `${p.y}px ${p.x}px`, justifyContent: "flex-end", gap: 0 }}>
        <div style={{ marginBottom: 24 }}>
          <h1 style={{
            fontFamily: "Inter, Helvetica Neue, Arial, sans-serif",
            fontWeight: 800,
            textTransform: "uppercase",
            lineHeight: 1.0,
            letterSpacing: "-0.5px",
          }}>
            <span style={{ display: "block", color: pal.headline, fontSize: fs }}>
              {line1.split("\n").map((l, i) => <React.Fragment key={i}>{i > 0 && <br />}{l}</React.Fragment>)}
            </span>
            <span style={{ display: "block", fontSize: fs, ...line2Style }}>
              {line2.split("\n").map((l, i) => <React.Fragment key={i}>{i > 0 && <br />}{l}</React.Fragment>)}
            </span>
          </h1>
        </div>
        <OTLLockup variant={pal.lockup} size={size === "9:16" ? 36 : 28} />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// 10. HOOK SLIDE — Carousel slide 1 only
//     Full-bleed photo (required). Contrarian/bold headline.
//     Curiosity gap above headline in accent color.
//     Brand mark top-left always. No explanation.
// ─────────────────────────────────────────────────────────────

function HookSlide({ campaign, photo, headline, curiosity, variant = "a", size = "4:5", accent, headlineFontScale = 1, photoEffect, subheadStyle = "solid" }) {
  const { cls } = SIZES[size];
  const p = pad(size);
  const safe = safeZones(size);

  // At 1080px wide displayed on mobile (~390pt logical), 1px ≈ 0.36pt.
  // Headlines need 130px+ to land at ~47pt on screen — stop-scroll territory.
  // Auto-fit so long single-line headlines don't overflow the reel-safe band.
  const hl = headline || campaign.statement;
  const idealH = size === "9:16" ? 160 : size === "4:5" ? 138 : 118;
  const fsH = autoFitFontSize(hl, safe.contentW, idealH, 0.42, 70) * headlineFontScale;
  // Curiosity text: ~48px ≈ 17pt — minimum legible on mobile
  const fsCuriosity = size === "9:16" ? 38 : size === "4:5" ? 34 : 28;
  const accentColor = accent || ACCENT_SLOTS[0].accent;

  return (
    <div className={`tpl ${cls}`} data-template="hook-slide" data-variant={variant}>
      {(photoEffect === "portrait_blur" || photoEffect === "portrait_bw_blur") ? (
        <PortraitBlurLayer photo={photo} bw={photoEffect === "portrait_bw_blur"} slot="hook" />
      ) : (
        <PhotoLayer photo={photo} overlay={null} placeholderLabel="HOOK PHOTO — REQUIRED" />
      )}
      {/* Heavy bottom fade — ensures white type is always legible */}
      <div style={{
        position: "absolute", inset: 0, zIndex: 1,
        background: "linear-gradient(180deg, rgba(0,0,0,0.08) 0%, rgba(0,0,0,0.15) 30%, rgba(0,0,0,0.92) 100%)"
      }}></div>
      {photoEffect === "vignette" && (
        <div style={{
          position: "absolute", inset: 0, zIndex: 2, pointerEvents: "none",
          background: "radial-gradient(ellipse at 50% 45%, transparent 30%, rgba(0,0,0,0.65) 100%)"
        }} />
      )}
      <div className="tpl-grain"></div>

      {/* Brand mark — top-left, always */}
      <div style={{ position: "absolute", top: p.y, left: p.x, zIndex: 10 }}>
        <OTLLockup variant="white" size={32} />
      </div>

      {/* Headline block — anchored above the IG repost-avatar zone (lower-left)
          and inside the reel-safe horizontal band. */}
      <div style={{
        position: "absolute",
        left: safe.reelX, right: safe.reelX,
        bottom: safe.bottomSafe,
        zIndex: 10,
        display: "flex", flexDirection: "column", gap: 18
      }}>
        {curiosity && (
          <p style={{
            fontFamily: "Inter, Helvetica, sans-serif", fontWeight: 700,
            fontSize: fsCuriosity, letterSpacing: 3, textTransform: "uppercase",
            color: accentColor, margin: 0, lineHeight: 1
          }}>{curiosity}</p>
        )}
        <h1 style={{
          fontFamily: "var(--font-display)", fontWeight: 400,
          fontSize: fsH, lineHeight: 0.9, margin: 0, color: "#fff",
          textTransform: "uppercase"
        }}>
          {hl.split("\n").map((l, i) => {
            if (i === 0) return <React.Fragment key={i}>{l}</React.Fragment>;
            const sw = Math.max(2, Math.round(fsH * 0.028));
            const lineSty = subheadStyle === "stroke"
              ? { WebkitTextStroke: `${sw}px #fff`, color: "transparent" }
              : subheadStyle === "color"
              ? { color: accentColor }
              : {};
            return <React.Fragment key={i}><br /><span style={lineSty}>{l}</span></React.Fragment>;
          })}
        </h1>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// 11. VALUE SLIDE — Carousel slides 2–N
//     Type-dominant only — no photos on value slides (photo budget rule).
//     Four layout options for typographic variety across a carousel.
//
//     layout: "headline" — big centered statement, optional nugget
//     layout: "stat"     — massive number + label + body explanation
//     layout: "list"     — numbered list (2–4 items) with body per item
//     layout: "quote"    — italic pull quote + attribution
//
//     All layouts share the same dark frame: diagonal gradient bg,
//     red left rail, ghost slide number, OTL lockup, badge.
// ─────────────────────────────────────────────────────────────

function ValueSlide({ campaign, photo, headline, body, nugget, slideNum, slideLabel, variant = "b", size = "4:5", accent, headlineFontScale = 1, subheadStyle = "solid", layout = "headline", stat, statLabel, listItems, quote, attribution }) {
  const { cls } = SIZES[size];
  const p = pad(size);
  const safe = safeZones(size);
  const accentColor = accent || ACCENT_SLOTS[0].accent;
  const badge = slideLabel || (slideNum != null ? `${String(slideNum).padStart(2, "0")}` : null);
  const fsNugget = size === "9:16" ? 52 : size === "4:5" ? 46 : 40;
  const slideNumDisplay = slideLabel?.replace(/[^0-9]/g, '') || (slideNum != null ? String(slideNum) : null);

  // ── Shared dark frame ──────────────────────────────────────
  const frame = (
    <React.Fragment>
      <div style={{ position: "absolute", inset: 0, zIndex: 0, background: "linear-gradient(145deg, #0e0e0e 0%, #070707 100%)" }}></div>
      <div style={{ position: "absolute", inset: 0, zIndex: 0, pointerEvents: "none", background: `radial-gradient(ellipse 55% 55% at 0% 100%, ${accentColor}18 0%, transparent 68%)` }}></div>
      <div className="tpl-grain tpl-grain--heavy"></div>
      {/* Ghost slide-number watermark — moved out of the IG audio-mute
          zone (lower-right) to the upper-right so the mute button
          doesn't sit on top of it. */}
      {slideNumDisplay && (
        <div style={{ position: "absolute", right: -15, top: -120, zIndex: 1, fontFamily: "var(--font-display)", fontWeight: 400, fontSize: size === "4:5" ? 560 : 640, lineHeight: 1, color: "rgba(255,255,255,0.055)", userSelect: "none", letterSpacing: -15 }}>{slideNumDisplay}</div>
      )}
      <div style={{ position: "absolute", top: 0, left: 0, bottom: 0, width: 8, background: accentColor, zIndex: 5, boxShadow: `6px 0 32px ${accentColor}55` }}></div>
      <div style={{ position: "absolute", top: p.y, left: safe.reelX, right: safe.reelX, zIndex: 10, display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <OTLLockup variant="white" size={28} />
        {badge && <span style={{ fontFamily: "Inter, Helvetica, sans-serif", fontWeight: 800, fontSize: 11, letterSpacing: 4, textTransform: "uppercase", color: accentColor }}>{badge}</span>}
      </div>
    </React.Fragment>
  );

  // ── layout: stat ──────────────────────────────────────────
  if (layout === "stat") {
    // Auto-fit the giant stat string to the reel-safe band.
    // Long stats like "10,000" at idealStat=480 overflow 760px content
    // width. autoFitFontSize scales font-size down by character count.
    // Bebas Neue digits run ~0.48 em wide (verified via Range measurement
    // on rendered HTML — uppercase letters average ~0.42, but digits
    // and commas push the average up for numeric stats). Floor at 120px
    // stays visually impactful.
    const idealStat   = size === "9:16" ? 520 : size === "4:5" ? 480 : 400;
    const fsStat      = autoFitFontSize(stat || headline || '', safe.contentW, idealStat, 0.48, 120);
    const fsStatLabel = size === "9:16" ? 30  : size === "4:5" ? 26  : 22;
    const fsStatBody  = size === "9:16" ? 46  : size === "4:5" ? 42  : 36;
    return (
      <div className={`tpl ${cls}`} data-template="value-slide" data-layout="stat">
        {frame}
        <div style={{ position: "absolute", left: safe.reelX, right: safe.reelX, zIndex: 10, top: p.y + 100, display: "flex", flexDirection: "column" }}>
          {statLabel && (
            <p style={{ fontFamily: "Inter, Helvetica, sans-serif", fontWeight: 600, fontSize: fsStatLabel, letterSpacing: 5, textTransform: "uppercase", color: "rgba(255,255,255,0.45)", margin: 0, marginBottom: 4 }}>{statLabel}</p>
          )}
          <div style={{ fontFamily: "var(--font-display)", fontWeight: 400, fontSize: fsStat, lineHeight: 0.85, color: "#fff" }}>{stat || headline}</div>
          <div style={{ width: 64, height: 4, background: accentColor, margin: "28px 0 22px" }}></div>
          {body && (
            <p style={{ fontFamily: "Inter, Helvetica, sans-serif", fontWeight: 400, fontSize: fsStatBody, color: "rgba(255,255,255,0.82)", margin: 0, lineHeight: 1.42, maxWidth: "90%" }}>{body}</p>
          )}
        </div>
      </div>
    );
  }

  // ── layout: list ──────────────────────────────────────────
  if (layout === "list") {
    // List title (Inter 800 uppercase) auto-fit so long titles like
    // "WHAT WE'RE ACTUALLY FIGHTING" don't overflow the reel-safe band.
    const idealListTitle = size === "9:16" ? 68 : size === "4:5" ? 60 : 50;
    const fsListTitle    = autoFitFontSize(headline || '', safe.contentW, idealListTitle, 0.62, 32);
    const fsListNum   = size === "9:16" ? 88 : size === "4:5" ? 76 : 64;
    const fsListItem  = size === "9:16" ? 50 : size === "4:5" ? 44 : 38;
    const fsListBody  = size === "9:16" ? 34 : size === "4:5" ? 30 : 26;
    const items = listItems || [];
    return (
      <div className={`tpl ${cls}`} data-template="value-slide" data-layout="list">
        {frame}
        <div style={{ position: "absolute", left: safe.reelX, right: safe.reelX, zIndex: 10, top: p.y + 100, bottom: safe.bottomSafe }}>
          {headline && (
            <h2 style={{ fontFamily: "Inter, Helvetica, sans-serif", fontWeight: 800, fontSize: fsListTitle, lineHeight: 1.0, color: "#fff", textTransform: "uppercase", margin: 0, marginBottom: 32, letterSpacing: -0.5 }}>{headline}</h2>
          )}
          <div style={{ display: "flex", flexDirection: "column" }}>
            {items.map((item, i) => (
              <div key={i} style={{ display: "grid", gridTemplateColumns: `${Math.round(fsListNum * 0.65)}px 1fr`, gap: 18, paddingBottom: 22, marginBottom: 22, borderBottom: i < items.length - 1 ? "1px solid rgba(255,255,255,0.1)" : "none", alignItems: "flex-start" }}>
                <div style={{ fontFamily: "var(--font-display)", fontWeight: 400, fontSize: fsListNum, lineHeight: 0.85, color: accentColor }}>{String(i + 1).padStart(2, "0")}</div>
                <div>
                  <p style={{ fontFamily: "Inter, Helvetica, sans-serif", fontWeight: 700, fontSize: fsListItem, color: "#fff", margin: 0, lineHeight: 1.1, textTransform: "uppercase" }}>{item.text || item}</p>
                  {item.body && <p style={{ fontFamily: "Inter, Helvetica, sans-serif", fontWeight: 400, fontSize: fsListBody, color: "rgba(255,255,255,0.62)", margin: 0, marginTop: 7, lineHeight: 1.38 }}>{item.body}</p>}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // ── layout: quote ─────────────────────────────────────────
  if (layout === "quote") {
    const fsQuoteMark = size === "4:5" ? 220 : 260;
    const fsQuote     = size === "9:16" ? 74 : size === "4:5" ? 66 : 56;
    const fsAttrib    = size === "9:16" ? 28 : size === "4:5" ? 24 : 20;
    return (
      <div className={`tpl ${cls}`} data-template="value-slide" data-layout="quote">
        {frame}
        <div style={{ position: "absolute", left: safe.reelX, right: safe.reelX, zIndex: 10, top: "44%", transform: "translateY(-52%)", display: "flex", flexDirection: "column", gap: 20 }}>
          <div style={{ fontFamily: "var(--font-display)", fontSize: fsQuoteMark, lineHeight: 0.55, color: accentColor, opacity: 0.45, userSelect: "none" }}>"</div>
          <p style={{ fontFamily: "Inter, Helvetica, sans-serif", fontWeight: 500, fontStyle: "italic", fontSize: fsQuote, color: "#fff", margin: 0, lineHeight: 1.32, maxWidth: "94%" }}>{quote || headline}</p>
          {attribution && (
            <div style={{ display: "flex", alignItems: "center", gap: 16, marginTop: 8 }}>
              <div style={{ width: 40, height: 2, background: accentColor }}></div>
              <p style={{ fontFamily: "Inter, Helvetica, sans-serif", fontWeight: 700, fontSize: fsAttrib, letterSpacing: 4, textTransform: "uppercase", color: accentColor, margin: 0 }}>{attribution}</p>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── layout: headline (default) ────────────────────────────
  // Auto-fit display headline to reel-safe band before applying user scale.
  // Catches long single-line statements like "ELITE IS NOT WHAT YOU THINK".
  const idealTypeDom = size === "9:16" ? 138 : size === "4:5" ? 118 : 100;
  const fsTypeDom = autoFitFontSize(headline || campaign.statement || '', safe.contentW, idealTypeDom, 0.42, 60) * headlineFontScale;
  return (
    <div className={`tpl ${cls}`} data-template="value-slide" data-layout="headline">
      {frame}
      <div style={{ position: "absolute", left: safe.reelX, right: safe.reelX, zIndex: 10, top: "44%", transform: "translateY(-50%)", paddingBottom: nugget ? "15%" : 0 }}>
        <h1 style={{ fontFamily: "var(--font-display)", fontWeight: 400, fontSize: fsTypeDom, lineHeight: 0.88, color: "#fff", textTransform: "uppercase", margin: 0 }}>
          {(headline || campaign.statement).split("\n").map((l, i) => {
            if (i === 0) return <React.Fragment key={i}>{l}</React.Fragment>;
            const sw = Math.max(2, Math.round(fsTypeDom * 0.028));
            const effectiveStyle = subheadStyle === "solid" ? "color" : subheadStyle;
            const lineSty = effectiveStyle === "stroke"
              ? { WebkitTextStroke: `${sw}px #fff`, color: "transparent" }
              : effectiveStyle === "color" ? { color: accentColor } : {};
            return <React.Fragment key={i}><br /><span style={lineSty}>{l}</span></React.Fragment>;
          })}
        </h1>
      </div>
      {nugget && (
        <div style={{ position: "absolute", bottom: safe.bottomSafe, left: safe.reelX, right: safe.reelX, zIndex: 10 }}>
          <div style={{ width: 48, height: 3, background: accentColor, marginBottom: 16 }}></div>
          <p style={{ fontFamily: "Inter, Helvetica, sans-serif", fontWeight: 700, fontSize: fsNugget, color: "rgba(255,255,255,0.92)", margin: 0, lineHeight: 1.2, textTransform: "uppercase", letterSpacing: 0.5 }}>{nugget}</p>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// 12. COMPARE SLIDE — before/after, right/wrong split
//     Left panel = wrong/before (red marker). Right panel = right/after (green).
//     No explanation needed — visual contrast does the work.
// ─────────────────────────────────────────────────────────────

function CompareSlide({ campaign, photoLeft, photoRight, labelLeft, labelRight, textLeft, textRight, headline, nugget, variant = "a", size = "4:5", accent }) {
  const { cls } = SIZES[size];
  const p = pad(size);
  const accentColor = accent || ACCENT_SLOTS[0].accent;

  const WRONG = "#C8102E";
  const RIGHT = "#22c55e";

  // All sizes scaled for mobile legibility (1px ≈ 0.36pt on phone)
  const fsLabel = size === "9:16" ? 30 : size === "4:5" ? 26 : 22;
  const fsPanel = size === "9:16" ? 58 : size === "4:5" ? 52 : 44;
  const fsNugget = size === "9:16" ? 52 : size === "4:5" ? 46 : 38;
  const fsHeadline = size === "9:16" ? 72 : size === "4:5" ? 64 : 54;

  const panelBg = "#111111";

  return (
    <div className={`tpl ${cls}`} data-template="compare-slide" data-variant={variant}>
      <div style={{ position: "absolute", inset: 0, background: "#0a0a0a", zIndex: 0 }}></div>
      <div className="tpl-grain tpl-grain--heavy"></div>

      {/* Brand mark top-left */}
      <div style={{ position: "absolute", top: p.y, left: p.x, zIndex: 10 }}>
        <OTLLockup variant="white" size={26} />
      </div>

      {/* Comparison panels — two columns */}
      <div style={{
        position: "absolute",
        top: p.y + 56,
        left: p.x,
        right: p.x,
        bottom: nugget ? p.y + 80 : p.y,
        zIndex: 10,
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gap: 12
      }}>
        {/* LEFT — wrong/before */}
        <div style={{
          background: panelBg, borderRadius: 4,
          overflow: "hidden", position: "relative",
          display: "flex", flexDirection: "column"
        }}>
          {photoLeft ? (
            <div style={{ flex: 1, overflow: "hidden", position: "relative" }}>
              <img src={photoLeft} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.4)" }}></div>
            </div>
          ) : (
            <div style={{
              flex: 1, display: "flex", alignItems: "center", justifyContent: "center",
              padding: "24px 20px"
            }}>
              <p style={{
                fontFamily: "Inter, Helvetica, sans-serif", fontWeight: 500,
                fontSize: fsPanel, color: "rgba(255,255,255,0.85)",
                textAlign: "center", lineHeight: 1.35, margin: 0
              }}>{textLeft || "Before"}</p>
            </div>
          )}
          {/* Wrong marker */}
          <div style={{
            padding: "12px 16px",
            background: "rgba(200,16,46,0.18)",
            borderTop: `2px solid ${WRONG}`,
            display: "flex", alignItems: "center", gap: 8
          }}>
            <span style={{
              width: 22, height: 22, borderRadius: "50%",
              background: WRONG, display: "flex", alignItems: "center", justifyContent: "center",
              fontFamily: "Inter, Helvetica, sans-serif", fontWeight: 800, fontSize: 14, color: "#fff",
              flexShrink: 0
            }}>✕</span>
            <span style={{
              fontFamily: "Inter, Helvetica, sans-serif", fontWeight: 700,
              fontSize: fsLabel, letterSpacing: 2, textTransform: "uppercase",
              color: WRONG
            }}>{labelLeft || "WRONG"}</span>
          </div>
        </div>

        {/* RIGHT — right/after */}
        <div style={{
          background: panelBg, borderRadius: 4,
          overflow: "hidden", position: "relative",
          display: "flex", flexDirection: "column"
        }}>
          {photoRight ? (
            <div style={{ flex: 1, overflow: "hidden", position: "relative" }}>
              <img src={photoRight} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.3)" }}></div>
            </div>
          ) : (
            <div style={{
              flex: 1, display: "flex", alignItems: "center", justifyContent: "center",
              padding: "24px 20px"
            }}>
              <p style={{
                fontFamily: "Inter, Helvetica, sans-serif", fontWeight: 500,
                fontSize: fsPanel, color: "rgba(255,255,255,0.85)",
                textAlign: "center", lineHeight: 1.35, margin: 0
              }}>{textRight || "After"}</p>
            </div>
          )}
          {/* Right marker */}
          <div style={{
            padding: "12px 16px",
            background: "rgba(34,197,94,0.12)",
            borderTop: `2px solid ${RIGHT}`,
            display: "flex", alignItems: "center", gap: 8
          }}>
            <span style={{
              width: 22, height: 22, borderRadius: "50%",
              background: RIGHT, display: "flex", alignItems: "center", justifyContent: "center",
              fontFamily: "Inter, Helvetica, sans-serif", fontWeight: 800, fontSize: 14, color: "#fff",
              flexShrink: 0
            }}>✓</span>
            <span style={{
              fontFamily: "Inter, Helvetica, sans-serif", fontWeight: 700,
              fontSize: fsLabel, letterSpacing: 2, textTransform: "uppercase",
              color: RIGHT
            }}>{labelRight || "RIGHT"}</span>
          </div>
        </div>
      </div>

      {/* Headline / nugget at bottom */}
      {(headline || nugget) && (
        <div style={{
          position: "absolute", bottom: p.y, left: p.x, right: p.x, zIndex: 10
        }}>
          {headline && (
            <h2 style={{
              fontFamily: "var(--font-display)", fontWeight: 400,
              fontSize: fsHeadline, lineHeight: 0.93, color: "#fff",
              textTransform: "uppercase", margin: 0, marginBottom: nugget ? 10 : 0
            }}>
              {headline.split("\n").map((l, i) =>
                <React.Fragment key={i}>{i > 0 && <br />}{l}</React.Fragment>
              )}
            </h2>
          )}
          {nugget && (
            <>
              <div style={{ width: 32, height: 2, background: accentColor, marginBottom: 8 }}></div>
              <p style={{
                fontFamily: "Inter, Helvetica, sans-serif", fontWeight: 700,
                fontSize: fsNugget, color: accentColor, margin: 0,
                textTransform: "uppercase", letterSpacing: 0.5
              }}>{nugget}</p>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// 13. CAROUSEL CTA SLIDE — always the last slide in a carousel
//     ALWAYS has a photo. FOLLOW FOR MORE + one CTA action.
//     Templated — same structure every carousel.
// ─────────────────────────────────────────────────────────────

function CarouselCTA({ campaign, photo, headline, subhead, variant = "a", size = "4:5", accent, headlineFontScale = 1, cta, photoEffect }) {
  const { cls } = SIZES[size];
  const p = pad(size);
  const safe = safeZones(size);
  const accentColor = accent || ACCENT_SLOTS[0].accent;
  const ctaAction = cta?.action || "Book a Free Intro";
  const ctaDetail = cta?.detail || "Link in bio · @crossfitotl";
  const hook      = headline   || "WANT IN?";

  const fsFollow  = size === "9:16" ? 110 : size === "4:5" ? 96  : 80;
  const fsHandle  = size === "9:16" ? 38  : size === "4:5" ? 32  : 26;
  const fsSave    = size === "9:16" ? 26  : size === "4:5" ? 22  : 18;
  const fsAction  = size === "9:16" ? 28  : size === "4:5" ? 24  : 20;

  return (
    <div className={`tpl ${cls}`} data-template="carousel-cta" data-variant={variant}>
      {/* Photo — always required */}
      {(photoEffect === "portrait_blur" || photoEffect === "portrait_bw_blur") ? (
        <PortraitBlurLayer photo={photo} bw={photoEffect === "portrait_bw_blur"} slot="hook" />
      ) : (
        <PhotoLayer photo={photo} overlay={null} placeholderLabel="CTA PHOTO — REQUIRED" />
      )}
      <div style={{
        position: "absolute", inset: 0, zIndex: 1,
        background: "linear-gradient(180deg, rgba(0,0,0,0.08) 0%, rgba(0,0,0,0.72) 60%, rgba(0,0,0,0.96) 100%)"
      }}></div>
      {photoEffect === "vignette" && (
        <div style={{
          position: "absolute", inset: 0, zIndex: 2, pointerEvents: "none",
          background: "radial-gradient(ellipse at 50% 45%, transparent 30%, rgba(0,0,0,0.65) 100%)"
        }} />
      )}
      <div className="tpl-grain"></div>

      {/* Brand mark — top-left */}
      <div style={{ position: "absolute", top: p.y, left: p.x, zIndex: 10 }}>
        <OTLLockup variant="white" size={28} />
      </div>

      {/* FOLLOW FOR MORE block — anchored above the IG repost-avatar zone
          (lower-left) and inside the reel-safe horizontal band. */}
      <div style={{
        position: "absolute",
        bottom: safe.bottomSafe,
        left: safe.reelX, right: safe.reelX,
        zIndex: 10,
        display: "flex", flexDirection: "column", gap: 20
      }}>
        {/* FOLLOW FOR MORE */}
        <div>
          <p style={{
            fontFamily: "Inter, Helvetica, sans-serif", fontWeight: 700,
            fontSize: fsSave, letterSpacing: 4, textTransform: "uppercase",
            color: accentColor, margin: 0, marginBottom: 4
          }}>FOLLOW FOR MORE</p>
          <h2 style={{
            fontFamily: "var(--font-display)", fontWeight: 400,
            fontSize: fsFollow, lineHeight: 0.9, color: "#fff",
            textTransform: "uppercase", margin: 0
          }}>@CROSSFITOTL</h2>
          <p style={{
            fontFamily: "Inter, Helvetica, sans-serif", fontWeight: 500,
            fontSize: fsHandle, letterSpacing: 1.5, textTransform: "uppercase",
            color: "rgba(255,255,255,0.55)", margin: 0, marginTop: 4
          }}>North Richland Hills, TX</p>
        </div>

        {/* Divider */}
        <div style={{ width: "100%", height: 1, background: "rgba(255,255,255,0.15)" }}></div>

        {/* CTA action */}
        <div style={{ display: "flex", justifyContent: "center", alignItems: "center" }}>
          <div style={{
            display: "inline-flex", padding: "10px 18px",
            background: accentColor,
            fontFamily: "Inter, Helvetica, sans-serif", fontWeight: 700,
            fontSize: fsAction, letterSpacing: 2, textTransform: "uppercase", color: "#fff"
          }}>{ctaAction}</div>
        </div>

        {/* Detail line */}
        <p style={{
          fontFamily: "Inter, Helvetica, sans-serif", fontWeight: 500,
          fontSize: fsSave, letterSpacing: 2, textTransform: "uppercase",
          color: "rgba(255,255,255,0.45)", margin: 0, textAlign: "center"
        }}>{ctaDetail}</p>
      </div>
    </div>
  );
}

// Export
window.OTL_TEMPLATES = {
  ArticleCover, BoldStatement, CoachCard, MemberSpotlight, ScheduleEvent, HeroWODPoster, ProgramCard, CTASlide, SplashSlide,
  HookSlide, ValueSlide, CompareSlide, CarouselCTA,
  SIZES
};
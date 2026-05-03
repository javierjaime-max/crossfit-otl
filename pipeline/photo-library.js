// photo-library.js — Query Cloudinary library for the right photo per post
// Returns a public HTTPS URL that Puppeteer can load directly.
// Falls back to local static pool if Cloudinary returns nothing.

import { v2 as cloudinary } from 'cloudinary';

const FOLDER = 'crossfit-otl/library';

const LOCAL_FALLBACK = {
  workout:   'assets/photos/training-crossfit.jpg',
  community: 'assets/photos/community.jpg',
  coaching:  'assets/photos/built-different.jpg',
  event:     'assets/photos/murph-group.jpg',
  kids:      'assets/photos/youth.jpg',
  lifestyle: 'assets/photos/lifestyle.jpg',
  default:   'assets/photos/training-crossfit.jpg',
};

export function configureCloudinary(env) {
  cloudinary.config({
    cloud_name: env.CLOUDINARY_CLOUD_NAME,
    api_key:    env.CLOUDINARY_API_KEY,
    api_secret: env.CLOUDINARY_API_SECRET,
  });
}

// Map post content keywords → Cloudinary tag search
// Returns [primaryTag, ...fallbackTags] — tried in order until a result is found
function contentToTagChain(headline, theme, campaign) {
  const text = [headline, theme, campaign?.statement, campaign?.pull]
    .filter(Boolean).join(' ').toLowerCase();

  // Specific movement/equipment tags first, theme fallback last
  if (/murph|memorial|hero|vest|honor/.test(text))   return ['murph', 'team', 'event'];
  if (/pull.?up|gymnastics|ring/.test(text))          return ['pull-ups', 'intensity'];
  if (/barbell|squat|clean|snatch|lift/.test(text))   return ['barbell', 'intensity'];
  if (/kettlebell|kb/.test(text))                     return ['kettlebell', 'intensity'];
  if (/row|erg/.test(text))                           return ['rowing', 'intensity'];
  if (/rope/.test(text))                              return ['rope-climb', 'intensity'];
  if (/run|sprint|mile/.test(text))                   return ['running', 'intensity'];
  if (/kids|youth|teen|children/.test(text))          return ['kids-class'];
  if (/coach|teach|technique/.test(text))             return ['coach', 'intensity'];
  if (/community|together|family|people/.test(text))  return ['group', 'community'];
  if (/celebrat|finish|done|pr|record/.test(text))    return ['celebration', 'group'];

  // Theme-based fallback chain
  if (theme === 'community')  return ['group', 'community', 'intensity'];
  if (theme === 'coaching')   return ['coach', 'intensity'];
  if (theme === 'event')      return ['team', 'group'];
  if (theme === 'kids')       return ['kids-class'];

  // Default: intensity — any hard-effort shot
  return ['intensity', 'barbell', 'group'];
}

// Cloudinary photo effect system
// Each effect is a transformation chain inserted into the delivery URL.
// Crop is always applied first (before effects) to bound the image size.
//
// slot: 'hook' | 'cta' = full frame (1080×1350), 'value' = top half (1080×675)
// effect: one of the EFFECTS keys below, or null for default (smart crop only)

const CROP = {
  value: 'c_fill,g_auto:subject,w_1080,h_675',
  hook:  'c_fill,g_auto:subject,w_1080,h_1350',
  cta:   'c_fill,g_auto:subject,w_1080,h_1350',
};

export const PHOTO_EFFECTS = {
  // Default — smart crop, no post-processing
  none: null,

  // Portrait mode — CSS-based in templates (two-layer: blurred bg + radial-masked sharp fg)
  // No Cloudinary background removal needed.
  portrait_blur: null,

  // Subject on solid black — punchy, graphic
  portrait_black: 'e_background_removal/b_black',

  // Subject on solid white — clean editorial
  portrait_white: 'e_background_removal/b_white',

  // Subject sharp + background B&W + blurred — CSS-based in templates (two-layer: bw+blurred bg, sharp fg)
  portrait_bw_blur: null,

  // Full black and white
  black_and_white: 'e_grayscale',

  // Dramatic editorial — muted, high contrast, slightly desaturated
  dramatic: 'e_improve:outdoor/e_contrast:25/e_saturation:-35/e_brightness:-10',

  // Art filter: incognito — classic high-contrast B&W with film grain feel
  art_noir: 'e_art:incognito',

  // Art filter: eucalyptus — soft, muted, natural tones
  art_muted: 'e_art:eucalyptus',

  // Art filter: daguerre — vintage daguerreotype
  art_vintage: 'e_art:daguerre',

  // Vignette — rendered as a CSS radial-gradient overlay in templates, not a Cloudinary effect.
  // null here means only the crop transform is applied; the template handles the visual.
  vignette: null,

  // Remove background — transparent PNG (subject only, no background)
  remove_bg: 'e_background_removal',
};

export function buildPhotoUrl(rawUrl, slot = 'value', effect = 'none') {
  if (!rawUrl || !rawUrl.includes('/upload/')) return rawUrl;

  const crop = CROP[slot] || CROP.value;

  const fx = PHOTO_EFFECTS[effect] || null;

  // Chain: crop first → effect after
  const chain = [crop, fx].filter(Boolean).join('/');
  return rawUrl.replace('/upload/', `/upload/${chain}/`);
}

// Pick a photo not already used in this post/session
function pickUnused(resources, usedUrls) {
  if (!resources?.length) return null;
  const unused = resources.filter(r => !usedUrls.has(r.secure_url));
  if (unused.length) return unused[Math.floor(Math.random() * unused.length)];
  // All results already used — fall back to any random result
  return resources[Math.floor(Math.random() * resources.length)];
}

export async function getPhotoForSlide({ headline, theme, campaign, minQuality = 3, usedUrls = new Set(), slot = 'value', effect = 'none' }) {
  try {
    const tagChain = contentToTagChain(headline, theme, campaign);

    for (const tag of tagChain) {
      const result = await cloudinary.search
        .expression(`folder:${FOLDER} AND tags=${tag}`)
        .with_field('tags')
        .max_results(50)
        .execute();

      // Filter by quality
      const qualified = (result.resources || []).filter(r => {
        const qtag = r.tags?.find(t => t.startsWith('quality:'));
        if (!qtag) return false;
        const q = parseInt(qtag.split(':')[1]);
        return q >= minQuality;
      });

      const photo = pickUnused(qualified, usedUrls);
      if (photo) {
        usedUrls.add(photo.secure_url);
        return buildPhotoUrl(photo.secure_url, slot, effect);
      }
    }

    // Broader fallback: any photo tagged with the theme
    const fallbackResult = await cloudinary.search
      .expression(`folder:${FOLDER} AND tags=theme\\:${theme || 'workout'}`)
      .max_results(50)
      .execute();

    const fallback = pickUnused(fallbackResult.resources || [], usedUrls);
    if (fallback) {
      usedUrls.add(fallback.secure_url);
      return buildPhotoUrl(fallback.secure_url, slot, effect);
    }

    // Last resort: any photo in the library at all
    const anyResult = await cloudinary.search
      .expression(`folder:${FOLDER}`)
      .max_results(50)
      .execute();

    const any = pickUnused(anyResult.resources || [], usedUrls);
    if (any) {
      usedUrls.add(any.secure_url);
      return buildPhotoUrl(any.secure_url, slot, effect);
    }

  } catch (e) {
    process.stderr.write(`  ⚠️  Cloudinary photo lookup failed: ${e.message}\n`);
  }

  // Local static fallback
  return LOCAL_FALLBACK[theme] || LOCAL_FALLBACK.default;
}

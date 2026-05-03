// image-gen.js — Automated image generation for carousel hook slides
// Uses Google Imagen 3 via Gemini API. Called by generate.js during post creation.
// Requires GEMINI_API_KEY in pipeline/.env
//
// How it works:
//   1. generate.js calls generateHookImage(slideContext, postDir) for HookSlide/ArticleCover
//   2. This builds a targeted Imagen prompt from the slide's content
//   3. Imagen 3 returns a base64 PNG
//   4. We save it to assets/photos/generated/<slug>.png
//   5. generate.js patches slides.json to use the generated file path

import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const IMAGEN_MODEL = 'imagen-3.0-generate-002';
const GENERATED_DIR = resolve(__dirname, 'assets/photos/generated');

// Visual style anchors for CrossFit OTL brand
const STYLE_ANCHOR = [
  'cinematic photography',
  'dramatic studio lighting',
  'high contrast',
  'dark moody atmosphere',
  'photorealistic',
  'professional editorial style',
  'no text',
  'no watermark',
  'no logos',
  '4:5 vertical format',
].join(', ');

// Maps headline content to a visual concept Imagen can render well
function buildImagenPrompt(headline, subhead, campaign) {
  const text = [headline, subhead, campaign?.statement, campaign?.pull]
    .filter(Boolean).join(' ').toLowerCase();

  // CrossFit movement shots
  if (/pull.up|pullup|rope|bar/.test(text)) {
    return `Male CrossFit athlete doing pull-ups on a barbell rig inside a CrossFit gym, chalk on hands, intense focus, muscles defined, dramatic side lighting, dark background, ${STYLE_ANCHOR}`;
  }
  if (/squat|clean|snatch|barbell|olympic/.test(text)) {
    return `CrossFit athlete mid-lift with a heavy barbell, clean and jerk or squat, Olympic lifting shoes, concentrated expression, gym chalk dust in air, dramatic upward lighting, dark gym background, ${STYLE_ANCHOR}`;
  }
  if (/run|mile|sprint|cardio/.test(text)) {
    return `CrossFit athlete running at dawn, stadium or track setting, motion blur on feet, determined expression, golden hour sidelight, dramatic sky, ${STYLE_ANCHOR}`;
  }
  if (/row|rowing|erg/.test(text)) {
    return `CrossFit athlete on a Concept2 rowing machine, full effort, sweat visible, gym environment, dramatic front lighting, dark gym, ${STYLE_ANCHOR}`;
  }

  // Community / people themes
  if (/community|together|group|family|people|together/.test(text)) {
    return `Group of diverse CrossFit athletes celebrating after a hard workout, high fives and smiles, CrossFit gym interior, warm dramatic lighting, genuine emotion, ${STYLE_ANCHOR}`;
  }
  if (/coach|coaching|teach|learn/.test(text)) {
    return `CrossFit coach demonstrating movement technique to an athlete, focused coaching moment, CrossFit gym, natural instructional lighting, trust and attention visible, ${STYLE_ANCHOR}`;
  }
  if (/member|woman|female/.test(text)) {
    return `Female CrossFit athlete mid-workout, powerful and determined expression, gym environment, dramatic lighting, strength and confidence, ${STYLE_ANCHOR}`;
  }

  // Challenge / hard work themes
  if (/quit|hard|suffer|tough|grit|mental/.test(text)) {
    return `CrossFit athlete at the end of a brutal workout, hands on knees, gasping, chalk on hands, gym floor, dramatic low lighting, raw human effort, ${STYLE_ANCHOR}`;
  }
  if (/murph|memorial|hero|honor/.test(text)) {
    return `CrossFit athlete wearing a weight vest doing pull-ups, Memorial Day Murph workout, American flag background blur, determined face, dramatic lighting, patriotic atmosphere, ${STYLE_ANCHOR}`;
  }
  if (/shirt|merch|gear|wear/.test(text)) {
    return `CrossFit athlete wearing a bold athletic t-shirt, gym setting, dramatic product-style photography, dark background, strong lighting from left, ${STYLE_ANCHOR}`;
  }

  // Mindset / results themes
  if (/result|transform|before|after|change|body/.test(text)) {
    return `Side profile of a fit CrossFit athlete in athletic wear, confident posture, gym environment, dramatic rim lighting, strong silhouette, ${STYLE_ANCHOR}`;
  }
  if (/kids|youth|teen|children/.test(text)) {
    return `Young athletes doing CrossFit Kids class, energetic movement, colorful gym equipment, bright coaching environment, joyful and active, ${STYLE_ANCHOR}`;
  }

  // Default: dramatic CrossFit action shot
  return `Dramatic CrossFit athlete mid-workout at a CrossFit gym, intense effort and focus, sweat and chalk, dynamic action pose, dark gym interior, dramatic directional lighting, cinematic composition, ${STYLE_ANCHOR}`;
}

// Call Google Imagen 3 API
async function callImagen(prompt) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY not set in .env');

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${IMAGEN_MODEL}:predict?key=${apiKey}`;

  const body = {
    instances: [{ prompt }],
    parameters: {
      sampleCount: 1,
      aspectRatio: '4:5',
      safetyFilterLevel: 'block_only_high',
      personGeneration: 'allow_adult',
    },
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Imagen API error ${res.status}: ${err}`);
  }

  const data = await res.json();
  const b64 = data?.predictions?.[0]?.bytesBase64Encoded;
  if (!b64) throw new Error('No image in Imagen response: ' + JSON.stringify(data));
  return b64;
}

// Main export: generate an image for a hook slide, save to disk, return relative path
export async function generateHookImage({ headline, subhead, campaign, slug }) {
  if (!process.env.GEMINI_API_KEY) {
    process.stdout.write('  ⚠️  No GEMINI_API_KEY — skipping image generation, using photo pool\n');
    return null;
  }

  mkdirSync(GENERATED_DIR, { recursive: true });

  const prompt = buildImagenPrompt(headline, subhead, campaign);
  process.stdout.write(`  🎨 Generating hook image via Imagen 3...\n`);
  process.stdout.write(`     Prompt: ${prompt.slice(0, 80)}...\n`);

  const b64 = await callImagen(prompt);
  const fileName = `${slug}-hook.png`;
  const absPath = resolve(GENERATED_DIR, fileName);
  writeFileSync(absPath, Buffer.from(b64, 'base64'));
  process.stdout.write(`  ✓ Image saved: assets/photos/generated/${fileName}\n`);

  // Return relative path from pipeline/ dir (same convention as existing photo pool)
  return `assets/photos/generated/${fileName}`;
}

// Also export the prompt builder so generate.js can log it
export { buildImagenPrompt };

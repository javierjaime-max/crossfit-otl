/**
 * CrossFit OTL — Post carousel to Instagram via Meta Graph API
 *
 * Flow:
 *   1. Upload slide PNGs to Cloudinary (public URLs required by Meta API)
 *   2. Create image containers via Meta Graph API
 *   3. Create carousel container
 *   4. Publish
 *
 * Required .env vars:
 *   META_ACCESS_TOKEN   — User token with instagram_content_publish scope
 *   OTL_IG_USER_ID      — OTL Instagram Business Account ID (17841448179180217)
 *   CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET
 */

import { v2 as cloudinary } from 'cloudinary';
import 'dotenv/config';

const IG_USER_ID      = process.env.OTL_IG_USER_ID || '17841448179180217';
const META_ACCESS_TOKEN = process.env.META_ACCESS_TOKEN;
const GRAPH_BASE      = 'https://graph.facebook.com/v19.0';

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// ── Cloudinary ─────────────────────────────────────────────────

async function uploadToCloudinary(filePath, publicId) {
  const result = await cloudinary.uploader.upload(filePath, {
    public_id:     publicId,
    folder:        'otl_ig',
    overwrite:     true,
    resource_type: 'image',
  });
  return result.secure_url;
}

// ── Meta Graph API ─────────────────────────────────────────────

async function graphPost(path, params) {
  params.access_token = META_ACCESS_TOKEN;
  const res = await fetch(`${GRAPH_BASE}/${path}`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    new URLSearchParams(params).toString(),
  });
  const data = await res.json();
  if (data.error) throw new Error(`Graph API error: ${JSON.stringify(data.error)}`);
  return data;
}

// ── Main export ────────────────────────────────────────────────

export async function postToInstagram({ slidePaths, caption, onProgress }) {
  const log = onProgress || console.log;

  if (!META_ACCESS_TOKEN) throw new Error('META_ACCESS_TOKEN not set in .env');
  if (!process.env.CLOUDINARY_CLOUD_NAME) throw new Error('CLOUDINARY_CLOUD_NAME not set in .env');

  const timestamp = Date.now();

  // Step 1 — Upload to Cloudinary
  log(`Uploading ${slidePaths.length} slide(s) to Cloudinary…`);
  const imageUrls = [];
  for (let i = 0; i < slidePaths.length; i++) {
    const publicId = `otl_${timestamp}_slide_${i + 1}`;
    const url = await uploadToCloudinary(slidePaths[i], publicId);
    imageUrls.push(url);
    log(`  ✓ Slide ${i + 1}/${slidePaths.length} uploaded`);
  }

  const isSingle = slidePaths.length === 1;

  if (isSingle) {
    // Single image post
    log('Creating single image container…');
    const container = await graphPost(`${IG_USER_ID}/media`, {
      image_url: imageUrls[0],
      caption,
    });
    log(`  ✓ Container: ${container.id}`);

    log('Waiting for container to be ready…');
    await new Promise(r => setTimeout(r, 5000));

    log('Publishing…');
    const published = await graphPost(`${IG_USER_ID}/media_publish`, {
      creation_id: container.id,
    });
    log(`✓ Posted! Instagram ID: ${published.id}`);
    return { postId: published.id, imageUrls };

  } else {
    // Carousel post
    log('Creating carousel item containers…');
    const containerIds = [];
    for (let i = 0; i < imageUrls.length; i++) {
      const data = await graphPost(`${IG_USER_ID}/media`, {
        image_url:        imageUrls[i],
        is_carousel_item: 'true',
      });
      containerIds.push(data.id);
      log(`  ✓ Container ${i + 1}: ${data.id}`);
    }

    log('Creating carousel container…');
    const carousel = await graphPost(`${IG_USER_ID}/media`, {
      media_type: 'CAROUSEL',
      caption,
      children:   containerIds.join(','),
    });
    log(`  ✓ Carousel: ${carousel.id}`);

    log('Waiting for containers to be ready…');
    await new Promise(r => setTimeout(r, 8000));

    log('Publishing…');
    const published = await graphPost(`${IG_USER_ID}/media_publish`, {
      creation_id: carousel.id,
    });
    log(`✓ Posted! Instagram ID: ${published.id}`);
    return { postId: published.id, imageUrls };
  }
}

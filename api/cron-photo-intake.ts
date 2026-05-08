/**
 * CrossFit OTL — photo intake (Vercel serverless function)
 *
 * Replaces the legacy launchd job on the Mac mini (com.otl.intake.plist).
 *
 * Pipeline:
 *   iCloud Shared Album  →  Claude Haiku Vision triage  →  Cloudinary library
 *
 * Stateless: dedup is Cloudinary-as-source-of-truth. Each iCloud photo's GUID
 * maps deterministically to a Cloudinary public_id (`crossfit-otl/library/otl_*`);
 * any existing match is skipped. New photos are downloaded, triaged with Claude
 * Haiku Vision, and (if quality >= MIN_QUALITY) uploaded to Cloudinary with the
 * same tag/context schema as the legacy pipeline/intake.js.
 *
 * No npm SDKs — talks to Anthropic and Cloudinary over plain HTTPS to keep
 * the project's dependency surface minimal (matches publish-scheduled-otl.ts).
 *
 * Required env vars (Production target on Vercel):
 *   ICLOUD_ALBUM_TOKEN
 *   ANTHROPIC_API_KEY
 *   CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET
 *   CRON_SECRET  (Bearer-token auth on this route)
 *
 * Invocation:
 *   curl -H "Authorization: Bearer $CRON_SECRET" \
 *        https://crossfit-otl.com/api/cron-photo-intake
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createHash } from "node:crypto";

// Vercel Hobby plan caps serverless functions at 60s
export const config = { maxDuration: 60 };

// ── Tuning ─────────────────────────────────────────────────────

const CLOUDINARY_FOLDER = "crossfit-otl/library";
const PUBLIC_ID_PREFIX = "otl_";
const MIN_QUALITY = 3;
const MAX_PER_RUN = 20; // tight cap to stay under 60s wall clock

// ── iCloud Shared Album ────────────────────────────────────────

const ICLOUD_BASE = "sharedstreams.icloud.com";

interface ICloudPhoto {
  photoGuid: string;
  derivatives?: Record<string, {
    checksum?: string;
    fileSize?: string | number;
    width?: string | number;
    height?: string | number;
  }>;
}

interface ICloudStreamResponse {
  photos?: ICloudPhoto[];
  "X-Apple-MMe-Host"?: string;
}

interface ICloudAssetUrlResponse {
  items: Record<string, { url_path: string; url_location: string; url_expiry: string }>;
  locations: Record<string, { scheme: string; hosts: string[] }>;
}

async function fetchStream(host: string, albumToken: string): Promise<{ data: ICloudStreamResponse; host: string }> {
  const url = `https://${host}/${albumToken}/sharedstreams/webstream`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "https://www.icloud.com" },
    body: JSON.stringify({ streamCtag: null }),
  });

  // iCloud returns 330 if you hit the wrong datacenter — follow the redirect
  if (res.status === 330) {
    const data = (await res.json()) as ICloudStreamResponse;
    const redirect = data["X-Apple-MMe-Host"];
    if (!redirect) throw new Error("330 redirect but no X-Apple-MMe-Host in response");
    return fetchStream(redirect, albumToken);
  }

  if (!res.ok) throw new Error(`iCloud stream error ${res.status}: ${await res.text()}`);
  return { data: (await res.json()) as ICloudStreamResponse, host };
}

async function fetchAssetUrls(host: string, albumToken: string, guids: string[]): Promise<ICloudAssetUrlResponse> {
  const url = `https://${host}/${albumToken}/sharedstreams/webasseturls`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "https://www.icloud.com" },
    body: JSON.stringify({ photoGuids: guids }),
  });
  if (!res.ok) throw new Error(`iCloud asset URL error ${res.status}: ${await res.text()}`);
  return (await res.json()) as ICloudAssetUrlResponse;
}

function bestDerivative(derivatives: ICloudPhoto["derivatives"]) {
  if (!derivatives) return null;
  const numericKeys = Object.keys(derivatives)
    .map(Number)
    .filter((n) => !Number.isNaN(n))
    .sort((a, b) => b - a);
  if (numericKeys.length) return derivatives[String(numericKeys[0])];
  return Object.values(derivatives).sort(
    (a, b) => Number(b.fileSize ?? 0) - Number(a.fileSize ?? 0)
  )[0];
}

function resolveDownloadUrl(
  derivative: ReturnType<typeof bestDerivative>,
  items: ICloudAssetUrlResponse["items"],
  locations: ICloudAssetUrlResponse["locations"]
): string | null {
  if (!derivative?.checksum) return null;
  const item = items[derivative.checksum];
  if (!item) return null;
  const loc = locations[item.url_location];
  if (!loc) return null;
  return `${loc.scheme}://${item.url_location}${item.url_path}`;
}

async function downloadPhoto(url: string): Promise<{ buffer: Buffer; mimeType: "image/jpeg" | "image/png" }> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed: ${res.status}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  const lower = url.toLowerCase();
  const mimeType: "image/jpeg" | "image/png" = lower.includes(".png") ? "image/png" : "image/jpeg";
  return { buffer, mimeType };
}

// ── Public-ID derivation (matches pipeline/intake.js) ─────────

function publicIdFromGuid(guid: string): string {
  return `${PUBLIC_ID_PREFIX}${guid.replace(/[^a-z0-9]/gi, "_").slice(0, 40)}`;
}

// ── Cloudinary REST (no SDK) ──────────────────────────────────

interface CloudinaryConfig {
  cloudName: string;
  apiKey: string;
  apiSecret: string;
}

interface CloudinaryResource {
  public_id: string;
  secure_url?: string;
}

interface CloudinaryListResponse {
  resources: CloudinaryResource[];
  next_cursor?: string;
}

async function listCloudinaryPublicIds(cfg: CloudinaryConfig): Promise<Set<string>> {
  const ids = new Set<string>();
  const auth = "Basic " + Buffer.from(`${cfg.apiKey}:${cfg.apiSecret}`).toString("base64");
  let cursor: string | undefined;
  do {
    const params = new URLSearchParams({
      type: "upload",
      prefix: `${CLOUDINARY_FOLDER}/${PUBLIC_ID_PREFIX}`,
      max_results: "500",
    });
    if (cursor) params.set("next_cursor", cursor);

    const url = `https://api.cloudinary.com/v1_1/${cfg.cloudName}/resources/image?${params}`;
    const res = await fetch(url, { headers: { Authorization: auth } });
    if (!res.ok) throw new Error(`Cloudinary list ${res.status}: ${await res.text()}`);
    const json = (await res.json()) as CloudinaryListResponse;

    for (const r of json.resources) {
      const id = r.public_id.startsWith(`${CLOUDINARY_FOLDER}/`)
        ? r.public_id.slice(CLOUDINARY_FOLDER.length + 1)
        : r.public_id;
      ids.add(id);
    }
    cursor = json.next_cursor;
  } while (cursor);
  return ids;
}

interface UploadMeta {
  guid: string;
  publicId: string;
  theme: string;
  tags: string[];
  mood: string;
  quality: number;
  description: string;
}

interface CloudinaryUploadResponse {
  secure_url: string;
  public_id: string;
}

// Computes Cloudinary's signed-upload signature: SHA-1 of (alphabetized k=v joined by &) + api_secret
function signParams(params: Record<string, string>, apiSecret: string): string {
  const ordered = Object.keys(params)
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join("&");
  return createHash("sha1").update(ordered + apiSecret).digest("hex");
}

async function uploadToCloudinary(
  cfg: CloudinaryConfig,
  imageBuffer: Buffer,
  mimeType: string,
  meta: UploadMeta
): Promise<CloudinaryUploadResponse> {
  const allTags = [
    `theme:${meta.theme}`,
    `mood:${meta.mood}`,
    `quality:${meta.quality}`,
    "source:icloud-album",
    ...meta.tags.map((t) => t.replace(/\s+/g, "-")),
  ];

  // Cloudinary expects context as `key=value|key=value` and tags comma-separated
  const contextStr = [
    `theme=${meta.theme}`,
    `mood=${meta.mood}`,
    `quality=${meta.quality}`,
    `description=${meta.description.replace(/[|=]/g, " ")}`,
    `source=icloud-album`,
    `icloud_guid=${meta.guid}`,
  ].join("|");

  const tagsStr = allTags.join(",");
  const timestamp = Math.floor(Date.now() / 1000).toString();

  // Params that must be signed (everything except file, api_key, signature, resource_type, file_type)
  const signed: Record<string, string> = {
    context: contextStr,
    folder: CLOUDINARY_FOLDER,
    overwrite: "false",
    public_id: meta.publicId,
    tags: tagsStr,
    timestamp,
  };
  const signature = signParams(signed, cfg.apiSecret);

  const form = new FormData();
  for (const [k, v] of Object.entries(signed)) form.append(k, v);
  form.append("api_key", cfg.apiKey);
  form.append("signature", signature);
  // Buffer's TS type carries `ArrayBufferLike` which BlobPart rejects under strict TS;
  // copy into a plain Uint8Array (with a real ArrayBuffer) before handing to Blob.
  const u8 = new Uint8Array(imageBuffer.byteLength);
  u8.set(imageBuffer);
  form.append("file", new Blob([u8], { type: mimeType }), `${meta.publicId}.${mimeType === "image/png" ? "png" : "jpg"}`);

  const url = `https://api.cloudinary.com/v1_1/${cfg.cloudName}/image/upload`;
  const res = await fetch(url, { method: "POST", body: form });
  if (!res.ok) throw new Error(`Cloudinary upload ${res.status}: ${await res.text()}`);
  return (await res.json()) as CloudinaryUploadResponse;
}

// ── Anthropic Messages API (no SDK) ───────────────────────────

const TRIAGE_PROMPT = `You are triaging photos for use in CrossFit OTL's Instagram carousels.
CrossFit OTL is a CrossFit affiliate gym in North Richland Hills, TX.

Evaluate this photo for Instagram carousel use. Return JSON only — no markdown, no explanation.

{
  "quality": <1-5>,
  "theme": "<workout|community|coaching|event|kids|lifestyle|other>",
  "tags": ["<specific tags — use any that apply: barbell, pull-ups, kettlebell, running, box-jump, rope-climb, rowing, group, celebration, coach, intensity, sweat, chalk, kids-class, team, murph, competition, outdoor, indoor, whiteboard>"],
  "mood": "<intense|joyful|determined|focused|celebratory|candid|instructional>",
  "description": "<one sentence — what is literally happening in this photo>",
  "reject_reason": "<only include if quality < 3 — why it fails: blurry, too dark, poor composition, not gym-related, personal/sensitive, etc.>"
}

Quality rubric:
5 — Excellent. Sharp, well-lit, compelling composition, strong emotional moment or action. Stop-scroll worthy.
4 — Good. Sharp, adequately lit, useful subject. Minor composition issues.
3 — Usable. Acceptable for carousel slide 2-3 but not ideal for a hook slide.
2 — Marginal. Blurry, dark, awkward crop, or not clearly CrossFit-related. Skip.
1 — Reject. Unusable: completely out of focus, accidental shot, contains sensitive content, or unrelated to CrossFit OTL.`;

interface TriageResult {
  quality: number;
  theme: string;
  tags?: string[];
  mood?: string;
  description?: string;
  reject_reason?: string;
}

interface AnthropicMessagesResponse {
  content: Array<{ type: string; text?: string }>;
}

async function triagePhoto(
  apiKey: string,
  imageBuffer: Buffer,
  mimeType: "image/jpeg" | "image/png"
): Promise<TriageResult> {
  const b64 = imageBuffer.toString("base64");
  const body = {
    model: "claude-haiku-4-5-20251001",
    max_tokens: 400,
    messages: [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mimeType, data: b64 } },
          { type: "text", text: TRIAGE_PROMPT },
        ],
      },
    ],
  };

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${await res.text()}`);

  const json = (await res.json()) as AnthropicMessagesResponse;
  const block = json.content.find((c) => c.type === "text");
  if (!block?.text) throw new Error("No text block in Anthropic response");
  const raw = block.text.trim();
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1) throw new Error("No JSON in triage response: " + raw.slice(0, 100));
  return JSON.parse(raw.slice(start, end + 1)) as TriageResult;
}

// ── Handler ───────────────────────────────────────────────────

interface IntakeResult {
  guid: string;
  status: "uploaded" | "skipped_quality" | "skipped_existing" | "error";
  quality?: number;
  theme?: string;
  reason?: string;
  cloudinary_url?: string;
  error?: string;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Auth — accept Bearer header or ?token= query param
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const authHeader = req.headers["authorization"];
    const queryToken = req.query["token"];
    if (authHeader !== `Bearer ${cronSecret}` && queryToken !== cronSecret) {
      return res.status(401).json({ error: "Unauthorized" });
    }
  }

  const albumToken = process.env.ICLOUD_ALBUM_TOKEN;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const cloudKey = process.env.CLOUDINARY_API_KEY;
  const cloudSecret = process.env.CLOUDINARY_API_SECRET;

  if (!albumToken || !anthropicKey || !cloudName || !cloudKey || !cloudSecret) {
    return res.status(500).json({
      error: "Server misconfigured",
      missing: {
        ICLOUD_ALBUM_TOKEN: !albumToken,
        ANTHROPIC_API_KEY: !anthropicKey,
        CLOUDINARY_CLOUD_NAME: !cloudName,
        CLOUDINARY_API_KEY: !cloudKey,
        CLOUDINARY_API_SECRET: !cloudSecret,
      },
    });
  }

  const cfg: CloudinaryConfig = {
    cloudName,
    apiKey: cloudKey,
    apiSecret: cloudSecret,
  };

  const startedAt = Date.now();
  const summary = {
    found: 0,
    new_processed: 0,
    uploaded: 0,
    skipped_quality: 0,
    skipped_existing: 0,
    errors: 0,
    duration_ms: 0,
    capped: false,
    results: [] as IntakeResult[],
  };

  try {
    // 1. Build dedup set from Cloudinary
    const existing = await listCloudinaryPublicIds(cfg);

    // 2. Fetch iCloud stream
    const { data: stream, host } = await fetchStream(`p15-${ICLOUD_BASE}`, albumToken);
    const photos = stream.photos ?? [];
    summary.found = photos.length;

    // 3. Filter to new (not already in Cloudinary)
    const newPhotos = photos.filter((p) => !existing.has(publicIdFromGuid(p.photoGuid)));

    // 4. Cap and resolve URLs
    const toProcess = newPhotos.slice(0, MAX_PER_RUN);
    summary.capped = newPhotos.length > MAX_PER_RUN;

    if (toProcess.length === 0) {
      summary.duration_ms = Date.now() - startedAt;
      return res.status(200).json({ ok: true, message: "Nothing new", ...summary });
    }

    const guids = toProcess.map((p) => p.photoGuid);
    const { items: assetItems, locations } = await fetchAssetUrls(host, albumToken, guids);

    // 5. Process sequentially
    for (const photo of toProcess) {
      const guid = photo.photoGuid;
      const publicId = publicIdFromGuid(guid);

      try {
        const derivative = bestDerivative(photo.derivatives);
        if (!derivative) {
          summary.errors++;
          summary.results.push({ guid, status: "error", error: "no derivatives" });
          continue;
        }
        const downloadUrl = resolveDownloadUrl(derivative, assetItems, locations);
        if (!downloadUrl) {
          summary.errors++;
          summary.results.push({ guid, status: "error", error: "no download url" });
          continue;
        }

        const { buffer, mimeType } = await downloadPhoto(downloadUrl);
        const triage = await triagePhoto(anthropicKey, buffer, mimeType);

        summary.new_processed++;

        if (triage.quality < MIN_QUALITY) {
          summary.skipped_quality++;
          summary.results.push({
            guid,
            status: "skipped_quality",
            quality: triage.quality,
            theme: triage.theme,
            reason: triage.reject_reason ?? "below quality threshold",
          });
          continue;
        }

        const uploaded = await uploadToCloudinary(cfg, buffer, mimeType, {
          guid,
          publicId,
          theme: triage.theme,
          tags: triage.tags ?? [],
          mood: triage.mood ?? "candid",
          quality: triage.quality,
          description: triage.description ?? "",
        });

        summary.uploaded++;
        summary.results.push({
          guid,
          status: "uploaded",
          quality: triage.quality,
          theme: triage.theme,
          cloudinary_url: uploaded.secure_url,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`✗ ${guid}: ${msg}`);
        summary.errors++;
        summary.results.push({ guid, status: "error", error: msg });
      }
    }

    summary.duration_ms = Date.now() - startedAt;
    return res.status(200).json({ ok: true, ...summary });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("Fatal:", msg);
    summary.duration_ms = Date.now() - startedAt;
    return res.status(500).json({ ok: false, error: msg, ...summary });
  }
}

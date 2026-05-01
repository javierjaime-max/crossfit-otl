/**
 * CrossFit OTL — Vercel cron: publish scheduled Instagram posts
 *
 * Runs every 5 minutes via vercel.json cron config.
 * Queries Supabase otl_post_queue for pending posts where scheduled_at <= now(),
 * publishes each via Meta Graph API, updates status.
 *
 * Required Vercel env vars:
 *   SUPABASE_URL, SUPABASE_ANON_KEY
 *   META_ACCESS_TOKEN, OTL_IG_USER_ID
 *   CRON_SECRET (optional but recommended)
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";

const GRAPH_BASE = "https://graph.facebook.com/v19.0";

interface QueuedPost {
  id: string;
  slug: string;
  date: string;
  cloudinary_urls: string[];
  caption: string;
  scheduled_at: string;
}

async function graphPost(
  path: string,
  params: Record<string, string>,
  accessToken: string
): Promise<Record<string, unknown>> {
  const body = new URLSearchParams({ ...params, access_token: accessToken });
  const res = await fetch(`${GRAPH_BASE}/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  const data = (await res.json()) as Record<string, unknown>;
  if (data.error) {
    throw new Error(`Graph API error: ${JSON.stringify(data.error)}`);
  }
  return data;
}

async function publishPost(
  imageUrls: string[],
  caption: string,
  igUserId: string,
  accessToken: string
): Promise<string> {
  const isSingle = imageUrls.length === 1;

  if (isSingle) {
    const container = await graphPost(
      `${igUserId}/media`,
      { image_url: imageUrls[0], caption },
      accessToken
    );
    await new Promise((r) => setTimeout(r, 5000));
    const published = await graphPost(
      `${igUserId}/media_publish`,
      { creation_id: container.id as string },
      accessToken
    );
    return published.id as string;
  }

  // Carousel
  const containerIds: string[] = [];
  for (const url of imageUrls) {
    const data = await graphPost(
      `${igUserId}/media`,
      { image_url: url, is_carousel_item: "true" },
      accessToken
    );
    containerIds.push(data.id as string);
  }

  const carousel = await graphPost(
    `${igUserId}/media`,
    { media_type: "CAROUSEL", caption, children: containerIds.join(",") },
    accessToken
  );

  await new Promise((r) => setTimeout(r, 8000));

  const published = await graphPost(
    `${igUserId}/media_publish`,
    { creation_id: carousel.id as string },
    accessToken
  );
  return published.id as string;
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

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_ANON_KEY;
  const metaToken = process.env.META_ACCESS_TOKEN;
  const igUserId = process.env.OTL_IG_USER_ID || "17841448179180217";

  if (!supabaseUrl || !supabaseKey || !metaToken) {
    return res.status(500).json({ error: "Server misconfigured" });
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  // Fetch all pending posts due now (or overdue), oldest first
  const { data: posts, error: fetchError } = await supabase
    .from("otl_post_queue")
    .select("id, slug, date, cloudinary_urls, caption, scheduled_at")
    .eq("status", "pending")
    .lte("scheduled_at", new Date().toISOString())
    .order("scheduled_at", { ascending: true });

  if (fetchError) {
    console.error("Supabase fetch error:", fetchError);
    return res.status(500).json({ error: "DB fetch failed" });
  }

  if (!posts || posts.length === 0) {
    return res.status(200).json({ published: 0, message: "Nothing due" });
  }

  const results: Array<{
    id: string;
    slug: string;
    status: string;
    igPostId?: string;
    error?: string;
  }> = [];

  for (const post of posts as QueuedPost[]) {
    try {
      const igPostId = await publishPost(
        post.cloudinary_urls,
        post.caption,
        igUserId,
        metaToken
      );

      await supabase
        .from("otl_post_queue")
        .update({ status: "published", ig_post_id: igPostId })
        .eq("id", post.id);

      console.log(`✓ Published ${post.date}/${post.slug} → IG ${igPostId}`);
      results.push({ id: post.id, slug: post.slug, status: "published", igPostId });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`✗ Failed ${post.date}/${post.slug}:`, message);

      await supabase
        .from("otl_post_queue")
        .update({ status: "failed", error: message })
        .eq("id", post.id);

      results.push({ id: post.id, slug: post.slug, status: "failed", error: message });
    }
  }

  return res.status(200).json({
    published: results.filter((r) => r.status === "published").length,
    failed: results.filter((r) => r.status === "failed").length,
    results,
  });
}

#!/usr/bin/env node

// ═══════════════════════════════════════════════════════════════
//  ClockCrew BBS Asset Extractor — Batch Runner
// ═══════════════════════════════════════════════════════════════
//  Scans ~700k ClockCrew forum posts, extracts media asset URLs
//  from bodyHtml / images[] / links[], downloads them, and
//  archives to MinIO bucket "clockcrew-assets".
//
//  Usage:
//    node scripts/extract-clockcrew-assets.js                  # full run
//    node scripts/extract-clockcrew-assets.js --dry-run        # scan only, no downloads
//    node scripts/extract-clockcrew-assets.js --resume         # pick up from last checkpoint
//    node scripts/extract-clockcrew-assets.js --limit=1000     # process N posts only
//    node scripts/extract-clockcrew-assets.js --concurrency=10 # parallel downloads
//    node scripts/extract-clockcrew-assets.js --skip-external  # only clockcrew.net assets
//    node scripts/extract-clockcrew-assets.js --reprocess      # re-scan already-processed posts
//
//  Requires: MINIO_ENDPOINT, MINIO_ACCESS_KEY, MINIO_SECRET_KEY
//  in vault/.env (or process.env / local .env).
// ═══════════════════════════════════════════════════════════════

import { Client as MinioClient } from "minio";
import { MongoClient, ObjectId } from "mongodb";
import { createVaultClient } from "../utils/vault-client.js";
import {
  extractAssetUrls,
  categorizeAsset,
  downloadAsset,
  sha256,
  buildMinioKey,
  uploadToMinio,
  ensureBucket,
  BUCKET_NAME,
} from "../services/ClockCrewAssetService.js";

// ─── CLI Argument Parsing ───────────────────────────────────────

const args = process.argv.slice(2);
const getArg = (name) => {
  const match = args.find((a) => a.startsWith(`--${name}=`));
  return match ? match.split("=")[1] : null;
};

const DRY_RUN = args.includes("--dry-run");
const RESUME = args.includes("--resume");
const REPROCESS = args.includes("--reprocess");
const SKIP_EXTERNAL = args.includes("--skip-external");
const LIMIT = getArg("limit") ? parseInt(getArg("limit"), 10) : 0;
const CONCURRENCY = getArg("concurrency") ? parseInt(getArg("concurrency"), 10) : 5;
const BATCH_SIZE = 500;
const CHECKPOINT_INTERVAL = 1000; // Save progress every N posts
const DOWNLOAD_DELAY_MS = 150; // Polite delay between downloads

// ─── Collections ────────────────────────────────────────────────

const JOB_META_ID = "extraction-job";
const ASSETS_COLLECTION = "ClockCrewAssets";
const JOB_META_COLLECTION = "ClockCrewAssetJobMeta";
const DEAD_URLS_COLLECTION = "ClockCrewDeadUrls";

// ─── Counters ───────────────────────────────────────────────────

const stats = {
  postsProcessed: 0,
  postsWithAssets: 0,
  urlsFound: 0,
  downloaded: 0,
  uploaded: 0,
  skippedDupes: 0,
  skippedDead: 0,
  skippedExternal: 0,
  failed: 0,
  startedAt: new Date(),
};

// ─── Helpers ────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function formatDuration(ms) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}h ${m % 60}m ${s % 60}s`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

function formatBytes(bytes) {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

function logProgress() {
  const elapsed = Date.now() - stats.startedAt.getTime();
  const rate = stats.postsProcessed / (elapsed / 1000);
  process.stdout.write(
    `\r  📊 Posts: ${stats.postsProcessed.toLocaleString()} | ` +
    `URLs: ${stats.urlsFound.toLocaleString()} | ` +
    `⬇ ${stats.downloaded.toLocaleString()} | ` +
    `⬆ ${stats.uploaded.toLocaleString()} | ` +
    `♻ ${stats.skippedDupes.toLocaleString()} | ` +
    `💀 ${stats.skippedDead.toLocaleString()} | ` +
    `❌ ${stats.failed.toLocaleString()} | ` +
    `${rate.toFixed(0)} posts/s | ` +
    `${formatDuration(elapsed)}   `,
  );
}

// ─── Main ───────────────────────────────────────────────────────

async function main() {
  console.log("═══════════════════════════════════════════════════════════");
  console.log("  🕰️  ClockCrew BBS Asset Extractor");
  console.log("═══════════════════════════════════════════════════════════");
  console.log(`  Mode:        ${DRY_RUN ? "DRY RUN (no downloads)" : "Full extraction"}`);
  console.log(`  Resume:      ${RESUME ? "Yes" : "No"}`);
  console.log(`  Reprocess:   ${REPROCESS ? "Yes" : "No"}`);
  console.log(`  Concurrency: ${CONCURRENCY} workers`);
  console.log(`  Limit:       ${LIMIT || "None"}`);
  console.log(`  Skip external: ${SKIP_EXTERNAL ? "Yes" : "No"}`);
  console.log("");

  // ── Bootstrap secrets ───────────────────────────────────────
  const vault = createVaultClient({
    localEnvFile: "./.env",
    fallbackEnvFile: "../vault/.env",
  });
  const secrets = await vault.fetch();
  for (const [key, value] of Object.entries(secrets)) {
    if (process.env[key] === undefined) process.env[key] = value;
  }

  // ── Validate required config ────────────────────────────────
  const MONGO_URI = process.env.MONGO_URI;
  const MINIO_ENDPOINT = process.env.MINIO_ENDPOINT;
  const MINIO_ACCESS_KEY = process.env.MINIO_ACCESS_KEY;
  const MINIO_SECRET_KEY = process.env.MINIO_SECRET_KEY;

  if (!MONGO_URI) {
    console.error("❌ MONGO_URI not set");
    process.exit(1);
  }

  if (!DRY_RUN && (!MINIO_ENDPOINT || !MINIO_ACCESS_KEY || !MINIO_SECRET_KEY)) {
    console.error("❌ MinIO credentials not set (MINIO_ENDPOINT, MINIO_ACCESS_KEY, MINIO_SECRET_KEY)");
    console.error("   Use --dry-run to scan without uploading.");
    process.exit(1);
  }

  // ── Connect MongoDB ─────────────────────────────────────────
  const mongoUri = MONGO_URI.replace(/\/tools\b/, "/clockcrew");
  const mongoClient = new MongoClient(mongoUri);
  await mongoClient.connect();
  const db = mongoClient.db("clockcrew");
  console.log(`  📡 MongoDB connected: ${db.databaseName}`);

  const postsCol = db.collection("ClockCrewNetPosts");
  const assetsCol = db.collection(ASSETS_COLLECTION);
  const jobMetaCol = db.collection(JOB_META_COLLECTION);
  const deadUrlsCol = db.collection(DEAD_URLS_COLLECTION);

  // ── Ensure indexes ──────────────────────────────────────────
  await assetsCol.createIndex({ sha256: 1 }, { unique: true, sparse: true });
  await assetsCol.createIndex({ url: 1 });
  await assetsCol.createIndex({ category: 1 });
  await assetsCol.createIndex({ "sourcePostIds": 1 });
  await deadUrlsCol.createIndex({ url: 1 }, { unique: true });
  console.log("  📑 Indexes ensured");

  // ── Load dead URL set (for fast skip) ───────────────────────
  const deadUrlSet = new Set();
  const deadDocs = await deadUrlsCol.find({}, { projection: { url: 1 } }).toArray();
  for (const d of deadDocs) deadUrlSet.add(d.url);
  console.log(`  💀 ${deadUrlSet.size.toLocaleString()} known dead URLs loaded`);

  // ── Connect MinIO ───────────────────────────────────────────
  let minioClient = null;
  if (!DRY_RUN) {
    const url = new URL(MINIO_ENDPOINT);
    minioClient = new MinioClient({
      endPoint: url.hostname,
      port: parseInt(url.port, 10) || (url.protocol === "https:" ? 443 : 80),
      useSSL: url.protocol === "https:",
      accessKey: MINIO_ACCESS_KEY,
      secretKey: MINIO_SECRET_KEY,
    });
    await ensureBucket(minioClient);
    console.log(`  🪣 MinIO connected: ${MINIO_ENDPOINT} → ${BUCKET_NAME}`);
  }

  // ── Resume checkpoint ───────────────────────────────────────
  let lastProcessedId = null;
  if (RESUME) {
    const jobMeta = await jobMetaCol.findOne({ _id: JOB_META_ID });
    if (jobMeta?.lastProcessedId) {
      lastProcessedId = jobMeta.lastProcessedId;
      stats.postsProcessed = jobMeta.totalPostsProcessed || 0;
      stats.urlsFound = jobMeta.totalUrlsFound || 0;
      stats.uploaded = jobMeta.totalArchived || 0;
      stats.failed = jobMeta.totalFailed || 0;
      stats.skippedDupes = jobMeta.totalSkippedDupes || 0;
      console.log(`  🔄 Resuming from post ${lastProcessedId} (${stats.postsProcessed.toLocaleString()} already processed)`);
    } else {
      console.log("  🔄 No checkpoint found — starting from beginning");
    }
  }

  // ── Count total posts ───────────────────────────────────────
  const query = {};
  if (lastProcessedId && !REPROCESS) {
    query._id = { $gt: new ObjectId(lastProcessedId) };
  }
  const totalPosts = await postsCol.countDocuments(query);
  console.log(`  📬 ${totalPosts.toLocaleString()} posts to process`);
  console.log("");

  // ── Stream through posts in batches ─────────────────────────
  let processedInSession = 0;
  const cursor = postsCol
    .find(query)
    .sort({ _id: 1 })
    .batchSize(BATCH_SIZE)
    .project({ _id: 1, messageId: 1, topicId: 1, bodyHtml: 1, images: 1, links: 1 });

  // Download queue for concurrent processing
  const downloadQueue = [];
  let queueProcessing = false;

  async function processDownloadQueue() {
    if (queueProcessing || DRY_RUN) return;
    queueProcessing = true;

    while (downloadQueue.length > 0) {
      // Take a batch of CONCURRENCY items
      const batch = downloadQueue.splice(0, CONCURRENCY);

      await Promise.all(batch.map(async (item) => {
        const { url, category, messageId, topicId } = item;

        // Check if already in dead URLs
        if (deadUrlSet.has(url)) {
          stats.skippedDead++;
          return;
        }

        // Skip external if flag set
        if (SKIP_EXTERNAL) {
          try {
            const hostname = new URL(url).hostname;
            if (!hostname.includes("clockcrew.net")) {
              stats.skippedExternal++;
              return;
            }
          } catch {
            return;
          }
        }

        // Check if already archived (by URL)
        const existing = await assetsCol.findOne({ url }, { projection: { _id: 1, sha256: 1, sourcePostIds: 1 } });
        if (existing) {
          // Add this post as a source if not already tracked
          if (!existing.sourcePostIds?.includes(messageId)) {
            await assetsCol.updateOne(
              { _id: existing._id },
              {
                $addToSet: {
                  sourcePostIds: messageId,
                  sourceThreadIds: topicId,
                },
              },
            );
          }
          stats.skippedDupes++;
          return;
        }

        // Download
        const result = await downloadAsset(url);
        if (!result) {
          stats.failed++;
          // Track dead URL
          await deadUrlsCol.updateOne(
            { url },
            {
              $set: { url, failedAt: new Date(), sourceMessageId: messageId },
              $setOnInsert: { firstSeenAt: new Date() },
            },
            { upsert: true },
          );
          deadUrlSet.add(url);
          return;
        }

        stats.downloaded++;

        // Hash for dedup
        const hash = sha256(result.buffer);
        const resolvedCategory = categorizeAsset(url, result.contentType) || category;
        const key = buildMinioKey(resolvedCategory, hash, url);

        // Check if same content already uploaded (by hash)
        const hashExists = await assetsCol.findOne({ sha256: hash }, { projection: { _id: 1, sourcePostIds: 1 } });
        if (hashExists) {
          await assetsCol.updateOne(
            { _id: hashExists._id },
            {
              $addToSet: {
                sourcePostIds: messageId,
                sourceThreadIds: topicId,
                sourceUrls: url,
              },
            },
          );
          stats.skippedDupes++;
          return;
        }

        // Upload to MinIO
        try {
          await uploadToMinio(minioClient, BUCKET_NAME, result.buffer, key, result.contentType);

          // Record in MongoDB
          await assetsCol.updateOne(
            { sha256: hash },
            {
              $set: {
                sha256: hash,
                minioKey: key,
                category: resolvedCategory,
                contentType: result.contentType,
                sizeBytes: result.sizeBytes,
                downloadedAt: new Date(),
                status: "archived",
              },
              $setOnInsert: {
                url,
                originalFilename: key.split("/").pop(),
                createdAt: new Date(),
              },
              $addToSet: {
                sourcePostIds: messageId,
                sourceThreadIds: topicId,
                sourceUrls: url,
              },
            },
            { upsert: true },
          );

          stats.uploaded++;
        } catch (err) {
          console.error(`\n  ❌ Upload failed for ${key}: ${err.message}`);
          stats.failed++;
        }

        // Polite delay
        await sleep(DOWNLOAD_DELAY_MS);
      }));
    }

    queueProcessing = false;
  }

  // ── Process posts ───────────────────────────────────────────
  for await (const post of cursor) {
    if (LIMIT && processedInSession >= LIMIT) break;

    // Extract URLs
    const urls = extractAssetUrls(
      post.bodyHtml || "",
      post.images || [],
      post.links || [],
    );

    stats.postsProcessed++;
    processedInSession++;

    if (urls.length > 0) {
      stats.postsWithAssets++;
      stats.urlsFound += urls.length;

      if (!DRY_RUN) {
        for (const asset of urls) {
          const category = categorizeAsset(asset.url);
          downloadQueue.push({
            url: asset.url,
            category,
            messageId: post.messageId,
            topicId: post.topicId,
          });
        }
      }
    }

    // Process downloads in flight
    if (downloadQueue.length >= CONCURRENCY * 2) {
      await processDownloadQueue();
    }

    // Checkpoint
    if (processedInSession % CHECKPOINT_INTERVAL === 0) {
      logProgress();

      if (!DRY_RUN) {
        await jobMetaCol.updateOne(
          { _id: JOB_META_ID },
          {
            $set: {
              lastProcessedId: post._id.toString(),
              totalPostsProcessed: stats.postsProcessed,
              totalUrlsFound: stats.urlsFound,
              totalArchived: stats.uploaded,
              totalFailed: stats.failed,
              totalSkippedDupes: stats.skippedDupes,
              lastCheckpointAt: new Date(),
            },
            $setOnInsert: {
              startedAt: stats.startedAt,
            },
          },
          { upsert: true },
        );
      }
    }
  }

  // ── Drain remaining queue ───────────────────────────────────
  if (downloadQueue.length > 0) {
    await processDownloadQueue();
  }

  // ── Final checkpoint ────────────────────────────────────────
  if (!DRY_RUN) {
    await jobMetaCol.updateOne(
      { _id: JOB_META_ID },
      {
        $set: {
          totalPostsProcessed: stats.postsProcessed,
          totalUrlsFound: stats.urlsFound,
          totalArchived: stats.uploaded,
          totalFailed: stats.failed,
          totalSkippedDupes: stats.skippedDupes,
          completedAt: new Date(),
          lastCheckpointAt: new Date(),
        },
      },
      { upsert: true },
    );
  }

  // ── Summary ─────────────────────────────────────────────────
  const elapsed = Date.now() - stats.startedAt.getTime();

  console.log("\n");
  console.log("═══════════════════════════════════════════════════════════");
  console.log("  🏁 Extraction Complete");
  console.log("═══════════════════════════════════════════════════════════");
  console.log(`  Posts processed:    ${stats.postsProcessed.toLocaleString()}`);
  console.log(`  Posts with assets:  ${stats.postsWithAssets.toLocaleString()}`);
  console.log(`  URLs found:         ${stats.urlsFound.toLocaleString()}`);
  console.log(`  Downloaded:         ${stats.downloaded.toLocaleString()}`);
  console.log(`  Uploaded to MinIO:  ${stats.uploaded.toLocaleString()}`);
  console.log(`  Skipped (dupes):    ${stats.skippedDupes.toLocaleString()}`);
  console.log(`  Skipped (dead):     ${stats.skippedDead.toLocaleString()}`);
  if (SKIP_EXTERNAL) {
    console.log(`  Skipped (external): ${stats.skippedExternal.toLocaleString()}`);
  }
  console.log(`  Failed:             ${stats.failed.toLocaleString()}`);
  console.log(`  Elapsed:            ${formatDuration(elapsed)}`);
  console.log("═══════════════════════════════════════════════════════════");

  // ── Category breakdown from DB ──────────────────────────────
  if (!DRY_RUN) {
    const breakdown = await assetsCol.aggregate([
      { $group: {
        _id: "$category",
        count: { $sum: 1 },
        totalBytes: { $sum: "$sizeBytes" },
      }},
      { $sort: { count: -1 } },
    ]).toArray();

    if (breakdown.length > 0) {
      console.log("\n  📊 Archive Breakdown:");
      for (const cat of breakdown) {
        console.log(`     ${cat._id.padEnd(10)} ${cat.count.toLocaleString().padStart(8)} files  ${formatBytes(cat.totalBytes).padStart(10)}`);
      }
    }
  }

  await mongoClient.close();
  process.exit(0);
}

main().catch((err) => {
  console.error("\n❌ Fatal error:", err);
  process.exit(1);
});

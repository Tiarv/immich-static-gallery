#!/usr/bin/env node
import { Command } from "commander"
import cron from "node-cron"
import fs from "fs/promises"
import path from "path"
import { loadConfig } from "../lib/config.js"
import {
  createCache,
  getSeenIds,
  pruneAlbumCache,
  setSeenIds,
} from "../lib/cache.js"
import { createClient } from "../lib/api.js"
import { downloadAssets } from "../lib/downloader.js"
import { buildGallery } from "../lib/gallery.js"
import { sendNotification } from "../lib/notify.js"

const program = new Command()

program
  .name("immich-static-gallery")
  .description("Sync Immich albums → static gallery")
  .argument("<mode>", '"once" to run once, "watch" to run & schedule')
  .option("--config <path>", "Path to config file", "config.yaml")

program.parse(process.argv)

const [mode] = program.args
const { config: configPath } = program.opts()

async function build(cfg, db) {
  const contentRoot = cfg.paths.contentDir
  let changed = false

  // ── 0) Remove any album folder no longer in config ──────────────
  const validSlugs = new Set(cfg.albums.map((a) => a.slug))
  const validAlbumIds = cfg.albums.map((a) => a.id)
  const staleAlbumIds = await pruneAlbumCache(db, validAlbumIds)
  if (staleAlbumIds.length) {
    console.log(`🗑 Removed ${staleAlbumIds.length} stale album cache entries.`)
  }

  try {
    const entries = await fs.readdir(contentRoot, { withFileTypes: true })
    for (const ent of entries) {
      if (ent.isDirectory() && !validSlugs.has(ent.name)) {
        const stalePath = path.join(contentRoot, ent.name)
        console.log(`🗑 Removing stale album folder: ${ent.name}`)
        await fs.rm(stalePath, { recursive: true, force: true })
        changed = true
      }
    }
  } catch (e) {
    // contentRoot may not exist yet
    await fs.mkdir(contentRoot, { recursive: true })
  }

  // ── 1) Per‑album sync (additions & deletions) ────────────────────
  const client = createClient({
    immichServer: cfg.immich.serverUrl,
    immichApiToken: cfg.immich.apiKey,
  })

  for (const album of cfg.albums) {
    const albumDir = path.join(contentRoot, album.slug)

    // ensure album folder exists
    await fs.mkdir(albumDir, { recursive: true })

    // fetch current assets
    const allAssets = await client.listAssets(album.id)

    const currentIds = allAssets.map((a) => a.id)
    const currentIdSet = new Set(currentIds)

    // load previously seen IDs
    const seenIds = getSeenIds(db, album.id)
    const seenIdSet = new Set(seenIds)

    // deletions: IDs in seenIds but not in currentIds
    const deletedIds = seenIds.filter((id) => !currentIdSet.has(id))
    if (deletedIds.length) {
      console.log(
        `– ${deletedIds.length} items removed from "${album.slug}", deleting files`
      )
      const files = await fs.readdir(albumDir)
      const filesByAssetId = new Map()

      for (const file of files) {
        const assetId = path.parse(file).name
        const assetFiles = filesByAssetId.get(assetId) || []
        assetFiles.push(file)
        filesByAssetId.set(assetId, assetFiles)
      }

      for (const id of deletedIds) {
        for (const file of filesByAssetId.get(id) || []) {
          await fs.rm(path.join(albumDir, file))
          console.log(`  • Deleted ${file}`)
        }
      }
      changed = true
    }

    // additions: assets not in seenIds
    const newAssets = allAssets.filter((a) => !seenIdSet.has(a.id))
    if (newAssets.length) {
      console.log(
        `+ ${newAssets.length} new items in "${album.slug}", downloading`
      )
      await downloadAssets(newAssets, album.slug, contentRoot, client)
      changed = true
    }

    // update cache if anything changed for this album
    if (deletedIds.length || newAssets.length) {
      await setSeenIds(db, album.id, currentIds)
    }
  }

  // ── 2) Rebuild if needed ─────────────────────────────────────────
  if (changed) {
    await buildGallery({
      contentDir: contentRoot,
      publicDir: cfg.paths.publicDir,
      flags: cfg.gallery?.flags,
    })
    // Send notification if webhook is configured
    if (cfg.notify?.webhookUrl) {
      const notified = await sendNotification(cfg.notify.webhookUrl)
      if (!notified) {
        const message = "Webhook notification failed after gallery update."
        if (cfg.notify.failOnError) throw new Error(message)
        console.warn(message)
      }
    }
  } else {
    console.log("No changes detected; skipping build.")
  }
}

async function main() {
  const cfg = loadConfig(configPath)
  const db = await createCache(cfg.paths.cacheFile)

  if (mode === "once") {
    await build(cfg, db)
    process.exit(0)
  }

  if (mode === "watch") {
    await build(cfg, db)
    const expr = `*/${cfg.scan.intervalMinutes} * * * *`
    console.log(`Scheduling every ${cfg.scan.intervalMinutes} minutes.`)
    cron.schedule(expr, () =>
      build(cfg, db).catch((err) => {
        console.error("Scheduled sync failed; next run will still be attempted.")
        console.error(err)
      })
    )
    return
  }

  console.error(`Unknown mode "${mode}". Use "once" or "watch".`)
  process.exit(1)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})

import { Low } from "lowdb"
import { JSONFile } from "lowdb/node"
import fs from "fs/promises"
import path from "path"

export async function createCache(file) {
  await fs.mkdir(path.dirname(file), { recursive: true })

  const adapter = new JSONFile(file)
  const db = new Low(adapter, { albums: {} }) // default data
  await db.read()
  db.data ||= {}
  db.data.albums ||= {}
  return db
}

export function getSeenIds(db, albumId) {
  return db.data.albums[albumId] || []
}

export async function setSeenIds(db, albumId, ids) {
  db.data.albums[albumId] = ids
  await db.write()
}

export async function pruneAlbumCache(db, validAlbumIds) {
  const valid = new Set(validAlbumIds)
  const albumIds = Object.keys(db.data.albums)
  const staleAlbumIds = albumIds.filter((albumId) => !valid.has(albumId))

  if (!staleAlbumIds.length) return []

  for (const albumId of staleAlbumIds) {
    delete db.data.albums[albumId]
  }

  await db.write()
  return staleAlbumIds
}

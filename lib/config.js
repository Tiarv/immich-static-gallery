import fs from "fs"
import yaml from "js-yaml"

import path from "path"
import dotenv from "dotenv"

// Load .env file variables into process.env
dotenv.config()

// --- Internal Paths Configuration ---
// Base directory mapped from the host's ./output directory
const OUTPUT_BASE_DIR = "./data"

const config = {
  // --- Essential Paths ---
  paths: {
    outputBase: OUTPUT_BASE_DIR,
    // Directory for temporary asset downloads
    contentDir: path.join(OUTPUT_BASE_DIR, "temp"),
    // Directory for the final static gallery output
    publicDir: path.join(OUTPUT_BASE_DIR, "public"),
    // Path for the internal cache file
    cacheFile: path.join("cache", "cache.json"),
    // Path to the user-provided configuration file
    configFile: "config.yaml", // Default, can be overridden by command line
  },

  // --- Immich Connection (from environment variables) ---
  immich: {
    serverUrl: process.env.IMMICH_SERVER,
    apiKey: process.env.IMMICH_API_KEY,
  },

  albums: [],

  scan: {
    intervalMinutes: 60,
    exitOnError: false,
  },

  notify: {
    webhookUrl: "",
    failOnError: false,
  },
}

function isPlainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value)
}

function mergeConfig(defaults, overrides) {
  const merged = { ...defaults }

  for (const [key, value] of Object.entries(overrides || {})) {
    if (isPlainObject(value) && isPlainObject(defaults[key])) {
      merged[key] = mergeConfig(defaults[key], value)
    } else {
      merged[key] = value
    }
  }

  return merged
}

function validate(config) {
  const requiredImmichConfig = [
    ["IMMICH_SERVER", config.immich?.serverUrl],
    ["IMMICH_API_KEY", config.immich?.apiKey],
  ]

  const missing = requiredImmichConfig
    .filter(([, value]) => !value)
    .map(([key]) => key)

  if (missing.length > 0) {
    console.warn(
      `Warning: Missing required environment variables: ${missing.join(
        ", "
      )}. Check your config file, .env file, or environment setup.`
    )

    process.exit(1) // Exit if critical info is missing
  }

  if (!Array.isArray(config.albums)) {
    console.warn("Warning: Config must define an albums array.")
    process.exit(1)
  }

  if (
    !Number.isInteger(config.scan?.intervalMinutes) ||
    config.scan.intervalMinutes < 1
  ) {
    console.warn("Warning: scan.intervalMinutes must be a positive integer.")
    process.exit(1)
  }

  if (typeof config.scan?.exitOnError !== "boolean") {
    console.warn("Warning: scan.exitOnError must be true or false.")
    process.exit(1)
  }

  const safeSlug = /^[a-zA-Z0-9._-]+$/
  const seenSlugs = new Set()

  for (const album of config.albums) {
    if (!album?.id || !album?.slug) {
      console.warn("Warning: Each album must define both id and slug.")
      process.exit(1)
    }

    if (!safeSlug.test(album.slug)) {
      console.warn(
        `Warning: Album slug "${album.slug}" is invalid. Use only letters, numbers, dots, underscores, and hyphens.`
      )
      process.exit(1)
    }

    if (seenSlugs.has(album.slug)) {
      console.warn(`Warning: Duplicate album slug "${album.slug}" found.`)
      process.exit(1)
    }

    seenSlugs.add(album.slug)
  }
}

export function loadConfig(path = config.paths.configFile) {
  const raw = fs.readFileSync(path, "utf8")
  const yml = yaml.load(raw) || {}
  const cfg = mergeConfig(config, yml)
  validate(cfg)
  return cfg
}

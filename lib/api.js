import axios from "axios"

export function createClient({ immichServer, immichApiToken }) {
  const client = axios.create({
    baseURL: immichServer,
    headers: {
      "Content-Type": "application/json",
      "User-Agent": "static-gallery",
      "x-api-key": `${immichApiToken}`,
    },
    responseType: "json",
    timeout: 30_000,
  })

  async function getAssetInfo(assetId) {
    const { data: asset } = await client.get(`/assets/${assetId}`)
    return asset
  }

  /**
   * List all assets in an album using the stable metadata search endpoint.
   */
  async function listAssets(albumId) {
    const all = []
    const seenIds = new Set()
    const size = 250
    let page = 1

    while (true) {
      const { data } = await client.post(`/search/metadata`, {
        albumIds: [albumId],
        page,
        size,
      })

      const assets = data?.assets
      const items = assets?.items || []
      const total = assets?.total

      if (!items.length) break

      const countBeforePage = all.length

      for (const item of items) {
        if (seenIds.has(item.id)) continue

        const asset = item.originalPath ? item : await getAssetInfo(item.id)

        if (asset && asset.id && asset.originalPath) {
          all.push(asset)
          seenIds.add(asset.id)
        } else {
          console.warn(`Asset ${item.id} missing originalPath or id, skipping.`)
        }
      }

      if (all.length === countBeforePage) break
      if (typeof total === "number" && all.length >= total) break
      if (items.length < size) break

      page += 1
    }

    return all
  }

  /**
   * Download the original bytes for a single asset
   * Returns the Axios response (with a stream in data)
   */
  function downloadAsset(assetId) {
    return client.get(`/assets/${assetId}/original`, {
      responseType: "stream",
    })
  }

  return { listAssets, downloadAsset }
}

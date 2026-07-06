import simpleGit from "simple-git"

export async function deploy(config, publicDir) {
  const { method } = config.deploy || {}

  if (!method) {
    console.log("Deploy skipped: no method configured.")
    return
  }

  if (method === "github") {
    const { repo, branch, commitMessage } = config.deploy.github || {}
    if (!repo || !branch) throw new Error("GitHub deploy needs repo and branch")

    console.log(`Deploying to GitHub Pages (${branch})...`)
    const git = simpleGit(publicDir)
    await git.init()
    await git.addRemote("origin", repo).catch(() => {}) // ignore if already exists
    await git.add(".")
    const status = await git.status()
    if (status.files.length === 0) {
      console.log("Deploy skipped: no public output changes to commit.")
      return
    }

    await git.commit(commitMessage || "update site")
    await git.push("origin", branch, { "--force": null })
    return
  }

  console.warn(`Unknown deploy method "${method}", skipping deploy.`)
}

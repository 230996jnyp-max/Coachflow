// npm run push:weekly            (normally run on a Sunday)
// npm run push:weekly -- --force (override the Sunday check)
// Builds dev, merges it into main, tags the release and pushes main + tag. Vercel deploys main.
import { spawnSync } from "node:child_process";

const git = (args, opts = {}) => spawnSync("git", args, { encoding: "utf8", ...opts });
const out = (args) => (git(args).stdout ?? "").trim();
const fail = (msg) => {
  console.error(`\n✖ ${msg}\n`);
  process.exit(1);
};
const step = (msg) => console.log(`\n▶ ${msg}`);

const force = process.argv.includes("--force");
const now = new Date();
const isSunday = now.getDay() === 0;
if (!isSunday && !force) {
  fail("Weekly releases go live on Sundays and today is not Sunday.\n  If you really want to publish now, run:  npm run push:weekly -- --force");
}

if (out(["rev-parse", "--abbrev-ref", "HEAD"]) !== "dev") fail('Run this from the dev branch:  git checkout dev');
if (out(["status", "--porcelain"])) fail("You have unsaved changes. Run  npm run save:daily  first.");
if (!out(["remote", "get-url", "origin"])) fail("No GitHub remote named origin is configured.");

const date = now.toISOString().slice(0, 10);
let tag = `release-${date}`;
for (let n = 2; out(["tag", "--list", tag]); n++) tag = `release-${date}-${n}`;

step("Checking the build (TypeScript + production build)...");
const build = spawnSync("npm", ["run", "build"], { stdio: "inherit", shell: true });
if (build.status !== 0) fail("The build failed, so nothing was pushed. Fix the errors on dev and try again.");

step("Merging dev into main...");
if (git(["checkout", "main"], { stdio: "inherit" }).status !== 0) fail("Could not switch to main.");
const merge = git(["merge", "--no-ff", "dev", "-m", `Weekly release ${date}`], { stdio: "inherit" });
if (merge.status !== 0) {
  git(["merge", "--abort"]);
  git(["checkout", "dev"]);
  fail("The merge hit conflicts and was cancelled. main is unchanged.");
}

step(`Tagging ${tag} and pushing to GitHub...`);
git(["tag", "-a", tag, "-m", `Weekly release ${date}`]);
const push = git(["push", "origin", "main", tag], { stdio: "inherit" });
git(["checkout", "dev"]);
if (push.status !== 0) fail("Push failed. main was merged locally but is not on GitHub yet. Check your connection / GitHub login, then run:  git push origin main --follow-tags");

console.log(`\n✔ Released ${tag}. Vercel is now deploying main to the live site.`);
console.log("  You are back on dev for next week's work.\n");

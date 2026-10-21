// npm run save:daily [-- "optional message"]
// Commits everything to the local `dev` branch. It never pushes, so the live site is untouched.
import { spawnSync } from "node:child_process";

const git = (args, opts = {}) => spawnSync("git", args, { encoding: "utf8", ...opts });
const out = (args) => (git(args).stdout ?? "").trim();
const fail = (msg) => {
  console.error(`\n✖ ${msg}\n`);
  process.exit(1);
};

const branch = out(["rev-parse", "--abbrev-ref", "HEAD"]);
if (branch !== "dev") fail(`You are on "${branch}". Daily work lives on the dev branch: run  git checkout dev  first.`);

git(["add", "-A"]);
const staged = out(["diff", "--cached", "--name-only"]).split("\n").filter(Boolean);
if (staged.length === 0) {
  console.log("Nothing new to save - dev is already up to date.");
  process.exit(0);
}

// Safety net: real environment files must never be committed (only .env.example is allowed).
const env = staged.filter((f) => /(^|\/)\.env/.test(f) && !/\.env\.example$/.test(f));
if (env.length) {
  git(["reset", "-q"]);
  fail(`Refusing to commit environment files: ${env.join(", ")}`);
}

const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
const custom = process.argv.slice(2).join(" ").trim();
const message = custom ? `${custom}` : `Daily save ${stamp}`;
const res = git(["commit", "-m", message], { stdio: "inherit" });
if (res.status !== 0) fail("Commit failed.");
console.log(`\n✔ Saved ${staged.length} file(s) to dev (local only). The live site is unchanged.`);

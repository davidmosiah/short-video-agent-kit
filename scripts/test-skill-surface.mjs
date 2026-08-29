import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(new URL(".", import.meta.url)));
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
assert.ok(Array.isArray(pkg.files) ? pkg.files.includes("skill") : existsSync(join(root, "skill/SKILL.md")));
assert.equal(existsSync(join(root, "skill/SKILL.md")), true);
const skill = readFileSync(join(root, "skill/SKILL.md"), "utf8");
assert.doesNotMatch(skill, /^[A-Z][A-Z0-9_]*_ALLOW_MUTATIONS\s*=\s*true$/m);
assert.match(skill, /call short_video_connection_status/);


const bin = join(root, "src/cli.js");
function run(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [bin, ...args], { env: { ...process.env }, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = ""; let stderr = "";
    child.stdout.on("data", (c) => { stdout += c; });
    child.stderr.on("data", (c) => { stderr += c; });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}
const result = await run(["call", "short_video_connection_status", "--json", "{}"]);
assert.ok(result.code === 0 || result.code === 1, result.stderr);
assert.ok(result.stdout.trim().length > 0, result.stderr);
const unknown = await run(["call", "not_a_real_tool_name"]);
assert.equal(unknown.code === 1 || unknown.code === 2, true);
console.log(JSON.stringify({ ok: true, suite: "skill-surface", tool: "short_video_connection_status" }, null, 2));

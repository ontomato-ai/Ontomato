import { appendFileSync, readFileSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";

const env = process.env;
const githubApi = `${env.GITHUB_API_URL}/repos/${env.GITHUB_REPOSITORY}`;
const runUrl = `${env.GITHUB_SERVER_URL}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}`;
const gitlabOrigin = "https://git.uino.com";
const enterpriseProject = 8459;
const gitlabApi = `${gitlabOrigin}/api/v4/projects/${enterpriseProject}`;
const statusContext = "Enterprise compatibility";
const requestTimeout = 10_000;
// Leave time for the live PR check and final status write within the 12-minute budget.
const waitDeadline = performance.now() + 12 * 60_000 - 2 * requestTimeout;
const activePipelines = new Set([
  "created", "waiting_for_resource", "preparing", "pending", "running", "scheduled",
]);
const failureHints = new Map([
  ["public-source", "Check PUBLIC_SHA and enterprise scripts/ci-public-minimum-sha."],
  ["frozen-lockfile", "Update enterprise pnpm-lock.yaml."],
  ["typecheck", "Fix the enterprise paths reported by the compiler."],
  ["server-locale", "Fix enterprise packages/workbench-server-enterprise/src/locales/."],
  ["ui-locale", "Fix enterprise packages/workbench-ui-enterprise/src/locales/."],
]);

class BridgeError extends Error {}

function isSha(value) {
  return typeof value === "string" && value.length === 40 && /^[a-f0-9]+$/.test(value);
}

function isId(value) {
  return Number.isSafeInteger(value) && value > 0;
}

async function request(url, operation, {
  method = "GET", headers, body, format = "json", missing = false, deadline = Infinity,
}) {
  const remaining = Math.floor(deadline - performance.now());
  if (remaining <= 0) throw new BridgeError("CI infrastructure: enterprise wait timed out.");
  try {
    const response = await fetch(url, {
      method, headers, body,
      redirect: "error",
      signal: AbortSignal.timeout(Math.min(requestTimeout, remaining)),
    });
    if (missing && response.status === 404) return null;
    if (!response.ok) throw new BridgeError(`CI infrastructure: ${operation} returned HTTP ${response.status}.`);
    if (format === "bytes") return Buffer.from(await response.arrayBuffer()).toString("latin1");
    if (format === "json") return await response.json();
    await response.body?.cancel();
  } catch (error) {
    // Network, parser and API diagnostics can contain private response data.
    if (error instanceof BridgeError) throw error;
    if (performance.now() >= deadline) throw new BridgeError("CI infrastructure: enterprise wait timed out.");
    throw new BridgeError(`CI infrastructure: ${operation} failed.`);
  }
}

const githubHeaders = {
  Accept: "application/vnd.github+json",
  Authorization: `Bearer ${env.GITHUB_TOKEN}`,
};

function getPull(number) {
  return request(`${githubApi}/pulls/${number}`, "GitHub PR lookup", { headers: githubHeaders });
}

function getDevelop() {
  return request(`${githubApi}/git/ref/heads/develop`, "GitHub develop lookup", { headers: githubHeaders });
}

function matchesEvent(pull, eventPull, repositoryId) {
  return pull.state === "open" && pull.draft === false &&
    pull.base?.ref === "develop" && pull.head?.repo?.id === repositoryId &&
    pull.head.sha === eventPull.head.sha;
}

async function resolvePull(number, eventPull, repositoryId) {
  const deadline = performance.now() + 30_000;
  let pull = await getPull(number);
  // GitHub computes mergeability asynchronously. Only that pending state is polled.
  while (matchesEvent(pull, eventPull, repositoryId) && pull.mergeable === null && performance.now() < deadline) {
    await delay(2_000);
    pull = await getPull(number);
  }
  return matchesEvent(pull, eventPull, repositoryId) ? pull : null;
}

async function selectMerge(pull) {
  if (pull.mergeable === false) throw new BridgeError("public-source: GitHub reports merge conflicts.");
  if (pull.mergeable !== true || !isSha(pull.merge_commit_sha)) {
    throw new BridgeError("public-source: GitHub test merge is unavailable.");
  }
  const commit = await request(`${githubApi}/git/commits/${pull.merge_commit_sha}`, "GitHub test merge lookup", {
    headers: githubHeaders,
    missing: true,
  });
  if (!commit) throw new BridgeError("public-source: GitHub test merge commit is unavailable.");
  if (commit.sha !== pull.merge_commit_sha ||
      commit.parents?.length !== 2 ||
      commit.parents[0].sha !== pull.base.sha || commit.parents[1].sha !== pull.head.sha) {
    throw new BridgeError("public-source: GitHub test merge does not match the PR head and base.");
  }
  return commit.sha;
}

function postStatus(sha, state, description, targetUrl = runUrl) {
  return request(`${githubApi}/statuses/${sha}`, "GitHub status write", {
    method: "POST",
    headers: { ...githubHeaders, "Content-Type": "application/json" },
    body: JSON.stringify({ state, context: statusContext, description, target_url: targetUrl }),
    format: "none",
  });
}

function gitlabGet(path, operation, format = "json") {
  return request(`${gitlabApi}${path}`, operation, {
    headers: { "PRIVATE-TOKEN": env.GITLAB_ENTERPRISE_READ_API_TOKEN },
    format,
    deadline: waitDeadline,
  });
}

async function triggerEnterprise(publicSha) {
  if (!env.GITLAB_ENTERPRISE_TRIGGER_TOKEN || !env.GITLAB_ENTERPRISE_READ_API_TOKEN) {
    throw new BridgeError("CI infrastructure: enterprise environment tokens are unavailable.");
  }
  const body = new URLSearchParams({
    ref: "develop",
    token: env.GITLAB_ENTERPRISE_TRIGGER_TOKEN,
    "variables[PUBLIC_PR_COMPAT]": "true",
    "variables[PUBLIC_SHA]": publicSha,
  });
  const pipeline = await request(`${gitlabApi}/trigger/pipeline`, "GitLab pipeline trigger", {
    method: "POST", body, deadline: waitDeadline,
  });
  if (!isId(pipeline.id) || !isSha(pipeline.sha) ||
      pipeline.project_id !== enterpriseProject || pipeline.ref !== "develop") {
    throw new BridgeError("CI infrastructure: unexpected GitLab trigger response.");
  }
  return pipeline;
}

function pipelineUrl(pipeline) {
  const path = new RegExp(`^https://git\\.uino\\.com/(?:[A-Za-z0-9_.-]+/)+-/pipelines/${pipeline.id}$`);
  if (typeof pipeline.web_url !== "string" || !path.test(pipeline.web_url)) {
    throw new BridgeError("CI infrastructure: unexpected GitLab pipeline link.");
  }
  return pipeline.web_url;
}

async function getCompatibilityJob(pipeline) {
  const matches = [];
  for (let page = 1; ; page += 1) {
    const jobs = await gitlabGet(
      `/pipelines/${pipeline.id}/jobs?include_retried=true&per_page=100&page=${page}`,
      "GitLab pipeline jobs lookup",
    );
    if (!Array.isArray(jobs)) throw new BridgeError("CI infrastructure: unexpected GitLab jobs response.");
    matches.push(...jobs.filter(job => job.name === "public-pr-compat"));
    if (jobs.length < 100) break;
  }
  const [job] = matches;
  if (matches.length !== 1 || !isId(job.id) || job.pipeline?.id !== pipeline.id ||
      job.pipeline.sha !== pipeline.sha || job.commit?.id !== pipeline.sha || !job.started_at) {
    throw new BridgeError("CI infrastructure: expected one executed public-pr-compat job on the enterprise SHA.");
  }
  return job;
}

async function getEnterpriseResult(pipeline) {
  for (;;) {
    const current = await gitlabGet(`/pipelines/${pipeline.id}`, "GitLab pipeline lookup");
    if (current.id !== pipeline.id || current.sha !== pipeline.sha || current.ref !== "develop") {
      throw new BridgeError("CI infrastructure: GitLab pipeline identity changed.");
    }
    if (!activePipelines.has(current.status)) {
      const job = await getCompatibilityJob(pipeline);
      if (current.status === "success" && job.status === "success") {
        return { state: "success", description: "passed: enterprise compatibility passed." };
      }
      if (job.status !== "failed") {
        throw new BridgeError("CI infrastructure: pipeline ended without a compatibility result.");
      }
      const artifact = await gitlabGet(
        `/jobs/${job.id}/artifacts/.build/public-pr-compat-result`, "GitLab result artifact lookup", "bytes",
      );
      const phase = artifact.endsWith("\n") ? artifact.slice(0, -1) : artifact;
      const hint = failureHints.get(phase);
      if (!hint) throw new BridgeError("CI infrastructure: unexpected compatibility result artifact.");
      return { state: "failure", description: `${phase}: ${hint}` };
    }
    await delay(Math.max(0, Math.min(10_000, waitDeadline - performance.now())));
  }
}

const report = {};

function reportResult(description) {
  const lines = [
    "## Enterprise compatibility",
    "",
    description,
    "",
    `- PUBLIC_SHA: \`${report.publicSha ?? "unavailable"}\``,
    `- Enterprise SHA: \`${report.enterpriseSha ?? "unavailable"}\``,
  ];
  if (report.url) lines.push(`- [Private GitLab pipeline](${report.url})`);
  appendFileSync(env.GITHUB_STEP_SUMMARY, `${lines.join("\n")}\n`);
}

async function run() {
  const { number, pull_request: eventPull, repository } = JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, "utf8"));
  if (!isId(number) || !isSha(eventPull?.head?.sha)) {
    throw new BridgeError("CI infrastructure: invalid GitHub pull request event.");
  }
  const pull = await resolvePull(number, eventPull, repository.id);
  if (!pull) {
    reportResult("Skipped: pull request event is stale or no longer eligible.");
    return;
  }

  async function isCurrent() {
    const [current, base] = await Promise.all([getPull(number), report.publicSha ? getDevelop() : null]);
    if (!matchesEvent(current, eventPull, repository.id)) return false;
    if (!report.publicSha) return true;
    return current.mergeable === true && current.merge_commit_sha === report.publicSha &&
      current.base.sha === pull.base.sha && base.object?.sha === pull.base.sha;
  }

  let result;
  try {
    report.publicSha = await selectMerge(pull);
    if (!await isCurrent()) {
      reportResult("Skipped: pull request or develop changed before the enterprise trigger.");
      return;
    }
    await postStatus(report.publicSha, "pending", "Waiting for the enterprise compatibility pipeline.");
    const pipeline = await triggerEnterprise(report.publicSha);
    report.enterpriseSha = pipeline.sha;
    report.url = pipelineUrl(pipeline);
    result = await getEnterpriseResult(pipeline);
  } catch (error) {
    if (!(error instanceof BridgeError)) throw error;
    result = { state: "error", description: error.message };
  }

  // PR concurrency cancels superseded runs. Refresh the candidate before any final write.
  if (!await isCurrent()) {
    reportResult("Skipped: pull request changed before status publication.");
    return;
  }
  // With no verified merge SHA, use the head only to make the source error visible.
  await postStatus(report.publicSha ?? pull.head.sha, result.state, result.description, report.url);
  reportResult(result.description);
  if (result.state !== "success") process.exitCode = 1;
}

try {
  await run();
} catch (error) {
  reportResult(error instanceof BridgeError ? error.message : "CI infrastructure: enterprise compatibility bridge failed.");
  process.exitCode = 1;
}

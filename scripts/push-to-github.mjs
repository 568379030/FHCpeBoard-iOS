#!/usr/bin/env node
/*
 * Push a local folder to a GitHub repo branch using only api.github.com.
 *
 * Why: on some networks the git smart-HTTP endpoint (github.com:443) is
 * blocked while api.github.com is reachable. This script does the same thing
 * git push would do, but over the REST API (blobs -> tree -> commit -> ref).
 *
 * Usage:
 *   GITHUB_TOKEN=ghp_xxx node scripts/push-to-github.mjs \
 *     --owner 568379030 --repo FHCpeBoard-iOS --branch ios-air6-sample59 \
 *     --dir . --message "iOS: Air6 client (sample59)"
 *
 * The token needs, on that repo: Contents = Read and write
 * (classic token scope: repo). Workflow files require the `workflow` scope on
 * classic tokens; fine-grained tokens need "Workflows: write".
 *
 * The token is read from the environment only; it is never written to disk
 * and never printed.
 */
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';

const API = 'https://api.github.com';
const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '';
if (!token) {
  console.error('缺少 GITHUB_TOKEN 环境变量');
  process.exit(2);
}

function arg(name, fallback) {
  const i = process.argv.indexOf('--' + name);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const owner = arg('owner');
const repo = arg('repo');
const branch = arg('branch', 'main');
const dir = path.resolve(arg('dir', '.'));
const message = arg('message', 'Update from local folder');
const dryRun = process.argv.includes('--dry-run');
if (!owner || !repo) {
  console.error('用法: --owner <user> --repo <name> [--branch b] [--dir .] [--message m]');
  process.exit(2);
}

const headers = {
  Authorization: `Bearer ${token}`,
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': 'air6-push'
};

async function api(method, url, body) {
  const res = await fetch(API + url, {
    method,
    headers: Object.assign({ 'Content-Type': 'application/json' }, headers),
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* non-json */ }
  if (!res.ok) {
    const detail = json && json.message ? json.message : text.slice(0, 200);
    const err = new Error(`${method} ${url} -> ${res.status} ${detail}`);
    err.status = res.status;
    err.body = json;
    throw err;
  }
  return json;
}

const SKIP_DIRS = new Set(['.git', 'build', 'dist', 'node_modules', 'DerivedData', '.gradle']);
const SKIP_EXT = ['.log', '.ipa', '.apk'];

async function walk(root, current = root, out = []) {
  for (const entry of await readdir(current, { withFileTypes: true })) {
    const full = path.join(current, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      await walk(root, full, out);
    } else if (entry.isFile()) {
      if (SKIP_EXT.some(ext => entry.name.endsWith(ext))) continue;
      const info = await stat(full);
      if (info.size > 40 * 1024 * 1024) { console.warn('跳过超大文件', full); continue; }
      out.push(path.relative(root, full).split(path.sep).join('/'));
    }
  }
  return out;
}

const created = [];
async function ensureRepo() {
  const me = await api('GET', '/user');
  console.log(`令牌账号: ${me.login}`);
  try {
    const info = await api('GET', `/repos/${owner}/${repo}`);
    console.log(`仓库: ${info.full_name}（默认分支 ${info.default_branch}，${info.private ? '私有' : '公开'}）`);
    return info;
  } catch (e) {
    if (e.status !== 404) throw e;
    if (dryRun) { console.log('仓库不存在，dry-run 到此为止'); process.exit(0); }
    const info = await api('POST', '/user/repos', {
      name: repo,
      private: true,
      description: 'AIR6 iOS client (unsigned CI build)',
      auto_init: true
    });
    created.push(info.full_name);
    console.log(`已创建仓库 ${info.full_name}`);
    // auto_init 后 ref 需要一点时间落地
    await new Promise(r => setTimeout(r, 2500));
    return info;
  }
}

async function main() {
  const info = await ensureRepo();
  const base = info.default_branch || 'main';

  let baseCommit = null;
  try {
    const ref = await api('GET', `/repos/${owner}/${repo}/git/ref/heads/${branch}`);
    baseCommit = ref.object.sha;
    console.log(`分支 ${branch} 已存在，基于 ${baseCommit.slice(0, 7)}`);
  } catch (e) {
    if (e.status !== 404) throw e;
    const ref = await api('GET', `/repos/${owner}/${repo}/git/ref/heads/${base}`);
    baseCommit = ref.object.sha;
    console.log(`分支 ${branch} 不存在，将从 ${base} (${baseCommit.slice(0, 7)}) 拉出`);
  }

  const commitInfo = await api('GET', `/repos/${owner}/${repo}/git/commits/${baseCommit}`);
  const baseTree = commitInfo.tree.sha;

  const files = await walk(dir);
  console.log(`待上传 ${files.length} 个文件`);

  const tree = [];
  for (const rel of files) {
    const buf = await readFile(path.join(dir, rel));
    const isText = !/\.(png|jpg|jpeg|gif|ico|jks|keystore|zip|ttf|otf)$/i.test(rel);
    const body = {
      content: isText ? buf.toString('utf8') : buf.toString('base64'),
      encoding: isText ? 'utf-8' : 'base64'
    };
    const blob = await api('POST', `/repos/${owner}/${repo}/git/blobs`, body);
    tree.push({ path: rel, mode: '100644', type: 'blob', sha: blob.sha });
    process.stdout.write('.');
  }
  process.stdout.write('\n');

  if (dryRun) { console.log('dry-run 结束（未创建提交）'); return; }

  const newTree = await api('POST', `/repos/${owner}/${repo}/git/trees`, { base_tree: baseTree, tree });
  const commit = await api('POST', `/repos/${owner}/${repo}/git/commits`, {
    message,
    tree: newTree.sha,
    parents: [baseCommit]
  });
  console.log(`提交 ${commit.sha.slice(0, 7)} 已创建`);

  try {
    await api('GET', `/repos/${owner}/${repo}/git/ref/heads/${branch}`);
    await api('PATCH', `/repos/${owner}/${repo}/git/refs/heads/${branch}`, { sha: commit.sha, force: false });
    console.log(`已更新分支 ${branch}`);
  } catch (e) {
    if (e.status !== 404) throw e;
    await api('POST', `/repos/${owner}/${repo}/git/refs`, { ref: `refs/heads/${branch}`, sha: commit.sha });
    console.log(`已创建分支 ${branch}`);
  }

  console.log(`\n完成：https://github.com/${owner}/${repo}/tree/${branch}`);
  console.log(`Actions：https://github.com/${owner}/${repo}/actions`);
}

main().catch(e => {
  console.error('\n失败:', e.message);
  if (e.status === 403) console.error('令牌缺少写权限：需要 Contents 读写（以及 Workflows 写，用于 .github/workflows）');
  if (e.status === 401) console.error('令牌无效或已过期');
  process.exit(1);
});

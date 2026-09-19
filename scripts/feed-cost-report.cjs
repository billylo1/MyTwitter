#!/usr/bin/env node
// Feed cost/volume report: where X API read spend is going, and what changed.
// Stateless — every trend is derived from post createdAt timestamps in Firestore.
//   node scripts/feed-cost-report.cjs [--days N]

const path = require("path");
const ROOT = path.resolve(__dirname, "..");
const admin = require(path.join(ROOT, "functions/node_modules/firebase-admin"));

const PRICE_PER_READ = 0.005;
const READS_PER_POST = 1185 / 1019; // calibrated: X usage counter vs posts stored, 2026-09-14
const CYCLE_CAP_USD = 50;

// Accounts unfollowed on 2026-09-14 to cut read volume; posts from them after
// this cutoff mean an unfollow did not stick.
const UNFOLLOW_CUTOFF = Date.parse("2026-09-14T16:30:00Z");
const UNFOLLOWED = new Set([
  "torontostar", "androidauth", "harvardbiz", "lifehacker", "kyivpost", "reuters", "ajenglish",
  "engineers_feed", "wonderofscience", "xaviation", "iphoneincanada", "car_witter",
  "buitengebieden", "flightradar24", "rainmaker1973", "manutd",
  "ycombinator", "normsworld", "d_a_keldsen", "foundersbeta",
]);

const arg = process.argv.indexOf("--days");
const RECENT_DAYS = arg > -1 ? Number(process.argv[arg + 1]) : 3;

const usd = (n) => "$" + n.toFixed(2);
const src = (v) => (v.repostedByHandle || v.authorHandle || "?").toLowerCase();
const isRt = (v) => Boolean(v.isRetweet || v.repostedByHandle);

(async () => {
  admin.initializeApp({ credential: admin.credential.cert(require(path.join(ROOT, "serviceAccount.json"))) });
  const db = admin.firestore();

  const userDoc = (await db.collection("users").get()).docs[0];
  const snap = await userDoc.ref.collection("posts").get();
  const now = Date.now();

  const posts = [];
  snap.forEach((d) => {
    const v = d.data();
    const t = v.createdAt?.toMillis ? v.createdAt.toMillis() : 0;
    if (t) posts.push({ t, src: src(v), rt: isRt(v) });
  });
  posts.sort((a, b) => a.t - b.t);
  if (!posts.length) { console.log("no posts stored"); process.exit(0); }

  // --- daily volume ---------------------------------------------------------
  const byDay = {};
  posts.forEach((p) => {
    const k = new Date(p.t).toISOString().slice(0, 10);
    byDay[k] = byDay[k] || { n: 0, rt: 0 };
    byDay[k].n++; if (p.rt) byDay[k].rt++;
  });
  console.log("=== daily feed volume ===");
  console.log("date        posts   retweets  rt%    est cost");
  Object.keys(byDay).sort().forEach((k) => {
    const d = byDay[k];
    const partial = k === new Date(now).toISOString().slice(0, 10) ? "  (today, partial)" : "";
    console.log(`${k}  ${String(d.n).padStart(5)}   ${String(d.rt).padStart(8)}  ${String(Math.round(d.rt / d.n * 100)).padStart(3)}%  ` +
      `${usd(d.n * READS_PER_POST * PRICE_PER_READ).padStart(8)}${partial}`);
  });

  // --- recent window --------------------------------------------------------
  const cut = now - RECENT_DAYS * 86400000;
  const recent = posts.filter((p) => p.t >= cut && p.t >= UNFOLLOW_CUTOFF);
  const spanDays = recent.length ? Math.max((now - Math.max(cut, UNFOLLOW_CUTOFF)) / 86400000, 0.5) : 0;
  console.log(`\n=== since unfollows (${recent.length} posts over ${spanDays.toFixed(2)}d) ===`);
  if (recent.length) {
    const rt = recent.filter((p) => p.rt).length;
    const perDay = recent.length / spanDays;
    const monthly = perDay * 30 * READS_PER_POST * PRICE_PER_READ;
    console.log(`${perDay.toFixed(0)} posts/day  ->  ${usd(monthly)}/mo modelled`);
    console.log(`retweets ${rt} (${Math.round(rt / recent.length * 100)}%) = ${usd(rt / spanDays * 30 * READS_PER_POST * PRICE_PER_READ)}/mo`);
    console.log(`with retweet exclusion: ${usd(monthly - rt / spanDays * 30 * READS_PER_POST * PRICE_PER_READ)}/mo`);

    const by = {};
    recent.forEach((p) => { by[p.src] = by[p.src] || { n: 0, rt: 0 }; by[p.src].n++; if (p.rt) by[p.src].rt++; });
    const rows = Object.entries(by).sort((a, b) => b[1].n - a[1].n);
    console.log(`\ntop accounts now (${rows.length} active; * = under 10 observations, rank unreliable)`);
    rows.slice(0, 15).forEach(([h, v], i) => {
      console.log(`${String(i + 1).padStart(2)} @${h.padEnd(18)} ${(v.n / spanDays).toFixed(1).padStart(5)}/d  ` +
        `rt${String(Math.round(v.rt / v.n * 100)).padStart(3)}%  ${usd(v.n / spanDays * 30 * READS_PER_POST * PRICE_PER_READ).padStart(6)}/mo  ${v.n < 10 ? "*" : ""}`);
    });
  } else {
    console.log("(no posts yet since the unfollow cutoff)");
  }

  // --- did the unfollows stick? --------------------------------------------
  const leaks = {};
  posts.filter((p) => p.t > UNFOLLOW_CUTOFF && UNFOLLOWED.has(p.src))
    .forEach((p) => { leaks[p.src] = (leaks[p.src] || 0) + 1; });
  console.log("\n=== unfollow check ===");
  console.log(Object.keys(leaks).length
    ? "STILL ARRIVING: " + Object.entries(leaks).map(([h, n]) => `@${h} (${n})`).join(", ")
    : `clean — nothing from the ${UNFOLLOWED.size} unfollowed accounts since cutoff`);

  // --- X's own usage counter + cap risk ------------------------------------
  const cfg = (await db.collection("config").doc("public").get()).data() || {};
  const u = cfg.usage || {};
  console.log("\n=== X usage endpoint ===");
  console.log(`cycle posts read: ${u.cyclePostsRead ?? "?"} / cap ${u.projectCap ?? "?"} (resets day ${u.capResetDay ?? "?"})`);
  console.log(`cumulative: ${u.postsReadCumulative ?? "?"} posts, est ${usd(Number(u.estimatedCostUsd || 0))} to date`);
  if (u.cyclePostsRead && u.capResetDay) {
    const d = new Date(now);
    let reset = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), u.capResetDay));
    if (reset.getTime() <= now) reset = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, u.capResetDay));
    const elapsed = Math.max((now - (reset.getTime() - 30 * 86400000)) / 86400000, 0.5);
    const projected = u.cyclePostsRead / elapsed * 30 * PRICE_PER_READ;
    console.log(`cycle spend so far ${usd(u.cyclePostsRead * PRICE_PER_READ)} over ${elapsed.toFixed(1)}d ` +
      `-> ${usd(projected)} projected vs ${usd(CYCLE_CAP_USD)} cap ` +
      `${projected > CYCLE_CAP_USD ? "*** OVER CAP — feed will be blocked before cycle end ***" : "(within cap)"}`);
  }
  process.exit(0);
})().catch((e) => { console.error("ERR", e.message); process.exit(1); });

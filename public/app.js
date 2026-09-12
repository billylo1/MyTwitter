import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-app.js";
import {
  getFirestore,
  collection,
  query,
  orderBy,
  limit,
  onSnapshot,
  doc,
  getDoc,
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyCNcleHS4D3NudVyPaK2HQwe0hfq8M-1eg",
  authDomain: "mytwitter-feed.firebaseapp.com",
  projectId: "mytwitter-feed",
  storageBucket: "mytwitter-feed.firebasestorage.app",
  messagingSenderId: "769496094182",
  appId: "1:769496094182:web:8e9419b38a98b8ad323227",
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const feedEl = document.getElementById("feed");
const emptyEl = document.getElementById("empty");
const statusEl = document.getElementById("status");
const refreshedEl = document.getElementById("refreshed");
const usageEl = document.getElementById("usage");

function formatUsd(amount) {
  if (typeof amount !== "number" || Number.isNaN(amount)) return "—";
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 3,
  }).format(amount);
}

function formatAbsolute(date) {
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function renderRefreshed(ts) {
  if (!refreshedEl) return;
  const date = ts?.toDate?.() || (ts instanceof Date ? ts : null);
  if (!date) {
    refreshedEl.textContent = "";
    return;
  }
  refreshedEl.textContent = `Last refreshed ${formatRelative(date)} · ${formatAbsolute(date)}`;
}

function renderUsage(usage) {
  if (!usageEl) return;
  const total =
    typeof usage?.postsReadCumulative === "number"
      ? usage.postsReadCumulative
      : typeof usage?.postsRead === "number"
        ? usage.postsRead
        : null;
  if (total == null) {
    usageEl.textContent = "";
    return;
  }
  const price = usage.pricePerPostUsd || 0.005;
  const cumulativeCost =
    typeof usage.estimatedCostUsd === "number"
      ? usage.estimatedCostUsd
      : total * price;
  const cyclePosts =
    typeof usage.cyclePostsRead === "number" ? usage.cyclePostsRead : null;
  const cycleCost =
    cyclePosts != null ? cyclePosts * price : null;

  let text = `${total.toLocaleString()} posts read · ~${formatUsd(cumulativeCost)} cumulative`;
  if (cyclePosts != null) {
    text += ` · ${cyclePosts.toLocaleString()} this cycle (~${formatUsd(cycleCost)})`;
  }
  usageEl.textContent = text;
}

function subscribePublicConfig() {
  return onSnapshot(
    doc(db, "config", "public"),
    (snap) => {
      if (!snap.exists()) {
        renderUsage(null);
        renderRefreshed(null);
        return;
      }
      const data = snap.data();
      renderUsage(data.usage || null);
      renderRefreshed(data.lastRefreshedAt || null);
    },
    (err) => {
      console.warn("config/public listener failed", err);
    }
  );
}

const FALLBACK_UID = localStorage.getItem("feedUid") || "";

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function linkify(text) {
  const escaped = escapeHtml(text);
  return escaped.replace(
    /(https?:\/\/[^\s<]+)/g,
    (url) => `<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`
  );
}

function formatRelative(date) {
  if (!date) return "";
  const ms = date.getTime() - Date.now();
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  const abs = Math.abs(ms);
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (abs < hour) return rtf.format(Math.round(ms / minute), "minute");
  if (abs < day) return rtf.format(Math.round(ms / hour), "hour");
  if (abs < 30 * day) return rtf.format(Math.round(ms / day), "day");
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function renderPost(id, data) {
  const created = data.createdAt?.toDate?.() || null;
  const handle = data.authorHandle || "unknown";
  const avatar =
    data.authorAvatar ||
    `https://abs.twimg.com/sticky/default_profile_images/default_profile_bigger.png`;
  const media = Array.isArray(data.mediaUrls) ? data.mediaUrls : [];
  const mediaHtml = media.length
    ? `<div class="media">${media
        .map(
          (src) =>
            `<img src="${escapeHtml(src)}" alt="" loading="lazy" referrerpolicy="no-referrer" />`
        )
        .join("")}</div>`
    : "";
  const badge = data.isRetweet ? `<span class="badge">reposted</span>` : "";

  return `<article class="card" data-id="${escapeHtml(id)}">
    <div class="card-header">
      <img class="avatar" src="${escapeHtml(avatar)}" alt="" width="44" height="44" loading="lazy" referrerpolicy="no-referrer" />
      <div>
        <p class="author-name">${escapeHtml(data.authorName || handle)}${badge}</p>
        <p class="author-meta">
          <a href="https://x.com/${escapeHtml(handle)}" target="_blank" rel="noopener noreferrer">@${escapeHtml(handle)}</a>
          · <time datetime="${created ? created.toISOString() : ""}">${escapeHtml(formatRelative(created))}</time>
        </p>
      </div>
    </div>
    <p class="text">${linkify(data.text || "")}</p>
    ${mediaHtml}
    <div class="card-footer">
      <a href="${escapeHtml(data.url || `https://x.com/i/status/${id}`)}" target="_blank" rel="noopener noreferrer">View on X</a>
    </div>
  </article>`;
}

function createPostElement(id, data) {
  const wrap = document.createElement("div");
  wrap.innerHTML = renderPost(id, data).trim();
  return wrap.firstElementChild;
}

function subscribeFeed(uid) {
  const q = query(
    collection(db, "users", uid, "posts"),
    orderBy("createdAt", "desc"),
    limit(100)
  );

  /** @type {Map<string, HTMLElement>} */
  const cards = new Map();

  function syncEmptyState(isEmpty) {
    if (isEmpty) {
      emptyEl.classList.remove("hidden");
      statusEl.textContent = "Waiting for the first sync…";
    } else {
      emptyEl.classList.add("hidden");
    }
  }

  function applyFeedSnapshot(snap) {
    feedEl.setAttribute("aria-busy", "false");

    if (snap.empty) {
      for (const el of cards.values()) el.remove();
      cards.clear();
      syncEmptyState(true);
      return;
    }

    syncEmptyState(false);

    for (const change of snap.docChanges()) {
      const id = change.doc.id;

      if (change.type === "removed") {
        cards.get(id)?.remove();
        cards.delete(id);
        continue;
      }

      const data = change.doc.data();
      const next = createPostElement(id, data);
      const prev = cards.get(id);

      if (prev) {
        // Rebuild only this card; siblings stay mounted (no full-feed flicker).
        prev.replaceWith(next);
      }
      cards.set(id, next);
    }

    // Ensure DOM order matches query order without remounting unchanged nodes.
    let previous = null;
    for (const d of snap.docs) {
      const el = cards.get(d.id);
      if (!el) continue;
      if (previous) {
        if (previous.nextElementSibling !== el) previous.after(el);
      } else if (feedEl.firstElementChild !== el) {
        feedEl.prepend(el);
      }
      previous = el;
    }

    statusEl.textContent = `${snap.size} recent posts · live`;
  }

  return onSnapshot(q, applyFeedSnapshot, (err) => {
    console.error(err);
    statusEl.textContent = `Could not load feed: ${err.message}`;
    feedEl.setAttribute("aria-busy", "false");
  });
}

async function resolveUid() {
  const params = new URLSearchParams(location.search);
  const fromQuery = params.get("uid");
  if (fromQuery) return fromQuery;

  try {
    const cfg = await getDoc(doc(db, "config", "public"));
    if (cfg.exists() && cfg.data().defaultUid) {
      return cfg.data().defaultUid;
    }
  } catch (err) {
    console.warn("config/public not readable yet", err);
  }

  if (FALLBACK_UID) return FALLBACK_UID;
  return null;
}

async function boot() {
  const dialog = document.getElementById("info-dialog");
  const openBtn = document.getElementById("info-open");
  const closeBtn = document.getElementById("info-close");
  if (dialog && openBtn && closeBtn) {
    openBtn.addEventListener("click", () => dialog.showModal());
    closeBtn.addEventListener("click", () => dialog.close());
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) dialog.close();
    });
  }

  subscribePublicConfig();
  const uid = await resolveUid();
  if (!uid) {
    statusEl.textContent =
      "No feed user configured yet. Run npm run oauth, then refresh.";
    emptyEl.classList.remove("hidden");
    feedEl.setAttribute("aria-busy", "false");
    return;
  }
  statusEl.textContent = "Connecting…";
  subscribeFeed(uid);
}

boot();

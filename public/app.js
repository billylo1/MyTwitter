import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
  signInWithCustomToken,
  signOut,
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js";
import {
  getFirestore,
  collection,
  query,
  orderBy,
  limit,
  onSnapshot,
  doc,
  getDoc,
  getDocs,
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import {
  getFunctions,
  httpsCallable,
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-functions.js";

const firebaseConfig = {
  apiKey: "AIzaSyCNcleHS4D3NudVyPaK2HQwe0hfq8M-1eg",
  authDomain: "mytwitter-feed.firebaseapp.com",
  projectId: "mytwitter-feed",
  storageBucket: "mytwitter-feed.firebasestorage.app",
  messagingSenderId: "769496094182",
  appId: "1:769496094182:web:8e9419b38a98b8ad323227",
};

const START_X_AUTH = `${location.origin}/oauth/start`;

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const functions = getFunctions(app, "us-central1");

const authGateEl = document.getElementById("auth-gate");
const appShellEl = document.getElementById("app-shell");
const authMessageEl = document.getElementById("auth-message");
const authErrorEl = document.getElementById("auth-error");
const signInBtn = document.getElementById("sign-in-btn");
const signOutBtn = document.getElementById("sign-out-btn");
const whoamiEl = document.getElementById("whoami");
const memberSelectEl = document.getElementById("member-select");
const adminPanelEl = document.getElementById("admin-panel");
const createInviteBtn = document.getElementById("create-invite-btn");
const inviteResultEl = document.getElementById("invite-result");

const feedEl = document.getElementById("feed");
const emptyEl = document.getElementById("empty");
const statusEl = document.getElementById("status");
const refreshedEl = document.getElementById("refreshed");
const usageEl = document.getElementById("usage");

let feedUnsub = null;
let configUnsub = null;
let currentMember = null;
/** @type {Map<string, object>} */
const membersById = new Map();

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
    (url) =>
      `<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`
  );
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
  const cycleCost = cyclePosts != null ? cyclePosts * price : null;

  let text = `${total.toLocaleString()} posts read · ~${formatUsd(cumulativeCost)} cumulative`;
  if (cyclePosts != null) {
    text += ` · ${cyclePosts.toLocaleString()} this cycle (~${formatUsd(cycleCost)})`;
  }
  usageEl.textContent = text;
}

function subscribePublicConfig() {
  if (configUnsub) configUnsub();
  configUnsub = onSnapshot(
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
  if (feedUnsub) {
    feedUnsub();
    feedUnsub = null;
  }
  feedEl.innerHTML = "";
  feedEl.setAttribute("aria-busy", "true");

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
        prev.replaceWith(next);
      }
      cards.set(id, next);
    }

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

  feedUnsub = onSnapshot(q, applyFeedSnapshot, (err) => {
    console.error(err);
    statusEl.textContent = `Could not load feed: ${err.message}`;
    feedEl.setAttribute("aria-busy", "false");
  });
}

function inviteFromUrl() {
  return new URLSearchParams(location.search).get("invite") || "";
}

function startAuthUrl() {
  const invite = inviteFromUrl();
  const u = new URL(START_X_AUTH);
  if (invite) u.searchParams.set("invite", invite);
  return u.toString();
}

function showAuthGate(message) {
  appShellEl.classList.add("hidden");
  authGateEl.classList.remove("hidden");
  if (message) authMessageEl.textContent = message;
  signInBtn.href = startAuthUrl();
}

function showAuthError(code) {
  const messages = {
    not_invited:
      "You’re not on the family list yet. Ask for an invite link, then try again.",
    expired_or_invalid_session: "Sign-in timed out. Please try again.",
    expired_session: "Sign-in timed out. Please try again.",
    oauth_failed: "X sign-in failed. Please try again.",
    missing_oauth_params: "X sign-in was cancelled or incomplete.",
  };
  authErrorEl.textContent =
    messages[code] || (code ? `Sign-in error: ${code}` : "");
  authErrorEl.classList.toggle("hidden", !authErrorEl.textContent);
}

async function consumeAuthParams() {
  const params = new URLSearchParams(location.search);
  const token = params.get("token");
  const authError = params.get("authError");
  const invite = params.get("invite");

  if (authError) {
    showAuthError(authError);
    params.delete("authError");
    const next = `${location.pathname}${params.toString() ? `?${params}` : ""}${location.hash}`;
    history.replaceState({}, "", next);
  }

  if (token) {
    params.delete("token");
    const next = `${location.pathname}${params.toString() ? `?${params}` : ""}${location.hash}`;
    history.replaceState({}, "", next);
    await signInWithCustomToken(auth, token);
  }

  if (invite && !authError) {
    authMessageEl.textContent =
      "You have an invite. Sign in with X to join this private feed.";
  }
}

function populateMemberSelect(selectedUid) {
  const members = [...membersById.values()].sort((a, b) =>
    String(a.handle || "").localeCompare(String(b.handle || ""))
  );
  memberSelectEl.innerHTML = members
    .map((m) => {
      const id = m.xUserId || m.id;
      const label =
        id === auth.currentUser?.uid
          ? `@${m.handle} (you)`
          : `@${m.handle || id}`;
      return `<option value="${escapeHtml(id)}"${id === selectedUid ? " selected" : ""}>${escapeHtml(label)}</option>`;
    })
    .join("");
}

async function loadMembers() {
  const snap = await getDocs(collection(db, "members"));
  membersById.clear();
  snap.forEach((d) => {
    const data = d.data();
    if (data.enabled === false) return;
    membersById.set(d.id, { id: d.id, ...data });
  });
}

async function enterApp(user) {
  authGateEl.classList.add("hidden");
  appShellEl.classList.remove("hidden");
  authErrorEl.classList.add("hidden");

  const memberSnap = await getDoc(doc(db, "members", user.uid));
  if (!memberSnap.exists() || memberSnap.data()?.enabled === false) {
    await signOut(auth);
    showAuthGate("You’re signed in to X but not a member of this feed yet.");
    showAuthError("not_invited");
    return;
  }

  currentMember = { id: memberSnap.id, ...memberSnap.data() };
  whoamiEl.textContent = `Signed in as @${currentMember.handle || user.uid}`;
  adminPanelEl.classList.toggle("hidden", currentMember.role !== "admin");

  await loadMembers();

  const params = new URLSearchParams(location.search);
  const fromQuery = params.get("uid");
  const feedUid =
    fromQuery && membersById.has(fromQuery)
      ? fromQuery
      : user.uid;

  populateMemberSelect(feedUid);
  subscribePublicConfig();
  statusEl.textContent = "Connecting…";
  subscribeFeed(feedUid);
}

function wireUi() {
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

  signInBtn.href = startAuthUrl();
  signInBtn.addEventListener("click", (e) => {
    e.preventDefault();
    location.href = startAuthUrl();
  });

  signOutBtn.addEventListener("click", () => signOut(auth));

  memberSelectEl.addEventListener("change", () => {
    const uid = memberSelectEl.value;
    const params = new URLSearchParams(location.search);
    if (uid === auth.currentUser?.uid) params.delete("uid");
    else params.set("uid", uid);
    const next = `${location.pathname}${params.toString() ? `?${params}` : ""}`;
    history.replaceState({}, "", next);
    subscribeFeed(uid);
  });

  createInviteBtn.addEventListener("click", async () => {
    inviteResultEl.textContent = "Creating…";
    try {
      const createInvite = httpsCallable(functions, "createInvite");
      const result = await createInvite({ maxUses: 5, days: 14 });
      const data = result.data;
      inviteResultEl.textContent = data.url;
      try {
        await navigator.clipboard.writeText(data.url);
        inviteResultEl.textContent = `${data.url} (copied)`;
      } catch {
        /* ignore clipboard errors */
      }
    } catch (err) {
      console.error(err);
      inviteResultEl.textContent = err.message || "Could not create invite";
    }
  });
}

async function boot() {
  wireUi();
  try {
    await consumeAuthParams();
  } catch (err) {
    console.error(err);
    showAuthError("oauth_failed");
  }

  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      if (feedUnsub) {
        feedUnsub();
        feedUnsub = null;
      }
      if (configUnsub) {
        configUnsub();
        configUnsub = null;
      }
      showAuthGate(
        inviteFromUrl()
          ? "You have an invite. Sign in with X to join this private feed."
          : "Sign in with X to view your following feed. Friends and family only."
      );
      return;
    }
    try {
      await enterApp(user);
    } catch (err) {
      console.error(err);
      showAuthGate("Could not load your membership. Try signing in again.");
    }
  });
}

boot();

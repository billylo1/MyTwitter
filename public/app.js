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
  setDoc,
  deleteDoc,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import {
  getFunctions,
  httpsCallable,
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-functions.js";

const firebaseConfig = window.FIREBASE_CONFIG;
if (!firebaseConfig?.projectId || firebaseConfig.projectId === "YOUR_PROJECT_ID") {
  throw new Error(
    "Missing Firebase web config. Copy public/firebase-config.example.js → public/firebase-config.js and fill in your project values."
  );
}

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
const adminPanelEl = document.getElementById("admin-panel");
const createInviteBtn = document.getElementById("create-invite-btn");
const inviteResultEl = document.getElementById("invite-result");

const feedEl = document.getElementById("feed");
const emptyEl = document.getElementById("empty");
const statusEl = document.getElementById("status");
const refreshedEl = document.getElementById("refreshed");
const usageEl = document.getElementById("usage");

let feedUnsub = null;
let likesUnsub = null;
let favoritesUnsub = null;
let configUnsub = null;
let invitesEnabled = false;
let currentMember = null;
/** @type {Set<string>} */
let likedIds = new Set();
/** @type {Set<string>} */
let favoritedIds = new Set();
/** @type {Map<string, object>} */
const favoriteMeta = new Map();

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
  if (abs < minute) return "just now";
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

/** Hide the card URL in body text when a link preview is already shown. */
function stripPreviewUrlsFromText(text, preview) {
  if (!preview || !text) return text || "";
  let out = String(text);
  const candidates = [
    preview.tcoUrl,
    preview.expandedUrl,
    preview.url,
    preview.displayUrl,
  ].filter(Boolean);
  for (const raw of candidates) {
    const escaped = String(raw).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    out = out.replace(new RegExp(escaped, "gi"), "");
  }
  if (!preview.tcoUrl) {
    out = out.replace(/https?:\/\/t\.co\/[A-Za-z0-9]+/gi, "");
  }
  return out
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function renderRefreshed(ts) {
  if (!refreshedEl) return;
  const date = ts?.toDate?.() || (ts instanceof Date ? ts : null);
  if (!date) {
    refreshedEl.textContent = "";
    refreshedEl.classList.add("hidden");
    return;
  }
  refreshedEl.classList.remove("hidden");
  refreshedEl.textContent = formatRelative(date);
  refreshedEl.title = formatAbsolute(date);
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

function updateAdminPanel() {
  const show =
    Boolean(currentMember) &&
    currentMember.role === "admin" &&
    invitesEnabled;
  adminPanelEl.classList.toggle("hidden", !show);
}

function subscribePublicConfig() {
  if (configUnsub) configUnsub();
  configUnsub = onSnapshot(
    doc(db, "config", "public"),
    (snap) => {
      if (!snap.exists()) {
        invitesEnabled = false;
        renderUsage(null);
        renderRefreshed(null);
        updateAdminPanel();
        return;
      }
      const data = snap.data();
      invitesEnabled = data.invitesEnabled === true;
      renderUsage(data.usage || null);
      renderRefreshed(data.lastRefreshedAt || null);
      updateAdminPanel();
    },
    (err) => {
      console.warn("config/public listener failed", err);
    }
  );
}

function renderMediaItem(item) {
  const type = item?.type || "photo";
  const poster = item.previewUrl || item.url || "";
  const alt = escapeHtml(item.alt || "");
  if ((type === "video" || type === "animated_gif") && item.videoUrl) {
    const src = escapeHtml(item.videoUrl);
    const posterAttr = poster ? ` poster="${escapeHtml(poster)}"` : "";
    if (type === "animated_gif") {
      return `<video class="media-gif" data-src="${src}"${posterAttr} autoplay muted loop playsinline></video>`;
    }
    return `<video class="media-video" data-src="${src}"${posterAttr} muted playsinline controls preload="metadata" controlslist="nodownload"></video>`;
  }
  if (!poster) return "";
  return `<img src="${escapeHtml(poster)}" alt="${alt}" loading="lazy" referrerpolicy="no-referrer" />`;
}

function renderMedia(data) {
  const items =
    Array.isArray(data.media) && data.media.length
      ? data.media
      : (Array.isArray(data.mediaUrls) ? data.mediaUrls : []).map((url) => ({
          type: "photo",
          url,
          previewUrl: url,
        }));
  if (!items.length) return "";
  const multi = items.length > 1 ? " media-multi" : "";
  return `<div class="media${multi}" data-count="${items.length}">${items.map(renderMediaItem).join("")}</div>`;
}

function renderLinkPreview(preview) {
  if (!preview?.url) return "";
  const domain = preview.domain || preview.displayUrl || "";
  const title = preview.title || domain || preview.url;
  const desc = preview.description
    ? `<p class="link-preview-desc">${escapeHtml(preview.description)}</p>`
    : "";
  const thumb = preview.imageUrl
    ? `<img class="link-preview-img" src="${escapeHtml(preview.imageUrl)}" alt="" loading="lazy" referrerpolicy="no-referrer" />`
    : `<div class="link-preview-placeholder" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="28" height="28">
          <path fill="currentColor" d="M6 4h9l3 3v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zm8 1v3h3M8 11h8v1.5H8V11zm0 3.5h8V16H8v-1.5zm0 3.5h5V19.5H8V18z"/>
        </svg>
      </div>`;
  return `<a class="link-preview" href="${escapeHtml(preview.url)}" target="_blank" rel="noopener noreferrer">
    <div class="link-preview-media">${thumb}</div>
    <div class="link-preview-body">
      ${domain ? `<p class="link-preview-domain">${escapeHtml(domain)}</p>` : ""}
      <p class="link-preview-title">${escapeHtml(title)}</p>
      ${desc}
    </div>
  </a>`;
}

function renderPost(id, data) {
  const created = data.createdAt?.toDate?.() || null;
  const handle = data.authorHandle || "unknown";
  const avatar =
    data.authorAvatar ||
    `https://abs.twimg.com/sticky/default_profile_images/default_profile_bigger.png`;
  const reposterHandle = data.repostedByHandle || "";
  const sameAuthor =
    (data.repostedById &&
      data.authorId &&
      String(data.repostedById) === String(data.authorId)) ||
    (reposterHandle &&
      handle &&
      reposterHandle.toLowerCase() === String(handle).toLowerCase());
  const showRepost = Boolean(data.isRetweet) && !sameAuthor;
  const repostLine =
    showRepost && reposterHandle
      ? `<p class="repost-line">
          <span
            class="author-hover reposter-hover"
            data-author-id="${escapeHtml(data.repostedById || "")}"
            data-author-handle="${escapeHtml(reposterHandle)}"
            data-author-name="${escapeHtml(data.repostedByName || reposterHandle)}"
            data-author-avatar="${escapeHtml(data.repostedByAvatar || "")}"
          >@${escapeHtml(reposterHandle)}</span>
          <span class="repost-label">reposted</span>
        </p>`
      : showRepost
        ? `<p class="repost-line"><span class="repost-label">reposted</span></p>`
        : "";

  const url = data.url || `https://x.com/i/status/${id}`;
  const liked = likedIds.has(id);
  const isFavoritedAuthor =
    (data.authorId && favoritedIds.has(String(data.authorId))) ||
    (data.repostedById && favoritedIds.has(String(data.repostedById)));
  const bodyText = data.linkPreview
    ? stripPreviewUrlsFromText(data.text || "", data.linkPreview)
    : data.text || "";
  const textBlock = bodyText
    ? `<p class="text">${linkify(bodyText)}</p>`
    : "";
  const favMark = isFavoritedAuthor
    ? `<span class="card-favorite-mark" title="Favorited account" aria-hidden="true">★</span>`
    : "";
  return `<article class="card${isFavoritedAuthor ? " is-favorited-author" : ""}" data-id="${escapeHtml(id)}" data-url="${escapeHtml(url)}" data-author-id="${escapeHtml(data.authorId || "")}" data-reposted-by-id="${escapeHtml(data.repostedById || "")}">
    ${favMark}
    <a class="card-hit" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" aria-label="View on X"></a>
    <div class="card-actions">
      <button
        type="button"
        class="action-btn action-like${liked ? " is-liked" : ""}"
        aria-label="${liked ? "Unlike" : "Like"}"
        aria-pressed="${liked ? "true" : "false"}"
        title="${liked ? "Unlike" : "Like"}"
      >
        <svg class="action-icon" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
        </svg>
      </button>
      <button
        type="button"
        class="action-btn action-share"
        aria-label="Share"
        title="Share"
      >
        <svg class="action-icon" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M18 16.08c-.76 0-1.44.3-1.96.77L8.91 12.7c.05-.23.09-.46.09-.7s-.04-.47-.09-.7l7.05-4.11c.54.5 1.25.81 2.04.81 1.66 0 3-1.34 3-3s-1.34-3-3-3-3 1.34-3 3c0 .24.04.47.09.7L8.04 9.81C7.5 9.31 6.79 9 6 9c-1.66 0-3 1.34-3 3s1.34 3 3 3c.79 0 1.5-.31 2.04-.81l7.12 4.16c-.05.21-.08.43-.08.65 0 1.61 1.31 2.92 2.92 2.92s2.92-1.31 2.92-2.92-1.31-2.92-2.92-2.92z"/>
        </svg>
      </button>
    </div>
    ${repostLine}
    <div class="card-header">
      <div class="author-hover" data-author-id="${escapeHtml(data.authorId || "")}" data-author-handle="${escapeHtml(handle)}" data-author-name="${escapeHtml(data.authorName || handle)}" data-author-avatar="${escapeHtml(avatar)}">
        <img class="avatar" src="${escapeHtml(avatar)}" alt="" width="44" height="44" loading="lazy" referrerpolicy="no-referrer" />
        <div>
          <p class="author-name">${escapeHtml(data.authorName || handle)}</p>
          <p class="author-meta">
            <a class="author-handle" href="https://x.com/${escapeHtml(handle)}" target="_blank" rel="noopener noreferrer">@${escapeHtml(handle)}</a>
            · <time datetime="${created ? created.toISOString() : ""}">${escapeHtml(formatRelative(created))}</time>
          </p>
        </div>
      </div>
    </div>
    ${textBlock}
    ${renderLinkPreview(data.linkPreview)}
    ${renderMedia(data)}
  </article>`;
}

function createPostElement(id, data) {
  const wrap = document.createElement("div");
  wrap.innerHTML = renderPost(id, data).trim();
  const el = wrap.firstElementChild;
  for (const video of el.querySelectorAll("video[data-src]")) {
    video.referrerPolicy = "no-referrer";
    video.src = video.dataset.src;
    video.removeAttribute("data-src");
  }
  bindAuthorHover(el);
  return el;
}

const authorCardEl = document.getElementById("author-card");
const authorCardAvatar = document.getElementById("author-card-avatar");
const authorCardName = document.getElementById("author-card-name");
const authorCardHandle = document.getElementById("author-card-handle");
const authorCardBio = document.getElementById("author-card-bio");
const authorCardStatus = document.getElementById("author-card-status");
const authorCardFollow = document.getElementById("author-card-follow");
const authorCardFavorite = document.getElementById("author-card-favorite");
/** @type {Map<string, object>} */
const authorCardCache = new Map();
let authorShowTimer = 0;
let authorHideTimer = 0;
let authorFetchGen = 0;
/** @type {object | null} */
let authorCardState = null;
/** Coarse pointer = touch / pen; fine + hover = desktop. */
const finePointer =
  typeof window.matchMedia === "function" &&
  window.matchMedia("(hover: hover) and (pointer: fine)").matches;

function authorCacheKey(handle, userId) {
  return String(userId || handle || "").toLowerCase();
}

function hideAuthorCard() {
  window.clearTimeout(authorShowTimer);
  window.clearTimeout(authorHideTimer);
  authorCardEl.classList.add("hidden");
  authorCardState = null;
}

function placeAuthorCard(trigger) {
  const gap = 8;
  const r = trigger.getBoundingClientRect();
  authorCardEl.classList.remove("hidden");
  const cr = authorCardEl.getBoundingClientRect();
  let top = r.bottom + gap;
  let left = r.left;
  if (top + cr.height > window.innerHeight - gap) {
    top = r.top - cr.height - gap;
  }
  if (left + cr.width > window.innerWidth - gap) {
    left = window.innerWidth - cr.width - gap;
  }
  if (left < gap) left = gap;
  if (top < gap) top = gap;
  authorCardEl.style.top = `${Math.round(top)}px`;
  authorCardEl.style.left = `${Math.round(left)}px`;
}

function renderAuthorCard(data, { pending = false } = {}) {
  const handle = data.handle || "";
  authorCardAvatar.src =
    data.avatar ||
    "https://abs.twimg.com/sticky/default_profile_images/default_profile_bigger.png";
  authorCardName.innerHTML = `${escapeHtml(data.name || handle)}${
    data.verified ? `<span class="verified" title="Verified">✔</span>` : ""
  }`;
  authorCardHandle.textContent = handle ? `@${handle}` : "";
  authorCardBio.textContent = data.description || "";
  authorCardBio.classList.toggle("hidden", !data.description);
  if (data.error) {
    authorCardStatus.textContent = data.error;
    authorCardStatus.classList.remove("hidden");
  } else {
    authorCardStatus.textContent = "";
    authorCardStatus.classList.add("hidden");
  }

  const isSelf = Boolean(data.isSelf);
  // Feed authors are usually already followed; default to following until API says otherwise.
  const following =
    typeof data.following === "boolean" ? data.following : true;
  const authorId = data.id ? String(data.id) : "";
  const favorited =
    typeof data.favorited === "boolean"
      ? data.favorited
      : Boolean(authorId && favoritedIds.has(authorId));
  authorCardFollow.classList.toggle("hidden", isSelf);
  authorCardFollow.disabled = pending || isSelf || !data.id;
  authorCardFollow.classList.toggle("is-following", following);
  authorCardFollow.textContent = following ? "Following" : "Follow";
  if (authorCardFavorite) {
    authorCardFavorite.classList.toggle("hidden", isSelf);
    authorCardFavorite.disabled = pending || isSelf || !data.id;
    authorCardFavorite.classList.toggle("is-favorited", favorited);
    authorCardFavorite.setAttribute("aria-pressed", favorited ? "true" : "false");
    authorCardFavorite.textContent = favorited ? "Favorited" : "Favorite";
    authorCardFavorite.title = favorited
      ? "Remove from favorites"
      : "Add to favorites";
  }
  authorCardState = { ...data, following, favorited };
}

async function loadAuthorCard(seed, trigger) {
  const gen = ++authorFetchGen;
  const cacheKey = authorCacheKey(seed.handle, seed.id);
  const cached = authorCardCache.get(cacheKey);
  if (cached) {
    renderAuthorCard(cached);
    return;
  }
  renderAuthorCard({ ...seed, description: "" }, { pending: true });
  try {
    const getAuthorCard = httpsCallable(functions, "getAuthorCard");
    const result = await getAuthorCard({
      userId: seed.id || undefined,
      handle: seed.handle || undefined,
    });
    if (gen !== authorFetchGen) return;
    const data = result.data;
    authorCardCache.set(authorCacheKey(data.handle, data.id), data);
    renderAuthorCard(data);
    if (trigger) placeAuthorCard(trigger);
  } catch (err) {
    if (gen !== authorFetchGen) return;
    const message =
      err.code === "functions/failed-precondition"
        ? err.message
        : "Could not load this account.";
    renderAuthorCard({ ...seed, error: message }, { pending: false });
  }
}

function seedFromTrigger(trigger) {
  return {
    id: trigger.dataset.authorId || "",
    handle: trigger.dataset.authorHandle || "",
    name: trigger.dataset.authorName || "",
    avatar: trigger.dataset.authorAvatar || "",
  };
}

function scheduleAuthorShow(trigger) {
  window.clearTimeout(authorHideTimer);
  window.clearTimeout(authorShowTimer);
  authorShowTimer = window.setTimeout(() => {
    loadAuthorCard(seedFromTrigger(trigger), trigger).then(() =>
      placeAuthorCard(trigger)
    );
    placeAuthorCard(trigger);
  }, 380);
}

function scheduleAuthorHide() {
  window.clearTimeout(authorShowTimer);
  window.clearTimeout(authorHideTimer);
  authorHideTimer = window.setTimeout(hideAuthorCard, 220);
}

async function openAuthorCard(trigger) {
  window.clearTimeout(authorHideTimer);
  window.clearTimeout(authorShowTimer);
  await loadAuthorCard(seedFromTrigger(trigger), trigger);
  placeAuthorCard(trigger);
}

function bindAuthorHover(el) {
  for (const trigger of el.querySelectorAll(".author-hover")) {
    if (finePointer) {
      trigger.addEventListener("mouseenter", () => scheduleAuthorShow(trigger));
      trigger.addEventListener("mouseleave", scheduleAuthorHide);
    }
    trigger.addEventListener("click", (event) => {
      if (event.target.closest("a")) return;
      event.preventDefault();
      event.stopPropagation();
      void openAuthorCard(trigger);
    });
  }
}

const videoObserver = new IntersectionObserver(
  (entries) => {
    for (const entry of entries) {
      const video = entry.target;
      if (!(video instanceof HTMLVideoElement)) continue;
      if (entry.isIntersecting) {
        video.play().catch(() => {});
      } else {
        video.pause();
      }
    }
  },
  { threshold: 0.55 }
);

function watchCardVideos(el) {
  for (const video of el.querySelectorAll("video.media-video")) {
    videoObserver.observe(video);
  }
}

function unwatchCardVideos(el) {
  for (const video of el.querySelectorAll("video")) {
    videoObserver.unobserve(video);
  }
}

function setLikeButtonState(btn, liked) {
  btn.classList.toggle("is-liked", liked);
  btn.setAttribute("aria-pressed", liked ? "true" : "false");
  btn.setAttribute("aria-label", liked ? "Unlike" : "Like");
  btn.title = liked ? "Unlike" : "Like";
}

function syncLikeButtons() {
  for (const btn of feedEl.querySelectorAll(".action-like")) {
    const id = btn.closest(".card")?.dataset.id;
    if (!id) continue;
    setLikeButtonState(btn, likedIds.has(id));
  }
}

function subscribeLikes(uid) {
  if (likesUnsub) {
    likesUnsub();
    likesUnsub = null;
  }
  likedIds = new Set();
  likesUnsub = onSnapshot(
    collection(db, "users", uid, "likes"),
    (snap) => {
      likedIds = new Set(snap.docs.map((d) => d.id));
      syncLikeButtons();
    },
    (err) => {
      console.error(err);
    }
  );
}

function syncFavoriteMarks() {
  for (const card of feedEl.querySelectorAll(".card")) {
    const authorId = card.dataset.authorId || "";
    const repostedById = card.dataset.repostedById || "";
    const isFav =
      (authorId && favoritedIds.has(authorId)) ||
      (repostedById && favoritedIds.has(repostedById));
    card.classList.toggle("is-favorited-author", isFav);
    let mark = card.querySelector(".card-favorite-mark");
    if (isFav && !mark) {
      mark = document.createElement("span");
      mark.className = "card-favorite-mark";
      mark.title = "Favorited account";
      mark.setAttribute("aria-hidden", "true");
      mark.textContent = "★";
      card.prepend(mark);
    } else if (!isFav && mark) {
      mark.remove();
    }
  }
  if (authorCardState?.id) {
    renderAuthorCard({
      ...authorCardState,
      favorited: favoritedIds.has(String(authorCardState.id)),
    });
  }
}

function subscribeFavorites(uid) {
  if (favoritesUnsub) {
    favoritesUnsub();
    favoritesUnsub = null;
  }
  favoritedIds = new Set();
  favoriteMeta.clear();
  favoritesUnsub = onSnapshot(
    collection(db, "users", uid, "favorites"),
    (snap) => {
      favoritedIds = new Set(snap.docs.map((d) => d.id));
      favoriteMeta.clear();
      for (const d of snap.docs) {
        favoriteMeta.set(d.id, d.data() || {});
      }
      syncFavoriteMarks();
    },
    (err) => {
      console.error(err);
    }
  );
}

async function toggleFavorite(author) {
  const uid = auth.currentUser?.uid;
  const authorId = author?.id ? String(author.id) : "";
  if (!uid || !authorId || author.isSelf) return;
  const next = !favoritedIds.has(authorId);
  const ref = doc(db, "users", uid, "favorites", authorId);
  if (authorCardFavorite) {
    authorCardFavorite.disabled = true;
    authorCardFavorite.classList.toggle("is-favorited", next);
    authorCardFavorite.setAttribute("aria-pressed", next ? "true" : "false");
    authorCardFavorite.textContent = next ? "Favorited" : "Favorite";
  }
  try {
    if (next) {
      await setDoc(ref, {
        handle: author.handle || "",
        name: author.name || author.handle || "",
        avatar: author.avatar || null,
        favoritedAt: serverTimestamp(),
      });
      favoritedIds.add(authorId);
    } else {
      await deleteDoc(ref);
      favoritedIds.delete(authorId);
    }
    const updated = { ...author, favorited: next };
    authorCardCache.set(authorCacheKey(updated.handle, updated.id), updated);
    renderAuthorCard(updated);
    syncFavoriteMarks();
  } catch (err) {
    console.error(err);
    if (authorCardFavorite) {
      authorCardFavorite.classList.toggle("is-favorited", !next);
      authorCardFavorite.setAttribute(
        "aria-pressed",
        !next ? "true" : "false"
      );
      authorCardFavorite.textContent = !next ? "Favorited" : "Favorite";
    }
    const message = err.message || "Could not update favorite.";
    statusEl.textContent = message;
    if (authorCardState) {
      renderAuthorCard({ ...authorCardState, error: message });
    }
  } finally {
    if (authorCardFavorite && authorCardState) {
      authorCardFavorite.disabled =
        authorCardState.isSelf || !authorCardState.id;
    }
  }
}

async function toggleLike(card, btn) {
  const tweetId = card.dataset.id;
  if (!tweetId || btn.disabled) return;
  const nextLiked = !btn.classList.contains("is-liked");
  setLikeButtonState(btn, nextLiked);
  btn.disabled = true;
  try {
    const setLiked = httpsCallable(functions, "setLiked");
    await setLiked({ tweetId, like: nextLiked });
    if (nextLiked) likedIds.add(tweetId);
    else likedIds.delete(tweetId);
  } catch (err) {
    setLikeButtonState(btn, !nextLiked);
    const message =
      err.code === "functions/failed-precondition"
        ? err.message
        : "Could not update like.";
    console.error(err);
    btn.title = message;
    statusEl.textContent = message;
  } finally {
    btn.disabled = false;
  }
}

function flashActionLabel(btn, label) {
  const actions = btn.closest(".card-actions");
  if (!actions) return;
  let tip = actions.querySelector(".action-tip");
  if (!tip) {
    tip = document.createElement("span");
    tip.className = "action-tip";
    tip.setAttribute("role", "status");
    actions.appendChild(tip);
  }
  tip.textContent = label;
  tip.classList.add("is-visible");
  btn.setAttribute("aria-label", label);
  btn.classList.add("is-copied");
  window.clearTimeout(tip._hideTimer);
  tip._hideTimer = window.setTimeout(() => {
    tip.classList.remove("is-visible");
    tip.textContent = "";
    if (btn.classList.contains("action-share")) {
      btn.setAttribute("aria-label", "Share");
      btn.title = "Share";
    }
    btn.classList.remove("is-copied");
  }, 1800);
}

async function sharePost(card, btn) {
  const url = card.dataset.url || `https://x.com/i/status/${card.dataset.id}`;
  const text = card.querySelector(".text")?.textContent?.trim() || "";
  const shareData = {
    title: "Post from MyTwitter",
    text: text.slice(0, 200),
    url,
  };
  const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  btn.disabled = true;
  try {
    if (isMobile && typeof navigator.share === "function") {
      const canShare =
        typeof navigator.canShare !== "function" || navigator.canShare(shareData);
      if (canShare) {
        await navigator.share(shareData);
        return;
      }
    }
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(url);
      flashActionLabel(btn, "Link copied");
      return;
    }
    window.open(url, "_blank", "noopener,noreferrer");
  } catch (err) {
    if (err?.name === "AbortError") return;
    console.error(err);
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
        flashActionLabel(btn, "Link copied");
        return;
      }
    } catch (copyErr) {
      console.error(copyErr);
    }
    flashActionLabel(btn, "Could not share");
    statusEl.textContent = "Could not share post.";
  } finally {
    btn.disabled = false;
  }
}

function subscribeFeed(uid) {
  if (feedUnsub) {
    feedUnsub();
    feedUnsub = null;
  }
  for (const video of feedEl.querySelectorAll("video")) {
    videoObserver.unobserve(video);
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
      for (const el of cards.values()) {
        unwatchCardVideos(el);
        el.remove();
      }
      cards.clear();
      syncEmptyState(true);
      return;
    }

    syncEmptyState(false);

    for (const change of snap.docChanges()) {
      const id = change.doc.id;

      if (change.type === "removed") {
        const gone = cards.get(id);
        if (gone) {
          unwatchCardVideos(gone);
          gone.remove();
        }
        cards.delete(id);
        continue;
      }

      const data = change.doc.data();
      const next = createPostElement(id, data);
      const prev = cards.get(id);

      if (prev) {
        unwatchCardVideos(prev);
        prev.replaceWith(next);
      }
      watchCardVideos(next);
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
    // Server still rejects redemption when invitesEnabled is false.
    authMessageEl.textContent =
      "You have an invite. Sign in with X to join this private feed.";
  }
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
  whoamiEl.textContent = `@${currentMember.handle || user.uid}`;
  updateAdminPanel();

  const params = new URLSearchParams(location.search);
  if (params.has("uid")) {
    params.delete("uid");
    const next = `${location.pathname}${params.toString() ? `?${params}` : ""}`;
    history.replaceState({}, "", next);
  }

  subscribePublicConfig();
  statusEl.textContent = "Connecting…";
  subscribeLikes(user.uid);
  subscribeFavorites(user.uid);
  subscribeFeed(user.uid);
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

  if (authorCardEl && authorCardFollow) {
    authorCardEl.addEventListener("mouseenter", () => {
      window.clearTimeout(authorHideTimer);
    });
    authorCardEl.addEventListener("mouseleave", () => {
      if (finePointer) scheduleAuthorHide();
    });
    document.addEventListener("click", (event) => {
      if (authorCardEl.classList.contains("hidden")) return;
      if (authorCardEl.contains(event.target)) return;
      if (event.target.closest(".author-hover")) return;
      hideAuthorCard();
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !authorCardEl.classList.contains("hidden")) {
        hideAuthorCard();
      }
    });
    authorCardFollow.addEventListener("mouseenter", () => {
      if (authorCardFollow.classList.contains("is-following")) {
        authorCardFollow.textContent = "Unfollow";
      }
    });
    authorCardFollow.addEventListener("mouseleave", () => {
      if (authorCardFollow.classList.contains("is-following")) {
        authorCardFollow.textContent = "Following";
      }
    });
    authorCardFollow.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      const current = authorCardState;
      if (!current?.id || current.isSelf) return;
      const nextFollow = !current.following;
      authorCardFollow.disabled = true;
      try {
        const setFollowing = httpsCallable(functions, "setFollowing");
        await setFollowing({ userId: current.id, follow: nextFollow });
        const updated = { ...current, following: nextFollow, error: "" };
        authorCardCache.set(
          authorCacheKey(updated.handle, updated.id),
          updated
        );
        renderAuthorCard(updated);
      } catch (err) {
        const message =
          err.code === "functions/failed-precondition"
            ? err.message
            : "Could not update follow.";
        renderAuthorCard({ ...current, error: message });
      }
    });
  }

  if (authorCardFavorite) {
    authorCardFavorite.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (!authorCardState?.id) return;
      await toggleFavorite(authorCardState);
    });
  }

  feedEl.addEventListener("click", (event) => {
    const likeBtn = event.target.closest(".action-like");
    if (likeBtn && feedEl.contains(likeBtn)) {
      event.preventDefault();
      event.stopPropagation();
      const card = likeBtn.closest(".card");
      if (card) void toggleLike(card, likeBtn);
      return;
    }
    const shareBtn = event.target.closest(".action-share");
    if (shareBtn && feedEl.contains(shareBtn)) {
      event.preventDefault();
      event.stopPropagation();
      const card = shareBtn.closest(".card");
      if (card) void sharePost(card, shareBtn);
      return;
    }

    // Card body opens X; skip controls / author / links / video.
    if (
      event.target.closest(
        "a, button, video, .card-actions, .author-hover, .action-btn, .link-preview"
      )
    ) {
      return;
    }
    const card = event.target.closest(".card");
    const url = card?.dataset?.url;
    if (!url) return;
    event.preventDefault();
    window.open(url, "_blank", "noopener,noreferrer");
  });

  feedEl.addEventListener(
    "play",
    (event) => {
      if (event.target.tagName !== "VIDEO") return;
      for (const video of feedEl.querySelectorAll("video.media-video")) {
        if (video !== event.target) video.pause();
      }
    },
    true
  );

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
      if (likesUnsub) {
        likesUnsub();
        likesUnsub = null;
      }
      if (favoritesUnsub) {
        favoritesUnsub();
        favoritesUnsub = null;
      }
      likedIds = new Set();
      favoritedIds = new Set();
      favoriteMeta.clear();
      currentMember = null;
      invitesEnabled = false;
      if (configUnsub) {
        configUnsub();
        configUnsub = null;
      }
      showAuthGate(
        "Sign in with X to view your following feed. Friends and family only."
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

import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import {
  Home, Search, PlusSquare, Heart, MessageCircle, Send, Bookmark,
  MoreHorizontal, X, ChevronLeft, LogOut, Camera, LayoutGrid, Trash2,
  RefreshCw, Plus, Lock, Shield, Settings, BadgeCheck, AlertTriangle, Ban, Info,
  Music, Volume2, VolumeX, Film
} from "lucide-react";
import { supabase, emailForKey, newLoginKey } from "./supabase.js";

/* ============================== helpers ============================== */

const LOGO_FONT = "'Snell Roundhand','Brush Script MT','Segoe Script','Savoye LET',cursive";
const GRAD = "linear-gradient(45deg,#f9ce34,#ee2a7b,#6228d7)";
const PERM_BAN = "9999-12-31T00:00:00.000Z";

function usernameError(u) {
  if (!u || u.length < 1) return "Pick a username (at least 1 character).";
  if (u.length > 30) return "Usernames can be at most 30 characters.";
  if (!/^[a-z0-9._]+$/.test(u)) return "Only lowercase letters, numbers, periods and underscores.";
  if (u.startsWith(".") || u.endsWith(".")) return "Usernames can't start or end with a period.";
  if (u.includes("..")) return "Usernames can't contain consecutive periods.";
  return null;
}

function timeAgo(ts) {
  const s = Math.max(1, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return s + "s";
  const m = Math.floor(s / 60); if (m < 60) return m + "m";
  const h = Math.floor(m / 60); if (h < 24) return h + "h";
  const d = Math.floor(h / 24); if (d < 7) return d + "d";
  const w = Math.floor(d / 7); if (w < 52) return w + "w";
  return Math.floor(w / 52) + "y";
}

function fmtCount(n) {
  if (n >= 1e6) return (n / 1e6).toFixed(n % 1e6 ? 1 : 0).replace(/\.0$/, "") + "M";
  if (n >= 1e4) return (n / 1e3).toFixed(n % 1e3 ? 1 : 0).replace(/\.0$/, "") + "K";
  return n.toLocaleString();
}

function banActive(u) {
  return !!(u?.bannedUntil && Date.parse(u.bannedUntil) > Date.now());
}

// Displayed counts = real + admin boost.
function shownFollowers(u) {
  return (u?.followers?.length || 0) + (u?.followerBoost || 0);
}
function shownLikes(post) {
  return (post?.likes?.length || 0) + (post?.likeBoost || 0);
}

function banLabel(u) {
  if (!banActive(u)) return null;
  return u.bannedUntil.startsWith("9999")
    ? "permanently"
    : "until " + new Date(u.bannedUntil).toLocaleString();
}

function compressImage(file, maxDim = 1080, quality = 0.8) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        let w = img.width, h = img.height;
        const scale = Math.min(1, maxDim / Math.max(w, h));
        w = Math.max(1, Math.round(w * scale));
        h = Math.max(1, Math.round(h * scale));
        const c = document.createElement("canvas");
        c.width = w; c.height = h;
        c.getContext("2d").drawImage(img, 0, 0, w, h);
        resolve(c.toDataURL("image/jpeg", quality));
      };
      img.onerror = () => reject(new Error("Couldn't read that image."));
      img.src = e.target.result;
    };
    reader.onerror = () => reject(new Error("Couldn't read that file."));
    reader.readAsDataURL(file);
  });
}

async function uploadDataUrl(dataUrl, path) {
  const blob = await (await fetch(dataUrl)).blob();
  const { error } = await supabase.storage
    .from("images")
    .upload(path, blob, { upsert: true, contentType: "image/jpeg" });
  if (error) throw error;
  return supabase.storage.from("images").getPublicUrl(path).data.publicUrl;
}

// Decode a video/audio file, then re-encode just the audio track to a WAV blob.
// Runs entirely in the browser via Web Audio — no server, no ffmpeg.
async function extractAudio(file, maxSeconds = 90) {
  const buf = await file.arrayBuffer();
  const Ctx = window.AudioContext || window.webkitAudioContext;
  const ctx = new Ctx();
  let decoded;
  try {
    decoded = await ctx.decodeAudioData(buf);
  } catch {
    ctx.close();
    throw new Error("Couldn't read audio from that file. Try a different video.");
  }
  ctx.close();

  const sampleRate = decoded.sampleRate;
  const channels = Math.min(2, decoded.numberOfChannels);
  const frames = Math.min(decoded.length, Math.floor(maxSeconds * sampleRate));
  if (frames <= 0) throw new Error("That file has no audio track.");

  // Interleave to 16-bit PCM
  const chans = [];
  for (let c = 0; c < channels; c++) chans.push(decoded.getChannelData(c));
  const bytesPerSample = 2;
  const blockAlign = channels * bytesPerSample;
  const dataLen = frames * blockAlign;
  const out = new DataView(new ArrayBuffer(44 + dataLen));

  const w = (off, s) => { for (let i = 0; i < s.length; i++) out.setUint8(off + i, s.charCodeAt(i)); };
  w(0, "RIFF"); out.setUint32(4, 36 + dataLen, true); w(8, "WAVE");
  w(12, "fmt "); out.setUint32(16, 16, true); out.setUint16(20, 1, true);
  out.setUint16(22, channels, true); out.setUint32(24, sampleRate, true);
  out.setUint32(28, sampleRate * blockAlign, true); out.setUint16(32, blockAlign, true);
  out.setUint16(34, 16, true); w(36, "data"); out.setUint32(40, dataLen, true);

  let off = 44;
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < channels; c++) {
      let s = Math.max(-1, Math.min(1, chans[c][i]));
      out.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      off += 2;
    }
  }
  return new Blob([out.buffer], { type: "audio/wav" });
}

async function uploadAudioBlob(blob, path) {
  const { error } = await supabase.storage
    .from("images")
    .upload(path, blob, { upsert: true, contentType: "audio/wav" });
  if (error) throw error;
  return supabase.storage.from("images").getPublicUrl(path).data.publicUrl;
}

// Read a video file's duration and grab a poster frame (for the grid thumbnail).
function loadVideo(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const v = document.createElement("video");
    v.preload = "metadata";
    v.muted = true;
    v.playsInline = true;
    v.src = url;
    const done = (res, err) => { URL.revokeObjectURL(url); err ? reject(err) : resolve(res); };
    v.onloadedmetadata = () => {
      const duration = v.duration || 0;
      // seek a touch in to avoid black first frame
      v.currentTime = Math.min(0.5, duration / 2);
    };
    v.onseeked = () => {
      try {
        const scale = Math.min(1, 720 / Math.max(v.videoWidth, v.videoHeight));
        const c = document.createElement("canvas");
        c.width = Math.max(1, Math.round(v.videoWidth * scale));
        c.height = Math.max(1, Math.round(v.videoHeight * scale));
        c.getContext("2d").drawImage(v, 0, 0, c.width, c.height);
        done({ duration: v.duration || 0, posterDataUrl: c.toDataURL("image/jpeg", 0.8) });
      } catch {
        done({ duration: v.duration || 0, posterDataUrl: null });
      }
    };
    v.onerror = () => done(null, new Error("Couldn't read that video. Try a different file."));
  });
}

async function uploadFile(file, path) {
  const { error } = await supabase.storage
    .from("images")
    .upload(path, file, { upsert: true, contentType: file.type || "video/mp4" });
  if (error) throw error;
  return supabase.storage.from("images").getPublicUrl(path).data.publicUrl;
}

const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

/* ============================ tiny pieces ============================ */

function Avatar({ user, size = 40, ring = false, onClick }) {
  const px = size + "px";
  const inner = user?.avatar ? (
    <img src={user.avatar} alt={user.u} className="w-full h-full object-cover rounded-full" draggable={false} />
  ) : (
    <div className="w-full h-full rounded-full flex items-center justify-center bg-neutral-700 text-neutral-200 font-semibold select-none"
      style={{ fontSize: size * 0.42 }}>
      {(user?.u || "?")[0].toUpperCase()}
    </div>
  );
  const core = (
    <div className="rounded-full overflow-hidden bg-black" style={{ width: px, height: px }}>{inner}</div>
  );
  return (
    <div onClick={onClick} className={onClick ? "cursor-pointer shrink-0" : "shrink-0"}>
      {ring ? (
        <div className="rounded-full p-[2.5px]" style={{ background: GRAD }}>
          <div className="rounded-full p-[2.5px] bg-black">{core}</div>
        </div>
      ) : core}
    </div>
  );
}

function Uname({ users, u, size = 14, className = "" }) {
  const user = users[u];
  const badge = user?.badge || (user?.verified ? "blue" : "");
  return (
    <span className={"inline-flex items-center gap-1 min-w-0 " + className}>
      <span className="truncate">{u}</span>
      {badge === "gold" && <BadgeCheck size={size} className="shrink-0" color="#1a1a1a" fill="#f5b50a" />}
      {badge === "blue" && <BadgeCheck size={size} className="shrink-0" color="white" fill="#0095f6" />}
      {user?.staff && <Shield size={size - 1} className="shrink-0" color="white" fill="#9333ea" />}
    </span>
  );
}

function Logo({ size = 30 }) {
  return (
    <span className="text-white select-none leading-none" style={{ fontFamily: LOGO_FONT, fontSize: size }}>
      Grambie
    </span>
  );
}

function Spinner({ className = "" }) {
  return (
    <div className={"flex items-center justify-center " + className}>
      <div className="w-7 h-7 rounded-full border-2 border-neutral-700 border-t-neutral-200 animate-spin" />
    </div>
  );
}

function Toast({ toast }) {
  if (!toast) return null;
  return (
    <div className="absolute bottom-20 md:bottom-8 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 rounded-lg bg-neutral-800 text-neutral-100 text-sm shadow-xl border border-neutral-700 whitespace-nowrap">
      {toast}
    </div>
  );
}

function FollowButton({ me, users, target, onToggle, small = false }) {
  if (!me || target === me) return null;
  const following = users[me]?.following?.includes(target);
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onToggle(target); }}
      className={
        (small ? "px-4 py-1.5 text-xs " : "px-6 py-2 text-sm ") +
        "rounded-lg font-semibold transition-colors " +
        (following
          ? "bg-neutral-800 text-neutral-100 hover:bg-neutral-700"
          : "bg-sky-500 text-white hover:bg-sky-400")
      }>
      {following ? "Following" : "Follow"}
    </button>
  );
}

function FollowButtonWide({ me, users, target, onToggle }) {
  const following = users[me]?.following?.includes(target);
  return (
    <button onClick={() => onToggle(target)}
      className={"w-full text-sm font-semibold rounded-lg py-2 transition-colors " +
        (following ? "bg-neutral-800 text-neutral-100 hover:bg-neutral-700" : "bg-sky-500 text-white hover:bg-sky-400")}>
      {following ? "Following" : "Follow"}
    </button>
  );
}

/* ============================== auth ============================== */

function AuthScreen({ onLogin, onSignup, busy }) {
  const [mode, setMode] = useState("login");
  const [u, setU] = useState("");
  const [name, setName] = useState("");
  const [pw, setPw] = useState("");
  const [err, setErr] = useState(null);

  const submit = async () => {
    setErr(null);
    const username = u.trim().toLowerCase();
    const result = mode === "login"
      ? await onLogin(username, pw)
      : await onSignup(username, name.trim(), pw);
    if (result) setErr(result);
  };
  const onKey = (e) => { if (e.key === "Enter") submit(); };

  return (
    <div className="h-full flex flex-col items-center justify-center px-8 bg-black overflow-y-auto">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8"><Logo size={52} /></div>

        <div className="space-y-2.5">
          <input value={u} onChange={(e) => setU(e.target.value)} onKeyDown={onKey}
            placeholder="Username" autoCapitalize="none" autoCorrect="off" spellCheck={false}
            className="w-full bg-neutral-900 border border-neutral-800 rounded-lg px-3.5 py-3 text-sm text-neutral-100 placeholder-neutral-500 outline-none focus:border-neutral-600" />
          {mode === "signup" && (
            <input value={name} onChange={(e) => setName(e.target.value)} onKeyDown={onKey}
              placeholder="Full name (optional)"
              className="w-full bg-neutral-900 border border-neutral-800 rounded-lg px-3.5 py-3 text-sm text-neutral-100 placeholder-neutral-500 outline-none focus:border-neutral-600" />
          )}
          <input value={pw} onChange={(e) => setPw(e.target.value)} onKeyDown={onKey}
            placeholder="Password" type="password"
            className="w-full bg-neutral-900 border border-neutral-800 rounded-lg px-3.5 py-3 text-sm text-neutral-100 placeholder-neutral-500 outline-none focus:border-neutral-600" />

          {err && <div className="text-rose-400 text-xs text-center pt-1">{err}</div>}

          <button onClick={submit} disabled={busy}
            className="w-full bg-sky-500 hover:bg-sky-400 disabled:opacity-60 text-white font-semibold rounded-lg py-3 text-sm transition-colors">
            {busy ? "One moment…" : mode === "login" ? "Log in" : "Sign up"}
          </button>
        </div>

        <div className="flex items-center gap-4 my-6">
          <div className="flex-1 h-px bg-neutral-800" />
          <span className="text-neutral-500 text-xs font-semibold">OR</span>
          <div className="flex-1 h-px bg-neutral-800" />
        </div>

        <div className="text-center text-sm text-neutral-400">
          {mode === "login" ? (
            <>Don't have an account?{" "}
              <button onClick={() => { setMode("signup"); setErr(null); }} className="text-sky-400 font-semibold">Sign up</button></>
          ) : (
            <>Have an account?{" "}
              <button onClick={() => { setMode("login"); setErr(null); }} className="text-sky-400 font-semibold">Log in</button></>
          )}
        </div>

        <div className="mt-8 flex items-start gap-2 text-[11px] leading-relaxed text-neutral-600">
          <Lock size={12} className="mt-0.5 shrink-0" />
          <span>No email needed — just a username and a password (6+ characters). There's no password reset, so keep it somewhere safe.</span>
        </div>
      </div>
    </div>
  );
}

function BannedScreen({ user, onLogout }) {
  const perm = user.bannedUntil?.startsWith("9999");
  return (
    <div className="flex-1 flex flex-col items-center justify-center px-8 text-center gap-4">
      <div className="w-16 h-16 rounded-full bg-rose-500/10 border border-rose-500/40 flex items-center justify-center">
        <Ban size={30} className="text-rose-400" />
      </div>
      <div className="text-xl font-bold text-neutral-100">Your account is suspended</div>
      <div className="text-sm text-neutral-400">
        {perm ? "This ban is permanent." : `You're banned until ${new Date(user.bannedUntil).toLocaleString()}.`}
      </div>
      {user.banReason && (
        <div className="text-sm text-neutral-300 bg-neutral-900 border border-neutral-800 rounded-lg px-4 py-3 max-w-sm">
          Reason: {user.banReason}
        </div>
      )}
      <button onClick={onLogout} className="mt-2 text-sm font-semibold text-sky-400">Log out</button>
    </div>
  );
}

/* ------------------------------ feed post ------------------------------ */

/* ------------------------------ post media (shared) ------------------------------ */

function PostMedia({ post, muted, onToggleMute, onDoubleClick, maxH = "max-h-[560px]", active = true }) {
  const ref = useRef(null);
  const audioElRef = useRef(null);
  const videoElRef = useRef(null);
  const [onScreen, setOnScreen] = useState(false);
  const isVideo = post.mediaType === "video" && post.video;

  useEffect(() => {
    const node = ref.current;
    if (!node || (!post.audio && !isVideo) || !active) { setOnScreen(false); return; }
    const obs = new IntersectionObserver(
      ([entry]) => setOnScreen(entry.isIntersecting && entry.intersectionRatio >= 0.6),
      { threshold: [0, 0.6, 1] }
    );
    obs.observe(node);
    return () => obs.disconnect();
  }, [post.audio, isVideo, active]);

  useEffect(() => {
    const a = audioElRef.current;
    if (a) {
      a.muted = muted;
      if (onScreen && active && !muted) a.play().catch(() => {}); else a.pause();
    }
    const v = videoElRef.current;
    if (v) {
      v.muted = muted;
      if (onScreen && active) v.play().catch(() => {}); else v.pause();
    }
  }, [onScreen, muted, active]);

  return (
    <div ref={ref} className="relative bg-neutral-950 select-none" onDoubleClick={onDoubleClick}>
      {isVideo ? (
        <video ref={videoElRef} src={post.video} poster={post.image || undefined}
          loop playsInline muted preload="metadata"
          onClick={() => onToggleMute && onToggleMute()}
          className={"w-full object-contain bg-black " + maxH} />
      ) : (
        <img src={post.image} alt={post.caption || "post"} className={"w-full object-contain " + maxH} draggable={false} loading="lazy" />
      )}
      {post.audio && !isVideo && <audio ref={audioElRef} src={post.audio} loop preload="none" />}
      {(post.audio || isVideo) && (
        <>
          <button onClick={() => onToggleMute && onToggleMute()}
            className="absolute bottom-2 right-2 bg-black/60 hover:bg-black/80 rounded-full p-2 transition-colors">
            {muted ? <VolumeX size={16} className="text-white" /> : <Volume2 size={16} className="text-white" />}
          </button>
          <div className="absolute bottom-2 left-2 flex items-center gap-1 bg-black/55 rounded-full px-2.5 py-1">
            {isVideo ? <Film size={11} className="text-white" /> : <Music size={11} className="text-white" />}
            <span className="text-white text-[10px] font-medium">{isVideo ? "video" : "audio"}</span>
          </div>
        </>
      )}
    </div>
  );
}

/* ------------------------------ feed post ------------------------------ */

function FeedPost({ post, users, me, muted, onToggleMute, onLike, onOpenPost, onOpenProfile, onToggleFollow, onOpenLikes, onDelete }) {
  const author = users[post.author];
  const liked = post.likes.includes(me);
  const canModerate = post.author === me || users[me]?.isAdmin;
  const [burst, setBurst] = useState(false);
  const [menu, setMenu] = useState(false);

  const doubleTap = () => {
    if (!liked) onLike(post.id);
    setBurst(true);
    setTimeout(() => setBurst(false), 750);
  };

  return (
    <div className="border-b border-neutral-900 pb-3">
      <div className="flex items-center gap-3 px-3 py-2.5">
        <Avatar user={author} size={34} ring onClick={() => onOpenProfile(post.author)} />
        <div className="flex-1 min-w-0">
          <button onClick={() => onOpenProfile(post.author)} className="text-sm font-semibold text-neutral-100 max-w-full">
            <Uname users={users} u={post.author} />
          </button>
          <div className="text-[11px] text-neutral-500 leading-tight">{timeAgo(post.ts)} ago</div>
        </div>
        {post.author !== me && !users[me]?.following?.includes(post.author) && (
          <FollowButton me={me} users={users} target={post.author} onToggle={onToggleFollow} small />
        )}
        {canModerate && (
          <div className="relative">
            <button onClick={() => setMenu(!menu)} className="text-neutral-300 p-1"><MoreHorizontal size={20} /></button>
            {menu && (
              <div className="absolute right-0 top-8 z-20 bg-neutral-900 border border-neutral-800 rounded-lg shadow-xl overflow-hidden">
                <button onClick={() => { setMenu(false); onDelete(post.id); }}
                  className="flex items-center gap-2 px-4 py-2.5 text-sm text-rose-400 hover:bg-neutral-800 w-36 text-left">
                  <Trash2 size={15} /> Delete
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="relative">
        <PostMedia post={post} muted={muted} onToggleMute={onToggleMute} onDoubleClick={doubleTap} />
        {burst && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <Heart size={96} className="text-white drop-shadow-lg animate-ping" fill="white" />
          </div>
        )}
      </div>

      <div className="flex items-center gap-4 px-3 pt-3">
        <button onClick={() => onLike(post.id)} className="active:scale-90 transition-transform">
          <Heart size={26} className={liked ? "text-rose-500" : "text-neutral-100"} fill={liked ? "currentColor" : "none"} />
        </button>
        <button onClick={() => onOpenPost(post.id)}><MessageCircle size={26} className="text-neutral-100 -scale-x-100" /></button>
        <Send size={24} className="text-neutral-100" />
        <div className="flex-1" />
        <Bookmark size={24} className="text-neutral-100" />
      </div>

      <div className="px-3 pt-2 space-y-1">
        {shownLikes(post) > 0 && (
          <button onClick={() => onOpenLikes(post)} className="text-sm font-semibold text-neutral-100">
            {fmtCount(shownLikes(post))} {shownLikes(post) === 1 ? "like" : "likes"}
          </button>
        )}
        {post.caption && (
          <div className="text-sm text-neutral-100">
            <button onClick={() => onOpenProfile(post.author)} className="font-semibold mr-1.5 align-bottom">
              <Uname users={users} u={post.author} size={13} />
            </button>
            <span className="text-neutral-200">{post.caption}</span>
          </div>
        )}
        {post.comments.length > 0 && (
          <button onClick={() => onOpenPost(post.id)} className="text-sm text-neutral-500 block">
            View {post.comments.length === 1 ? "1 comment" : `all ${post.comments.length} comments`}
          </button>
        )}
        <button onClick={() => onOpenPost(post.id)} className="text-sm text-neutral-600 block">Add a comment…</button>
      </div>
    </div>
  );
}

/* ------------------------------ home ------------------------------ */

function HomeScreen({ me, users, posts, feedTab, setFeedTab, onRefresh, refreshing, hasStory, unseenActivity, onOpenActivity, onOpenStory, onAddStory, ...actions }) {
  const [muted, setMuted] = useState(true);
  const meUser = users[me];
  const following = meUser?.following || [];
  const feedPosts = feedTab === "following"
    ? posts.filter((p) => p.author === me || following.includes(p.author))
    : posts;

  const suggestions = Object.values(users)
    .filter((x) => x.u !== me && !following.includes(x.u))
    .sort((a, b) => (b.followers?.length || 0) - (a.followers?.length || 0))
    .slice(0, 6);

  const storyUsers = [meUser, ...following.map((u) => users[u]).filter(Boolean)];

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="sticky top-0 z-10 bg-black/95 backdrop-blur border-b border-neutral-900 safe-top safe-x">
        <div className="flex items-center justify-between px-4 h-14">
          <Logo size={30} />
          <div className="flex items-center gap-5">
            <button onClick={onRefresh} className={refreshing ? "animate-spin" : ""}>
              <RefreshCw size={21} className="text-neutral-100" />
            </button>
            <button onClick={onOpenActivity} className="relative">
              <Heart size={24} className="text-neutral-100" />
              {unseenActivity > 0 && (
                <span className="absolute -top-1.5 -right-1.5 min-w-[16px] h-4 px-1 rounded-full bg-rose-500 text-white text-[10px] font-bold flex items-center justify-center">
                  {unseenActivity > 9 ? "9+" : unseenActivity}
                </span>
              )}
            </button>
          </div>
        </div>
        <div className="flex px-4 gap-6 text-sm font-semibold">
          {["foryou", "following"].map((t) => (
            <button key={t} onClick={() => setFeedTab(t)}
              className={"pb-2.5 border-b-2 transition-colors " + (feedTab === t ? "text-neutral-100 border-neutral-100" : "text-neutral-500 border-transparent")}>
              {t === "foryou" ? "For you" : "Following"}
            </button>
          ))}
        </div>
      </div>

      <div className="flex gap-4 px-4 py-3 overflow-x-auto border-b border-neutral-900">
        <div className="flex flex-col items-center gap-1.5 w-[68px] shrink-0">
          <div className="relative">
            <Avatar user={meUser} size={56} ring={hasStory(me)}
              onClick={() => (hasStory(me) ? onOpenStory(me) : onAddStory())} />
            <button onClick={onAddStory}
              className="absolute -bottom-0.5 -right-0.5 bg-sky-500 rounded-full p-[3px] border-2 border-black">
              <Plus size={10} className="text-white" strokeWidth={3.5} />
            </button>
          </div>
          <span className="text-[11px] text-neutral-400 truncate w-full text-center">Your story</span>
        </div>
        {storyUsers.slice(1).filter((u) => hasStory(u.u)).map((u) => (
          <div key={u.u} className="flex flex-col items-center gap-1.5 w-[68px] shrink-0">
            <Avatar user={u} size={56} ring onClick={() => onOpenStory(u.u)} />
            <span className="text-[11px] text-neutral-300 truncate w-full text-center">{u.u}</span>
          </div>
        ))}
        {storyUsers.slice(1).filter((u) => !hasStory(u.u)).map((u) => (
          <div key={u.u} className="flex flex-col items-center gap-1.5 w-[68px] shrink-0">
            <Avatar user={u} size={56} onClick={() => actions.onOpenProfile(u.u)} />
            <span className="text-[11px] text-neutral-500 truncate w-full text-center">{u.u}</span>
          </div>
        ))}
      </div>

      {feedPosts.length === 0 ? (
        <div className="px-6 py-10 text-center">
          <div className="text-neutral-100 font-semibold mb-1">
            {feedTab === "following" ? "Your feed is quiet" : "No posts yet"}
          </div>
          <div className="text-neutral-500 text-sm mb-6">
            {feedTab === "following"
              ? "Follow people to see their posts here."
              : "Be the first — share a photo from the + tab."}
          </div>
          {suggestions.length > 0 && (
            <div className="text-left">
              <div className="text-sm font-semibold text-neutral-300 mb-3">Suggested for you</div>
              {suggestions.map((u) => (
                <div key={u.u} className="flex items-center gap-3 py-2">
                  <Avatar user={u} size={44} ring onClick={() => actions.onOpenProfile(u.u)} />
                  <div className="flex-1 min-w-0" onClick={() => actions.onOpenProfile(u.u)}>
                    <div className="text-sm font-semibold text-neutral-100 truncate cursor-pointer">
                      <Uname users={users} u={u.u} />
                    </div>
                    <div className="text-xs text-neutral-500 truncate">{u.name || `${fmtCount(u.followers?.length || 0)} followers`}</div>
                  </div>
                  <FollowButton me={me} users={users} target={u.u} onToggle={actions.onToggleFollow} small />
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        feedPosts.map((p) => <FeedPost key={p.id} post={p} users={users} me={me} muted={muted} onToggleMute={() => setMuted((m) => !m)} {...actions} />)
      )}
      <div className="h-4" />
    </div>
  );
}

/* ------------------------------ search ------------------------------ */

function SearchScreen({ me, users, posts, onOpenProfile, onOpenPost, onToggleFollow }) {
  const [q, setQ] = useState("");
  const query = q.trim().toLowerCase();
  const results = query
    ? Object.values(users).filter((u) => u.u.includes(query) || (u.name || "").toLowerCase().includes(query))
    : [];

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="sticky top-0 z-10 bg-black/95 backdrop-blur px-4 pt-3 pb-2 safe-top safe-x">
        <div className="flex items-center gap-2 bg-neutral-900 rounded-full px-4 py-2.5">
          <Search size={16} className="text-neutral-500" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search Grambie"
            className="flex-1 bg-transparent text-sm text-neutral-100 placeholder-neutral-500 outline-none" />
          {q && <button onClick={() => setQ("")}><X size={16} className="text-neutral-500" /></button>}
        </div>
      </div>

      {query ? (
        <div className="px-4 pt-2">
          {results.length === 0 && <div className="text-neutral-500 text-sm text-center py-10">No one matches "{q}" yet.</div>}
          {results.map((u) => (
            <div key={u.u} className="flex items-center gap-3 py-2.5">
              <Avatar user={u} size={48} ring onClick={() => onOpenProfile(u.u)} />
              <div className="flex-1 min-w-0 cursor-pointer" onClick={() => onOpenProfile(u.u)}>
                <div className="text-sm font-semibold text-neutral-100 truncate">
                  <Uname users={users} u={u.u} />
                </div>
                <div className="text-xs text-neutral-500 truncate">
                  {(u.name ? u.name + " · " : "") + fmtCount(u.followers?.length || 0) + " followers"}
                </div>
              </div>
              <FollowButton me={me} users={users} target={u.u} onToggle={onToggleFollow} small />
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-px pt-1">
          {posts.map((p) => (
            <button key={p.id} onClick={() => onOpenPost(p.id)} className="relative aspect-square bg-neutral-900 overflow-hidden">
              <img src={p.image} alt="" className="w-full h-full object-cover hover:opacity-80 transition-opacity" draggable={false} loading="lazy" />
              {p.mediaType === "video" && <Film size={15} className="absolute top-1.5 right-1.5 text-white drop-shadow" fill="white" />}
              <div className="absolute bottom-1.5 left-1.5 flex items-center gap-1 text-white text-[11px] font-semibold drop-shadow">
                <Heart size={11} fill="white" /> {fmtCount(shownLikes(p))}
              </div>
            </button>
          ))}
          {posts.length === 0 && (
            <div className="col-span-3 text-neutral-500 text-sm text-center py-14">Nothing to explore yet.</div>
          )}
        </div>
      )}
    </div>
  );
}

/* ------------------------------ create ------------------------------ */

function CreateScreen({ onShare, busy }) {
  const [mode, setMode] = useState(null);      // null | 'image' | 'video'
  const [image, setImage] = useState(null);    // data URL (photo, or video poster)
  const [videoFile, setVideoFile] = useState(null);
  const [videoPreview, setVideoPreview] = useState(null);
  const [caption, setCaption] = useState("");
  const [audioBlob, setAudioBlob] = useState(null);
  const [audioName, setAudioName] = useState(null);
  const [audioPreview, setAudioPreview] = useState(null);
  const [extracting, setExtracting] = useState(false);
  const [checking, setChecking] = useState(false);
  const [err, setErr] = useState(null);
  const fileRef = useRef(null);
  const videoFileRef = useRef(null);
  const audioRef = useRef(null);
  const previewRef = useRef(null);

  const pick = async (e) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    setErr(null);
    try { setImage(await compressImage(f, 1080, 0.8)); setMode("image"); }
    catch (x) { setErr(x.message); }
  };

  const pickVideo = async (e) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    setErr(null);
    setChecking(true);
    try {
      const info = await loadVideo(f);   // { duration, posterDataUrl }
      if (info.duration > 60.9) {
        setErr(`That video is ${Math.round(info.duration)}s. Please pick one up to 60 seconds.`);
        return;
      }
      if (f.size > 50 * 1024 * 1024) {
        setErr("That video file is over 50MB. Try a shorter or lower-resolution clip.");
        return;
      }
      if (videoPreview) URL.revokeObjectURL(videoPreview);
      setVideoFile(f);
      setVideoPreview(URL.createObjectURL(f));
      setImage(info.posterDataUrl);      // poster used as grid thumbnail
      setMode("video");
    } catch (x) {
      setErr(x.message);
    } finally { setChecking(false); }
  };

  const pickAudio = async (e) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    setErr(null);
    setExtracting(true);
    try {
      const blob = await extractAudio(f, 90);
      setAudioBlob(blob);
      setAudioName(f.name);
      setAudioPreview((prev) => { if (prev) URL.revokeObjectURL(prev); return URL.createObjectURL(blob); });
    } catch (x) {
      setErr(x.message);
    } finally { setExtracting(false); }
  };

  const clearAudio = () => {
    if (audioPreview) URL.revokeObjectURL(audioPreview);
    setAudioBlob(null); setAudioName(null); setAudioPreview(null);
  };

  const reset = () => {
    setMode(null); setImage(null); setCaption(""); clearAudio();
    if (videoPreview) URL.revokeObjectURL(videoPreview);
    setVideoFile(null); setVideoPreview(null);
  };

  const canShare = (mode === "image" && image) || (mode === "video" && videoFile);

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="sticky top-0 z-10 bg-black/95 backdrop-blur border-b border-neutral-900 flex items-center justify-between px-4 min-h-14 safe-top safe-x">
        <span className="text-neutral-100 font-semibold">New post</span>
        <button
          disabled={!canShare || busy || extracting || checking}
          onClick={async () => {
            const ok = await onShare({
              mediaType: mode, image, videoFile, audioBlob, caption: caption.trim(),
            });
            if (ok) reset();
          }}
          className="text-sky-400 font-semibold text-sm disabled:opacity-40">
          {busy ? "Sharing…" : "Share"}
        </button>
      </div>

      <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={pick} />
      <input ref={videoFileRef} type="file" accept="video/*" className="hidden" onChange={pickVideo} />
      <input ref={audioRef} type="file" accept="video/*,audio/*" className="hidden" onChange={pickAudio} />

      {!mode ? (
        <div className="p-4 space-y-3">
          <button onClick={() => fileRef.current?.click()}
            className="w-full aspect-square max-h-[360px] rounded-2xl border-2 border-dashed border-neutral-800 flex flex-col items-center justify-center gap-3 text-neutral-500 hover:border-neutral-600 hover:text-neutral-300 transition-colors">
            <Camera size={44} strokeWidth={1.3} />
            <span className="text-sm font-medium">Photo</span>
          </button>
          <button onClick={() => videoFileRef.current?.click()} disabled={checking}
            className="w-full rounded-2xl border-2 border-dashed border-neutral-800 flex items-center justify-center gap-3 py-6 text-neutral-500 hover:border-neutral-600 hover:text-neutral-300 transition-colors disabled:opacity-60">
            <Film size={28} strokeWidth={1.4} />
            <span className="text-sm font-medium">{checking ? "Checking video…" : "Video (up to 60s)"}</span>
          </button>
        </div>
      ) : mode === "video" ? (
        <div className="p-4 space-y-3">
          <div className="relative rounded-2xl overflow-hidden bg-neutral-950">
            <video src={videoPreview} controls playsInline className="w-full max-h-[480px] object-contain bg-black" />
            <button onClick={reset}
              className="absolute top-2 right-2 bg-black/70 rounded-full p-1.5"><X size={16} className="text-white" /></button>
          </div>
          <textarea value={caption} onChange={(e) => setCaption(e.target.value)} placeholder="Write a caption…"
            rows={3} maxLength={500}
            className="w-full bg-neutral-900 border border-neutral-800 rounded-xl px-3.5 py-3 text-sm text-neutral-100 placeholder-neutral-500 outline-none focus:border-neutral-600 resize-none" />
          <div className="text-[11px] text-neutral-600">
            Videos play automatically (muted) when on screen; tap to unmute. Max 60 seconds.
          </div>
        </div>
      ) : (
        <div className="p-4 space-y-3">
          <div className="relative rounded-2xl overflow-hidden bg-neutral-950">
            <img src={image} alt="preview" className="w-full max-h-[480px] object-contain" />
            <button onClick={reset}
              className="absolute top-2 right-2 bg-black/70 rounded-full p-1.5"><X size={16} className="text-white" /></button>
            {audioBlob && (
              <div className="absolute bottom-2 left-2 flex items-center gap-1.5 bg-black/70 rounded-full px-3 py-1.5 text-white text-xs">
                <Music size={13} /> Audio added
              </div>
            )}
          </div>

          {!audioBlob ? (
            <button onClick={() => audioRef.current?.click()} disabled={extracting}
              className="w-full flex items-center justify-center gap-2 bg-neutral-900 border border-neutral-800 rounded-xl py-3 text-sm font-medium text-neutral-200 hover:border-neutral-600 transition-colors disabled:opacity-60">
              <Music size={17} />
              {extracting ? "Extracting audio…" : "Add audio (from a video or audio file)"}
            </button>
          ) : (
            <div className="flex items-center gap-3 bg-neutral-900 border border-neutral-800 rounded-xl px-3.5 py-2.5">
              <button onClick={() => { const a = previewRef.current; if (a) { a.paused ? a.play() : a.pause(); } }}
                className="text-sky-400 shrink-0"><Volume2 size={18} /></button>
              <span className="text-xs text-neutral-300 truncate flex-1">{audioName}</span>
              <audio ref={previewRef} src={audioPreview} className="hidden" />
              <button onClick={clearAudio} className="text-neutral-500 hover:text-rose-400 shrink-0"><X size={16} /></button>
            </div>
          )}

          <textarea value={caption} onChange={(e) => setCaption(e.target.value)} placeholder="Write a caption…"
            rows={3} maxLength={500}
            className="w-full bg-neutral-900 border border-neutral-800 rounded-xl px-3.5 py-3 text-sm text-neutral-100 placeholder-neutral-500 outline-none focus:border-neutral-600 resize-none" />
          <div className="text-[11px] text-neutral-600">
            Audio plays automatically when your post is on screen and stops when it scrolls away. We use just the sound from the video you pick (up to 90s).
          </div>
        </div>
      )}
      {err && <div className="text-rose-400 text-xs text-center px-4 pb-3">{err}</div>}
    </div>
  );
}

/* ------------------------------ profile ------------------------------ */

function ProfileScreen({ username, me, users, posts, onOpenPost, onToggleFollow, onOpenList, onEdit, onSettings, onBack, fromTab, hasStory, onOpenStory, onAddStory }) {
  const u = users[username];
  if (!u) return <div className="flex-1 flex items-center justify-center text-neutral-500 text-sm">User not found.</div>;
  const own = username === me;
  const myPosts = posts.filter((p) => p.author === username);
  const followers = u.followers || [];
  const following = u.following || [];

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="sticky top-0 z-10 bg-black/95 backdrop-blur border-b border-neutral-900 flex items-center px-4 min-h-14 gap-3 safe-top safe-x">
        {!own && fromTab !== "profile" && (
          <button onClick={onBack}><ChevronLeft size={24} className="text-neutral-100" /></button>
        )}
        <span className="text-neutral-100 font-bold text-lg flex-1 truncate">
          <Uname users={users} u={username} size={17} />
        </span>
        {own && (
          <button onClick={onSettings} className="text-neutral-300 hover:text-neutral-100 transition-colors">
            <Settings size={22} />
          </button>
        )}
      </div>

      <div className="px-4 pt-4">
        <div className="flex items-center gap-6">
          <Avatar user={u} size={80} ring={hasStory(username)}
            onClick={() => {
              if (hasStory(username)) onOpenStory(username);
              else if (username === me) onAddStory();
            }} />
          <div className="flex-1 flex justify-around text-center">
            <div>
              <div className="text-lg font-bold text-neutral-100">{fmtCount(myPosts.length)}</div>
              <div className="text-xs text-neutral-400">posts</div>
            </div>
            <button onClick={() => onOpenList("Followers", followers)}>
              <div className="text-lg font-bold text-neutral-100">{fmtCount(shownFollowers(u))}</div>
              <div className="text-xs text-neutral-400">followers</div>
            </button>
            <button onClick={() => onOpenList("Following", following)}>
              <div className="text-lg font-bold text-neutral-100">{fmtCount(following.length)}</div>
              <div className="text-xs text-neutral-400">following</div>
            </button>
          </div>
        </div>

        {(u.name || u.bio) && (
          <div className="pt-3">
            {u.name && <div className="text-sm font-semibold text-neutral-100">{u.name}</div>}
            {u.bio && <div className="text-sm text-neutral-300 whitespace-pre-wrap">{u.bio}</div>}
          </div>
        )}

        <div className="flex gap-2 pt-4">
          {own ? (
            <>
              <button onClick={onEdit} className="flex-1 bg-neutral-800 hover:bg-neutral-700 text-neutral-100 text-sm font-semibold rounded-lg py-2 transition-colors">Edit profile</button>
              <button
                onClick={() => {
                  if (navigator.clipboard) {
                    navigator.clipboard.writeText(window.location.origin + "/#" + username);
                  }
                }}
                className="flex-1 bg-neutral-800 hover:bg-neutral-700 text-neutral-100 text-sm font-semibold rounded-lg py-2 transition-colors">
                Share profile
              </button>
            </>
          ) : (
            <>
              <div className="flex-1"><FollowButtonWide me={me} users={users} target={username} onToggle={onToggleFollow} /></div>
              <button className="flex-1 bg-neutral-800 hover:bg-neutral-700 text-neutral-100 text-sm font-semibold rounded-lg py-2 transition-colors">Message</button>
            </>
          )}
        </div>
      </div>

      <div className="mt-5 border-t border-neutral-900">
        <div className="flex justify-center py-2.5 border-b-2 border-neutral-200 w-1/2 mx-auto">
          <LayoutGrid size={22} className="text-neutral-100" />
        </div>
        {myPosts.length === 0 ? (
          <div className="text-center py-14 px-8">
            <div className="w-16 h-16 mx-auto rounded-full border-2 border-neutral-700 flex items-center justify-center mb-4">
              <Camera size={28} className="text-neutral-400" strokeWidth={1.5} />
            </div>
            <div className="text-xl font-bold text-neutral-100 mb-1">
              {own ? "Create your first post" : "No posts yet"}
            </div>
            {own && <div className="text-sm text-neutral-500">Make this space your own.</div>}
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-px">
            {myPosts.map((p) => (
              <button key={p.id} onClick={() => onOpenPost(p.id)} className="relative aspect-square bg-neutral-900 overflow-hidden">
                <img src={p.image} alt="" className="w-full h-full object-cover hover:opacity-80 transition-opacity" draggable={false} loading="lazy" />
                {p.mediaType === "video" && <Film size={15} className="absolute top-1.5 right-1.5 text-white drop-shadow" fill="white" />}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------ modals ------------------------------ */

function PostModal({ post, users, me, onClose, onLike, onComment, onOpenProfile, onOpenLikes, onDelete }) {
  const [text, setText] = useState("");
  const [muted, setMuted] = useState(true);
  const liked = post.likes.includes(me);
  const author = users[post.author];
  const canModerate = post.author === me || users[me]?.isAdmin;

  const doubleTap = () => { if (!liked) onLike(post.id); };

  const send = () => {
    const t = text.trim();
    if (!t) return;
    onComment(post.id, t);
    setText("");
  };

  return (
    <div className="absolute inset-0 z-40 bg-black flex flex-col anim-fade">
      <div className="flex items-center px-3 min-h-14 border-b border-neutral-900 gap-3 safe-top safe-x">
        <button onClick={onClose}><ChevronLeft size={26} className="text-neutral-100" /></button>
        <span className="text-neutral-100 font-semibold">Post</span>
        <div className="flex-1" />
        {canModerate && (
          <button onClick={() => { onDelete(post.id); onClose(); }} className="text-rose-400"><Trash2 size={19} /></button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="flex items-center gap-3 px-3 py-2.5">
          <Avatar user={author} size={34} ring onClick={() => { onClose(); onOpenProfile(post.author); }} />
          <button onClick={() => { onClose(); onOpenProfile(post.author); }} className="text-sm font-semibold text-neutral-100">
            <Uname users={users} u={post.author} />
          </button>
          <span className="text-xs text-neutral-500">· {timeAgo(post.ts)}</span>
        </div>
        <PostMedia post={post} muted={muted} onToggleMute={() => setMuted((m) => !m)}
          onDoubleClick={doubleTap} maxH="max-h-[480px]" />
        <div className="flex items-center gap-4 px-3 pt-3">
          <button onClick={() => onLike(post.id)} className="active:scale-90 transition-transform">
            <Heart size={26} className={liked ? "text-rose-500" : "text-neutral-100"} fill={liked ? "currentColor" : "none"} />
          </button>
          <MessageCircle size={26} className="text-neutral-100 -scale-x-100" />
          <Send size={24} className="text-neutral-100" />
        </div>
        <div className="px-3 pt-2 pb-3 space-y-1.5">
          {shownLikes(post) > 0 && (
            <button onClick={() => onOpenLikes(post)} className="text-sm font-semibold text-neutral-100">
              {fmtCount(shownLikes(post))} {shownLikes(post) === 1 ? "like" : "likes"}
            </button>
          )}
          {post.caption && (
            <div className="text-sm text-neutral-100">
              <span className="font-semibold mr-1.5">{post.author}</span>
              <span className="text-neutral-200">{post.caption}</span>
            </div>
          )}
        </div>

        <div className="border-t border-neutral-900 px-3 py-3 space-y-3">
          {post.comments.length === 0 && <div className="text-neutral-500 text-sm text-center py-4">No comments yet. Start the conversation.</div>}
          {post.comments.map((c, i) => (
            <div key={i} className="flex gap-2.5">
              <Avatar user={users[c.u]} size={30} onClick={() => { onClose(); onOpenProfile(c.u); }} />
              <div className="flex-1 min-w-0">
                <div className="text-sm text-neutral-100">
                  <button onClick={() => { onClose(); onOpenProfile(c.u); }} className="font-semibold mr-1.5 align-bottom">
                    <Uname users={users} u={c.u} size={12} />
                  </button>
                  <span className="text-neutral-200">{c.text}</span>
                </div>
                <div className="text-[11px] text-neutral-500">{timeAgo(c.ts)}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="border-t border-neutral-900 p-3 flex items-center gap-2.5 safe-bottom safe-x">
        <Avatar user={users[me]} size={32} />
        <input value={text} onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
          placeholder={`Add a comment as ${me}…`} maxLength={300}
          className="flex-1 bg-neutral-900 rounded-full px-4 py-2.5 text-sm text-neutral-100 placeholder-neutral-500 outline-none" />
        <button onClick={send} disabled={!text.trim()} className="text-sky-400 font-semibold text-sm disabled:opacity-40">Post</button>
      </div>
    </div>
  );
}

function ListModal({ title, usernames, users, me, onClose, onOpenProfile, onToggleFollow }) {
  return (
    <div className="absolute inset-0 z-40 bg-black flex flex-col anim-fade">
      <div className="flex items-center px-3 min-h-14 border-b border-neutral-900 gap-3 safe-top safe-x">
        <button onClick={onClose}><ChevronLeft size={26} className="text-neutral-100" /></button>
        <span className="text-neutral-100 font-semibold">{title}</span>
      </div>
      <div className="flex-1 overflow-y-auto px-4 pt-2">
        {usernames.length === 0 && <div className="text-neutral-500 text-sm text-center py-12">Nobody here yet.</div>}
        {usernames.map((un) => {
          const u = users[un];
          if (!u) return null;
          return (
            <div key={un} className="flex items-center gap-3 py-2.5">
              <Avatar user={u} size={44} onClick={() => { onClose(); onOpenProfile(un); }} />
              <div className="flex-1 min-w-0 cursor-pointer" onClick={() => { onClose(); onOpenProfile(un); }}>
                <div className="text-sm font-semibold text-neutral-100 truncate">
                  <Uname users={users} u={un} />
                </div>
                {u.name && <div className="text-xs text-neutral-500 truncate">{u.name}</div>}
              </div>
              <FollowButton me={me} users={users} target={un} onToggle={onToggleFollow} small />
            </div>
          );
        })}
      </div>
    </div>
  );
}

function EditProfileModal({ user, onClose, onSave, busy }) {
  const [name, setName] = useState(user.name || "");
  const [bio, setBio] = useState(user.bio || "");
  const [avatar, setAvatar] = useState(user.avatar || null);
  const [changedAvatar, setChangedAvatar] = useState(false);
  const [err, setErr] = useState(null);
  const fileRef = useRef(null);

  const pick = async (e) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    try {
      setAvatar(await compressImage(f, 256, 0.8));
      setChangedAvatar(true);
      setErr(null);
    } catch (x) { setErr(x.message); }
  };

  return (
    <div className="absolute inset-0 z-40 bg-black flex flex-col anim-fade">
      <div className="flex items-center px-3 min-h-14 border-b border-neutral-900 gap-3 safe-top safe-x">
        <button onClick={onClose}><X size={24} className="text-neutral-100" /></button>
        <span className="text-neutral-100 font-semibold flex-1">Edit profile</span>
        <button disabled={busy} onClick={() => onSave({ name: name.trim(), bio: bio.trim(), avatar, changedAvatar })}
          className="text-sky-400 font-semibold text-sm disabled:opacity-40">{busy ? "Saving…" : "Done"}</button>
      </div>
      <div className="flex-1 overflow-y-auto px-5 pt-6 space-y-5">
        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={pick} />
        <div className="flex flex-col items-center gap-2.5">
          <Avatar user={{ ...user, avatar }} size={88} ring />
          <button onClick={() => fileRef.current?.click()} className="text-sky-400 text-sm font-semibold">Change photo</button>
          {err && <div className="text-rose-400 text-xs">{err}</div>}
        </div>
        <div>
          <div className="text-xs text-neutral-500 mb-1.5">Name</div>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={50}
            className="w-full bg-neutral-900 border border-neutral-800 rounded-lg px-3.5 py-3 text-sm text-neutral-100 outline-none focus:border-neutral-600" />
        </div>
        <div>
          <div className="text-xs text-neutral-500 mb-1.5">Bio</div>
          <textarea value={bio} onChange={(e) => setBio(e.target.value)} rows={3} maxLength={150}
            className="w-full bg-neutral-900 border border-neutral-800 rounded-lg px-3.5 py-3 text-sm text-neutral-100 outline-none focus:border-neutral-600 resize-none" />
        </div>
      </div>
    </div>
  );
}

/* ------------------------------ settings ------------------------------ */

function SettingsModal({ user, onClose, onChangeUsername, onChangePassword, onLogout }) {
  const [newU, setNewU] = useState(user.u);
  const [uMsg, setUMsg] = useState(null);
  const [uBusy, setUBusy] = useState(false);
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [pMsg, setPMsg] = useState(null);
  const [pBusy, setPBusy] = useState(false);

  const saveUsername = async () => {
    setUMsg(null); setUBusy(true);
    const err = await onChangeUsername(newU.trim().toLowerCase());
    setUBusy(false);
    setUMsg(err ? { e: true, t: err } : { e: false, t: "Username updated. Use it next time you log in." });
  };

  const savePassword = async () => {
    setPMsg(null);
    if (pw !== pw2) { setPMsg({ e: true, t: "Passwords don't match." }); return; }
    setPBusy(true);
    const err = await onChangePassword(pw);
    setPBusy(false);
    if (err) setPMsg({ e: true, t: err });
    else { setPMsg({ e: false, t: "Password updated." }); setPw(""); setPw2(""); }
  };

  return (
    <div className="absolute inset-0 z-40 bg-black flex flex-col anim-fade">
      <div className="flex items-center px-3 min-h-14 border-b border-neutral-900 gap-3 safe-top safe-x">
        <button onClick={onClose}><ChevronLeft size={26} className="text-neutral-100" /></button>
        <span className="text-neutral-100 font-semibold">Settings</span>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-6 space-y-8">
        <div>
          <div className="text-sm font-semibold text-neutral-100 mb-1">Username</div>
          <div className="text-xs text-neutral-500 mb-3">Letters, numbers, periods and underscores. You'll log in with the new one.</div>
          <input value={newU} onChange={(e) => setNewU(e.target.value)}
            autoCapitalize="none" autoCorrect="off" spellCheck={false}
            className="w-full bg-neutral-900 border border-neutral-800 rounded-lg px-3.5 py-3 text-sm text-neutral-100 outline-none focus:border-neutral-600" />
          {uMsg && <div className={"text-xs mt-2 " + (uMsg.e ? "text-rose-400" : "text-emerald-400")}>{uMsg.t}</div>}
          <button onClick={saveUsername} disabled={uBusy || newU.trim().toLowerCase() === user.u}
            className="mt-3 bg-sky-500 hover:bg-sky-400 disabled:opacity-40 text-white text-sm font-semibold rounded-lg px-5 py-2 transition-colors">
            {uBusy ? "Saving…" : "Save username"}
          </button>
        </div>

        <div className="h-px bg-neutral-900" />

        <div>
          <div className="text-sm font-semibold text-neutral-100 mb-1">Password</div>
          <div className="text-xs text-neutral-500 mb-3">At least 6 characters. There's no reset, so don't lose it.</div>
          <div className="space-y-2.5">
            <input value={pw} onChange={(e) => setPw(e.target.value)} type="password" placeholder="New password"
              className="w-full bg-neutral-900 border border-neutral-800 rounded-lg px-3.5 py-3 text-sm text-neutral-100 placeholder-neutral-500 outline-none focus:border-neutral-600" />
            <input value={pw2} onChange={(e) => setPw2(e.target.value)} type="password" placeholder="Repeat new password"
              className="w-full bg-neutral-900 border border-neutral-800 rounded-lg px-3.5 py-3 text-sm text-neutral-100 placeholder-neutral-500 outline-none focus:border-neutral-600" />
          </div>
          {pMsg && <div className={"text-xs mt-2 " + (pMsg.e ? "text-rose-400" : "text-emerald-400")}>{pMsg.t}</div>}
          <button onClick={savePassword} disabled={pBusy || !pw}
            className="mt-3 bg-sky-500 hover:bg-sky-400 disabled:opacity-40 text-white text-sm font-semibold rounded-lg px-5 py-2 transition-colors">
            {pBusy ? "Saving…" : "Save password"}
          </button>
        </div>

        <div className="h-px bg-neutral-900" />

        <button onClick={onLogout}
          className="flex items-center gap-2 text-rose-400 text-sm font-semibold">
          <LogOut size={18} /> Log out
        </button>
      </div>
    </div>
  );
}

/* ------------------------------ notices ------------------------------ */

function NoticesModal({ notices, onAck }) {
  const iconFor = (t) =>
    t === "warning" ? <AlertTriangle size={20} className="text-amber-400 shrink-0" />
      : t === "ban" ? <Ban size={20} className="text-rose-400 shrink-0" />
        : <Info size={20} className="text-sky-400 shrink-0" />;
  const titleFor = (t) =>
    t === "warning" ? "Warning" : t === "ban" ? "Account notice" : t === "username" ? "Username changed" : "Notice";

  return (
    <div className="absolute inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-5 anim-fade">
      <div className="w-full max-w-sm bg-neutral-950 border border-neutral-800 rounded-2xl overflow-hidden shadow-2xl anim-pop">
        <div className="px-5 py-4 border-b border-neutral-900 font-semibold text-neutral-100">
          You have {notices.length === 1 ? "a notice" : `${notices.length} notices`} from Grambie
        </div>
        <div className="max-h-[50vh] overflow-y-auto divide-y divide-neutral-900">
          {notices.map((n) => (
            <div key={n.id} className="flex gap-3 px-5 py-4">
              {iconFor(n.type)}
              <div className="min-w-0">
                <div className="text-xs font-semibold text-neutral-400 mb-0.5">{titleFor(n.type)} · {timeAgo(Date.parse(n.created_at))} ago</div>
                <div className="text-sm text-neutral-100 whitespace-pre-wrap">{n.message}</div>
              </div>
            </div>
          ))}
        </div>
        <button onClick={onAck}
          className="w-full py-3.5 text-sm font-semibold text-sky-400 hover:bg-neutral-900 transition-colors border-t border-neutral-900">
          Got it
        </button>
      </div>
    </div>
  );
}

/* ------------------------------ admin panel ------------------------------ */

function AdminPanel({ users, posts, me, onClose, admin }) {
  const [view, setView] = useState("users");
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(null);
  const [form, setForm] = useState(null); // warn | tempban | permban | rename
  const [reason, setReason] = useState("");
  const [amount, setAmount] = useState("24");
  const [unit, setUnit] = useState("hours");
  const [newName, setNewName] = useState("");
  const [boostInput, setBoostInput] = useState("");
  const [likeBoostInputs, setLikeBoostInputs] = useState({});
  const [err, setErr] = useState(null);
  const [working, setWorking] = useState(false);
  const [confirmDel, setConfirmDel] = useState(null);

  useEffect(() => {
    if (sel && users[sel]) setBoostInput(String(users[sel].followerBoost || 0));
  }, [sel]);

  const query = q.trim().toLowerCase();
  const list = Object.values(users)
    .filter((u) => u.u !== me)
    .filter((u) => !query || u.u.includes(query) || (u.name || "").toLowerCase().includes(query))
    .sort((a, b) => a.u.localeCompare(b.u));

  const target = sel ? users[sel] : null;

  const openForm = (f) => { setForm(f); setReason(""); setNewName(""); setErr(null); };

  const submit = async () => {
    setErr(null); setWorking(true);
    try {
      if (form === "warn") {
        if (!reason.trim()) { setErr("Write a reason."); return; }
        const e = await admin.warn(sel, reason.trim());
        if (e) { setErr(e); return; }
        setForm(null);
      }
      if (form === "tempban") {
        const n = Number(amount);
        const hours = unit === "days" ? n * 24 : n;
        if (!hours || hours <= 0) { setErr("Enter a valid duration."); return; }
        if (!reason.trim()) { setErr("Write a reason."); return; }
        const e = await admin.ban(sel, hours, reason.trim());
        if (e) { setErr(e); return; }
        setForm(null);
      }
      if (form === "permban") {
        if (!reason.trim()) { setErr("Write a reason."); return; }
        const e = await admin.ban(sel, null, reason.trim());
        if (e) { setErr(e); return; }
        setForm(null);
      }
      if (form === "rename") {
        const nu = newName.trim().toLowerCase();
        const e = await admin.rename(sel, nu, reason.trim() || "Not specified");
        if (e) { setErr(e); return; }
        setSel(nu);
        setForm(null);
      }
    } finally { setWorking(false); }
  };

  const ActionBtn = ({ label, onClick, danger = false }) => (
    <button onClick={onClick} disabled={working}
      className={"px-3.5 py-2 rounded-lg text-xs font-semibold transition-colors disabled:opacity-40 " +
        (danger ? "bg-rose-500/10 text-rose-400 border border-rose-500/30 hover:bg-rose-500/20"
          : "bg-neutral-800 text-neutral-100 hover:bg-neutral-700")}>
      {label}
    </button>
  );

  return (
    <div className="absolute inset-0 z-40 bg-black flex flex-col anim-fade">
      <div className="flex items-center px-3 min-h-14 border-b border-neutral-900 gap-3 safe-top safe-x">
        <button onClick={() => (sel ? setSel(null) : onClose())}>
          <ChevronLeft size={26} className="text-neutral-100" />
        </button>
        <Shield size={18} className="text-sky-400" />
        <span className="text-neutral-100 font-semibold flex-1">
          {sel ? "@" + sel : "Admin panel"}
        </span>
        {!sel && (
          <div className="flex gap-1 bg-neutral-900 rounded-lg p-1">
            {["users", "posts"].map((v) => (
              <button key={v} onClick={() => setView(v)}
                className={"px-3 py-1 rounded-md text-xs font-semibold capitalize transition-colors " +
                  (view === v ? "bg-neutral-700 text-neutral-100" : "text-neutral-400")}>
                {v}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* ---------- user detail ---------- */}
        {target ? (
          <div className="p-4 space-y-5">
            <div className="flex items-center gap-4">
              <Avatar user={target} size={64} ring />
              <div className="min-w-0">
                <div className="text-base font-bold text-neutral-100"><Uname users={users} u={target.u} size={16} /></div>
                {target.name && <div className="text-sm text-neutral-400">{target.name}</div>}
                <div className="text-xs text-neutral-500">
                  {fmtCount(shownFollowers(target))} followers · {fmtCount(posts.filter((p) => p.author === target.u).length)} posts
                </div>
              </div>
            </div>

            {banActive(target) && (
              <div className="bg-rose-500/10 border border-rose-500/30 rounded-lg px-4 py-3 text-sm text-rose-300">
                Banned {banLabel(target)}.{target.banReason ? ` Reason: ${target.banReason}` : ""}
              </div>
            )}
            {target.u === "admin" && (
              <div className="bg-sky-500/10 border border-sky-500/30 rounded-lg px-4 py-3 text-sm text-sky-300">
                This is the owner account — protected and can't be moderated.
              </div>
            )}
            {target.bio && <div className="text-sm text-neutral-300 bg-neutral-900 rounded-lg px-4 py-3">Bio: {target.bio}</div>}

            {/* verification badges */}
            <div>
              <div className="text-xs font-semibold text-neutral-500 mb-2">Verification</div>
              <div className="flex flex-wrap gap-2">
                <ActionBtn label={target.badge === "blue" ? "✓ Blue (active)" : "Give blue check"} onClick={() => admin.setBadge(sel, "blue")} />
                <ActionBtn label={target.badge === "gold" ? "✓ Gold (active)" : "Give gold check"} onClick={() => admin.setBadge(sel, "gold")} />
                {target.badge && <ActionBtn label="Remove check" danger onClick={() => admin.setBadge(sel, "")} />}
                <ActionBtn label={target.staff ? "Remove staff shield" : "Add staff shield"} onClick={() => admin.setStaff(sel, !target.staff)} />
              </div>
            </div>

            {/* follower boost */}
            <div>
              <div className="text-xs font-semibold text-neutral-500 mb-1">Follower count boost</div>
              <div className="text-[11px] text-neutral-600 mb-2">
                Adds to the displayed follower number (no real accounts). Real followers: {fmtCount(target.followers.length)}. Shown: {fmtCount(shownFollowers(target))}.
              </div>
              <div className="flex gap-2">
                <input value={boostInput} onChange={(e) => setBoostInput(e.target.value.replace(/[^0-9]/g, ""))}
                  type="text" inputMode="numeric" placeholder="e.g. 23000"
                  className="flex-1 bg-neutral-900 border border-neutral-800 rounded-lg px-3.5 py-2.5 text-sm text-neutral-100 placeholder-neutral-500 outline-none focus:border-neutral-600" />
                <button onClick={async () => { setWorking(true); await admin.setFollowerBoost(sel, boostInput); setWorking(false); }}
                  disabled={working}
                  className="px-4 py-2 rounded-lg text-xs font-semibold bg-sky-500 hover:bg-sky-400 text-white disabled:opacity-50 transition-colors">
                  Set
                </button>
              </div>
              <div className="flex flex-wrap gap-1.5 mt-2">
                {[0, 1000, 10000, 23000, 100000, 1000000].map((n) => (
                  <button key={n} onClick={() => setBoostInput(String(n))}
                    className="px-2.5 py-1 rounded-md text-[11px] font-semibold bg-neutral-800 text-neutral-300 hover:bg-neutral-700">
                    {n === 0 ? "clear" : fmtCount(n)}
                  </button>
                ))}
              </div>
            </div>

            {/* admin access (owner only) */}
            {admin.isRoot && target.u !== "admin" && (
              <div>
                <div className="text-xs font-semibold text-neutral-500 mb-2">Admin access</div>
                <div className="flex flex-wrap gap-2">
                  {target.isAdmin
                    ? <ActionBtn label="Remove admin access" danger onClick={() => admin.revokeAdmin(sel)} />
                    : <ActionBtn label="Grant admin access" onClick={() => admin.grantAdmin(sel)} />}
                </div>
              </div>
            )}

            {/* moderation */}
            {target.u !== "admin" && (
              <div>
                <div className="text-xs font-semibold text-neutral-500 mb-2">Moderation</div>
                <div className="flex flex-wrap gap-2">
                  <ActionBtn label="Warn" onClick={() => openForm("warn")} />
                  {banActive(target)
                    ? <ActionBtn label="Unban" onClick={() => admin.unban(sel)} />
                    : <>
                      <ActionBtn label="Temp ban" danger onClick={() => openForm("tempban")} />
                      <ActionBtn label="Permanent ban" danger onClick={() => openForm("permban")} />
                    </>}
                  {target.avatar && <ActionBtn label="Remove photo" danger onClick={() => admin.clearAvatar(sel)} />}
                  {target.bio && <ActionBtn label="Clear bio" danger onClick={() => admin.clearBio(sel)} />}
                  <ActionBtn label="Change username" onClick={() => openForm("rename")} />
                </div>
              </div>
            )}

            {form && (
              <div className="bg-neutral-950 border border-neutral-800 rounded-xl p-4 space-y-3">
                <div className="text-sm font-semibold text-neutral-100">
                  {form === "warn" && "Send a warning"}
                  {form === "tempban" && "Temporary ban"}
                  {form === "permban" && "Permanent ban"}
                  {form === "rename" && "Change username"}
                </div>

                {form === "tempban" && (
                  <div className="flex gap-2">
                    <input value={amount} onChange={(e) => setAmount(e.target.value)} type="number" min="1"
                      className="w-24 bg-neutral-900 border border-neutral-800 rounded-lg px-3 py-2.5 text-sm text-neutral-100 outline-none focus:border-neutral-600" />
                    <select value={unit} onChange={(e) => setUnit(e.target.value)}
                      className="bg-neutral-900 border border-neutral-800 rounded-lg px-3 py-2.5 text-sm text-neutral-100 outline-none">
                      <option value="hours">hours</option>
                      <option value="days">days</option>
                    </select>
                  </div>
                )}

                {form === "rename" && (
                  <input value={newName} onChange={(e) => setNewName(e.target.value)}
                    placeholder={`New username (current: ${sel})`}
                    autoCapitalize="none" autoCorrect="off" spellCheck={false}
                    className="w-full bg-neutral-900 border border-neutral-800 rounded-lg px-3.5 py-2.5 text-sm text-neutral-100 placeholder-neutral-500 outline-none focus:border-neutral-600" />
                )}

                <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2}
                  placeholder={form === "rename" ? "Reason shown to the user (e.g. impersonation)" : "Reason shown to the user"}
                  className="w-full bg-neutral-900 border border-neutral-800 rounded-lg px-3.5 py-2.5 text-sm text-neutral-100 placeholder-neutral-500 outline-none focus:border-neutral-600 resize-none" />

                {err && <div className="text-rose-400 text-xs">{err}</div>}

                <div className="flex gap-2 justify-end">
                  <button onClick={() => setForm(null)} className="px-4 py-2 rounded-lg text-xs font-semibold text-neutral-300 hover:bg-neutral-900">Cancel</button>
                  <button onClick={submit} disabled={working}
                    className="px-4 py-2 rounded-lg text-xs font-semibold bg-sky-500 hover:bg-sky-400 text-white disabled:opacity-50 transition-colors">
                    {working ? "Working…" : "Confirm"}
                  </button>
                </div>
              </div>
            )}

            <div className="text-[11px] text-neutral-600 leading-relaxed">
              Warnings, bans and username changes send the user a popup notice the next time they open Grambie.
            </div>
          </div>
        ) : view === "users" ? (
          /* ---------- user list ---------- */
          <div>
            {/* your own badge / shield */}
            <div className="mx-4 mt-3 mb-1 bg-neutral-950 border border-neutral-800 rounded-xl p-3.5">
              <div className="flex items-center gap-2.5 mb-2.5">
                <Avatar user={users[me]} size={32} />
                <div className="text-sm font-semibold text-neutral-100">Your badges (@{me})</div>
              </div>
              <div className="flex flex-wrap gap-2">
                <ActionBtn label={users[me]?.badge === "blue" ? "✓ Blue" : "Blue check"} onClick={() => admin.setBadge(me, "blue")} />
                <ActionBtn label={users[me]?.badge === "gold" ? "✓ Gold" : "Gold check"} onClick={() => admin.setBadge(me, "gold")} />
                {users[me]?.badge && <ActionBtn label="Remove" danger onClick={() => admin.setBadge(me, "")} />}
                <ActionBtn label={users[me]?.staff ? "Shield on" : "Shield"} onClick={() => admin.setStaff(me, !users[me]?.staff)} />
              </div>
            </div>
            <div className="px-4 pt-3 pb-2">
              <div className="flex items-center gap-2 bg-neutral-900 rounded-full px-4 py-2.5">
                <Search size={16} className="text-neutral-500" />
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search users"
                  className="flex-1 bg-transparent text-sm text-neutral-100 placeholder-neutral-500 outline-none" />
              </div>
            </div>
            {list.length === 0 && <div className="text-neutral-500 text-sm text-center py-10">No users found.</div>}
            {list.map((u) => (
              <button key={u.u} onClick={() => { setSel(u.u); setForm(null); }}
                className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-neutral-950 text-left transition-colors">
                <Avatar user={u} size={42} />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-neutral-100 truncate"><Uname users={users} u={u.u} /></div>
                  <div className="text-xs truncate">
                    {banActive(u)
                      ? <span className="text-rose-400">Banned {banLabel(u)}</span>
                      : <span className="text-neutral-500">{u.name || `${fmtCount(shownFollowers(u))} followers`}</span>}
                  </div>
                </div>
                <MoreHorizontal size={18} className="text-neutral-600" />
              </button>
            ))}
          </div>
        ) : (
          /* ---------- posts list ---------- */
          <div>
            {posts.length === 0 && <div className="text-neutral-500 text-sm text-center py-10">No posts.</div>}
            {posts.map((p) => (
              <div key={p.id} className="px-4 py-2.5 border-b border-neutral-950">
                <div className="flex items-center gap-3">
                  <img src={p.image} alt="" className="w-12 h-12 rounded-lg object-cover bg-neutral-900" loading="lazy" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-neutral-100 truncate">@{p.author}{p.mediaType === "video" ? " · 🎬" : ""}</div>
                    <div className="text-xs text-neutral-500 truncate">{p.caption || "(no caption)"} · {fmtCount(shownLikes(p))} likes</div>
                  </div>
                  {confirmDel === p.id ? (
                    <button onClick={() => { admin.deletePost(p.id); setConfirmDel(null); }}
                      className="px-3 py-1.5 rounded-lg text-xs font-bold bg-rose-500 text-white">Confirm</button>
                  ) : (
                    <button onClick={() => setConfirmDel(p.id)} className="text-rose-400 p-1.5"><Trash2 size={17} /></button>
                  )}
                </div>
                <div className="flex items-center gap-2 mt-2">
                  <span className="text-[11px] text-neutral-500 shrink-0">Like boost:</span>
                  <input
                    value={likeBoostInputs[p.id] ?? String(p.likeBoost || 0)}
                    onChange={(e) => setLikeBoostInputs((m) => ({ ...m, [p.id]: e.target.value.replace(/[^0-9]/g, "") }))}
                    type="text" inputMode="numeric"
                    className="w-28 bg-neutral-900 border border-neutral-800 rounded-md px-2.5 py-1.5 text-xs text-neutral-100 outline-none focus:border-neutral-600" />
                  <button onClick={() => admin.setLikeBoost(p.id, likeBoostInputs[p.id] ?? p.likeBoost)}
                    className="px-3 py-1.5 rounded-md text-[11px] font-semibold bg-neutral-800 text-neutral-100 hover:bg-neutral-700">Set</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------ sidebar (desktop) ------------------------------ */

function Sidebar({ me, users, tab, isAdmin, onNav, onProfile, onAdmin }) {
  const Item = ({ active, icon, label, onClick }) => (
    <button onClick={onClick}
      className={"flex items-center gap-4 px-3 py-3 rounded-xl hover:bg-neutral-900 transition-colors w-full text-left " +
        (active ? "font-bold text-neutral-100" : "text-neutral-300")}>
      {icon}
      <span className="text-[15px]">{label}</span>
    </button>
  );
  return (
    <div className="hidden md:flex flex-col w-64 shrink-0 border-r border-neutral-900 px-3 py-6 gap-1">
      <div className="px-3 pb-8"><Logo size={34} /></div>
      <Item active={tab === "home"} icon={<Home size={26} strokeWidth={tab === "home" ? 2.4 : 1.8} />} label="Home" onClick={() => onNav("home")} />
      <Item active={tab === "search"} icon={<Search size={26} strokeWidth={tab === "search" ? 2.4 : 1.8} />} label="Search" onClick={() => onNav("search")} />
      <Item active={tab === "create"} icon={<PlusSquare size={26} strokeWidth={tab === "create" ? 2.4 : 1.8} />} label="Create" onClick={() => onNav("create")} />
      <Item active={tab === "profile"} icon={<Avatar user={users[me]} size={26} />} label="Profile" onClick={onProfile} />
      {isAdmin && <Item icon={<Shield size={26} strokeWidth={1.8} />} label="Admin" onClick={onAdmin} />}
    </div>
  );
}

/* ------------------------------ story upload ------------------------------ */

function StoryUploadModal({ onClose, onPost, busy }) {
  const [mode, setMode] = useState(null);
  const [image, setImage] = useState(null);
  const [videoFile, setVideoFile] = useState(null);
  const [videoPreview, setVideoPreview] = useState(null);
  const [checking, setChecking] = useState(false);
  const [err, setErr] = useState(null);
  const imgRef = useRef(null);
  const vidRef = useRef(null);

  const pickImg = async (e) => {
    const f = e.target.files?.[0]; e.target.value = ""; if (!f) return;
    setErr(null);
    try { setImage(await compressImage(f, 1080, 0.85)); setMode("image"); }
    catch (x) { setErr(x.message); }
  };
  const pickVid = async (e) => {
    const f = e.target.files?.[0]; e.target.value = ""; if (!f) return;
    setErr(null); setChecking(true);
    try {
      const info = await loadVideo(f);
      if (info.duration > 60.9) { setErr("Story videos can be up to 60 seconds."); return; }
      if (f.size > 50 * 1024 * 1024) { setErr("That video is over 50MB. Try a shorter clip."); return; }
      if (videoPreview) URL.revokeObjectURL(videoPreview);
      setVideoFile(f); setVideoPreview(URL.createObjectURL(f)); setImage(info.posterDataUrl); setMode("video");
    } catch (x) { setErr(x.message); } finally { setChecking(false); }
  };

  return (
    <div className="absolute inset-0 z-50 bg-black flex flex-col anim-fade">
      <div className="flex items-center px-3 min-h-14 border-b border-neutral-900 gap-3 safe-top safe-x">
        <button onClick={onClose}><X size={24} className="text-neutral-100" /></button>
        <span className="text-neutral-100 font-semibold flex-1">Add to your story</span>
        {mode && (
          <button disabled={busy || checking}
            onClick={() => onPost({ mediaType: mode, image, videoFile })}
            className="text-sky-400 font-semibold text-sm disabled:opacity-40">
            {busy ? "Posting…" : "Share"}
          </button>
        )}
      </div>
      <input ref={imgRef} type="file" accept="image/*" className="hidden" onChange={pickImg} />
      <input ref={vidRef} type="file" accept="video/*" className="hidden" onChange={pickVid} />
      <div className="flex-1 overflow-y-auto p-4">
        {!mode ? (
          <div className="space-y-3">
            <button onClick={() => imgRef.current?.click()}
              className="w-full aspect-square max-h-[360px] rounded-2xl border-2 border-dashed border-neutral-800 flex flex-col items-center justify-center gap-3 text-neutral-500 hover:border-neutral-600 hover:text-neutral-300 transition-colors">
              <Camera size={44} strokeWidth={1.3} /><span className="text-sm font-medium">Photo</span>
            </button>
            <button onClick={() => vidRef.current?.click()} disabled={checking}
              className="w-full rounded-2xl border-2 border-dashed border-neutral-800 flex items-center justify-center gap-3 py-6 text-neutral-500 hover:border-neutral-600 hover:text-neutral-300 transition-colors disabled:opacity-60">
              <Film size={28} strokeWidth={1.4} /><span className="text-sm font-medium">{checking ? "Checking…" : "Video (up to 60s)"}</span>
            </button>
          </div>
        ) : (
          <div className="relative rounded-2xl overflow-hidden bg-neutral-950">
            {mode === "video"
              ? <video src={videoPreview} controls playsInline className="w-full max-h-[480px] object-contain bg-black" />
              : <img src={image} alt="" className="w-full max-h-[480px] object-contain" />}
            <button onClick={() => { setMode(null); setImage(null); setVideoFile(null); if (videoPreview) URL.revokeObjectURL(videoPreview); setVideoPreview(null); }}
              className="absolute top-2 right-2 bg-black/70 rounded-full p-1.5"><X size={16} className="text-white" /></button>
          </div>
        )}
        {err && <div className="text-rose-400 text-xs text-center pt-3">{err}</div>}
      </div>
    </div>
  );
}

/* ------------------------------ story viewer ------------------------------ */

function StoryViewer({ username, stories, users, me, onClose, onDelete }) {
  const items = stories;
  const [i, setI] = useState(0);
  const cur = items[i];
  const [muted, setMuted] = useState(false);
  const vidRef = useRef(null);

  useEffect(() => { setI(0); }, [username]);

  // auto-advance photos after 5s
  useEffect(() => {
    if (!cur || cur.mediaType === "video") return;
    const t = setTimeout(() => { i + 1 < items.length ? setI(i + 1) : onClose(); }, 5000);
    return () => clearTimeout(t);
  }, [i, cur, items.length]);

  if (!cur) return null;
  const next = () => { i + 1 < items.length ? setI(i + 1) : onClose(); };
  const prev = () => { if (i > 0) setI(i - 1); };

  return (
    <div className="absolute inset-0 z-50 bg-black flex flex-col anim-fade">
      {/* progress bars */}
      <div className="flex gap-1 px-3 pt-3 safe-top safe-x">
        {items.map((_, idx) => (
          <div key={idx} className="flex-1 h-0.5 rounded-full bg-white/30 overflow-hidden">
            <div className={"h-full bg-white " + (idx < i ? "w-full" : idx === i ? "w-full" : "w-0")} />
          </div>
        ))}
      </div>
      <div className="flex items-center gap-3 px-4 py-3">
        <Avatar user={users[username]} size={34} />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-white"><Uname users={users} u={username} /></div>
          <div className="text-[11px] text-white/60">{timeAgo(cur.ts)} ago</div>
        </div>
        {(cur.mediaType === "video") && (
          <button onClick={() => setMuted((m) => !m)} className="text-white">
            {muted ? <VolumeX size={20} /> : <Volume2 size={20} />}
          </button>
        )}
        {(username === me || users[me]?.isAdmin) && (
          <button onClick={() => { onDelete(cur.id); next(); }} className="text-white/80"><Trash2 size={18} /></button>
        )}
        <button onClick={onClose} className="text-white"><X size={24} /></button>
      </div>

      <div className="flex-1 relative flex items-center justify-center bg-black">
        {cur.mediaType === "video"
          ? <video ref={vidRef} src={cur.video} autoPlay playsInline muted={muted}
              onEnded={next} className="max-h-full max-w-full object-contain" />
          : <img src={cur.image} alt="" className="max-h-full max-w-full object-contain" />}
        {/* tap zones */}
        <button onClick={prev} className="absolute left-0 top-0 bottom-0 w-1/3" aria-label="previous" />
        <button onClick={next} className="absolute right-0 top-0 bottom-0 w-1/3" aria-label="next" />
      </div>
    </div>
  );
}

/* ------------------------------ activity (notifications) ------------------------------ */

function ActivityModal({ activity, users, posts, me, onClose, onOpenProfile, onOpenPost, onToggleFollow }) {
  return (
    <div className="absolute inset-0 z-40 bg-black flex flex-col anim-fade">
      <div className="flex items-center px-3 min-h-14 border-b border-neutral-900 gap-3 safe-top safe-x">
        <button onClick={onClose}><ChevronLeft size={26} className="text-neutral-100" /></button>
        <span className="text-neutral-100 font-semibold">Notifications</span>
      </div>
      <div className="flex-1 overflow-y-auto">
        {activity.length === 0 && (
          <div className="text-center py-16 px-8">
            <Heart size={40} className="mx-auto text-neutral-700 mb-3" />
            <div className="text-neutral-300 font-semibold">Activity on your posts</div>
            <div className="text-neutral-500 text-sm mt-1">Likes, comments and new followers show up here.</div>
          </div>
        )}
        {activity.map((a) => {
          const post = a.postId ? posts.find((p) => p.id === a.postId) : null;
          return (
            <div key={a.id} className={"flex items-center gap-3 px-4 py-3 " + (!a.seen ? "bg-sky-500/5" : "")}>
              <Avatar user={users[a.actor]} size={42} onClick={() => { onClose(); onOpenProfile(a.actor); }} />
              <div className="flex-1 min-w-0 text-sm text-neutral-100">
                <button onClick={() => { onClose(); onOpenProfile(a.actor); }} className="font-semibold mr-1.5 align-bottom">
                  <Uname users={users} u={a.actor} size={12} />
                </button>
                <span className="text-neutral-300">
                  {a.type === "like" && "liked your post."}
                  {a.type === "follow" && "started following you."}
                  {a.type === "comment" && <>commented: {a.text}</>}
                </span>
                <span className="text-neutral-600"> · {timeAgo(a.ts)}</span>
              </div>
              {post && (
                <button onClick={() => { onClose(); onOpenPost(post.id); }} className="shrink-0">
                  <img src={post.image} alt="" className="w-11 h-11 rounded object-cover bg-neutral-900" />
                </button>
              )}
              {a.type === "follow" && (
                <FollowButton me={me} users={users} target={a.actor} onToggle={onToggleFollow} small />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* =============================== app =============================== */

export default function App() {
  const [session, setSession] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const [users, setUsers] = useState({});
  const [posts, setPosts] = useState([]);
  const [notices, setNotices] = useState([]);
  const [stories, setStories] = useState([]);
  const [activity, setActivity] = useState([]);
  const [dataReady, setDataReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const [tab, setTab] = useState("home");
  const [feedTab, setFeedTab] = useState("foryou");
  const [profileUser, setProfileUser] = useState(null);
  const [prevTab, setPrevTab] = useState("home");
  const [activePostId, setActivePostId] = useState(null);
  const [listModal, setListModal] = useState(null);
  const [editOpen, setEditOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [adminOpen, setAdminOpen] = useState(false);
  const [storyView, setStoryView] = useState(null);   // username whose story is open
  const [storyUpload, setStoryUpload] = useState(false);
  const [activityOpen, setActivityOpen] = useState(false);
  const [toast, setToast] = useState(null);

  const toastTimer = useRef(null);
  const showToast = useCallback((msg) => {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2400);
  }, []);

  /* ----- auth session ----- */

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setAuthReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  /* ----- data loading ----- */

  const fetchAll = useCallback(async () => {
    const sinceStory = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const myId = session?.user?.id || null;
    const [profilesRes, followsRes, postsRes, noticesRes, storiesRes, activityRes] = await Promise.all([
      supabase.from("profiles").select("*"),
      supabase.from("follows").select("*"),
      supabase
        .from("posts")
        .select("*, likes(user_id), comments(id, user_id, text, created_at)")
        .order("created_at", { ascending: false })
        .limit(100),
      supabase.from("notices").select("*").eq("acknowledged", false).order("created_at", { ascending: true }),
      supabase.from("stories").select("*").gte("created_at", sinceStory).order("created_at", { ascending: true }),
      myId
        ? supabase.from("activity").select("*").eq("recipient", myId).order("created_at", { ascending: false }).limit(100)
        : Promise.resolve({ data: [] }),
    ]);

    const profiles = profilesRes.data || [];
    const follows = followsRes.data || [];
    const postRows = postsRes.data || [];

    const byId = {};
    const map = {};
    profiles.forEach((p) => {
      byId[p.id] = p;
      map[p.username] = {
        id: p.id, u: p.username, name: p.name || "", bio: p.bio || "",
        avatar: p.avatar_url || null, followers: [], following: [],
        verified: !!p.verified, badge: p.badge || (p.verified ? "blue" : ""),
        staff: !!p.staff, isAdmin: !!p.is_admin, followerBoost: p.follower_boost || 0,
        bannedUntil: p.banned_until || null, banReason: p.ban_reason || null,
      };
    });
    follows.forEach((f) => {
      const a = byId[f.follower], b = byId[f.following];
      if (a && b) {
        map[a.username].following.push(b.username);
        map[b.username].followers.push(a.username);
      }
    });

    const mapped = postRows
      .map((r) => ({
        id: r.id,
        author: byId[r.author]?.username,
        caption: r.caption || "",
        image: r.image_url,
        audio: r.audio_url || null,
        mediaType: r.media_type || "image",
        video: r.video_url || null,
        likeBoost: r.like_boost || 0,
        ts: Date.parse(r.created_at),
        likes: (r.likes || []).map((l) => byId[l.user_id]?.username).filter(Boolean),
        comments: (r.comments || [])
          .slice()
          .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at))
          .map((c) => ({ u: byId[c.user_id]?.username || "?", text: c.text, ts: Date.parse(c.created_at) })),
      }))
      .filter((p) => p.author);

    const storyList = (storiesRes.data || [])
      .map((s) => ({
        id: s.id, author: byId[s.author]?.username,
        image: s.image_url, mediaType: s.media_type || "image",
        video: s.video_url || null, ts: Date.parse(s.created_at),
      }))
      .filter((s) => s.author);

    const acts = (activityRes.data || []).map((a) => ({
      id: a.id, actor: byId[a.actor]?.username, type: a.type,
      postId: a.post_id || null, text: a.text || null,
      seen: !!a.seen, ts: Date.parse(a.created_at),
    })).filter((a) => a.actor);

    setUsers(map);
    setPosts(mapped);
    setNotices(noticesRes.data || []);
    setStories(storyList);
    setActivity(acts);
    setDataReady(true);
    return map;
  }, [session]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const me = useMemo(() => {
    if (!session) return null;
    const found = Object.values(users).find((u) => u.id === session.user.id);
    return found ? found.u : null;
  }, [session, users]);

  const isAdmin = !!users[me]?.isAdmin;

  useEffect(() => {
    if (authReady && dataReady && session && !me && !busy) supabase.auth.signOut();
  }, [authReady, dataReady, session, me, busy]);

  /* ----- auth actions ----- */

  const signup = async (username, name, pw) => {
    const e = usernameError(username);
    if (e) return e;
    if (!pw || pw.length < 6) return "Password needs at least 6 characters.";
    setBusy(true);
    try {
      const { data: existing } = await supabase
        .from("profiles").select("username").eq("username", username).maybeSingle();
      if (existing) return "That username is taken.";

      const loginEmail = emailForKey(newLoginKey());
      const { data, error } = await supabase.auth.signUp({ email: loginEmail, password: pw });
      if (error) return error.message;
      if (!data.session) {
        return 'Almost there — in Supabase, turn OFF "Confirm email" (Authentication → Sign In / Up → Email), then try again.';
      }

      const { error: pErr } = await supabase
        .from("profiles")
        .insert({ id: data.user.id, username, name: name || "", login_email: loginEmail });
      if (pErr) {
        await supabase.auth.signOut();
        return /duplicate|unique/i.test(pErr.message) ? "That username is taken." : "Couldn't create your profile: " + pErr.message;
      }

      await fetchAll();
      setTab("home");
      return null;
    } finally { setBusy(false); }
  };

  const login = async (username, pw) => {
    setBusy(true);
    try {
      const uname = username.toLowerCase();
      const { data: prof } = await supabase
        .from("profiles").select("login_email").eq("username", uname).maybeSingle();
      if (!prof?.login_email) return "Wrong username or password.";
      const { error } = await supabase.auth.signInWithPassword({ email: prof.login_email, password: pw });
      if (error) return "Wrong username or password.";
      await fetchAll();
      setTab("home");
      return null;
    } finally { setBusy(false); }
  };

  const logout = async () => {
    await supabase.auth.signOut();
    setTab("home"); setProfileUser(null);
    setActivePostId(null); setListModal(null); setEditOpen(false);
    setSettingsOpen(false); setAdminOpen(false);
  };

  /* ----- app actions ----- */

  const refresh = async () => {
    setRefreshing(true);
    await fetchAll();
    setRefreshing(false);
  };

  const sharePost = async ({ mediaType, image, videoFile, audioBlob, caption }) => {
    setBusy(true);
    try {
      const meId = session.user.id;
      const stem = `${meId}/${newId()}`;
      let imageUrl = null, videoUrl = null, audioUrl = null;

      if (mediaType === "video") {
        videoUrl = await uploadFile(videoFile, stem + "-vid." + (videoFile.name.split(".").pop() || "mp4"));
        if (image) imageUrl = await uploadDataUrl(image, stem + ".jpg"); // poster
      } else {
        imageUrl = await uploadDataUrl(image, stem + ".jpg");
        if (audioBlob) audioUrl = await uploadAudioBlob(audioBlob, stem + ".wav");
      }

      const { data, error } = await supabase
        .from("posts")
        .insert({
          author: meId, caption,
          image_url: imageUrl || videoUrl, // never null
          audio_url: audioUrl,
          media_type: mediaType,
          video_url: videoUrl,
        })
        .select()
        .single();
      if (error) { showToast("Couldn't share: " + error.message); return false; }
      setPosts((ps) => [{
        id: data.id, author: me, caption,
        image: imageUrl || videoUrl, audio: audioUrl,
        mediaType, video: videoUrl, likeBoost: 0,
        likes: [], comments: [], ts: Date.parse(data.created_at),
      }, ...ps]);
      setTab("profile"); setProfileUser(me);
      showToast("Shared");
      return true;
    } catch (e) {
      showToast("Couldn't share: " + (e.message || "upload failed"));
      return false;
    } finally { setBusy(false); }
  };

  const postStory = async ({ mediaType, image, videoFile }) => {
    setBusy(true);
    try {
      const meId = session.user.id;
      const stem = `${meId}/story-${newId()}`;
      let imageUrl = null, videoUrl = null;
      if (mediaType === "video") {
        videoUrl = await uploadFile(videoFile, stem + "-vid." + (videoFile.name.split(".").pop() || "mp4"));
        if (image) imageUrl = await uploadDataUrl(image, stem + ".jpg");
      } else {
        imageUrl = await uploadDataUrl(image, stem + ".jpg");
      }
      const { data, error } = await supabase
        .from("stories")
        .insert({ author: meId, image_url: imageUrl || videoUrl, media_type: mediaType, video_url: videoUrl })
        .select().single();
      if (error) { showToast("Couldn't post story: " + error.message); return false; }
      setStories((s) => [...s, {
        id: data.id, author: me, image: imageUrl || videoUrl,
        mediaType, video: videoUrl, ts: Date.parse(data.created_at),
      }]);
      setStoryUpload(false);
      showToast("Story posted");
      return true;
    } catch (e) {
      showToast("Couldn't post story: " + (e.message || "upload failed"));
      return false;
    } finally { setBusy(false); }
  };

  const deleteStory = async (storyId) => {
    setStories((s) => s.filter((x) => x.id !== storyId));
    await supabase.from("stories").delete().eq("id", storyId);
    showToast("Story deleted");
  };

  const markActivitySeen = async () => {
    const unseen = activity.filter((a) => !a.seen).map((a) => a.id);
    if (!unseen.length) return;
    setActivity((acts) => acts.map((a) => ({ ...a, seen: true })));
    await supabase.from("activity").update({ seen: true }).in("id", unseen);
  };

  const deletePost = async (id) => {
    const post = posts.find((p) => p.id === id);
    setPosts((ps) => ps.filter((p) => p.id !== id));
    setActivePostId((cur) => (cur === id ? null : cur));
    await supabase.from("posts").delete().eq("id", id);
    if (post?.image && (post.author === me)) {
      const path = post.image.split("/images/")[1]?.split("?")[0];
      if (path) supabase.storage.from("images").remove([decodeURIComponent(path)]);
    }
    showToast("Post deleted");
  };

  const notify = async (recipientUsername, type, postId = null, text = null) => {
    const recipientId = users[recipientUsername]?.id;
    if (!recipientId || recipientUsername === me) return;
    await supabase.from("activity").insert({
      recipient: recipientId, actor: session.user.id, type, post_id: postId, text,
    });
  };

  const toggleLike = async (id) => {
    const meId = session.user.id;
    const post = posts.find((p) => p.id === id);
    if (!post) return;
    const liked = post.likes.includes(me);
    setPosts((ps) => ps.map((p) => p.id === id
      ? { ...p, likes: liked ? p.likes.filter((x) => x !== me) : [...p.likes, me] }
      : p));
    const { error } = liked
      ? await supabase.from("likes").delete().match({ post_id: id, user_id: meId })
      : await supabase.from("likes").insert({ post_id: id, user_id: meId });
    if (error) fetchAll();
    else if (!liked) notify(post.author, "like", id);
  };

  const addComment = async (id, text) => {
    const meId = session.user.id;
    const post = posts.find((p) => p.id === id);
    const c = { u: me, text, ts: Date.now() };
    setPosts((ps) => ps.map((p) => (p.id === id ? { ...p, comments: [...p.comments, c] } : p)));
    const { error } = await supabase.from("comments").insert({ post_id: id, user_id: meId, text });
    if (error) fetchAll();
    else if (post) notify(post.author, "comment", id, text.slice(0, 120));
  };

  const toggleFollow = async (target) => {
    if (!me || target === me) return;
    const meId = session.user.id;
    const targetId = users[target]?.id;
    if (!targetId) return;
    const isF = users[me].following.includes(target);
    setUsers((u) => ({
      ...u,
      [me]: { ...u[me], following: isF ? u[me].following.filter((x) => x !== target) : [...u[me].following, target] },
      [target]: { ...u[target], followers: isF ? u[target].followers.filter((x) => x !== me) : [...u[target].followers, me] },
    }));
    const { error } = isF
      ? await supabase.from("follows").delete().match({ follower: meId, following: targetId })
      : await supabase.from("follows").insert({ follower: meId, following: targetId });
    if (error) fetchAll();
    else if (!isF) notify(target, "follow");
  };

  const saveProfile = async ({ name, bio, avatar, changedAvatar }) => {
    setBusy(true);
    try {
      const meId = session.user.id;
      let avatar_url = users[me]?.avatar || null;
      if (changedAvatar && avatar) {
        const url = await uploadDataUrl(avatar, `${meId}/avatar.jpg`);
        avatar_url = url + "?v=" + Date.now();
      }
      const { error } = await supabase
        .from("profiles")
        .update({ name, bio, avatar_url })
        .eq("id", meId);
      if (error) { showToast("Couldn't save profile."); return; }
      setUsers((u) => ({ ...u, [me]: { ...u[me], name, bio, avatar: avatar_url } }));
      setEditOpen(false);
      showToast("Profile updated");
    } catch (e) {
      showToast("Couldn't save: " + (e.message || "upload failed"));
    } finally { setBusy(false); }
  };

  /* ----- settings actions ----- */

  const changeUsername = async (newU) => {
    const err = usernameError(newU);
    if (err) return err;
    if (newU === me) return "That's already your username.";
    if (newU === "admin") return "That username is reserved.";
    if (users[newU]) return "That username is taken.";
    const old = me;
    const { error } = await supabase.from("profiles").update({ username: newU }).eq("id", session.user.id);
    if (error) return /duplicate|unique/i.test(error.message) ? "That username is taken." : error.message;
    await fetchAll();
    setProfileUser((p) => (p === old ? newU : p));
    showToast("Username updated");
    return null;
  };

  const changePassword = async (pw) => {
    if (!pw || pw.length < 6) return "Password needs at least 6 characters.";
    const { error } = await supabase.auth.updateUser({ password: pw });
    if (error) return error.message;
    showToast("Password updated");
    return null;
  };

  /* ----- notices ----- */

  const ackNotices = async () => {
    const ids = notices.map((n) => n.id);
    setNotices([]);
    if (ids.length) await supabase.from("notices").update({ acknowledged: true }).in("id", ids);
  };

  /* ----- admin actions ----- */

  const sendNotice = async (targetU, type, message) => {
    const id = users[targetU]?.id;
    if (!id) return;
    await supabase.from("notices").insert({ user_id: id, type, message });
  };

  const adminUpdate = async (targetU, fields) => {
    const id = users[targetU]?.id;
    if (!id) return "User not found.";
    const { error } = await supabase.from("profiles").update(fields).eq("id", id);
    return error ? error.message : null;
  };

  const isRoot = me === "admin";

  const admin = {
    setBadge: async (u, tier) => {
      const e = await adminUpdate(u, { badge: tier, verified: tier !== "" });
      if (e) { showToast(e); return e; }
      if (tier) await sendNotice(u, "info", `Your account is now verified with a ${tier} check ✓`);
      else await sendNotice(u, "info", "Your verification badge was removed.");
      await fetchAll();
      showToast(tier ? `@${u} given ${tier} check` : "Badge removed");
      return null;
    },
    setStaff: async (u, val) => {
      const e = await adminUpdate(u, { staff: val });
      if (e) { showToast(e); return e; }
      await fetchAll();
      showToast(val ? `@${u} marked as staff` : "Staff badge removed");
      return null;
    },
    grantAdmin: async (u) => {
      if (!isRoot) return "Only the owner can grant admin access.";
      const e = await adminUpdate(u, { is_admin: true });
      if (e) { showToast(e); return e; }
      await sendNotice(u, "info", "You've been given admin access on Grambie. The Shield tab is now in your menu.");
      await fetchAll();
      showToast(`@${u} is now an admin`);
      return null;
    },
    revokeAdmin: async (u) => {
      if (!isRoot) return "Only the owner can remove admin access.";
      const e = await adminUpdate(u, { is_admin: false });
      if (e) { showToast(e); return e; }
      await sendNotice(u, "info", "Your admin access on Grambie has been removed.");
      await fetchAll();
      showToast(`@${u} is no longer an admin`);
      return null;
    },
    warn: async (u, reason) => {
      await sendNotice(u, "warning", `You have received a warning from Grambie.\nReason: ${reason}`);
      showToast("Warning sent to @" + u);
      return null;
    },
    ban: async (u, hours, reason) => {
      if (u === "admin") { showToast("The owner account can't be banned."); return "protected"; }
      const until = hours == null ? PERM_BAN : new Date(Date.now() + hours * 3600 * 1000).toISOString();
      const e = await adminUpdate(u, { banned_until: until, ban_reason: reason });
      if (e) return e;
      await sendNotice(u, "ban", hours == null
        ? `Your account has been permanently banned.\nReason: ${reason}`
        : `Your account has been banned until ${new Date(until).toLocaleString()}.\nReason: ${reason}`);
      await fetchAll();
      showToast("@" + u + " banned");
      return null;
    },
    unban: async (u) => {
      const e = await adminUpdate(u, { banned_until: null, ban_reason: null });
      if (e) { showToast(e); return e; }
      await sendNotice(u, "info", "Your ban has been lifted. Welcome back.");
      await fetchAll();
      showToast("@" + u + " unbanned");
      return null;
    },
    clearAvatar: async (u) => {
      if (u === "admin") { showToast("The owner account is protected."); return "protected"; }
      const e = await adminUpdate(u, { avatar_url: null });
      if (e) { showToast(e); return e; }
      await sendNotice(u, "info", "Your profile photo was removed by a moderator.");
      await fetchAll();
      showToast("Photo removed");
      return null;
    },
    clearBio: async (u) => {
      if (u === "admin") { showToast("The owner account is protected."); return "protected"; }
      const e = await adminUpdate(u, { bio: "" });
      if (e) { showToast(e); return e; }
      await sendNotice(u, "info", "Your bio was removed by a moderator.");
      await fetchAll();
      showToast("Bio cleared");
      return null;
    },
    rename: async (u, newU, reason) => {
      if (u === "admin") { showToast("The owner account can't be renamed."); return "The owner account is protected."; }
      const err = usernameError(newU);
      if (err) return err;
      if (newU === u) return "That's already their username.";
      if (newU === "admin") return "That username is reserved.";
      if (users[newU]) return "That username is taken.";
      const targetId = users[u]?.id;
      if (!targetId) return "User not found.";
      const { error } = await supabase.from("profiles").update({ username: newU }).eq("id", targetId);
      if (error) return /duplicate|unique/i.test(error.message) ? "That username is taken." : error.message;
      await supabase.from("notices").insert({
        user_id: targetId, type: "username",
        message: `Your username has been changed from @${u} to @${newU} by a moderator.\nReason: ${reason}\nUse @${newU} the next time you log in.`,
      });
      await fetchAll();
      setProfileUser((p) => (p === u ? newU : p));
      showToast(`@${u} → @${newU}`);
      return null;
    },
    setFollowerBoost: async (u, n) => {
      const val = Math.max(0, Math.floor(Number(n) || 0));
      const e = await adminUpdate(u, { follower_boost: val });
      if (e) { showToast(e); return e; }
      await fetchAll();
      showToast(`@${u} follower boost set to ${fmtCount(val)}`);
      return null;
    },
    setLikeBoost: async (postId, n) => {
      const val = Math.max(0, Math.floor(Number(n) || 0));
      const { error } = await supabase.from("posts").update({ like_boost: val }).eq("id", postId);
      if (error) { showToast(error.message); return error.message; }
      setPosts((ps) => ps.map((p) => (p.id === postId ? { ...p, likeBoost: val } : p)));
      showToast(`Like boost set to ${fmtCount(val)}`);
      return null;
    },
    deletePost,
    isRoot,
  };

  /* ----- navigation ----- */

  const openProfile = (username) => {
    setPrevTab(tab === "profileView" ? prevTab : tab);
    setProfileUser(username);
    setTab(username === me ? "profile" : "profileView");
  };
  const openPost = (id) => setActivePostId(id);
  const openLikes = (post) => setListModal({ title: "Likes", usernames: post.likes });
  const openList = (title, usernames) => setListModal({ title, usernames });
  const navTo = (t) => { setTab(t); if (t !== "profile" && t !== "profileView") setProfileUser(null); };

  const activePost = posts.find((p) => p.id === activePostId) || null;
  const meUser = me ? users[me] : null;
  const storyByUser = useMemo(() => {
    const m = {};
    stories.forEach((s) => { (m[s.author] ||= []).push(s); });
    return m;
  }, [stories]);
  const hasStory = (u) => (storyByUser[u]?.length || 0) > 0;
  const unseenActivity = activity.filter((a) => !a.seen).length;

  /* ----- render ----- */

  const frame = (children, withSidebar = false) => (
    <div className="w-full h-dvh bg-black flex"
      style={{ fontFamily: "-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif" }}>
      {withSidebar && (
        <Sidebar me={me} users={users} tab={tab} isAdmin={isAdmin}
          onNav={navTo} onProfile={() => openProfile(me)} onAdmin={() => setAdminOpen(true)} />
      )}
      <div className="flex-1 flex justify-center min-w-0">
        <div className="relative w-full max-w-md md:max-w-[720px] lg:max-w-[880px] h-full bg-black flex flex-col overflow-hidden sm:border-x sm:border-neutral-900">
          {children}
        </div>
      </div>
    </div>
  );

  if (!authReady || !dataReady) return frame(<Spinner className="flex-1" />);
  if (!session || !me) return frame(<AuthScreen onLogin={login} onSignup={signup} busy={busy} />);
  if (banActive(meUser)) return frame(<BannedScreen user={meUser} onLogout={logout} />);

  const sharedActions = {
    onLike: toggleLike,
    onOpenPost: openPost,
    onOpenProfile: openProfile,
    onToggleFollow: toggleFollow,
    onOpenLikes: openLikes,
    onDelete: deletePost,
  };

  const navItems = [
    { id: "home", icon: <Home size={26} /> },
    { id: "search", icon: <Search size={26} /> },
    { id: "create", icon: <PlusSquare size={26} /> },
  ];

  return frame(
    <>
      {tab === "home" && (
        <HomeScreen me={me} users={users} posts={posts} feedTab={feedTab} setFeedTab={setFeedTab}
          onRefresh={refresh} refreshing={refreshing}
          hasStory={hasStory} unseenActivity={unseenActivity}
          onOpenActivity={() => { setActivityOpen(true); markActivitySeen(); }}
          onOpenStory={(u) => setStoryView(u)} onAddStory={() => setStoryUpload(true)}
          {...sharedActions} />
      )}
      {tab === "search" && (
        <SearchScreen me={me} users={users} posts={posts}
          onOpenProfile={openProfile} onOpenPost={openPost} onToggleFollow={toggleFollow} />
      )}
      {tab === "create" && <CreateScreen onShare={sharePost} busy={busy} />}
      {(tab === "profile" || tab === "profileView") && (
        <ProfileScreen username={profileUser || me} me={me} users={users} posts={posts}
          onOpenPost={openPost} onToggleFollow={toggleFollow} onOpenList={openList}
          onEdit={() => setEditOpen(true)} onSettings={() => setSettingsOpen(true)}
          onBack={() => { setTab(prevTab); setProfileUser(null); }} fromTab={tab}
          hasStory={hasStory} onOpenStory={(u) => setStoryView(u)} onAddStory={() => setStoryUpload(true)} />
      )}

      {/* bottom nav (mobile only) */}
      <div className="md:hidden border-t border-neutral-900 bg-black flex items-center justify-around min-h-14 shrink-0 safe-bottom safe-x">
        {navItems.map((n) => (
          <button key={n.id} onClick={() => navTo(n.id)}
            className={tab === n.id ? "text-neutral-100" : "text-neutral-500 hover:text-neutral-300"}>
            {React.cloneElement(n.icon, { strokeWidth: tab === n.id ? 2.4 : 1.8 })}
          </button>
        ))}
        {isAdmin && (
          <button onClick={() => setAdminOpen(true)} className="text-neutral-500 hover:text-neutral-300">
            <Shield size={26} strokeWidth={1.8} />
          </button>
        )}
        <button onClick={() => openProfile(me)}>
          <div className={"rounded-full " + (tab === "profile" ? "ring-2 ring-neutral-100" : "")}>
            <Avatar user={users[me]} size={28} />
          </div>
        </button>
      </div>

      {/* overlays */}
      {activePost && (
        <PostModal post={activePost} users={users} me={me}
          onClose={() => setActivePostId(null)} onLike={toggleLike} onComment={addComment}
          onOpenProfile={openProfile} onOpenLikes={openLikes} onDelete={deletePost} />
      )}
      {listModal && (
        <ListModal title={listModal.title} usernames={listModal.usernames} users={users} me={me}
          onClose={() => setListModal(null)} onOpenProfile={openProfile} onToggleFollow={toggleFollow} />
      )}
      {editOpen && meUser && (
        <EditProfileModal user={meUser} onClose={() => setEditOpen(false)} onSave={saveProfile} busy={busy} />
      )}
      {settingsOpen && meUser && (
        <SettingsModal user={meUser} onClose={() => setSettingsOpen(false)}
          onChangeUsername={changeUsername} onChangePassword={changePassword} onLogout={logout} />
      )}
      {adminOpen && isAdmin && (
        <AdminPanel users={users} posts={posts} me={me} onClose={() => setAdminOpen(false)} admin={admin} />
      )}
      {storyUpload && (
        <StoryUploadModal onClose={() => setStoryUpload(false)} onPost={postStory} busy={busy} />
      )}
      {storyView && storyByUser[storyView] && (
        <StoryViewer username={storyView} stories={storyByUser[storyView]} users={users} me={me}
          onClose={() => setStoryView(null)} onDelete={deleteStory} />
      )}
      {activityOpen && (
        <ActivityModal activity={activity} users={users} posts={posts} me={me}
          onClose={() => setActivityOpen(false)} onOpenProfile={openProfile} onOpenPost={openPost}
          onToggleFollow={toggleFollow} />
      )}
      {notices.length > 0 && <NoticesModal notices={notices} onAck={ackNotices} />}
      <Toast toast={toast} />
    </>,
    true
  );
}

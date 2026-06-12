import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import {
  Home, Search, PlusSquare, Heart, MessageCircle, Send, Bookmark,
  MoreHorizontal, X, ChevronLeft, LogOut, Camera, LayoutGrid, Trash2,
  RefreshCw, Plus, Lock
} from "lucide-react";
import { supabase, usernameToEmail } from "./supabase.js";

/* ============================== helpers ============================== */

const LOGO_FONT = "'Snell Roundhand','Brush Script MT','Segoe Script','Savoye LET',cursive";
const GRAD = "linear-gradient(45deg,#f9ce34,#ee2a7b,#6228d7)";

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
    <div className="absolute bottom-20 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 rounded-lg bg-neutral-800 text-neutral-100 text-sm shadow-xl border border-neutral-700 whitespace-nowrap">
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

/* ============================== screens ============================== */

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

/* ------------------------------ feed post ------------------------------ */

function FeedPost({ post, users, me, onLike, onOpenPost, onOpenProfile, onToggleFollow, onOpenLikes, onDelete }) {
  const author = users[post.author];
  const liked = post.likes.includes(me);
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
          <button onClick={() => onOpenProfile(post.author)} className="text-sm font-semibold text-neutral-100 truncate">
            {post.author}
          </button>
          <div className="text-[11px] text-neutral-500 leading-tight">{timeAgo(post.ts)} ago</div>
        </div>
        {post.author !== me && !users[me]?.following?.includes(post.author) && (
          <FollowButton me={me} users={users} target={post.author} onToggle={onToggleFollow} small />
        )}
        {post.author === me && (
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

      <div className="relative bg-neutral-950 select-none" onDoubleClick={doubleTap}>
        <img src={post.image} alt={post.caption || "post"} className="w-full max-h-[560px] object-contain" draggable={false} loading="lazy" />
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
        {post.likes.length > 0 && (
          <button onClick={() => onOpenLikes(post)} className="text-sm font-semibold text-neutral-100">
            {fmtCount(post.likes.length)} {post.likes.length === 1 ? "like" : "likes"}
          </button>
        )}
        {post.caption && (
          <div className="text-sm text-neutral-100">
            <button onClick={() => onOpenProfile(post.author)} className="font-semibold mr-1.5">{post.author}</button>
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

function HomeScreen({ me, users, posts, feedTab, setFeedTab, onRefresh, refreshing, ...actions }) {
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
      <div className="sticky top-0 z-10 bg-black/95 backdrop-blur border-b border-neutral-900">
        <div className="flex items-center justify-between px-4 h-14">
          <Logo size={30} />
          <div className="flex items-center gap-5">
            <button onClick={onRefresh} className={refreshing ? "animate-spin" : ""}>
              <RefreshCw size={21} className="text-neutral-100" />
            </button>
            <Heart size={24} className="text-neutral-100" />
          </div>
        </div>
        <div className="flex px-4 gap-6 text-sm font-semibold">
          {["foryou", "following"].map((t) => (
            <button key={t} onClick={() => setFeedTab(t)}
              className={"pb-2.5 border-b-2 " + (feedTab === t ? "text-neutral-100 border-neutral-100" : "text-neutral-500 border-transparent")}>
              {t === "foryou" ? "For you" : "Following"}
            </button>
          ))}
        </div>
      </div>

      <div className="flex gap-4 px-4 py-3 overflow-x-auto border-b border-neutral-900">
        <div className="flex flex-col items-center gap-1.5 w-[68px] shrink-0">
          <div className="relative">
            <Avatar user={meUser} size={56} onClick={() => actions.onOpenProfile(me)} />
            <div className="absolute -bottom-0.5 -right-0.5 bg-sky-500 rounded-full p-[3px] border-2 border-black">
              <Plus size={10} className="text-white" strokeWidth={3.5} />
            </div>
          </div>
          <span className="text-[11px] text-neutral-400 truncate w-full text-center">Your story</span>
        </div>
        {storyUsers.slice(1).map((u) => (
          <div key={u.u} className="flex flex-col items-center gap-1.5 w-[68px] shrink-0">
            <Avatar user={u} size={56} ring onClick={() => actions.onOpenProfile(u.u)} />
            <span className="text-[11px] text-neutral-300 truncate w-full text-center">{u.u}</span>
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
                    <div className="text-sm font-semibold text-neutral-100 truncate cursor-pointer">{u.u}</div>
                    <div className="text-xs text-neutral-500 truncate">{u.name || `${fmtCount(u.followers?.length || 0)} followers`}</div>
                  </div>
                  <FollowButton me={me} users={users} target={u.u} onToggle={actions.onToggleFollow} small />
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        feedPosts.map((p) => <FeedPost key={p.id} post={p} users={users} me={me} {...actions} />)
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
      <div className="sticky top-0 z-10 bg-black/95 backdrop-blur px-4 pt-3 pb-2">
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
                <div className="text-sm font-semibold text-neutral-100 truncate">{u.u}</div>
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
              <img src={p.image} alt="" className="w-full h-full object-cover" draggable={false} loading="lazy" />
              <div className="absolute bottom-1.5 left-1.5 flex items-center gap-1 text-white text-[11px] font-semibold drop-shadow">
                <Heart size={11} fill="white" /> {fmtCount(p.likes.length)}
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
  const [image, setImage] = useState(null);
  const [caption, setCaption] = useState("");
  const [err, setErr] = useState(null);
  const fileRef = useRef(null);

  const pick = async (e) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    setErr(null);
    try { setImage(await compressImage(f, 1080, 0.8)); }
    catch (x) { setErr(x.message); }
  };

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="sticky top-0 z-10 bg-black/95 backdrop-blur border-b border-neutral-900 flex items-center justify-between px-4 h-14">
        <span className="text-neutral-100 font-semibold">New post</span>
        <button
          disabled={!image || busy}
          onClick={async () => {
            const ok = await onShare(image, caption.trim());
            if (ok) { setImage(null); setCaption(""); }
          }}
          className="text-sky-400 font-semibold text-sm disabled:opacity-40">
          {busy ? "Sharing…" : "Share"}
        </button>
      </div>

      <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={pick} />

      {!image ? (
        <button onClick={() => fileRef.current?.click()}
          className="m-4 w-[calc(100%-2rem)] aspect-square rounded-2xl border-2 border-dashed border-neutral-800 flex flex-col items-center justify-center gap-3 text-neutral-500 hover:border-neutral-600 hover:text-neutral-300 transition-colors">
          <Camera size={44} strokeWidth={1.3} />
          <span className="text-sm font-medium">Tap to choose a photo</span>
        </button>
      ) : (
        <div className="p-4 space-y-3">
          <div className="relative rounded-2xl overflow-hidden bg-neutral-950">
            <img src={image} alt="preview" className="w-full max-h-[480px] object-contain" />
            <button onClick={() => setImage(null)}
              className="absolute top-2 right-2 bg-black/70 rounded-full p-1.5"><X size={16} className="text-white" /></button>
          </div>
          <textarea value={caption} onChange={(e) => setCaption(e.target.value)} placeholder="Write a caption…"
            rows={3} maxLength={500}
            className="w-full bg-neutral-900 border border-neutral-800 rounded-xl px-3.5 py-3 text-sm text-neutral-100 placeholder-neutral-500 outline-none focus:border-neutral-600 resize-none" />
        </div>
      )}
      {err && <div className="text-rose-400 text-xs text-center">{err}</div>}
    </div>
  );
}

/* ------------------------------ profile ------------------------------ */

function ProfileScreen({ username, me, users, posts, onOpenPost, onToggleFollow, onOpenList, onEdit, onLogout, onBack, fromTab }) {
  const u = users[username];
  if (!u) return <div className="flex-1 flex items-center justify-center text-neutral-500 text-sm">User not found.</div>;
  const own = username === me;
  const myPosts = posts.filter((p) => p.author === username);
  const followers = u.followers || [];
  const following = u.following || [];

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="sticky top-0 z-10 bg-black/95 backdrop-blur border-b border-neutral-900 flex items-center px-4 h-14 gap-3">
        {!own && fromTab !== "profile" && (
          <button onClick={onBack}><ChevronLeft size={24} className="text-neutral-100" /></button>
        )}
        <span className="text-neutral-100 font-bold text-lg flex-1 truncate">{username}</span>
        {own && (
          <button onClick={onLogout} className="flex items-center gap-1.5 text-neutral-400 text-xs font-semibold hover:text-neutral-200">
            <LogOut size={16} /> Log out
          </button>
        )}
      </div>

      <div className="px-4 pt-4">
        <div className="flex items-center gap-6">
          <Avatar user={u} size={80} ring />
          <div className="flex-1 flex justify-around text-center">
            <div>
              <div className="text-lg font-bold text-neutral-100">{fmtCount(myPosts.length)}</div>
              <div className="text-xs text-neutral-400">posts</div>
            </div>
            <button onClick={() => onOpenList("Followers", followers)}>
              <div className="text-lg font-bold text-neutral-100">{fmtCount(followers.length)}</div>
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
                <img src={p.image} alt="" className="w-full h-full object-cover" draggable={false} loading="lazy" />
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
  const liked = post.likes.includes(me);
  const author = users[post.author];

  const send = () => {
    const t = text.trim();
    if (!t) return;
    onComment(post.id, t);
    setText("");
  };

  return (
    <div className="absolute inset-0 z-40 bg-black flex flex-col">
      <div className="flex items-center px-3 h-14 border-b border-neutral-900 gap-3">
        <button onClick={onClose}><ChevronLeft size={26} className="text-neutral-100" /></button>
        <span className="text-neutral-100 font-semibold">Post</span>
        <div className="flex-1" />
        {post.author === me && (
          <button onClick={() => { onDelete(post.id); onClose(); }} className="text-rose-400"><Trash2 size={19} /></button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="flex items-center gap-3 px-3 py-2.5">
          <Avatar user={author} size={34} ring onClick={() => { onClose(); onOpenProfile(post.author); }} />
          <button onClick={() => { onClose(); onOpenProfile(post.author); }} className="text-sm font-semibold text-neutral-100">{post.author}</button>
          <span className="text-xs text-neutral-500">· {timeAgo(post.ts)}</span>
        </div>
        <img src={post.image} alt="" className="w-full max-h-[480px] object-contain bg-neutral-950" />
        <div className="flex items-center gap-4 px-3 pt-3">
          <button onClick={() => onLike(post.id)} className="active:scale-90 transition-transform">
            <Heart size={26} className={liked ? "text-rose-500" : "text-neutral-100"} fill={liked ? "currentColor" : "none"} />
          </button>
          <MessageCircle size={26} className="text-neutral-100 -scale-x-100" />
          <Send size={24} className="text-neutral-100" />
        </div>
        <div className="px-3 pt-2 pb-3 space-y-1.5">
          {post.likes.length > 0 && (
            <button onClick={() => onOpenLikes(post)} className="text-sm font-semibold text-neutral-100">
              {fmtCount(post.likes.length)} {post.likes.length === 1 ? "like" : "likes"}
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
                  <button onClick={() => { onClose(); onOpenProfile(c.u); }} className="font-semibold mr-1.5">{c.u}</button>
                  <span className="text-neutral-200">{c.text}</span>
                </div>
                <div className="text-[11px] text-neutral-500">{timeAgo(c.ts)}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="border-t border-neutral-900 p-3 flex items-center gap-2.5">
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
    <div className="absolute inset-0 z-40 bg-black flex flex-col">
      <div className="flex items-center px-3 h-14 border-b border-neutral-900 gap-3">
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
                <div className="text-sm font-semibold text-neutral-100 truncate">{un}</div>
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
    <div className="absolute inset-0 z-40 bg-black flex flex-col">
      <div className="flex items-center px-3 h-14 border-b border-neutral-900 gap-3">
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

/* =============================== app =============================== */

export default function App() {
  const [session, setSession] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const [users, setUsers] = useState({});
  const [posts, setPosts] = useState([]);
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
    const [profilesRes, followsRes, postsRes] = await Promise.all([
      supabase.from("profiles").select("*"),
      supabase.from("follows").select("*"),
      supabase
        .from("posts")
        .select("*, likes(user_id), comments(id, user_id, text, created_at)")
        .order("created_at", { ascending: false })
        .limit(100),
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
        ts: Date.parse(r.created_at),
        likes: (r.likes || []).map((l) => byId[l.user_id]?.username).filter(Boolean),
        comments: (r.comments || [])
          .slice()
          .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at))
          .map((c) => ({ u: byId[c.user_id]?.username || "?", text: c.text, ts: Date.parse(c.created_at) })),
      }))
      .filter((p) => p.author);

    setUsers(map);
    setPosts(mapped);
    setDataReady(true);
    return map;
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const me = useMemo(() => {
    if (!session) return null;
    const found = Object.values(users).find((u) => u.id === session.user.id);
    return found ? found.u : null;
  }, [session, users]);

  // a session whose profile row is missing can't use the app — sign it out
  useEffect(() => {
    if (authReady && dataReady && session && !me) supabase.auth.signOut();
  }, [authReady, dataReady, session, me]);

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

      const { data, error } = await supabase.auth.signUp({
        email: usernameToEmail(username),
        password: pw,
      });
      if (error) {
        if (/already registered/i.test(error.message)) return "That username is taken.";
        return error.message;
      }
      if (!data.session) {
        return 'Almost there — in Supabase, turn OFF "Confirm email" (Authentication → Sign In / Up → Email), then try again.';
      }

      const { error: pErr } = await supabase
        .from("profiles")
        .insert({ id: data.user.id, username, name: name || "" });
      if (pErr) {
        await supabase.auth.signOut();
        return "Couldn't create your profile: " + pErr.message;
      }

      await fetchAll();
      setTab("home");
      return null;
    } finally { setBusy(false); }
  };

  const login = async (username, pw) => {
    setBusy(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: usernameToEmail(username.toLowerCase()),
        password: pw,
      });
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
  };

  /* ----- app actions ----- */

  const refresh = async () => {
    setRefreshing(true);
    await fetchAll();
    setRefreshing(false);
  };

  const sharePost = async (imageDataUrl, caption) => {
    setBusy(true);
    try {
      const meId = session.user.id;
      const path = `${meId}/${newId()}.jpg`;
      const publicUrl = await uploadDataUrl(imageDataUrl, path);
      const { data, error } = await supabase
        .from("posts")
        .insert({ author: meId, caption, image_url: publicUrl })
        .select()
        .single();
      if (error) { showToast("Couldn't share: " + error.message); return false; }
      setPosts((ps) => [{
        id: data.id, author: me, caption, image: publicUrl,
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

  const deletePost = async (id) => {
    const post = posts.find((p) => p.id === id);
    setPosts((ps) => ps.filter((p) => p.id !== id));
    setActivePostId((cur) => (cur === id ? null : cur));
    await supabase.from("posts").delete().eq("id", id);
    // best-effort: remove the image file too
    if (post?.image) {
      const path = post.image.split("/images/")[1]?.split("?")[0];
      if (path) supabase.storage.from("images").remove([decodeURIComponent(path)]);
    }
    showToast("Post deleted");
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
  };

  const addComment = async (id, text) => {
    const meId = session.user.id;
    const c = { u: me, text, ts: Date.now() };
    setPosts((ps) => ps.map((p) => (p.id === id ? { ...p, comments: [...p.comments, c] } : p)));
    const { error } = await supabase.from("comments").insert({ post_id: id, user_id: meId, text });
    if (error) fetchAll();
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
  };

  const saveProfile = async ({ name, bio, avatar, changedAvatar }) => {
    setBusy(true);
    try {
      const meId = session.user.id;
      let avatar_url = users[me]?.avatar || null;
      if (changedAvatar && avatar) {
        const url = await uploadDataUrl(avatar, `${meId}/avatar.jpg`);
        avatar_url = url + "?v=" + Date.now(); // bust CDN cache after re-upload
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

  /* ----- navigation ----- */

  const openProfile = (username) => {
    setPrevTab(tab === "profileView" ? prevTab : tab);
    setProfileUser(username);
    setTab(username === me ? "profile" : "profileView");
  };
  const openPost = (id) => setActivePostId(id);
  const openLikes = (post) => setListModal({ title: "Likes", usernames: post.likes });
  const openList = (title, usernames) => setListModal({ title, usernames });

  const activePost = posts.find((p) => p.id === activePostId) || null;

  /* ----- render ----- */

  const shell = (children) => (
    <div className="w-full h-dvh bg-neutral-950 flex justify-center"
      style={{ fontFamily: "-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif" }}>
      <div className="relative w-full max-w-md h-full bg-black flex flex-col overflow-hidden sm:border-x sm:border-neutral-900">
        {children}
      </div>
    </div>
  );

  if (!authReady || !dataReady) return shell(<Spinner className="flex-1" />);
  if (!session || !me) return shell(<AuthScreen onLogin={login} onSignup={signup} busy={busy} />);

  const sharedActions = {
    onLike: toggleLike,
    onOpenPost: openPost,
    onOpenProfile: openProfile,
    onToggleFollow: toggleFollow,
    onOpenLikes: openLikes,
    onDelete: deletePost,
  };

  const navItems = [
    { id: "home", icon: <Home size={26} />, go: () => setTab("home") },
    { id: "search", icon: <Search size={26} />, go: () => setTab("search") },
    { id: "create", icon: <PlusSquare size={26} />, go: () => setTab("create") },
  ];

  return shell(
    <>
      {tab === "home" && (
        <HomeScreen me={me} users={users} posts={posts} feedTab={feedTab} setFeedTab={setFeedTab}
          onRefresh={refresh} refreshing={refreshing} {...sharedActions} />
      )}
      {tab === "search" && (
        <SearchScreen me={me} users={users} posts={posts}
          onOpenProfile={openProfile} onOpenPost={openPost} onToggleFollow={toggleFollow} />
      )}
      {tab === "create" && <CreateScreen onShare={sharePost} busy={busy} />}
      {(tab === "profile" || tab === "profileView") && (
        <ProfileScreen username={profileUser || me} me={me} users={users} posts={posts}
          onOpenPost={openPost} onToggleFollow={toggleFollow} onOpenList={openList}
          onEdit={() => setEditOpen(true)} onLogout={logout}
          onBack={() => { setTab(prevTab); setProfileUser(null); }} fromTab={tab} />
      )}

      <div className="border-t border-neutral-900 bg-black flex items-center justify-around h-14 shrink-0">
        {navItems.map((n) => (
          <button key={n.id} onClick={n.go}
            className={tab === n.id ? "text-neutral-100" : "text-neutral-500 hover:text-neutral-300"}>
            {React.cloneElement(n.icon, { strokeWidth: tab === n.id ? 2.4 : 1.8 })}
          </button>
        ))}
        <button onClick={() => openProfile(me)}>
          <div className={"rounded-full " + (tab === "profile" ? "ring-2 ring-neutral-100" : "")}>
            <Avatar user={users[me]} size={28} />
          </div>
        </button>
      </div>

      {activePost && (
        <PostModal post={activePost} users={users} me={me}
          onClose={() => setActivePostId(null)} onLike={toggleLike} onComment={addComment}
          onOpenProfile={openProfile} onOpenLikes={openLikes} onDelete={deletePost} />
      )}
      {listModal && (
        <ListModal title={listModal.title} usernames={listModal.usernames} users={users} me={me}
          onClose={() => setListModal(null)} onOpenProfile={openProfile} onToggleFollow={toggleFollow} />
      )}
      {editOpen && users[me] && (
        <EditProfileModal user={users[me]} onClose={() => setEditOpen(false)} onSave={saveProfile} busy={busy} />
      )}
      <Toast toast={toast} />
    </>
  );
}

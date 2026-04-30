"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { BottomNav } from "@/components/BottomNav";
import { RosterDropdown, type RosterOption } from "@/components/RosterDropdown";
import { useAuthActions } from "@convex-dev/auth/react";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";

type GameFormat = "1v1" | "2v2";
type StartScore = 301 | 501;
export type DashboardView = "play" | "friends" | "history" | "stats";
type HistoryFilter = "all" | "1v1" | "2v2" | "wins" | "losses";
type StatsLeaderView = "players" | "teams";

function normalizeKey(name: string) {
  return name.trim().toLowerCase();
}

function guessYouNameFromEmail(email: string) {
  return email.split("@")[0]?.replace(/[._-]/g, " ").trim() ?? "";
}

function handleFromName(name: string) {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[^a-z0-9]/g, "");
  return slug ? `@${slug}` : "@friend";
}

function formatHistoryMeta(ts: number, format: GameFormat, startScore: StartScore) {
  const d = new Date(ts);
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  const time = d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: false });
  const dayPart = sameDay ? "TODAY" : d.toLocaleDateString(undefined, { month: "short", day: "numeric" }).toUpperCase();
  return `${dayPart}, ${time} · ${format.toUpperCase()} · ${startScore}`;
}

function teamDisplayLabel(players: string[]) {
  if (players.length === 0) return "Team";
  if (players.length === 1) return players[0];
  return players.join(" & ");
}

function initials(name: string) {
  const parts = name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2);
  if (parts.length === 0) return "NA";
  return parts.map((part) => part[0]?.toUpperCase() ?? "").join("");
}

type DashboardBodyProps = {
  activeView: DashboardView;
};

export function DashboardBody({ activeView }: DashboardBodyProps) {
  const router = useRouter();
  const { isAuthenticated: isSignedIn, isLoading } = useConvexAuth();
  const { signOut } = useAuthActions();
  const [format, setFormat] = useState<GameFormat>("2v2");
  const [startScore, setStartScore] = useState<StartScore>(501);
  const [legsToWin, setLegsToWin] = useState(3);
  const [teamAPlayer1, setTeamAPlayer1] = useState("");
  const [teamAPlayer2, setTeamAPlayer2] = useState("");
  const [teamBPlayer1, setTeamBPlayer1] = useState("");
  const [teamBPlayer2, setTeamBPlayer2] = useState("");
  const [newFriendName, setNewFriendName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [friendSearch, setFriendSearch] = useState("");
  const [friendMenuId, setFriendMenuId] = useState<Id<"friends"> | null>(null);
  const [showAddFriend, setShowAddFriend] = useState(false);
  const [historyFilter, setHistoryFilter] = useState<HistoryFilter>("all");
  const [statsLeaderView, setStatsLeaderView] = useState<StatsLeaderView>("players");

  const viewerEmail = useQuery(api.viewer.getViewerEmail, isSignedIn ? {} : "skip");
  const games = useQuery(api.games.listGames, isSignedIn ? {} : "skip");
  const history = useQuery(api.games.listGameHistory, isSignedIn ? {} : "skip");
  const friendStats = useQuery(api.games.getFriendStats, isSignedIn ? {} : "skip");
  const stats = useQuery(api.games.getStats, isSignedIn ? {} : "skip");

  const createGame = useMutation(api.games.createGame);
  const addFriend = useMutation(api.games.addFriend);
  const removeFriend = useMutation(api.games.removeFriend);

  const totalGames = history?.length ?? 0;
  const totalWins = useMemo(
    () => (stats?.teamStats ?? []).reduce((sum, row) => sum + row.gamesWon, 0),
    [stats?.teamStats],
  );
  const averageScore = useMemo(() => {
    const playerRows = stats?.playerStats ?? [];
    const totalPoints = playerRows.reduce((sum, row) => sum + row.pointsScored, 0);
    const totalTurns = playerRows.reduce((sum, row) => sum + row.turnsPlayed, 0);
    if (totalTurns === 0) return 0;
    return totalPoints / totalTurns;
  }, [stats?.playerStats]);
  const authEmail = viewerEmail ?? "";
  const userBadge = authEmail?.trim().charAt(0).toUpperCase() || "Y";
  const meDisplayName = useMemo(() => {
    const fromEmail = guessYouNameFromEmail(authEmail).trim();
    if (fromEmail.length > 0) return fromEmail.slice(0, 48);
    const local = authEmail?.split("@")[0]?.trim();
    if (local && local.length > 0) return local.slice(0, 48);
    return "You";
  }, [authEmail]);

  useEffect(() => {
    if (isLoading) return;
    if (!isSignedIn) {
      router.replace("/auth/sign-in");
    }
  }, [isLoading, isSignedIn, router]);

  useEffect(() => {
    if (format === "1v1") {
      setTeamAPlayer2("");
      setTeamBPlayer2("");
    }
  }, [format]);

  useEffect(() => {
    if (!friendMenuId) return;
    const close = () => setFriendMenuId(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [friendMenuId]);

  const filteredFriends = useMemo(() => {
    const list = friendStats ?? [];
    const q = friendSearch.trim().toLowerCase();
    if (!q) return list;
    return list.filter((f) => f.name.toLowerCase().includes(q));
  }, [friendStats, friendSearch]);

  const filteredHistory = useMemo(() => {
    const list = history ?? [];
    return list.filter((game) => {
      if (historyFilter === "1v1" && game.format !== "1v1") return false;
      if (historyFilter === "2v2" && game.format !== "2v2") return false;
      if (historyFilter === "wins" && (!game.matchCompleted || game.winnerTeam !== "A")) return false;
      if (historyFilter === "losses" && (!game.matchCompleted || game.winnerTeam !== "B")) return false;
      return true;
    });
  }, [history, historyFilter]);

  const primaryPlayer = useMemo(() => {
    const rows = stats?.playerStats ?? [];
    if (rows.length === 0) return null;
    return [...rows].sort((a, b) => b.gamesPlayed - a.gamesPlayed)[0] ?? null;
  }, [stats?.playerStats]);

  const winRatePct = useMemo(() => {
    if (!primaryPlayer || primaryPlayer.gamesPlayed === 0) return 0;
    return Math.round((primaryPlayer.gamesWon / primaryPlayer.gamesPlayed) * 100);
  }, [primaryPlayer]);

  const winStreak = useMemo(() => {
    const list = [...(history ?? [])].sort((a, b) => (b.endedAt ?? b.createdAt) - (a.endedAt ?? a.createdAt));
    let streak = 0;
    for (const game of list) {
      if (!game.matchCompleted) continue;
      if (game.winnerTeam === "A") streak += 1;
      else break;
    }
    return streak;
  }, [history]);

  const highestTurnEver = useMemo(() => {
    const rows = stats?.playerStats ?? [];
    if (rows.length === 0) return 0;
    return Math.max(...rows.map((r) => r.highestTurn));
  }, [stats?.playerStats]);

  async function handleCreateGame(event: FormEvent) {
    event.preventDefault();
    setError(null);
    const a1 = teamAPlayer1.trim();
    const a2 = teamAPlayer2.trim();
    const b1 = teamBPlayer1.trim();
    const b2 = teamBPlayer2.trim();
    if (!a1 || !b1) {
      setError("Choose a player for each team.");
      return;
    }
    if (format === "2v2" && (!a2 || !b2)) {
      setError("Choose both partners for each side in 2v2.");
      return;
    }
    const roster = format === "2v2" ? [a1, a2, b1, b2] : [a1, b1];
    const keys = roster.map((n) => normalizeKey(n));
    if (new Set(keys).size !== keys.length) {
      setError("Each player must be different.");
      return;
    }
    setBusy(true);
    try {
      const teamAPlayers = format === "2v2" ? [a1, a2] : [a1];
      const teamBPlayers = format === "2v2" ? [b1, b2] : [b1];
      const gameId = await createGame({
        format,
        startScore,
        legsToWin,
        teamAPlayers,
        teamBPlayers,
      });
      router.push(`/game/${gameId}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to create game.");
    } finally {
      setBusy(false);
    }
  }

  async function handleAddFriend(event: FormEvent): Promise<boolean> {
    event.preventDefault();
    if (!newFriendName.trim()) return false;
    setError(null);
    setBusy(true);
    try {
      await addFriend({ name: newFriendName });
      setNewFriendName("");
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to add friend.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function handleSignOut() {
    setError(null);
    setBusy(true);
    try {
      await signOut();
      setTeamAPlayer1("");
      setTeamAPlayer2("");
      setTeamBPlayer1("");
      setTeamBPlayer2("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to sign out.");
    } finally {
      setBusy(false);
    }
  }

  async function handleRemoveFriend(friendId: Id<"friends">) {
    setError(null);
    setBusy(true);
    try {
      await removeFriend({ friendId });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to remove friend.");
    } finally {
      setBusy(false);
    }
  }

  function handleInviteFriend(name: string) {
    const trimmed = name.trim();
    if (!trimmed) return;
    if (format === "1v1") {
      if (!teamAPlayer1.trim()) {
        setTeamAPlayer1(trimmed);
        return;
      }
      setTeamBPlayer1(trimmed);
      return;
    }
    if (!teamAPlayer1.trim()) {
      setTeamAPlayer1(trimmed);
      return;
    }
    if (!teamAPlayer2.trim()) {
      setTeamAPlayer2(trimmed);
      return;
    }
    if (!teamBPlayer1.trim()) {
      setTeamBPlayer1(trimmed);
      return;
    }
    setTeamBPlayer2(trimmed);
  }

  function excludeNamesForSlot(slot: "a1" | "a2" | "b1" | "b2"): Set<string> {
    const pairs: [typeof slot, string][] = [
      ["a1", teamAPlayer1],
      ["a2", teamAPlayer2],
      ["b1", teamBPlayer1],
      ["b2", teamBPlayer2],
    ];
    const out = new Set<string>();
    for (const [key, val] of pairs) {
      if (key === slot) continue;
      const t = val.trim();
      if (t) out.add(normalizeKey(t));
    }
    return out;
  }

  function isRosterPickAllowed(name: string, exclude: Set<string>, currentSlotValue: string): boolean {
    const t = name.trim();
    if (!t) return false;
    if (normalizeKey(t) === normalizeKey(currentSlotValue)) return true;
    return !exclude.has(normalizeKey(t));
  }

  type RosterSlot = "a1" | "a2" | "b1" | "b2";

  const rosterPickOptions = useMemo(() => {
    const build = (slot: RosterSlot, current: string): RosterOption[] => {
      const ex = excludeNamesForSlot(slot);
      const out: RosterOption[] = [];
      const me = meDisplayName.trim();
      if (me && isRosterPickAllowed(me, ex, current)) {
        out.push({ value: me, label: "Me" });
      }
      for (const f of friendStats ?? []) {
        if (me && normalizeKey(f.name) === normalizeKey(me)) continue;
        if (isRosterPickAllowed(f.name, ex, current)) {
          out.push({ value: f.name, label: f.name });
        }
      }
      return out;
    };
    return {
      a1: build("a1", teamAPlayer1),
      b1: build("b1", teamBPlayer1),
      a2: build("a2", teamAPlayer2),
      b2: build("b2", teamBPlayer2),
    };
  }, [teamAPlayer1, teamAPlayer2, teamBPlayer1, teamBPlayer2, friendStats, meDisplayName]);

  /** Full layout on dashboard; compact one-screen treatment is for `/game/[id]` only. */
  const compactPlay = false;

  const inputClassName =
    "w-full rounded-xl border border-zinc-800 bg-[#11161a] px-3 py-2.5 text-sm text-white outline-none transition placeholder:text-zinc-500 focus:border-emerald-500/70";
  const selectClassName = `${inputClassName} cursor-pointer appearance-none pr-10`;
  const cardClassName = "rounded-3xl border border-zinc-800/80 bg-[#0e1318]/90 p-5";

  if (isLoading || !isSignedIn) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-md flex-col items-center justify-center bg-[#06090f] px-4 text-white">
        <p className="text-sm text-zinc-400">{isLoading ? "Loading…" : "Redirecting to sign in…"}</p>
      </main>
    );
  }

  return (
    <main className="box-border mx-auto flex min-h-screen w-full max-w-md flex-col bg-[#06090f] pb-24 text-white">
          <header className={compactPlay ? "shrink-0 px-3 pb-1 pt-2" : "px-5 pb-4 pt-6"}>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p
                  className={
                    compactPlay
                      ? "text-[9px] font-semibold uppercase tracking-[0.2em] text-emerald-400"
                      : "text-xs font-semibold uppercase tracking-[0.3em] text-emerald-400"
                  }
                >
                  {activeView === "play"
                    ? "Welcome back"
                    : activeView === "friends"
                      ? "Roster"
                      : activeView === "history"
                        ? "Matches"
                        : "Leaderboards"}
                </p>
                <h1
                  className={
                    compactPlay
                      ? "mt-0.5 truncate text-xl font-bold leading-tight tracking-tight text-white"
                      : "mt-1 text-5xl font-semibold leading-[1.05] text-white"
                  }
                >
                  {activeView === "play"
                    ? "Ready to play?"
                    : activeView === "friends"
                      ? "Friends"
                      : activeView === "history"
                        ? "History"
                        : "Stats"}
                </h1>
              </div>
              <button
                type="button"
                onClick={handleSignOut}
                className={
                  compactPlay
                    ? "flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-zinc-700/70 bg-[#11161d] text-xs font-semibold text-zinc-200"
                    : "mt-1 flex h-12 w-12 items-center justify-center rounded-full border border-zinc-700/70 bg-[#11161d] text-sm font-semibold text-zinc-200"
                }
                title="Sign out"
              >
                {userBadge}
              </button>
            </div>
          </header>

          {error ? (
            <section
              className={
                compactPlay
                  ? "mx-2 mb-1 shrink-0 rounded-lg border border-red-700 bg-red-950/40 px-2 py-1.5 text-center text-[11px] text-red-200"
                  : "mx-5 mb-3 rounded-xl border border-red-700 bg-red-950/40 px-4 py-3 text-sm text-red-200"
              }
            >
              {error}
            </section>
          ) : null}

          {activeView === "play" ? (
            <div className="flex flex-col gap-6 pb-6">
              <section className={compactPlay ? "min-h-0 shrink px-2" : "px-4"}>
                <form
                  onSubmit={handleCreateGame}
                  className={
                    compactPlay
                      ? "space-y-1.5 rounded-xl border border-emerald-700/30 bg-gradient-to-b from-emerald-950/25 via-[#0f1820] to-[#0d1117] p-2.5 shadow-[0_0_20px_rgba(16,185,129,0.12)]"
                      : "space-y-4 rounded-3xl border border-emerald-700/30 bg-gradient-to-b from-emerald-950/30 via-[#0f1820] to-[#0d1117] p-5 shadow-[0_0_40px_rgba(16,185,129,0.18)]"
                  }
                >
                  <p
                    className={
                      compactPlay
                        ? "text-[9px] font-semibold uppercase tracking-[0.2em] text-emerald-400"
                        : "text-xs font-semibold uppercase tracking-[0.3em] text-emerald-400"
                    }
                  >
                    New match
                  </p>
                  {!compactPlay ? (
                    <>
                      <h2 className="text-4xl font-semibold leading-tight text-white">
                        Start a quick game with friends
                      </h2>
                      <p className="text-sm text-zinc-400">
                        Pick a format, then choose friends for each team (no duplicate names).
                      </p>
                    </>
                  ) : (
                    <p className="text-[10px] leading-snug text-zinc-500">
                      Pick format, score, legs — then choose from your friends.
                    </p>
                  )}

                  <div className={compactPlay ? "grid grid-cols-2 gap-1" : "grid grid-cols-2 gap-2"}>
                    <button
                      type="button"
                      onClick={() => setFormat("1v1")}
                      className={`rounded-xl border text-left transition ${
                        compactPlay ? "px-2 py-1.5" : "rounded-2xl px-4 py-3"
                      } ${
                        format === "1v1"
                          ? "border-emerald-500/60 bg-emerald-500/10 text-white"
                          : "border-zinc-800 bg-[#11161d] text-zinc-200"
                      }`}
                    >
                      <p className={compactPlay ? "text-base font-bold" : "text-3xl font-semibold tracking-tight"}>
                        1 v 1
                      </p>
                      {!compactPlay ? (
                        <p className="mt-1 text-[11px] uppercase tracking-[0.2em] text-zinc-400">Solo duel</p>
                      ) : null}
                    </button>
                    <button
                      type="button"
                      onClick={() => setFormat("2v2")}
                      className={`rounded-xl border text-left transition ${
                        compactPlay ? "px-2 py-1.5" : "rounded-2xl px-4 py-3"
                      } ${
                        format === "2v2"
                          ? "border-emerald-500/60 bg-emerald-500/10 text-white"
                          : "border-zinc-800 bg-[#11161d] text-zinc-200"
                      }`}
                    >
                      <p className={compactPlay ? "text-base font-bold" : "text-3xl font-semibold tracking-tight"}>
                        2 v 2
                      </p>
                      {!compactPlay ? (
                        <p className="mt-1 text-[11px] uppercase tracking-[0.2em] text-zinc-400">Doubles</p>
                      ) : null}
                    </button>
                  </div>

                  <div className={compactPlay ? "grid grid-cols-2 gap-1" : "grid grid-cols-2 gap-2"}>
                    <button
                      type="button"
                      onClick={() => setStartScore(301)}
                      className={`rounded-lg border font-semibold transition ${
                        compactPlay ? "px-2 py-1 text-[11px]" : "rounded-xl px-3 py-2 text-sm"
                      } ${
                        startScore === 301
                          ? "border-emerald-500/60 bg-emerald-500/10 text-emerald-300"
                          : "border-zinc-800 bg-[#11161d] text-zinc-300"
                      }`}
                    >
                      301
                    </button>
                    <button
                      type="button"
                      onClick={() => setStartScore(501)}
                      className={`rounded-lg border font-semibold transition ${
                        compactPlay ? "px-2 py-1 text-[11px]" : "rounded-xl px-3 py-2 text-sm"
                      } ${
                        startScore === 501
                          ? "border-emerald-500/60 bg-emerald-500/10 text-emerald-300"
                          : "border-zinc-800 bg-[#11161d] text-zinc-300"
                      }`}
                    >
                      501
                    </button>
                  </div>

                  <div
                    className={
                      compactPlay
                        ? "flex items-center justify-between gap-2 rounded-lg border border-zinc-800/80 bg-black/20 px-2 py-1.5"
                        : "rounded-2xl border border-zinc-800/80 bg-black/20 p-4"
                    }
                  >
                    {compactPlay ? (
                      <>
                        <span className="text-[10px] text-zinc-500">
                          First to <span className="font-semibold text-white">{legsToWin}</span> legs
                        </span>
                        <select
                          value={legsToWin}
                          onChange={(e) => setLegsToWin(Number(e.target.value))}
                          className="rounded-md border border-zinc-700 bg-[#11161a] px-1.5 py-0.5 text-xs text-white"
                        >
                          {[1, 2, 3, 4, 5, 7, 9, 11, 15, 21].map((n) => (
                            <option key={n} value={n}>
                              {n}
                            </option>
                          ))}
                        </select>
                      </>
                    ) : (
                      <>
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                          Match length
                        </p>
                        <p className="mt-1 text-sm text-zinc-300">
                          First to{" "}
                          <span className="font-semibold text-white">{legsToWin}</span> leg
                          {legsToWin === 1 ? "" : "s"} wins the match. The game ends as soon as one side reaches
                          that many legs.
                        </p>
                        <div className="mt-3 flex flex-wrap items-center gap-3">
                          <label className="flex items-center gap-2 text-sm text-zinc-400">
                            <span className="text-zinc-500">Legs to win</span>
                            <select
                              value={legsToWin}
                              onChange={(e) => setLegsToWin(Number(e.target.value))}
                              className={`${selectClassName} w-auto min-w-[4.5rem] py-2 pr-8 text-sm`}
                            >
                              {[1, 2, 3, 4, 5, 7, 9, 11, 15, 21].map((n) => (
                                <option key={n} value={n}>
                                  {n}
                                </option>
                              ))}
                            </select>
                          </label>
                        </div>
                      </>
                    )}
                  </div>

                  <div className={compactPlay ? "grid grid-cols-2 gap-1.5" : "grid gap-3 sm:grid-cols-2"}>
                    <div className={compactPlay ? "space-y-0.5" : "space-y-1"}>
                      <p className="text-[9px] font-semibold uppercase tracking-wider text-emerald-500/90">Team A</p>
                      <RosterDropdown
                        aria-label="Team A first player"
                        accent="emerald"
                        compact={compactPlay}
                        placeholder="You or friend"
                        clearLabel="Clear"
                        value={teamAPlayer1}
                        onChange={setTeamAPlayer1}
                        options={rosterPickOptions.a1}
                      />
                    </div>
                    <div className={compactPlay ? "space-y-0.5" : "space-y-1"}>
                      <p className="text-[9px] font-semibold uppercase tracking-wider text-cyan-500/90">Team B</p>
                      <RosterDropdown
                        aria-label="Team B first player"
                        accent="cyan"
                        compact={compactPlay}
                        placeholder="You or friend"
                        clearLabel="Clear"
                        value={teamBPlayer1}
                        onChange={setTeamBPlayer1}
                        options={rosterPickOptions.b1}
                      />
                    </div>
                    {format === "2v2" ? (
                      <>
                        <div className="block">
                          <span className="mb-0.5 block text-[9px] font-medium uppercase tracking-wider text-zinc-500">
                            A · partner
                          </span>
                          <RosterDropdown
                            aria-label="Team A partner"
                            accent="emerald"
                            compact={compactPlay}
                            placeholder="You or friend"
                            clearLabel="Clear"
                            value={teamAPlayer2}
                            onChange={setTeamAPlayer2}
                            options={rosterPickOptions.a2}
                          />
                        </div>
                        <div className="block">
                          <span className="mb-0.5 block text-[9px] font-medium uppercase tracking-wider text-zinc-500">
                            B · partner
                          </span>
                          <RosterDropdown
                            aria-label="Team B partner"
                            accent="cyan"
                            compact={compactPlay}
                            placeholder="You or friend"
                            clearLabel="Clear"
                            value={teamBPlayer2}
                            onChange={setTeamBPlayer2}
                            options={rosterPickOptions.b2}
                          />
                        </div>
                      </>
                    ) : null}
                  </div>
                  {friendStats && friendStats.length === 0 ? (
                    <p className="text-center text-[10px] leading-snug text-zinc-500">
                      You can pick <span className="font-medium text-zinc-400">Me</span> above. Add people on{" "}
                      <Link href="/friends" className="text-emerald-400 underline-offset-2 hover:underline">
                        Friends
                      </Link>{" "}
                      for more names.
                    </p>
                  ) : null}

                  <button
                    type="submit"
                    disabled={busy}
                    className={
                      compactPlay
                        ? "flex w-full items-center justify-center gap-1 rounded-xl bg-emerald-500 px-3 py-2 text-sm font-bold text-[#031007] shadow-md shadow-emerald-500/25 transition hover:bg-emerald-400 disabled:opacity-60"
                        : "flex w-full items-center justify-center gap-2 rounded-2xl bg-emerald-500 px-4 py-3.5 text-lg font-bold text-[#031007] shadow-[0_0_28px_rgba(52,211,153,0.35)] transition hover:bg-emerald-400 disabled:opacity-60"
                    }
                  >
                    <span aria-hidden>▶</span>
                    {busy ? "Creating..." : "Create Game"}
                  </button>
                </form>
              </section>

              <section
                className={
                  compactPlay
                    ? "grid shrink-0 grid-cols-3 gap-1 px-2 pt-1"
                    : "grid grid-cols-3 gap-2 px-4 pt-4"
                }
              >
                <div className={`${cardClassName} ${compactPlay ? "p-1.5" : "p-3"}`}>
                  <p className={compactPlay ? "text-[8px] font-medium uppercase tracking-wider text-zinc-500" : "text-[11px] font-medium uppercase tracking-[0.2em] text-zinc-500"}>
                    Games
                  </p>
                  <p className={compactPlay ? "mt-0.5 text-xl font-semibold leading-none" : "mt-2 text-5xl font-semibold leading-none"}>
                    {totalGames}
                  </p>
                </div>
                <div className={`${cardClassName} border-emerald-700/40 ${compactPlay ? "p-1.5" : "p-3"}`}>
                  <p className={compactPlay ? "text-[8px] font-medium uppercase tracking-wider text-zinc-500" : "text-[11px] font-medium uppercase tracking-[0.2em] text-zinc-500"}>
                    Wins
                  </p>
                  <p
                    className={
                      compactPlay
                        ? "mt-0.5 text-xl font-semibold leading-none text-emerald-400"
                        : "mt-2 text-5xl font-semibold leading-none text-emerald-400"
                    }
                  >
                    {totalWins}
                  </p>
                </div>
                <div className={`${cardClassName} ${compactPlay ? "p-1.5" : "p-3"}`}>
                  <p className={compactPlay ? "text-[8px] font-medium uppercase tracking-wider text-zinc-500" : "text-[11px] font-medium uppercase tracking-[0.2em] text-zinc-500"}>
                    Avg
                  </p>
                  <p className={compactPlay ? "mt-0.5 text-xl font-semibold leading-none" : "mt-2 text-5xl font-semibold leading-none"}>
                    {Number.isFinite(averageScore) ? averageScore.toFixed(1) : "0.0"}
                  </p>
                </div>
              </section>

              <section className="px-4 pt-5">
                    <div className="mb-3 flex items-center justify-between">
                      <h3 className="text-3xl font-semibold tracking-tight">Recent partners</h3>
                      <Link href="/friends" className="text-lg font-semibold text-emerald-400">
                        See all
                      </Link>
                    </div>
                    <div className="space-y-2">
                      {(friendStats ?? []).slice(0, 5).map((friend) => {
                        const gamesPlayed = friend.stats?.gamesPlayed ?? 0;
                        const wins = friend.stats?.gamesWon ?? 0;
                        const rate = gamesPlayed > 0 ? Math.round((wins / gamesPlayed) * 100) : 0;
                        return (
                          <div
                            key={friend._id}
                            className="flex items-center justify-between rounded-2xl border border-zinc-800/80 bg-[#0f141b] px-3 py-3"
                          >
                            <div className="flex items-center gap-3">
                              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#1a222d] text-sm font-semibold text-zinc-200">
                                {initials(friend.name)}
                              </div>
                              <div>
                                <p className="text-xl font-semibold leading-none">{friend.name}</p>
                                <p className="mt-1 text-sm text-zinc-400">{rate}% win rate together</p>
                              </div>
                            </div>
                            <button
                              type="button"
                              onClick={() => handleInviteFriend(friend.name)}
                              className="rounded-full bg-emerald-500/20 px-4 py-1.5 text-base font-semibold text-emerald-300 ring-1 ring-emerald-500/30"
                            >
                              Invite
                            </button>
                          </div>
                        );
                      })}
                      {friendStats && friendStats.length === 0 ? (
                        <p className="rounded-xl border border-zinc-800 bg-[#0f141b] px-3 py-4 text-sm text-zinc-400">
                          Save friends to see quick invite suggestions.
                        </p>
                      ) : null}
                    </div>
                  </section>

                  <section className="px-4 pt-5">
                    <h3 className="mb-3 text-2xl font-semibold">Live games</h3>
                    <div className="space-y-2">
                      {games
                        ?.filter((game) => !game.matchCompleted)
                        .map((game) => (
                          <button
                            key={game._id}
                            onClick={() => router.push(`/game/${game._id}`)}
                            className="w-full rounded-2xl border border-zinc-800 bg-[#0f141b] p-3 text-left"
                          >
                            <p className="text-lg font-semibold">
                              {game.teamA.join(" + ")} vs {game.teamB.join(" + ")}
                            </p>
                            <p className="text-sm text-zinc-400">
                              {game.format.toUpperCase()} · {game.startScore}
                              {game.legsToWin != null ? ` · First to ${game.legsToWin} legs` : ""} · {game.teamAScore} -{" "}
                              {game.teamBScore}
                            </p>
                          </button>
                        ))}
                      {games && games.filter((g) => !g.matchCompleted).length === 0 ? (
                        <p className="rounded-xl border border-zinc-800 bg-[#0f141b] px-3 py-4 text-sm text-zinc-400">
                          No active games yet.
                        </p>
                      ) : null}
                    </div>
                  </section>
            </div>
          ) : null}

          {activeView === "friends" ? (
            <section className="space-y-4 px-4 pb-2">
              <header className="flex items-start justify-between gap-3 pt-1">
                <div>
                  <p className="text-sm font-medium text-zinc-400">
                    <span className="tabular-nums font-semibold text-white">{(friendStats?.length ?? 0)}</span>{" "}
                    saved
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowAddFriend((open) => !open)}
                  className="flex shrink-0 items-center gap-2 rounded-full bg-emerald-500 px-4 py-2.5 text-sm font-bold text-[#031007] shadow-[0_0_22px_rgba(52,211,153,0.45)]"
                >
                  <span aria-hidden>＋</span>
                  Add
                </button>
              </header>

              {showAddFriend ? (
                <form
                  onSubmit={async (event) => {
                    const ok = await handleAddFriend(event);
                    if (ok) setShowAddFriend(false);
                  }}
                  className="rounded-2xl border border-zinc-800 bg-[#0f141b] p-4"
                >
                  <p className="text-sm font-semibold text-white">Add a friend</p>
                  <input
                    value={newFriendName}
                    onChange={(event) => setNewFriendName(event.target.value)}
                    className={`${inputClassName} mt-2`}
                    placeholder="Name"
                    required
                  />
                  <button
                    type="submit"
                    disabled={busy}
                    className="mt-3 w-full rounded-xl bg-emerald-500 py-2.5 text-sm font-bold text-[#031007] disabled:opacity-60"
                  >
                    Save
                  </button>
                </form>
              ) : null}

              <div className="relative">
                <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-zinc-500">
                  ⌕
                </span>
                <input
                  value={friendSearch}
                  onChange={(event) => setFriendSearch(event.target.value)}
                  className={`${inputClassName} rounded-full py-3 pl-11`}
                  placeholder="Search friends..."
                />
              </div>

              <div className="space-y-3">
                {filteredFriends.map((friend) => {
                  const gamesPlayed = friend.stats?.gamesPlayed ?? 0;
                  const wins = friend.stats?.gamesWon ?? 0;
                  const pct = gamesPlayed > 0 ? Math.round((wins / gamesPlayed) * 100) : 0;
                  return (
                    <div
                      key={friend._id}
                      className="relative overflow-hidden rounded-2xl border border-zinc-800/90 bg-[#10161d] p-4"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex gap-3">
                          <div className="relative">
                            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#1a222d] text-sm font-semibold text-zinc-200">
                              {initials(friend.name)}
                            </div>
                            <span className="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full border-2 border-[#10161d] bg-emerald-500" />
                          </div>
                          <div>
                            <p className="text-lg font-semibold text-white">{friend.name}</p>
                            <p className="text-sm text-zinc-500">{handleFromName(friend.name)}</p>
                          </div>
                        </div>
                        <div className="relative">
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              setFriendMenuId((current) => (current === friend._id ? null : friend._id));
                            }}
                            className="rounded-lg px-2 py-1 text-zinc-400 hover:bg-zinc-800/80 hover:text-white"
                            aria-label="Friend options"
                          >
                            ⋮
                          </button>
                          {friendMenuId === friend._id ? (
                            <div className="absolute right-0 top-9 z-10 min-w-[140px] rounded-xl border border-zinc-700 bg-[#151b24] py-1 shadow-xl">
                              <button
                                type="button"
                                className="block w-full px-3 py-2 text-left text-sm text-red-200 hover:bg-red-950/40"
                                onClick={() => {
                                  void handleRemoveFriend(friend._id);
                                  setFriendMenuId(null);
                                }}
                              >
                                Remove friend
                              </button>
                            </div>
                          ) : null}
                        </div>
                      </div>
                      <div className="my-4 h-px bg-zinc-800/80" />
                      <div className="grid grid-cols-3 gap-2 text-center">
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Games</p>
                          <p className="mt-1 text-2xl font-bold tabular-nums text-white">{gamesPlayed}</p>
                        </div>
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Wins</p>
                          <p className="mt-1 text-2xl font-bold tabular-nums text-emerald-400">{wins}</p>
                        </div>
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Win %</p>
                          <p className="mt-1 text-2xl font-bold tabular-nums text-white">{pct}%</p>
                        </div>
                      </div>
                    </div>
                  );
                })}
                {friendStats && friendStats.length === 0 ? (
                  <p className="rounded-2xl border border-zinc-800 bg-[#0f141b] px-4 py-6 text-center text-sm text-zinc-400">
                    No friends yet. Tap Add to save someone you play with often.
                  </p>
                ) : null}
                {friendStats && friendStats.length > 0 && filteredFriends.length === 0 ? (
                  <p className="text-center text-sm text-zinc-500">No matches for that search.</p>
                ) : null}
              </div>
            </section>
          ) : null}

          {activeView === "history" ? (
            <section className="space-y-4 px-4 pb-2">
              <header>
                <p className="text-sm font-medium text-zinc-400">
                  <span className="tabular-nums font-semibold text-white">{history?.length ?? 0}</span> matches
                  total
                </p>
              </header>

              <div className="flex gap-2 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                {(
                  [
                    { id: "all" as const, label: "All" },
                    { id: "1v1" as const, label: "1v1" },
                    { id: "2v2" as const, label: "2v2" },
                    { id: "wins" as const, label: "Wins" },
                    { id: "losses" as const, label: "Losses" },
                  ] as const
                ).map((chip) => (
                  <button
                    key={chip.id}
                    type="button"
                    onClick={() => setHistoryFilter(chip.id)}
                    className={`shrink-0 rounded-full border px-4 py-2 text-sm font-semibold transition ${
                      historyFilter === chip.id
                        ? "border-emerald-500/70 bg-emerald-500/10 text-emerald-300"
                        : "border-zinc-800 bg-[#11161d] text-zinc-400"
                    }`}
                  >
                    {chip.label}
                  </button>
                ))}
              </div>

              <div className="space-y-3">
                {filteredHistory.map((game) => {
                  const ts = game.endedAt ?? game.createdAt;
                  const legsA = game.legsWonA ?? 0;
                  const legsB = game.legsWonB ?? 0;
                  const aWon = game.matchCompleted && game.winnerTeam === "A";
                  const bWon = game.matchCompleted && game.winnerTeam === "B";
                  return (
                    <button
                      key={game._id}
                      type="button"
                      onClick={() => router.push(`/game/${game._id}`)}
                      className="w-full rounded-2xl border border-zinc-800/90 bg-[#10161d] p-4 text-left transition hover:border-zinc-600"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">
                          {formatHistoryMeta(ts, game.format, game.startScore)}
                        </p>
                        <span className="text-zinc-500" aria-hidden>
                          ›
                        </span>
                      </div>
                      <div className="mt-4 grid grid-cols-[1fr_auto_1fr] items-center gap-2">
                        <div className="min-w-0">
                          <div className="flex items-center gap-1">
                            {aWon ? <span className="text-amber-400">🏆</span> : null}
                            <p
                              className={`truncate text-base font-bold ${
                                aWon ? "text-emerald-300" : "text-white"
                              }`}
                            >
                              {teamDisplayLabel(game.teamA)}
                            </p>
                          </div>
                          <div className="mt-2 flex items-center">
                            {game.teamA.map((name, index) => (
                              <div
                                key={name}
                                className={`flex h-9 w-9 items-center justify-center rounded-full border-2 border-[#10161d] bg-[#1a222d] text-xs font-semibold text-zinc-200 ${
                                  index > 0 ? "-ml-2" : ""
                                }`}
                              >
                                {name.trim().charAt(0).toUpperCase()}
                              </div>
                            ))}
                          </div>
                          <p className="mt-1 truncate text-xs text-zinc-500">{game.teamA.join(" · ")}</p>
                        </div>

                        <div className="flex flex-col items-center px-1">
                          <p className="text-3xl font-bold tabular-nums leading-none text-white">
                            {legsA}
                            <span className="mx-1 text-zinc-600">·</span>
                            {legsB}
                          </p>
                          <p className="mt-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-zinc-500">
                            Legs
                          </p>
                        </div>

                        <div className="min-w-0 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <p
                              className={`truncate text-base font-bold ${
                                bWon ? "text-cyan-300" : "text-white"
                              }`}
                            >
                              {teamDisplayLabel(game.teamB)}
                            </p>
                            {bWon ? <span className="text-amber-400">🏆</span> : null}
                          </div>
                          <div className="mt-2 flex items-center justify-end">
                            {game.teamB.map((name, index) => (
                              <div
                                key={name}
                                className={`flex h-9 w-9 items-center justify-center rounded-full border-2 border-[#10161d] bg-[#1a222d] text-xs font-semibold text-zinc-200 ${
                                  index > 0 ? "-ml-2" : ""
                                }`}
                              >
                                {name.trim().charAt(0).toUpperCase()}
                              </div>
                            ))}
                          </div>
                          <p className="mt-1 truncate text-xs text-zinc-500">{game.teamB.join(" · ")}</p>
                        </div>
                      </div>
                      {!game.matchCompleted ? (
                        <p className="mt-3 text-center text-xs text-amber-200/80">In progress</p>
                      ) : null}
                    </button>
                  );
                })}
                {history && history.length === 0 ? (
                  <p className="rounded-2xl border border-zinc-800 bg-[#0f141b] px-4 py-6 text-center text-sm text-zinc-400">
                    No matches yet.{" "}
                    <Link href="/home" className="text-emerald-400 underline-offset-2 hover:underline">
                      Create a game from Home
                    </Link>
                    .
                  </p>
                ) : null}
                {history && history.length > 0 && filteredHistory.length === 0 ? (
                  <p className="text-center text-sm text-zinc-500">Nothing in this filter.</p>
                ) : null}
              </div>
            </section>
          ) : null}

          {activeView === "stats" ? (
            <section className="space-y-4 px-4 pb-2">
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-2xl border border-emerald-800/40 bg-[#0f1a14]/90 p-3">
                  <div className="flex items-start justify-between">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-zinc-500">
                      Win rate
                    </p>
                    <span className="text-lg" aria-hidden>
                      🏆
                    </span>
                  </div>
                  <p className="mt-2 text-3xl font-bold tabular-nums text-white">
                    {primaryPlayer && primaryPlayer.gamesPlayed > 0 ? `${winRatePct}%` : "—"}
                  </p>
                  <p className="mt-1 text-xs text-zinc-500">
                    {primaryPlayer && primaryPlayer.gamesPlayed > 0
                      ? `${primaryPlayer.gamesWon} of ${primaryPlayer.gamesPlayed} games`
                      : "Play more games"}
                  </p>
                </div>
                <div className="rounded-2xl border border-amber-800/40 bg-[#1a140c]/90 p-3">
                  <div className="flex items-start justify-between">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-zinc-500">
                      Streak
                    </p>
                    <span className="text-lg" aria-hidden>
                      🔥
                    </span>
                  </div>
                  <p className="mt-2 text-3xl font-bold tabular-nums text-amber-200">{winStreak}</p>
                  <p className="mt-1 text-xs text-zinc-500">Wins in a row (Team A)</p>
                </div>
                <div className="rounded-2xl border border-zinc-800 bg-[#10161d] p-3">
                  <div className="flex items-start justify-between">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-zinc-500">
                      3-dart avg
                    </p>
                    <span className="text-lg" aria-hidden>
                      ◎
                    </span>
                  </div>
                  <p className="mt-2 text-3xl font-bold tabular-nums text-white">
                    {Number.isFinite(averageScore) && averageScore > 0 ? averageScore.toFixed(1) : "—"}
                  </p>
                  <p className="mt-1 text-xs text-zinc-500">Career (all players)</p>
                </div>
                <div className="rounded-2xl border border-zinc-800 bg-[#10161d] p-3">
                  <div className="flex items-start justify-between">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-zinc-500">
                      Highest
                    </p>
                    <span className="text-lg" aria-hidden>
                      ↗
                    </span>
                  </div>
                  <p className="mt-2 text-3xl font-bold tabular-nums text-white">{highestTurnEver || "—"}</p>
                  <p className="mt-1 text-xs text-zinc-500">Personal best (max turn)</p>
                </div>
              </div>

              <div className="flex rounded-full border border-zinc-800 bg-[#0c1016] p-1">
                <button
                  type="button"
                  onClick={() => setStatsLeaderView("players")}
                  className={`flex flex-1 items-center justify-center gap-2 rounded-full py-2.5 text-sm font-semibold transition ${
                    statsLeaderView === "players"
                      ? "bg-zinc-800 text-white"
                      : "text-zinc-500"
                  }`}
                >
                  <span aria-hidden>◎</span>
                  Players
                </button>
                <button
                  type="button"
                  onClick={() => setStatsLeaderView("teams")}
                  className={`flex flex-1 items-center justify-center gap-2 rounded-full py-2.5 text-sm font-semibold transition ${
                    statsLeaderView === "teams"
                      ? "bg-zinc-800 text-white"
                      : "text-zinc-500"
                  }`}
                >
                  <span aria-hidden>👥</span>
                  Teams
                </button>
              </div>

              <div className="space-y-2">
                {statsLeaderView === "players"
                  ? (stats?.playerStats ?? []).map((row, index) => {
                      const rank = index + 1;
                      const avg =
                        row.turnsPlayed > 0 ? (row.pointsScored / row.turnsPlayed).toFixed(1) : "—";
                      const pct =
                        row.gamesPlayed > 0 ? Math.round((row.gamesWon / row.gamesPlayed) * 100) : 0;
                      const isYou =
                        meDisplayName.length > 0 &&
                        normalizeKey(row.playerName) === normalizeKey(meDisplayName);
                      return (
                        <div
                          key={row._id}
                          className={`flex items-center gap-3 rounded-2xl border px-3 py-3 ${
                            isYou
                              ? "border-emerald-500/60 bg-emerald-500/5"
                              : "border-zinc-800/90 bg-[#10161d]"
                          }`}
                        >
                          <div
                            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-bold ${
                              rank === 1
                                ? "bg-gradient-to-br from-amber-400 to-amber-700 text-black"
                                : "bg-[#1a222d] text-zinc-300"
                            }`}
                          >
                            {rank}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-baseline gap-2">
                              <p className="truncate text-base font-semibold text-white">{row.playerName}</p>
                              {isYou ? (
                                <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-300">
                                  You
                                </span>
                              ) : null}
                            </div>
                            <p className="text-xs text-zinc-500">
                              Avg {avg} · HT {row.highestTurn}
                            </p>
                          </div>
                          <div className="shrink-0 text-right">
                            <p className="text-lg font-bold text-emerald-400">{pct}%</p>
                            <p className="text-xs text-zinc-500">
                              {row.gamesWon}/{row.gamesPlayed}
                            </p>
                          </div>
                        </div>
                      );
                    })
                  : (stats?.teamStats ?? []).map((row, index) => {
                      const rank = index + 1;
                      const avg =
                        row.turnsPlayed > 0 ? (row.pointsScored / row.turnsPlayed).toFixed(1) : "—";
                      const pct =
                        row.gamesPlayed > 0 ? Math.round((row.gamesWon / row.gamesPlayed) * 100) : 0;
                      return (
                        <div
                          key={row._id}
                          className="flex items-center gap-3 rounded-2xl border border-zinc-800/90 bg-[#10161d] px-3 py-3"
                        >
                          <div
                            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-bold ${
                              rank === 1
                                ? "bg-gradient-to-br from-amber-400 to-amber-700 text-black"
                                : "bg-[#1a222d] text-zinc-300"
                            }`}
                          >
                            {rank}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-base font-semibold text-white">{row.teamKey}</p>
                            <p className="text-xs text-zinc-500">
                              Avg {avg} · HT {row.highestTurn}
                            </p>
                          </div>
                          <div className="shrink-0 text-right">
                            <p className="text-lg font-bold text-emerald-400">{pct}%</p>
                            <p className="text-xs text-zinc-500">
                              {row.gamesWon}/{row.gamesPlayed}
                            </p>
                          </div>
                        </div>
                      );
                    })}
                {statsLeaderView === "players" && (stats?.playerStats ?? []).length === 0 ? (
                  <p className="rounded-2xl border border-zinc-800 bg-[#0f141b] px-4 py-6 text-center text-sm text-zinc-400">
                    No player stats yet.
                  </p>
                ) : null}
                {statsLeaderView === "teams" && (stats?.teamStats ?? []).length === 0 ? (
                  <p className="rounded-2xl border border-zinc-800 bg-[#0f141b] px-4 py-6 text-center text-sm text-zinc-400">
                    No team stats yet.
                  </p>
                ) : null}
              </div>
            </section>
          ) : null}

          <BottomNav />
    </main>
  );
}

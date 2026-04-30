"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";

type TeamSide = "A" | "B";
type StatsModalTab = "team" | "individual";
type StatsScope = "overall" | "leg";
type PendingTurn =
  | { kind: "checkout"; turnTotal: number }
  | { kind: "zone"; turnTotal: number; remaining: number };

type StatTurn = {
  _id: Id<"turns">;
  wasBust: boolean;
  turnTotal: number;
  darts: number[];
  legNumber?: number;
  scoreAfter: number;
  scoreBefore: number;
  playerName: string;
  createdAt: number;
  dartsAtDoubleBed?: number;
  dartsHitOnDoubleBed?: number;
  checkoutDoubleHit?: boolean;
  checkoutDartsOnDouble?: number;
  doublesHitNotes?: string;
};

function countLegsWonByTeam(
  allTurns: Array<{
    legNumber?: number;
    scoreAfter: number;
    wasBust: boolean;
    team: TeamSide;
    createdAt: number;
  }>,
  team: TeamSide,
): number {
  const byLeg = new Map<number, typeof allTurns>();
  for (const turn of allTurns) {
    const leg = turn.legNumber ?? 1;
    const bucket = byLeg.get(leg) ?? [];
    bucket.push(turn);
    byLeg.set(leg, bucket);
  }
  let won = 0;
  for (const legTurns of byLeg.values()) {
    legTurns.sort((a, b) => a.createdAt - b.createdAt);
    const checkout = [...legTurns].reverse().find((t) => !t.wasBust && t.scoreAfter === 0);
    if (checkout && checkout.team === team) won += 1;
  }
  return won;
}

/**
 * Double hit % = sum(hits) / sum(aimed) — same idea as common stat trackers (each dart at the
 * double ring is an “aim”; count how many actually hit a double, including wrong-bed doubles).
 * Only counts visits with aimed ≥ 1 and known hits (checkout can infer hits if legacy rows lack it).
 */
function computeDoubleBedAiming(turns: StatTurn[]) {
  let aimed = 0;
  let hit = 0;
  for (const turn of turns) {
    const at = turn.dartsAtDoubleBed;
    if (at === undefined || at < 1) continue;

    let h: number | undefined = turn.dartsHitOnDoubleBed;
    if (h === undefined && !turn.wasBust && turn.scoreAfter === 0 && turn.checkoutDoubleHit === true) {
      const on = turn.checkoutDartsOnDouble;
      h = on !== undefined && on > 0 ? on : 1;
    }
    if (h === undefined) continue;

    aimed += at;
    hit += Math.max(0, Math.min(h, at));
  }
  return { aimed, hit };
}

/** Dart count from turn total — matches Convex `toDartsFromTotal` (max 60 per dart). */
function dartCountFromTurnTotal(turnTotal: number): number {
  const capped = Math.max(0, Math.min(180, Math.floor(turnTotal)));
  if (capped === 0) return 1;
  const darts: number[] = [];
  let remaining = capped;
  while (remaining > 0 && darts.length < 3) {
    const dart = Math.min(60, remaining);
    darts.push(dart);
    remaining -= dart;
  }
  return darts.length;
}

/**
 * Darts thrown this visit for PPR.
 * Stored `darts` is a greedy split of the turn total (fewest segments), not how many darts
 * were actually thrown — using `darts.length` inflates PPR (e.g. 60 → 1 “dart” → bogus 180).
 * Convention: full scoring visits count as 3 darts; checkouts use meta vs greedy, capped at 3.
 */
function turnEffectiveDartCount(turn: StatTurn): number {
  const n = turn.darts.length;
  const atD = turn.dartsAtDoubleBed;

  if (!turn.wasBust && turn.scoreAfter === 0) {
    const aimed = atD != null && atD > 0 ? atD : n;
    return Math.min(3, Math.max(n, aimed));
  }

  if (turn.wasBust) {
    return Math.min(3, Math.max(1, n));
  }

  return 3;
}

function computeModalStats(turns: StatTurn[]) {
  const dartsTotal = turns.reduce((sum, turn) => sum + turnEffectiveDartCount(turn), 0);
  const pointsTotal = turns.reduce((sum, turn) => sum + turnPoints(turn), 0);
  const threeDartAvg = dartsTotal > 0 ? (pointsTotal / dartsTotal) * 3 : 0;
  const highest = turns.reduce((max, turn) => (turn.wasBust ? max : Math.max(max, turn.turnTotal)), 0);
  const turnCount = turns.length;

  let pointsNoD = 0;
  let dartsNoD = 0;
  for (const turn of turns) {
    const p = turnPoints(turn);
    const d = turnEffectiveDartCount(turn);
    const hadDouble =
      countLikelyDoubleDarts(turn.darts) > 0 || (turn.dartsAtDoubleBed ?? 0) > 0 || turn.scoreAfter === 0;
    if (!hadDouble) {
      pointsNoD += p;
      dartsNoD += d;
    }
  }
  const avgWoD = dartsNoD > 0 ? (pointsNoD / dartsNoD) * 3 : 0;

  const checkoutTurns = turns.filter((turn) => !turn.wasBust && turn.scoreAfter === 0);
  const checkoutWithMeta = checkoutTurns.filter((turn) => turn.checkoutDoubleHit !== undefined);
  const checkoutsHit = checkoutTurns.filter((turn) => turn.checkoutDoubleHit === true).length;
  const checkoutPct =
    checkoutWithMeta.length > 0 ? Math.round((checkoutsHit / checkoutWithMeta.length) * 100) : 0;

  const dartsAtDoubleValues = turns
    .map((turn) => turn.dartsAtDoubleBed)
    .filter((n): n is number => n !== undefined && n > 0);
  const dartsToDoubleAvg =
    dartsAtDoubleValues.length > 0
      ? dartsAtDoubleValues.reduce((a, b) => a + b, 0) / dartsAtDoubleValues.length
      : 0;

  const { aimed: dartsAimedAtDouble, hit: dartsHitOnDouble } = computeDoubleBedAiming(turns);
  const doublesHitStr =
    dartsAimedAtDouble > 0
      ? `${dartsHitOnDouble}/${dartsAimedAtDouble} (${Math.round((dartsHitOnDouble / dartsAimedAtDouble) * 100)}%)`
      : "—";

  const count180 = turns.filter((turn) => !turn.wasBust && turn.turnTotal === 180).length;
  const count140 = turns.filter((turn) => !turn.wasBust && turn.turnTotal >= 140).length;
  const count100 = turns.filter((turn) => !turn.wasBust && turn.turnTotal >= 100).length;
  const count80 = turns.filter((turn) => !turn.wasBust && turn.turnTotal >= 80).length;
  const count60 = turns.filter((turn) => !turn.wasBust && turn.turnTotal >= 60).length;

  return {
    threeDartAvg,
    highest,
    turnCount,
    avgWoD,
    checkoutPct,
    dartsToDoubleAvg,
    doublesHitStr,
    count180,
    count140,
    count100,
    count80,
    count60,
  };
}

function teamLabel(team: "A" | "B", players: { playerName: string }[]): string {
  if (players.length === 0) return team === "A" ? "TEAM A" : "TEAM B";
  const joined = players.map((p) => p.playerName).join(" & ");
  return joined.length > 18 ? (team === "A" ? "TEAM A" : "TEAM B") : joined.toUpperCase();
}

function isLikelyDoubleDart(d: number): boolean {
  if (d === 50) return true;
  if (d >= 2 && d <= 40 && d % 2 === 0) {
    const seg = d / 2;
    return Number.isInteger(seg) && seg >= 1 && seg <= 20;
  }
  return false;
}

function countLikelyDoubleDarts(darts: number[]): number {
  return darts.filter(isLikelyDoubleDart).length;
}

function turnPoints(turn: { wasBust: boolean; turnTotal: number }): number {
  return turn.wasBust ? 0 : turn.turnTotal;
}

function turnDartCount(turn: { darts: number[] }): number {
  return turn.darts.length;
}

function StatMini({
  label,
  value,
  icon,
  accent,
  highlight,
}: {
  label: string;
  value: string;
  icon?: string;
  accent?: boolean;
  highlight?: boolean;
}) {
  return (
    <div
      className={`rounded-2xl border bg-[#151b22] p-3 ${
        highlight ? "border-emerald-500/55 ring-1 ring-emerald-500/25" : "border-zinc-800/90"
      }`}
    >
      <div className="flex items-start justify-between gap-1">
        <span className="text-[9px] font-semibold uppercase tracking-[0.14em] text-zinc-500">{label}</span>
        {icon ? <span className="text-sm leading-none text-zinc-500">{icon}</span> : null}
      </div>
      <p className={`mt-2 text-2xl font-bold tabular-nums ${accent ? "text-emerald-400" : "text-white"}`}>
        {value}
      </p>
    </div>
  );
}

export default function GamePage() {
  const router = useRouter();
  const params = useParams<{ gameId: string }>();
  const gameId = params.gameId as Id<"games">;

  const [turnInput, setTurnInput] = useState("");
  const [checkMessage, setCheckMessage] = useState<string | null>(null);
  const [showLegHistory, setShowLegHistory] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [statsTeam, setStatsTeam] = useState<TeamSide | null>(null);
  const [statsLeg, setStatsLeg] = useState<number>(1);
  const [statsTab, setStatsTab] = useState<StatsModalTab>("team");
  const [statsScope, setStatsScope] = useState<StatsScope>("overall");
  const [statsPlayerName, setStatsPlayerName] = useState<string | null>(null);

  const [pendingTurn, setPendingTurn] = useState<PendingTurn | null>(null);
  /** Darts aimed at a double bed this checkout visit (≤ darts in this turn). */
  const [checkoutAtDouble, setCheckoutAtDouble] = useState<number | null>(null);
  /** Of those, how many hit a double (includes the checkout). */
  const [checkoutHitsOnDouble, setCheckoutHitsOnDouble] = useState<number | null>(null);
  const [zoneDartsAtDouble, setZoneDartsAtDouble] = useState<number | null>(null);
  /** For double-zone visits: of darts aimed at a double, how many hit (0…aimed). */
  const [zoneHitsOnDouble, setZoneHitsOnDouble] = useState<number | null>(null);
  const [zoneNotes, setZoneNotes] = useState("");

  const details = useQuery(api.games.getGameDetails, { gameId });
  const submitTurnTotal = useMutation(api.games.submitTurnTotal);
  const undoLastTurn = useMutation(api.games.undoLastTurn);
  const startNextLeg = useMutation(api.games.startNextLeg);
  const toggleTeamStarterIndex = useMutation(api.games.toggleTeamStarterIndex);
  const endGame = useMutation(api.games.endGame);

  /** Leg number we already fired autostart for (avoids duplicate calls). */
  const autostartLegRef = useRef<number | null>(null);

  useEffect(() => {
    if (!details) return;
    const g = details.game;
    if (g.matchCompleted || !g.isFinished) return;
    const legNum = g.legNumber ?? 1;
    if (autostartLegRef.current === legNum) return;
    autostartLegRef.current = legNum;

    let cancelled = false;
    (async () => {
      setError(null);
      setBusy(true);
      try {
        await startNextLeg({ gameId: g._id });
      } catch (cause) {
        if (!cancelled) {
          autostartLegRef.current = null;
          setError(cause instanceof Error ? cause.message : "Could not start the next leg.");
        }
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    details?.game._id,
    details?.game.isFinished,
    details?.game.matchCompleted,
    details?.game.legNumber,
    startNextLeg,
  ]);

  const maxLeg = useMemo(() => {
    if (!details) return 1;
    const fromTurns = details.turns.map((t) => t.legNumber ?? 1);
    return Math.max(details.game.legNumber ?? 1, ...fromTurns, 1);
  }, [details]);

  const currentLegTurns = useMemo(() => {
    if (!details) return [];
    const currentLeg = details.game.legNumber ?? 1;
    return details.turns.filter((turn) => (turn.legNumber ?? 1) === currentLeg);
  }, [details]);

  const lastTurnByTeam = useMemo(() => {
    const sorted = [...currentLegTurns].sort((a, b) => a.createdAt - b.createdAt);
    let lastA: (typeof sorted)[0] | null = null;
    let lastB: (typeof sorted)[0] | null = null;
    for (const turn of sorted) {
      if (turn.team === "A") lastA = turn;
      if (turn.team === "B") lastB = turn;
    }
    return { A: lastA, B: lastB };
  }, [currentLegTurns]);

  const checkoutSlotInfo = useMemo(() => {
    if (!pendingTurn || pendingTurn.kind !== "checkout") {
      return { slots: 3, maxAtDouble: 3 };
    }
    const slots = dartCountFromTurnTotal(pendingTurn.turnTotal);
    return { slots, maxAtDouble: 3 };
  }, [pendingTurn]);

  const modalTurns = useMemo((): StatTurn[] => {
    if (!details || statsTeam === null) return [];
    let list = details.turns.filter((t) => t.team === statsTeam) as StatTurn[];
    if (statsScope === "leg") {
      list = list.filter((t) => (t.legNumber ?? 1) === statsLeg);
    }
    if (statsTab === "individual" && statsPlayerName) {
      list = list.filter((t) => t.playerName === statsPlayerName);
    }
    return list.sort((a, b) => a.createdAt - b.createdAt);
  }, [details, statsTeam, statsLeg, statsScope, statsTab, statsPlayerName]);

  const legsWonInModal = useMemo(() => {
    if (!details || statsTeam === null) return 0;
    return countLegsWonByTeam(details.turns, statsTeam);
  }, [details, statsTeam]);

  const modalStats = useMemo(() => computeModalStats(modalTurns), [modalTurns]);

  const legsWonA = details?.legsWonA ?? 0;
  const legsWonB = details?.legsWonB ?? 0;

  const modalLegTurnsList = useMemo(() => {
    if (!details || statsTeam === null) return [];
    let list = details.turns.filter(
      (t) => t.team === statsTeam && (t.legNumber ?? 1) === statsLeg,
    ) as StatTurn[];
    if (statsTab === "individual" && statsPlayerName) {
      list = list.filter((t) => t.playerName === statsPlayerName);
    }
    return list.sort((a, b) => a.createdAt - b.createdAt);
  }, [details, statsTeam, statsLeg, statsTab, statsPlayerName]);

  function appendDigit(digit: string) {
    setTurnInput((previous) => {
      if (previous.length >= 3) return previous;
      if (previous === "0") return digit;
      return previous + digit;
    });
    setCheckMessage(null);
  }

  function handleBackspace() {
    setTurnInput((previous) => previous.slice(0, -1));
    setCheckMessage(null);
  }

  function handleCheck() {
    if (!details || !details.activeParticipant) return;
    const turnTotal = turnInput.trim() === "" ? 0 : Number(turnInput);
    if (!Number.isFinite(turnTotal) || turnTotal < 0 || turnTotal > 180) {
      setCheckMessage("Enter a score between 0 and 180.");
      return;
    }

    const currentScore =
      details.activeParticipant.team === "A" ? details.game.teamAScore : details.game.teamBScore;
    const scoreLeft = currentScore - turnTotal;
    if (scoreLeft < 0) {
      setCheckMessage(`Bust: ${currentScore} − ${turnTotal} goes below 0.`);
    } else if (scoreLeft === 0) {
      setCheckMessage("Checkout: this score wins the leg.");
    } else {
      setCheckMessage(`After ${turnTotal}, you would have ${scoreLeft} left.`);
    }
  }

  function openStats(team: TeamSide) {
    if (!details) return;
    setStatsTeam(team);
    setStatsLeg(details.game.legNumber ?? 1);
    setStatsTab("team");
    setStatsScope("overall");
    const names = team === "A" ? details.teamA.map((p) => p.playerName) : details.teamB.map((p) => p.playerName);
    setStatsPlayerName(names[0] ?? null);
  }

  function closeStats() {
    setStatsTeam(null);
    setStatsScope("overall");
    setStatsPlayerName(null);
  }

  function resetCheckoutModal() {
    setPendingTurn(null);
    setCheckoutAtDouble(null);
    setCheckoutHitsOnDouble(null);
    setZoneDartsAtDouble(null);
    setZoneHitsOnDouble(null);
    setZoneNotes("");
  }

  async function submitTurnWithMeta(
    turnTotal: number,
    extra?: {
      dartsAtDoubleBed?: number;
      dartsHitOnDoubleBed?: number;
      checkoutDoubleHit?: boolean;
      checkoutDartsOnDouble?: number;
      doublesHitNotes?: string;
    },
  ) {
    if (!details || !details.activeParticipant) return;
    setError(null);
    setCheckMessage(null);
    setBusy(true);
    try {
      await submitTurnTotal({
        gameId: details.game._id,
        participantId: details.activeParticipant._id,
        turnTotal,
        dartsAtDoubleBed: extra?.dartsAtDoubleBed,
        dartsHitOnDoubleBed: extra?.dartsHitOnDoubleBed,
        checkoutDoubleHit: extra?.checkoutDoubleHit,
        checkoutDartsOnDouble: extra?.checkoutDartsOnDouble,
        doublesHitNotes: extra?.doublesHitNotes?.trim() || undefined,
      });
      setTurnInput("");
      resetCheckoutModal();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to submit turn.");
    } finally {
      setBusy(false);
    }
  }

  function beginAddTurn() {
    if (!details || !details.activeParticipant) return;
    const turnTotal = turnInput.trim() === "" ? 0 : Number(turnInput);
    if (!Number.isFinite(turnTotal) || turnTotal < 0 || turnTotal > 180) {
      setError("Enter a valid turn score between 0 and 180.");
      return;
    }

    const currentScore =
      details.activeParticipant.team === "A" ? details.game.teamAScore : details.game.teamBScore;
    const left = currentScore - turnTotal;
    if (left < 0) {
      setError("That score is a bust.");
      return;
    }

    setError(null);
    if (left > 40) {
      void submitTurnWithMeta(turnTotal, undefined);
      return;
    }
    if (left === 0) {
      setCheckoutAtDouble(null);
      setCheckoutHitsOnDouble(null);
      setPendingTurn({ kind: "checkout", turnTotal });
      return;
    }
    setZoneDartsAtDouble(null);
    setZoneHitsOnDouble(null);
    setZoneNotes("");
    setPendingTurn({ kind: "zone", turnTotal, remaining: left });
  }

  function confirmZone(skip: boolean) {
    if (!pendingTurn || pendingTurn.kind !== "zone") return;
    if (skip) {
      void submitTurnWithMeta(pendingTurn.turnTotal, undefined);
      return;
    }
    if (zoneDartsAtDouble === null) {
      setError("Pick 0–3 darts at the double, or tap Skip.");
      return;
    }
    if (zoneDartsAtDouble >= 1 && zoneHitsOnDouble === null) {
      setError("Pick how many of those darts hit a double (0 if none).");
      return;
    }
    const notes = zoneNotes.trim();
    void submitTurnWithMeta(pendingTurn.turnTotal, {
      dartsAtDoubleBed: zoneDartsAtDouble,
      dartsHitOnDoubleBed: zoneDartsAtDouble >= 1 ? zoneHitsOnDouble! : undefined,
      doublesHitNotes: notes || undefined,
    });
  }

  function confirmCheckout() {
    if (!pendingTurn || pendingTurn.kind !== "checkout") return;
    const maxAt = checkoutSlotInfo.maxAtDouble;
    if (checkoutAtDouble === null || checkoutAtDouble < 1 || checkoutAtDouble > maxAt) {
      setError(`Pick how many darts were at the double (1–${maxAt} for this turn).`);
      return;
    }
    const hits =
      checkoutAtDouble === 1 ? 1 : checkoutHitsOnDouble;
    if (hits === null || hits < 1 || hits > checkoutAtDouble) {
      setError("Pick how many of those darts hit a double (including the checkout).");
      return;
    }
    void submitTurnWithMeta(pendingTurn.turnTotal, {
      dartsAtDoubleBed: checkoutAtDouble,
      dartsHitOnDoubleBed: hits,
      checkoutDoubleHit: true,
      checkoutDartsOnDouble: checkoutAtDouble,
    });
  }

  async function handleUndo() {
    if (!details) return;
    setError(null);
    setCheckMessage(null);
    setBusy(true);
    try {
      await undoLastTurn({ gameId: details.game._id });
      setTurnInput("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to undo.");
    } finally {
      setBusy(false);
    }
  }

  async function handleRetryStartNextLeg() {
    if (!details) return;
    setError(null);
    setBusy(true);
    try {
      await startNextLeg({ gameId: details.game._id });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to start next leg.");
    } finally {
      setBusy(false);
    }
  }

  async function handleToggleTeamStarter(team: TeamSide) {
    if (!details) return;
    setError(null);
    setBusy(true);
    try {
      await toggleTeamStarterIndex({ gameId: details.game._id, team });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not update teammate order.");
    } finally {
      setBusy(false);
    }
  }

  async function handleEndGame() {
    if (!details) return;
    setError(null);
    setBusy(true);
    try {
      await endGame({ gameId: details.game._id });
      router.push("/home");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to end game.");
    } finally {
      setBusy(false);
    }
  }

  if (!details) {
    return (
      <main className="relative box-border flex h-[100dvh] max-h-[100dvh] w-full max-w-md flex-col items-center justify-center overflow-hidden bg-[#060908] px-4 pb-[max(1rem,env(safe-area-inset-bottom))] text-white">
        <p className="text-sm text-zinc-400">Loading…</p>
      </main>
    );
  }

  const canSwapTeammateOrder =
    !details.game.matchCompleted &&
    (details.game.isFinished || details.game.turnIndex === 0);

  const leg = details.game.legNumber ?? 1;
  const legsTarget = details.game.legsToWin;
  const formatLine = `${details.game.startScore} · ${details.game.format.toUpperCase()}${
    legsTarget != null ? ` · First to ${legsTarget} legs` : ""
  }`;
  const active = details.activeParticipant;

  const statsRosterNames =
    statsTeam === "A" ? details.teamA.map((p) => p.playerName) : details.teamB.map((p) => p.playerName);
  const modalTeamTitle =
    statsTeam === "A" ? teamLabel("A", details.teamA) : teamLabel("B", details.teamB);
  const modalPlayersLine = statsRosterNames.join(" · ");

  return (
    <main className="relative box-border mx-auto flex h-[100dvh] max-h-[100dvh] w-full max-w-md flex-col overflow-hidden bg-[#060908] pb-[max(1rem,env(safe-area-inset-bottom))] text-white">
      {/* Top bar */}
      <header className="flex shrink-0 items-start justify-between px-3 pt-2 pb-1">
        <Link
          href="/home"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-zinc-700/80 bg-[#111816] text-base text-zinc-100 shadow-inner hover:border-emerald-600/60"
          aria-label="Back to home"
        >
          ←
        </Link>
        <div className="flex flex-1 flex-col items-center px-1.5 text-center">
          <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-zinc-500">{formatLine}</p>
          <p className="mt-0.5 text-lg font-bold tracking-tight text-white">Leg {leg}</p>
        </div>
        <button
          type="button"
          onClick={handleEndGame}
          disabled={busy}
          className="flex shrink-0 flex-col items-center gap-0 rounded-lg px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-red-300 hover:text-red-200 disabled:opacity-40"
        >
          <span className="text-sm leading-none" aria-hidden>
            🏁
          </span>
          End
        </button>
      </header>

      {error ? (
        <div className="mx-3 mb-1.5 rounded-lg border border-red-800/60 bg-red-950/40 px-2.5 py-1.5 text-center text-[11px] text-red-200">
          {error}
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-y-contain">
      {/* Team scorecards */}
      {!details.game.matchCompleted && (
        <div className="grid shrink-0 grid-cols-2 gap-1.5 px-2.5 pb-1.5 min-h-[140px]">
          <div
            role="button"
            tabIndex={0}
            aria-label="Open team stats"
            onClick={() => openStats("A")}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                openStats("A");
              }
            }}
            className="relative flex cursor-pointer flex-col rounded-xl border border-emerald-500/25 bg-gradient-to-b from-emerald-950/50 to-[#0a1510] p-2 shadow-md shadow-emerald-900/20 outline-none ring-emerald-500/0 transition hover:ring-2 hover:ring-emerald-500/30 focus-visible:ring-2 focus-visible:ring-emerald-500/40"
          >
            <p className="text-[9px] font-semibold uppercase tracking-widest text-emerald-400/90">
              {teamLabel("A", details.teamA)}
            </p>
            <div className="mt-1 flex flex-1 flex-col justify-between">
              <div className="flex items-start justify-between gap-0.5">
                <span className="text-3xl font-bold tabular-nums leading-none tracking-tighter text-white">
                  {details.game.teamAScore}
                </span>
                {lastTurnByTeam.A ? (
                  <div className="flex flex-col items-end pt-0.5">
                    <span className="text-[8px] font-medium uppercase tracking-wider text-zinc-500">Last</span>
                    <span className="text-xs font-semibold tabular-nums text-emerald-400">
                      −{lastTurnByTeam.A.turnTotal}
                    </span>
                  </div>
                ) : (
                  <span className="pt-1 text-[9px] text-zinc-600">—</span>
                )}
              </div>
              <div className="mt-1.5 rounded-lg border border-black/30 bg-black/25 px-1.5 py-1 text-center">
                <p className="text-[8px] font-semibold uppercase tracking-wider text-zinc-500">Legs won</p>
                <p className="mt-0 text-lg font-bold tabular-nums leading-none text-emerald-300">{legsWonA}</p>
              </div>
              {details.teamA.length > 1 ? (
                <button
                  type="button"
                  disabled={busy || !canSwapTeammateOrder}
                  title={
                    !canSwapTeammateOrder
                      ? "Switch order only before the first throw of this leg, or after a leg ends."
                      : "Swap which teammate leads your rotation"
                  }
                  onClick={(event) => {
                    event.stopPropagation();
                    void handleToggleTeamStarter("A");
                  }}
                  className="mt-1.5 w-full rounded-md border border-emerald-800/50 bg-black/30 px-1.5 py-1 text-left text-[9px] font-medium leading-tight text-zinc-300 transition hover:border-emerald-600/50 hover:bg-emerald-950/30 disabled:opacity-40"
                >
                  <span className="text-zinc-500">Order · </span>
                  <span className="text-emerald-200/95">
                    {details.teamA[details.game.teamAStarterIndex ?? 0]?.playerName ?? "—"} first
                  </span>
                  <span className="text-zinc-500"> · tap to switch</span>
                </button>
              ) : null}
              <div className="mt-2 flex flex-col gap-1">
                {details.teamA.map((player) => {
                  const throwing = active?._id === player._id;
                  return (
                    <div
                      key={player._id}
                      className={`rounded-lg px-2 py-1 text-center text-[11px] font-medium transition ${
                        throwing
                          ? "border border-emerald-400/60 bg-emerald-500/20 text-emerald-100 shadow-[0_0_8px_rgba(16,185,129,0.2)]"
                          : "border border-zinc-800/80 bg-black/20 text-zinc-500"
                      }`}
                    >
                      {throwing ? (
                        <span className="mr-0.5 inline-block h-1 w-1 rounded-full bg-emerald-400 align-middle" />
                      ) : null}
                      {player.playerName}
                      {throwing ? (
                        <span className="mt-0 block text-[8px] font-semibold uppercase tracking-wider text-emerald-300/90">
                          Throwing
                        </span>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          <div
            role="button"
            tabIndex={0}
            aria-label="Open team stats"
            onClick={() => openStats("B")}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                openStats("B");
              }
            }}
            className="relative flex cursor-pointer flex-col rounded-xl border border-cyan-500/25 bg-gradient-to-b from-cyan-950/40 to-[#0a1215] p-2 shadow-md shadow-cyan-900/15 outline-none ring-cyan-500/0 transition hover:ring-2 hover:ring-cyan-500/30 focus-visible:ring-2 focus-visible:ring-cyan-500/40"
          >
            <p className="text-[9px] font-semibold uppercase tracking-widest text-cyan-400/90">
              {teamLabel("B", details.teamB)}
            </p>
            <div className="mt-1 flex flex-1 flex-col justify-between">
              <div className="flex items-start justify-between gap-0.5">
                <span className="text-3xl font-bold tabular-nums leading-none tracking-tighter text-white">
                  {details.game.teamBScore}
                </span>
                {lastTurnByTeam.B ? (
                  <div className="flex flex-col items-end pt-0.5">
                    <span className="text-[8px] font-medium uppercase tracking-wider text-zinc-500">Last</span>
                    <span className="text-xs font-semibold tabular-nums text-cyan-400">
                      −{lastTurnByTeam.B.turnTotal}
                    </span>
                  </div>
                ) : (
                  <span className="pt-1 text-[9px] text-zinc-600">—</span>
                )}
              </div>
              <div className="mt-1.5 rounded-lg border border-black/30 bg-black/25 px-1.5 py-1 text-center">
                <p className="text-[8px] font-semibold uppercase tracking-wider text-zinc-500">Legs won</p>
                <p className="mt-0 text-lg font-bold tabular-nums leading-none text-cyan-300">{legsWonB}</p>
              </div>
              {details.teamB.length > 1 ? (
                <button
                  type="button"
                  disabled={busy || !canSwapTeammateOrder}
                  title={
                    !canSwapTeammateOrder
                      ? "Switch order only before the first throw of this leg, or after a leg ends."
                      : "Swap which teammate leads your rotation"
                  }
                  onClick={(event) => {
                    event.stopPropagation();
                    void handleToggleTeamStarter("B");
                  }}
                  className="mt-1.5 w-full rounded-md border border-cyan-800/50 bg-black/30 px-1.5 py-1 text-left text-[9px] font-medium leading-tight text-zinc-300 transition hover:border-cyan-600/50 hover:bg-cyan-950/25 disabled:opacity-40"
                >
                  <span className="text-zinc-500">Order · </span>
                  <span className="text-cyan-200/95">
                    {details.teamB[details.game.teamBStarterIndex ?? 0]?.playerName ?? "—"} first
                  </span>
                  <span className="text-zinc-500"> · tap to switch</span>
                </button>
              ) : null}
              <div className="mt-2 flex flex-col gap-1">
                {details.teamB.map((player) => {
                  const throwing = active?._id === player._id;
                  return (
                    <div
                      key={player._id}
                      className={`rounded-lg px-2 py-1 text-center text-[11px] font-medium transition ${
                        throwing
                          ? "border border-cyan-400/60 bg-cyan-500/20 text-cyan-50 shadow-[0_0_8px_rgba(34,211,238,0.18)]"
                          : "border border-zinc-800/80 bg-black/20 text-zinc-500"
                      }`}
                    >
                      {throwing ? (
                        <span className="mr-0.5 inline-block h-1 w-1 rounded-full bg-cyan-400 align-middle" />
                      ) : null}
                      {player.playerName}
                      {throwing ? (
                        <span className="mt-0 block text-[8px] font-semibold uppercase tracking-wider text-cyan-200/90">
                          Throwing
                        </span>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      {!details.game.matchCompleted && !details.game.isFinished && active ? (
        <p className="px-3 pb-1 text-center text-[10px] text-zinc-400">
          Now throwing{" "}
          <span
            className={`inline-block rounded-full px-1.5 py-px text-[10px] font-semibold ${
              active.team === "A"
                ? "bg-emerald-500/25 text-emerald-200 ring-1 ring-emerald-500/40"
                : "bg-cyan-500/20 text-cyan-100 ring-1 ring-cyan-500/35"
            }`}
          >
            {active.playerName}
          </span>
        </p>
      ) : null}

      {!details.game.matchCompleted && !details.game.isFinished ? (
        <>
          {pendingTurn ? (
            <div className="mx-2.5 mt-0.5 flex flex-col gap-2 pb-1.5">
              {pendingTurn.kind === "checkout" ? (
                <div className="rounded-xl border border-emerald-700/45 bg-gradient-to-b from-emerald-950/50 to-[#0c1210] p-3 shadow-md shadow-emerald-900/15">
                  <p className="text-center text-[10px] font-semibold uppercase tracking-[0.28em] text-emerald-400">
                    Checkout
                  </p>
                  <p className="mt-0.5 text-center text-base font-bold text-white">Turn total {pendingTurn.turnTotal}</p>
                  <p className="mt-1 text-center text-[10px] text-zinc-500">
                    Turn total is stored as {checkoutSlotInfo.slots} scoring dart
                    {checkoutSlotInfo.slots === 1 ? "" : "s"} — you can still report 1–3 darts thrown at a double (e.g.
                    two misses then a checkout).
                  </p>
                  <p className="mt-3 text-center text-xs text-zinc-300">Darts aimed at a double this visit</p>
                  <div className="mt-1.5 flex gap-1.5">
                    {Array.from({ length: checkoutSlotInfo.maxAtDouble }, (_, i) => i + 1).map((n) => (
                      <button
                        key={n}
                        type="button"
                        onClick={() => {
                          setError(null);
                          setCheckoutAtDouble(n);
                          setCheckoutHitsOnDouble(null);
                        }}
                        className={`flex-1 rounded-lg border py-2 text-base font-bold ${
                          checkoutAtDouble === n
                            ? "border-emerald-500 bg-emerald-500/25 text-emerald-100 shadow-[0_0_14px_rgba(16,185,129,0.25)]"
                            : "border-zinc-700 bg-[#111820] text-zinc-300"
                        }`}
                      >
                        {n}
                      </button>
                    ))}
                  </div>
                  {checkoutAtDouble !== null && checkoutAtDouble > 1 ? (
                    <>
                      <p className="mt-3 text-center text-xs text-zinc-300">How many hit a double?</p>
                      <p className="mt-0.5 text-center text-[10px] text-zinc-500">
                        (Includes the checkout; misses lower your hit %.)
                      </p>
                      <div className="mt-1.5 flex flex-wrap justify-center gap-1.5">
                        {Array.from({ length: checkoutAtDouble }, (_, i) => i + 1).map((n) => (
                          <button
                            key={n}
                            type="button"
                            onClick={() => {
                              setError(null);
                              setCheckoutHitsOnDouble(n);
                            }}
                            className={`min-w-[2.75rem] rounded-lg border px-2 py-2 text-sm font-bold ${
                              checkoutHitsOnDouble === n
                                ? "border-emerald-500 bg-emerald-500/25 text-emerald-100 shadow-[0_0_14px_rgba(16,185,129,0.25)]"
                                : "border-zinc-700 bg-[#111820] text-zinc-300"
                            }`}
                          >
                            {n}
                          </button>
                        ))}
                      </div>
                      {checkoutAtDouble > 0 && checkoutHitsOnDouble !== null ? (
                        <p className="mt-3 text-center text-xs text-zinc-400">
                          Hit rate this visit:{" "}
                          <span className="font-semibold text-emerald-300/90">
                            {Math.round((checkoutHitsOnDouble / checkoutAtDouble) * 100)}%
                          </span>{" "}
                          ({checkoutHitsOnDouble}/{checkoutAtDouble})
                        </p>
                      ) : null}
                    </>
                  ) : checkoutAtDouble === 1 ? (
                    <p className="mt-2 text-center text-[10px] text-zinc-500">One dart at the double — counts as 1 hit.</p>
                  ) : null}
                </div>
              ) : (
                <div className="rounded-xl border border-amber-700/40 bg-gradient-to-b from-amber-950/35 to-[#0c1210] p-3 shadow-md shadow-amber-900/10">
                  <p className="text-center text-[10px] font-semibold uppercase tracking-[0.28em] text-amber-400">
                    Double zone
                  </p>
                  <p className="mt-0.5 text-center text-base font-bold text-white">You land on {pendingTurn.remaining}</p>
                  <p className="mt-1 text-center text-[10px] text-zinc-500">Optional: darts on the double bed this visit</p>
                  <div className="mt-2 flex gap-1.5">
                    {[0, 1, 2, 3].map((n) => (
                      <button
                        key={n}
                        type="button"
                        onClick={() => {
                          setError(null);
                          setZoneDartsAtDouble(n);
                          setZoneHitsOnDouble(null);
                        }}
                        className={`flex-1 rounded-lg border py-2 text-xs font-bold ${
                          zoneDartsAtDouble === n
                            ? "border-amber-500 bg-amber-500/15 text-amber-100"
                            : "border-zinc-700 bg-[#111820] text-zinc-300"
                        }`}
                      >
                        {n}
                      </button>
                    ))}
                  </div>
                  {zoneDartsAtDouble !== null && zoneDartsAtDouble >= 1 ? (
                    <>
                      <p className="mt-3 text-center text-xs text-zinc-300">How many hit a double?</p>
                      <p className="mt-0.5 text-center text-[10px] text-zinc-500">
                        Count any double segment (including wrong doubles). Misses = 0 hits on that dart.
                      </p>
                      <div className="mt-1.5 flex flex-wrap justify-center gap-1.5">
                        {Array.from({ length: zoneDartsAtDouble + 1 }, (_, i) => i).map((n) => (
                          <button
                            key={n}
                            type="button"
                            onClick={() => {
                              setError(null);
                              setZoneHitsOnDouble(n);
                            }}
                            className={`min-w-[2.75rem] rounded-lg border px-2 py-2 text-sm font-bold ${
                              zoneHitsOnDouble === n
                                ? "border-amber-500 bg-amber-500/15 text-amber-100"
                                : "border-zinc-700 bg-[#111820] text-zinc-300"
                            }`}
                          >
                            {n}
                          </button>
                        ))}
                      </div>
                      {zoneHitsOnDouble !== null ? (
                        <p className="mt-3 text-center text-xs text-zinc-400">
                          This visit:{" "}
                          <span className="font-semibold text-amber-200/90">
                            {Math.round((zoneHitsOnDouble / zoneDartsAtDouble) * 100)}%
                          </span>{" "}
                          ({zoneHitsOnDouble}/{zoneDartsAtDouble})
                        </p>
                      ) : null}
                    </>
                  ) : null}
                  <label className="mt-3 block text-xs text-zinc-500">
                    Notes (optional)
                    <input
                      value={zoneNotes}
                      onChange={(e) => setZoneNotes(e.target.value)}
                      className="mt-1 w-full rounded-xl border border-zinc-700 bg-[#111820] px-3 py-2 text-sm text-white"
                      placeholder="e.g. missed D20"
                    />
                  </label>
                </div>
              )}
              <div className="flex gap-1.5 px-0">
                <button
                  type="button"
                  onClick={() => {
                    setError(null);
                    resetCheckoutModal();
                  }}
                  className="flex-1 rounded-xl border border-zinc-700 bg-[#141a22] py-2.5 text-xs font-semibold text-white hover:bg-zinc-800"
                >
                  Cancel
                </button>
                {pendingTurn.kind === "checkout" ? (
                  <button
                    type="button"
                    onClick={() => {
                      setError(null);
                      confirmCheckout();
                    }}
                    disabled={busy}
                    className="flex-1 rounded-xl bg-emerald-500 py-2.5 text-xs font-bold text-[#041008] shadow-md shadow-emerald-500/25 disabled:opacity-50"
                  >
                    Confirm leg
                  </button>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        setError(null);
                        confirmZone(true);
                      }}
                      disabled={busy}
                      className="flex-1 rounded-xl border border-zinc-700 bg-[#141a22] py-2.5 text-xs font-semibold text-white hover:bg-zinc-800 disabled:opacity-50"
                    >
                      Skip
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setError(null);
                        confirmZone(false);
                      }}
                      disabled={busy}
                      className="flex-1 rounded-xl bg-emerald-500 py-2.5 text-xs font-bold text-[#041008] shadow-md shadow-emerald-500/25 disabled:opacity-50"
                    >
                      Save
                    </button>
                  </>
                )}
              </div>
            </div>
          ) : (
            <>
              <div className="relative mx-2.5 mt-0.5 rounded-xl border border-zinc-800 bg-[#0c1210] p-2.5 pr-11">
                <button
                  type="button"
                  onClick={handleBackspace}
                  disabled={busy || turnInput.length === 0}
                  className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-lg border border-zinc-700/80 text-base text-zinc-300 hover:border-zinc-500 hover:text-white disabled:opacity-30"
                  aria-label="Delete last digit"
                >
                  ⌫
                </button>
                <p className="text-center text-[9px] font-semibold uppercase tracking-[0.2em] text-zinc-500">
                  Turn total
                </p>
                <p className="mt-0.5 text-center text-3xl font-bold tabular-nums leading-none text-white">
                  {turnInput === "" ? "0" : turnInput}
                </p>
                {checkMessage ? (
                  <p className="mt-1 text-center text-[10px] leading-snug text-emerald-300/90">{checkMessage}</p>
                ) : null}
              </div>

              <div className="px-2.5 pt-2">
                <button
                  type="button"
                  onClick={beginAddTurn}
                  disabled={busy}
                  className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-emerald-500 py-2.5 text-xs font-bold uppercase tracking-wide text-[#041208] shadow-md shadow-emerald-500/30 transition hover:bg-emerald-400 disabled:opacity-50"
                >
                  Add turn
                  <span className="text-base" aria-hidden>
                    →
                  </span>
                </button>
              </div>

              <button
                type="button"
                onClick={() => setShowLegHistory((v) => !v)}
                className="mx-auto mt-1 text-[10px] font-medium text-zinc-500 underline-offset-2 hover:text-zinc-400 hover:underline"
              >
                {showLegHistory ? "Hide leg history" : "Leg history"}
              </button>
              {showLegHistory ? (
                <div className="mx-2.5 mt-1.5 max-h-24 space-y-1 overflow-y-auto rounded-lg border border-zinc-800/80 bg-black/20 p-1.5">
                  {[...currentLegTurns]
                    .sort((a, b) => b.createdAt - a.createdAt)
                    .map((turn) => (
                      <div key={turn._id} className="flex justify-between text-[10px] text-zinc-400">
                        <span className="text-zinc-300">
                          {turn.playerName}{" "}
                          <span className="text-zinc-500">({turn.team})</span>
                        </span>
                        <span>
                          {turn.turnTotal}
                          {turn.wasBust ? " bust" : ""}
                        </span>
                      </div>
                    ))}
                </div>
              ) : null}

              <div className="mt-auto grid grid-cols-3 gap-1.5 px-2.5 pb-4 pt-2">
                {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((digit) => (
                  <button
                    key={digit}
                    type="button"
                    onClick={() => appendDigit(String(digit))}
                    className="rounded-xl border border-zinc-800/90 bg-[#121a17] py-2.5 text-xl font-semibold text-white shadow-inner hover:border-emerald-700/50 active:scale-[0.98]"
                  >
                    {digit}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={handleUndo}
                  disabled={busy}
                  className="flex items-center justify-center gap-0.5 rounded-xl border border-zinc-800/90 bg-[#121a17] py-2 text-[10px] font-bold uppercase tracking-wide text-zinc-300 hover:border-zinc-600 disabled:opacity-40"
                >
                  <span className="text-sm" aria-hidden>
                    ↩
                  </span>
                  Revert
                </button>
                <button
                  type="button"
                  onClick={() => appendDigit("0")}
                  className="rounded-xl border border-zinc-800/90 bg-[#121a17] py-2.5 text-xl font-semibold text-white shadow-inner hover:border-emerald-700/50 active:scale-[0.98]"
                >
                  0
                </button>
                <button
                  type="button"
                  onClick={handleCheck}
                  className="flex items-center justify-center gap-0.5 rounded-xl border border-zinc-800/90 bg-[#121a17] py-2 text-[10px] font-bold uppercase tracking-wide text-emerald-300 hover:border-emerald-600/50"
                >
                  Check
                  <span className="text-sm" aria-hidden>
                    ✓
                  </span>
                </button>
              </div>
            </>
          )}
        </>
      ) : !details.game.matchCompleted && details.game.isFinished ? (
        <div className="mx-3 mt-4 rounded-2xl border border-zinc-800/80 bg-[#0c1210] px-4 py-5 text-center">
          <p className="text-sm font-medium text-zinc-300">
            Team {details.game.winnerTeam} won the leg
          </p>
          {busy ? (
            <p className="mt-2 text-xs text-zinc-500">Starting next leg…</p>
          ) : error ? (
            <>
              <p className="mt-2 text-xs text-red-300/90">{error}</p>
              <button
                type="button"
                onClick={() => void handleRetryStartNextLeg()}
                className="mt-4 w-full rounded-2xl bg-emerald-500 py-3 text-sm font-bold text-[#041208]"
              >
                Start next leg
              </button>
            </>
          ) : (
            <p className="mt-2 text-xs text-zinc-500">Starting next leg…</p>
          )}
        </div>
      ) : (
        <section className="mx-3 mt-2 rounded-2xl border border-zinc-800 bg-[#0f1d15]/95 p-5 text-center">
          <h2 className="text-lg font-semibold">Match over</h2>
          <p className="mt-2 text-sm text-zinc-300">
            Team {details.game.winnerTeam ?? "—"} wins
            {legsTarget != null ? (
              <>
                {" "}
                <span className="text-zinc-500">(first to {legsTarget} leg{legsTarget === 1 ? "" : "s"})</span>
              </>
            ) : null}
            .
          </p>
          <p className="mt-1 text-2xl font-bold tabular-nums text-white">
            {legsWonA} <span className="text-zinc-600">·</span> {legsWonB}
            <span className="ml-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">Legs</span>
          </p>
          <p className="mt-3 text-sm text-zinc-400">Tap the arrow to return home.</p>
        </section>
      )}
      </div>

      {/* Stats modal */}
      {statsTeam !== null ? (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/80 p-3 sm:items-center"
          role="dialog"
          aria-modal="true"
          aria-labelledby="stats-modal-title"
          onClick={(event) => {
            if (event.target === event.currentTarget) closeStats();
          }}
        >
          <div className="flex max-h-[92vh] w-full max-w-md flex-col overflow-hidden rounded-3xl border border-zinc-800 bg-[#0a0e12] shadow-2xl">
            <div className="relative bg-gradient-to-b from-emerald-950 via-[#0a1510] to-[#060a08] px-5 pb-4 pt-5">
              <button
                type="button"
                onClick={closeStats}
                className="absolute right-4 top-4 rounded-full p-1.5 text-lg text-zinc-300 hover:bg-white/10 hover:text-white"
                aria-label="Close"
              >
                ✕
              </button>
              <p className="text-[10px] font-semibold uppercase tracking-[0.28em] text-emerald-400">Team stats</p>
              <div className="mt-1 flex flex-wrap items-baseline justify-between gap-2 pr-10">
                <h2 id="stats-modal-title" className="text-2xl font-bold tracking-tight text-white">
                  {modalTeamTitle}
                </h2>
                <span className="text-sm font-medium text-zinc-500">{legsWonInModal} legs won</span>
              </div>
              <p className="mt-1 text-sm text-zinc-400">{modalPlayersLine}</p>
              <div className="mt-4 flex rounded-full border border-emerald-900/40 bg-black/30 p-1">
                <button
                  type="button"
                  onClick={() => setStatsTab("team")}
                  className={`flex-1 rounded-full py-2.5 text-xs font-bold uppercase tracking-wide ${
                    statsTab === "team"
                      ? "bg-emerald-600/30 text-emerald-100"
                      : "text-zinc-500 hover:text-zinc-300"
                  }`}
                >
                  Team
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setStatsTab("individual");
                    if (!statsPlayerName && details) {
                      const n =
                        statsTeam === "A"
                          ? details.teamA[0]?.playerName
                          : details.teamB[0]?.playerName;
                      if (n) setStatsPlayerName(n);
                    }
                  }}
                  className={`flex-1 rounded-full py-2.5 text-xs font-bold uppercase tracking-wide ${
                    statsTab === "individual"
                      ? "bg-emerald-500 text-[#031008]"
                      : "text-zinc-500 hover:text-zinc-300"
                  }`}
                >
                  Individual
                </button>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-3 pt-3">
              {statsTab === "individual" ? (
                <div className="mb-3 flex flex-wrap gap-2">
                  {statsRosterNames.map((name) => (
                    <button
                      key={name}
                      type="button"
                      onClick={() => setStatsPlayerName(name)}
                      className={`rounded-full border px-4 py-1.5 text-sm font-semibold transition ${
                        statsPlayerName === name
                          ? "border-emerald-500/70 bg-emerald-500/15 text-emerald-200 shadow-[0_0_12px_rgba(16,185,129,0.2)]"
                          : "border-zinc-800 bg-[#121820] text-zinc-400"
                      }`}
                    >
                      {name}
                    </button>
                  ))}
                </div>
              ) : null}

              <div className="flex rounded-full border border-zinc-800 bg-[#080c10] p-1">
                <button
                  type="button"
                  onClick={() => setStatsScope("overall")}
                  className={`flex-1 rounded-full py-2 text-xs font-bold uppercase tracking-wide ${
                    statsScope === "overall" ? "bg-zinc-800 text-white" : "text-zinc-500"
                  }`}
                >
                  Overall
                </button>
                <button
                  type="button"
                  onClick={() => setStatsScope("leg")}
                  className={`flex-1 rounded-full py-2 text-xs font-bold uppercase tracking-wide ${
                    statsScope === "leg" ? "bg-zinc-800 text-white" : "text-zinc-500"
                  }`}
                >
                  By leg
                </button>
              </div>

              {statsScope === "leg" ? (
                <div className="mt-4 flex items-center justify-between px-2">
                  <button
                    type="button"
                    onClick={() => setStatsLeg((n) => Math.max(1, n - 1))}
                    disabled={statsLeg <= 1}
                    className="rounded-full border border-zinc-800 px-3 py-2 text-lg text-zinc-400 hover:text-white disabled:opacity-30"
                    aria-label="Previous leg"
                  >
                    ‹
                  </button>
                  <div className="text-center">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-zinc-500">Leg</p>
                    <p className="text-3xl font-black tabular-nums tracking-tight text-white">
                      {statsLeg} / {maxLeg}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setStatsLeg((n) => Math.min(maxLeg, n + 1))}
                    disabled={statsLeg >= maxLeg}
                    className="rounded-full border border-zinc-800 px-3 py-2 text-lg text-zinc-400 hover:text-white disabled:opacity-30"
                    aria-label="Next leg"
                  >
                    ›
                  </button>
                </div>
              ) : null}

              <div className="mt-4 grid grid-cols-3 gap-2">
                <StatMini
                  label="3-dart avg"
                  value={modalStats.turnCount > 0 ? modalStats.threeDartAvg.toFixed(1) : "—"}
                  icon="↗"
                  accent={modalStats.turnCount > 0}
                />
                <StatMini
                  label="Highest"
                  value={modalStats.turnCount > 0 && modalStats.highest > 0 ? String(modalStats.highest) : "—"}
                  icon="🔥"
                />
                <StatMini
                  label="Turns"
                  value={String(modalStats.turnCount)}
                  icon="◎"
                  accent={modalStats.turnCount > 0}
                />
                <StatMini
                  label="3-dart · no D"
                  value={modalStats.avgWoD > 0 ? modalStats.avgWoD.toFixed(1) : "0.0"}
                />
                <StatMini label="60+" value={String(modalStats.count60)} />
                <StatMini label="80+" value={String(modalStats.count80)} />
                <StatMini
                  label="Checkout %"
                  value={`${modalStats.checkoutPct}%`}
                  icon="◎"
                  accent
                />
                <StatMini
                  label="Darts → D"
                  value={modalStats.dartsToDoubleAvg > 0 ? modalStats.dartsToDoubleAvg.toFixed(1) : "0.0"}
                />
                <StatMini label="At double (hit/aim)" value={modalStats.doublesHitStr} />
                <StatMini label="180s" value={String(modalStats.count180)} />
                <StatMini label="100+" value={String(modalStats.count100)} />
                <StatMini label="140+" value={String(modalStats.count140)} />
              </div>

              {statsScope === "leg" ? (
                <div className="mt-5">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-zinc-500">
                    Turns — leg {statsLeg}
                  </p>
                  <div className="mt-2 max-h-48 space-y-2 overflow-y-auto rounded-2xl border border-zinc-800/90 bg-[#0c1018] p-3">
                    {modalLegTurnsList.length === 0 ? (
                      <p className="py-6 text-center text-sm text-zinc-500">No turns logged yet.</p>
                    ) : (
                      modalLegTurnsList.map((t) => (
                        <div
                          key={t._id}
                          className="rounded-xl border border-zinc-800/60 bg-[#101820] px-3 py-2 text-xs text-zinc-300"
                        >
                          <div className="flex justify-between gap-2">
                            <span className="font-semibold text-white">{t.playerName}</span>
                            <span className="tabular-nums text-zinc-400">
                              {t.scoreBefore} → {t.scoreAfter}
                              {t.wasBust ? " bust" : ""}
                            </span>
                          </div>
                          <div className="mt-1 text-zinc-500">
                            {t.turnTotal} pts · [{t.darts.join(", ")}]
                          </div>
                          {(t.dartsAtDoubleBed ?? 0) > 0 ||
                          t.dartsHitOnDoubleBed !== undefined ||
                          t.checkoutDoubleHit !== undefined ||
                          t.doublesHitNotes ? (
                            <div className="mt-1 text-[11px] text-emerald-400/90">
                              {t.dartsAtDoubleBed !== undefined ? `At double: ${t.dartsAtDoubleBed}` : null}
                              {t.dartsHitOnDoubleBed !== undefined && (t.dartsAtDoubleBed ?? 0) > 0
                                ? ` · Hits: ${t.dartsHitOnDoubleBed}/${t.dartsAtDoubleBed} (${Math.round(
                                    (t.dartsHitOnDoubleBed / (t.dartsAtDoubleBed ?? 1)) * 100,
                                  )}%)`
                                : null}
                              {t.checkoutDoubleHit !== undefined
                                ? ` · Checkout: ${t.checkoutDoubleHit ? "yes" : "no"}`
                                : null}
                              {t.checkoutDartsOnDouble !== undefined
                                ? ` · Darts to finish: ${t.checkoutDartsOnDouble}`
                                : null}
                              {t.doublesHitNotes ? ` · ${t.doublesHitNotes}` : null}
                            </div>
                          ) : null}
                        </div>
                      ))
                    )}
                  </div>
                </div>
              ) : null}
            </div>

            <div className="border-t border-zinc-800/90 p-3">
              <button
                type="button"
                onClick={closeStats}
                className="w-full rounded-2xl border border-zinc-700 bg-[#141a22] py-3.5 text-sm font-semibold text-white hover:bg-zinc-800"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}

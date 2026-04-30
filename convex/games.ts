import { mutation, query, MutationCtx, QueryCtx } from "./_generated/server";
import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { Id } from "./_generated/dataModel";

type TeamSide = "A" | "B";

async function requireUserId(ctx: QueryCtx | MutationCtx): Promise<string> {
  const userId = await getAuthUserId(ctx);
  if (!userId) throw new Error("Unauthorized");
  return userId;
}

function normalizeName(name: string): string {
  return name.trim().toLowerCase();
}

function sanitizePlayerNames(names: string[]): string[] {
  return names
    .map((name) => name.trim())
    .filter((name) => name.length > 0)
    .slice(0, 2);
}

function toTeamKey(teamPlayers: string[]): string {
  return [...teamPlayers].sort((a, b) => a.localeCompare(b)).join(" + ");
}

/** Count completed legs per team from checkout turns (scoreAfter === 0). */
function countLegWinsFromTurns(
  turns: {
    legNumber?: number;
    scoreAfter: number;
    wasBust: boolean;
    team: TeamSide;
    createdAt: number;
  }[],
): { legsWonA: number; legsWonB: number } {
  const byLeg = new Map<number, typeof turns>();
  for (const turn of turns) {
    const leg = turn.legNumber ?? 1;
    const bucket = byLeg.get(leg) ?? [];
    bucket.push(turn);
    byLeg.set(leg, bucket);
  }
  let legsWonA = 0;
  let legsWonB = 0;
  for (const legTurns of byLeg.values()) {
    legTurns.sort((a, b) => a.createdAt - b.createdAt);
    const checkout = [...legTurns].reverse().find((t) => !t.wasBust && t.scoreAfter === 0);
    if (checkout) {
      if (checkout.team === "A") legsWonA += 1;
      else legsWonB += 1;
    }
  }
  return { legsWonA, legsWonB };
}

function clampStarterIndex(value: number, max: number): number {
  if (max <= 1) return 0;
  return value >= max ? 0 : Math.max(0, value);
}

function toDartsFromTotal(turnTotal: number): number[] {
  const capped = Math.max(0, Math.min(180, Math.floor(turnTotal)));
  if (capped === 0) return [0];
  const darts: number[] = [];
  let remaining = capped;
  while (remaining > 0 && darts.length < 3) {
    const dart = Math.min(60, remaining);
    darts.push(dart);
    remaining -= dart;
  }
  return darts;
}

/** B throws first: swap teams in the throwing order (1v1: B,A — 2v2: B0,A0,B1,A1). */
function rotateThrowOrder<T extends { team: TeamSide }>(base: T[]): T[] {
  if (base.length === 2) return [base[1], base[0]];
  if (base.length === 4) return [base[1], base[0], base[3], base[2]];
  return base;
}

function getTurnOrder<T extends { team: TeamSide; order: number }>(
  participants: T[],
  game: {
    format: "1v1" | "2v2";
    teamAStarterIndex?: number;
    teamBStarterIndex?: number;
    startsFirstTeam?: "A" | "B";
  },
) {
  const teamA = participants.filter((participant) => participant.team === "A");
  const teamB = participants.filter((participant) => participant.team === "B");

  let order: T[];
  if (game.format === "1v1" || teamA.length < 2 || teamB.length < 2) {
    order = [...teamA, ...teamB];
  } else {
    const aStart = clampStarterIndex(game.teamAStarterIndex ?? 0, teamA.length);
    const bStart = clampStarterIndex(game.teamBStarterIndex ?? 0, teamB.length);
    const aNext = aStart === 0 ? 1 : 0;
    const bNext = bStart === 0 ? 1 : 0;
    order = [teamA[aStart], teamB[bStart], teamA[aNext], teamB[bNext]];
  }

  if (game.startsFirstTeam === "B") return rotateThrowOrder(order);
  return order;
}

async function upsertPlayerGameResult(
  ctx: MutationCtx,
  ownerId: string,
  playerName: string,
  didWin: boolean,
) {
  const existing = await ctx.db
    .query("playerStats")
    .withIndex("by_owner_player", (q) =>
      q.eq("ownerId", ownerId).eq("playerName", playerName),
    )
    .unique();

  if (!existing) {
    await ctx.db.insert("playerStats", {
      ownerId,
      playerName,
      gamesPlayed: 1,
      gamesWon: didWin ? 1 : 0,
      turnsPlayed: 0,
      dartsThrown: 0,
      pointsScored: 0,
      busts: 0,
      highestTurn: 0,
    });
    return;
  }

  await ctx.db.patch(existing._id, {
    gamesPlayed: existing.gamesPlayed + 1,
    gamesWon: existing.gamesWon + (didWin ? 1 : 0),
  });
}

async function upsertTeamGameResult(
  ctx: MutationCtx,
  ownerId: string,
  teamKey: string,
  didWin: boolean,
) {
  const existing = await ctx.db
    .query("teamStats")
    .withIndex("by_owner_team", (q) => q.eq("ownerId", ownerId).eq("teamKey", teamKey))
    .unique();

  if (!existing) {
    await ctx.db.insert("teamStats", {
      ownerId,
      teamKey,
      gamesPlayed: 1,
      gamesWon: didWin ? 1 : 0,
      turnsPlayed: 0,
      pointsScored: 0,
      busts: 0,
      highestTurn: 0,
    });
    return;
  }

  await ctx.db.patch(existing._id, {
    gamesPlayed: existing.gamesPlayed + 1,
    gamesWon: existing.gamesWon + (didWin ? 1 : 0),
  });
}

async function upsertPlayerTurnStats(
  ctx: MutationCtx,
  ownerId: string,
  playerName: string,
  pointsScored: number,
  dartsCount: number,
  wasBust: boolean,
) {
  const existing = await ctx.db
    .query("playerStats")
    .withIndex("by_owner_player", (q) =>
      q.eq("ownerId", ownerId).eq("playerName", playerName),
    )
    .unique();

  if (!existing) {
    await ctx.db.insert("playerStats", {
      ownerId,
      playerName,
      gamesPlayed: 0,
      gamesWon: 0,
      turnsPlayed: 1,
      dartsThrown: dartsCount,
      pointsScored,
      busts: wasBust ? 1 : 0,
      highestTurn: pointsScored,
    });
    return;
  }

  await ctx.db.patch(existing._id, {
    turnsPlayed: existing.turnsPlayed + 1,
    dartsThrown: existing.dartsThrown + dartsCount,
    pointsScored: existing.pointsScored + pointsScored,
    busts: existing.busts + (wasBust ? 1 : 0),
    highestTurn: Math.max(existing.highestTurn, pointsScored),
  });
}

async function upsertTeamTurnStats(
  ctx: MutationCtx,
  ownerId: string,
  teamKey: string,
  pointsScored: number,
  wasBust: boolean,
) {
  const existing = await ctx.db
    .query("teamStats")
    .withIndex("by_owner_team", (q) => q.eq("ownerId", ownerId).eq("teamKey", teamKey))
    .unique();

  if (!existing) {
    await ctx.db.insert("teamStats", {
      ownerId,
      teamKey,
      gamesPlayed: 0,
      gamesWon: 0,
      turnsPlayed: 1,
      pointsScored,
      busts: wasBust ? 1 : 0,
      highestTurn: pointsScored,
    });
    return;
  }

  await ctx.db.patch(existing._id, {
    turnsPlayed: existing.turnsPlayed + 1,
    pointsScored: existing.pointsScored + pointsScored,
    busts: existing.busts + (wasBust ? 1 : 0),
    highestTurn: Math.max(existing.highestTurn, pointsScored),
  });
}

async function buildGameSummary(
  ctx: QueryCtx,
  gameId: string,
  game: {
    format: "1v1" | "2v2";
    teamAStarterIndex?: number;
    teamBStarterIndex?: number;
    startsFirstTeam?: "A" | "B";
  },
) {
  const participants = await ctx.db
    .query("gameParticipants")
    .withIndex("by_game", (q) => q.eq("gameId", gameId as never))
    .collect();
  participants.sort((a, b) => a.order - b.order);

  const teamA = participants.filter((p) => p.team === "A").map((p) => p.playerName);
  const teamB = participants.filter((p) => p.team === "B").map((p) => p.playerName);
  const turnOrder = getTurnOrder(participants, game);

  return { participants, teamA, teamB, turnOrder };
}

export const addFriend = mutation({
  args: { name: v.string() },
  handler: async (ctx, args) => {
    const ownerId = await requireUserId(ctx);
    const name = args.name.trim();

    if (name.length < 2) throw new Error("Friend name must have at least 2 characters.");
    if (name.length > 40) throw new Error("Friend name must be under 40 characters.");

    const existing = await ctx.db
      .query("friends")
      .withIndex("by_owner", (q) => q.eq("ownerId", ownerId))
      .collect();
    if (existing.some((friend) => normalizeName(friend.name) === normalizeName(name))) {
      throw new Error("This friend already exists.");
    }

    return ctx.db.insert("friends", {
      ownerId,
      name,
      createdAt: Date.now(),
    });
  },
});

export const removeFriend = mutation({
  args: { friendId: v.id("friends") },
  handler: async (ctx, args) => {
    const ownerId = await requireUserId(ctx);
    const friend = await ctx.db.get(args.friendId);
    if (!friend || friend.ownerId !== ownerId) throw new Error("Friend not found.");
    await ctx.db.delete(args.friendId);
  },
});

export const listFriends = query({
  args: {},
  handler: async (ctx) => {
    const ownerId = await requireUserId(ctx);
    const friends = await ctx.db
      .query("friends")
      .withIndex("by_owner", (q) => q.eq("ownerId", ownerId))
      .collect();
    friends.sort((a, b) => a.name.localeCompare(b.name));
    return friends;
  },
});

export const getFriendStats = query({
  args: {},
  handler: async (ctx) => {
    const ownerId = await requireUserId(ctx);
    const friends = await ctx.db
      .query("friends")
      .withIndex("by_owner", (q) => q.eq("ownerId", ownerId))
      .collect();
    const stats = await ctx.db
      .query("playerStats")
      .withIndex("by_owner", (q) => q.eq("ownerId", ownerId))
      .collect();
    const byName = new Map(stats.map((entry) => [normalizeName(entry.playerName), entry]));

    return friends
      .map((friend) => ({
        ...friend,
        stats: byName.get(normalizeName(friend.name)) ?? null,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  },
});

export const createGame = mutation({
  args: {
    format: v.union(v.literal("1v1"), v.literal("2v2")),
    startScore: v.union(v.literal(301), v.literal(501)),
    /** First to this many legs wins. Omit for open-ended matches (end manually). */
    legsToWin: v.optional(v.number()),
    teamAPlayers: v.array(v.string()),
    teamBPlayers: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const ownerId = await requireUserId(ctx);

    const teamAPlayers = sanitizePlayerNames(args.teamAPlayers);
    const teamBPlayers = sanitizePlayerNames(args.teamBPlayers);
    const expectedCount = args.format === "1v1" ? 1 : 2;
    if (teamAPlayers.length !== expectedCount || teamBPlayers.length !== expectedCount) {
      throw new Error(`This format requires exactly ${expectedCount} players per team.`);
    }

    const allNames = [...teamAPlayers, ...teamBPlayers];
    const uniqueNames = new Set(allNames.map((name) => normalizeName(name)));
    if (uniqueNames.size !== allNames.length) {
      throw new Error("Player names must be unique in the same game.");
    }

    let legsToWin: number | undefined = args.legsToWin;
    if (legsToWin !== undefined) {
      legsToWin = Math.floor(legsToWin);
      if (legsToWin < 1 || legsToWin > 99) {
        throw new Error("Legs to win must be between 1 and 99.");
      }
    }

    const gameId = await ctx.db.insert("games", {
      ownerId,
      format: args.format,
      startScore: args.startScore,
      teamAScore: args.startScore,
      teamBScore: args.startScore,
      teamAStarterIndex: 0,
      teamBStarterIndex: 0,
      legNumber: 1,
      legsToWin,
      matchCompleted: false,
      turnIndex: 0,
      isFinished: false,
      createdAt: Date.now(),
    });

    const participantOrder =
      args.format === "1v1"
        ? [
            { playerName: teamAPlayers[0], team: "A" as TeamSide, order: 0 },
            { playerName: teamBPlayers[0], team: "B" as TeamSide, order: 1 },
          ]
        : [
            { playerName: teamAPlayers[0], team: "A" as TeamSide, order: 0 },
            { playerName: teamBPlayers[0], team: "B" as TeamSide, order: 1 },
            { playerName: teamAPlayers[1], team: "A" as TeamSide, order: 2 },
            { playerName: teamBPlayers[1], team: "B" as TeamSide, order: 3 },
          ];

    for (const participant of participantOrder) {
      await ctx.db.insert("gameParticipants", {
        gameId,
        ownerId,
        playerName: participant.playerName,
        team: participant.team,
        order: participant.order,
      });
    }

    const teamAKey = toTeamKey(teamAPlayers);
    const teamBKey = toTeamKey(teamBPlayers);
    await upsertTeamGameResult(ctx, ownerId, teamAKey, false);
    await upsertTeamGameResult(ctx, ownerId, teamBKey, false);
    for (const playerName of allNames) {
      await upsertPlayerGameResult(ctx, ownerId, playerName, false);
    }

    return gameId;
  },
});

type TurnDartMeta = {
  dartsAtDoubleBed?: number;
  dartsHitOnDoubleBed?: number;
  checkoutDoubleHit?: boolean;
  checkoutDartsOnDouble?: number;
  doublesHitNotes?: string;
};

async function performTurn(
  ctx: MutationCtx,
  args: { gameId: Id<"games">; participantId: Id<"gameParticipants">; darts: number[]; dartMeta?: TurnDartMeta },
) {
    const ownerId = await requireUserId(ctx);

    const game = await ctx.db.get(args.gameId);
    if (!game || game.ownerId !== ownerId) throw new Error("Game not found.");
    if (game.matchCompleted) throw new Error("This game has already ended.");
    if (game.isFinished) throw new Error("Game is already finished.");
    if (args.darts.length === 0 || args.darts.length > 3) {
      throw new Error("A turn must have between 1 and 3 darts.");
    }
    for (const dart of args.darts) {
      if (dart < 0 || dart > 60) throw new Error("Each dart value must be between 0 and 60.");
    }

    const participants = await ctx.db
      .query("gameParticipants")
      .withIndex("by_game", (q) => q.eq("gameId", args.gameId))
      .collect();
    participants.sort((a, b) => a.order - b.order);
    if (participants.length === 0) throw new Error("No participants found for this game.");

    const turnOrder = getTurnOrder(participants, game);
    const expectedParticipant = turnOrder[game.turnIndex % turnOrder.length];
    if (expectedParticipant._id !== args.participantId) {
      throw new Error("It is not this player's turn.");
    }

    const teamPlayers = participants
      .filter((player) => player.team === expectedParticipant.team)
      .map((player) => player.playerName);
    const teamKey = toTeamKey(teamPlayers);
    const scoreBefore = expectedParticipant.team === "A" ? game.teamAScore : game.teamBScore;
    const turnTotal = args.darts.reduce((sum, value) => sum + value, 0);
    const rawScoreAfter = scoreBefore - turnTotal;
    const wasBust = rawScoreAfter < 0;
    const scoreAfter = wasBust ? scoreBefore : rawScoreAfter;
    const pointsScored = wasBust ? 0 : turnTotal;

    const meta = args.dartMeta;

    if (!wasBust && scoreAfter === 0) {
      if (meta?.dartsAtDoubleBed === undefined || meta.dartsAtDoubleBed < 1 || meta.dartsAtDoubleBed > 3) {
        throw new Error("Checkout: darts aimed at the double must be between 1 and 3.");
      }
      if (meta.checkoutDoubleHit === undefined) {
        throw new Error("Checkout: say whether the double was hit.");
      }
      if (meta.checkoutDoubleHit) {
        if (
          meta.checkoutDartsOnDouble === undefined ||
          meta.checkoutDartsOnDouble < 1 ||
          meta.checkoutDartsOnDouble > 3
        ) {
          throw new Error("Checkout: enter how many darts it took to hit the double (1–3).");
        }
        if (meta.checkoutDartsOnDouble > meta.dartsAtDoubleBed) {
          throw new Error("Darts on the double cannot exceed darts at the double this visit.");
        }
        const hits =
          meta.dartsHitOnDoubleBed !== undefined
            ? meta.dartsHitOnDoubleBed
            : Math.min(meta.checkoutDartsOnDouble ?? 1, meta.dartsAtDoubleBed);
        if (hits < 1 || hits > meta.dartsAtDoubleBed) {
          throw new Error("Hits on a double must be between 1 and darts aimed at the double.");
        }
      }
    } else if (!wasBust && scoreAfter >= 1 && scoreAfter <= 40) {
      if (meta?.dartsAtDoubleBed !== undefined && (meta.dartsAtDoubleBed < 0 || meta.dartsAtDoubleBed > 3)) {
        throw new Error("Darts at double must be between 0 and 3.");
      }
      if (meta?.checkoutDoubleHit !== undefined || meta?.checkoutDartsOnDouble !== undefined) {
        throw new Error("Checkout fields are only allowed on a checkout turn.");
      }
      const atZone = meta?.dartsAtDoubleBed;
      if (atZone !== undefined && atZone > 0) {
        if (meta?.dartsHitOnDoubleBed === undefined) {
          throw new Error("Say how many darts hit a double when logging darts at the double.");
        }
        if (meta.dartsHitOnDoubleBed < 0 || meta.dartsHitOnDoubleBed > atZone) {
          throw new Error("Hits on a double must be between 0 and darts at the double this visit.");
        }
      } else if (meta?.dartsHitOnDoubleBed !== undefined) {
        throw new Error("Hits on a double are only used when darts at the double is 1–3.");
      }
    } else if (meta !== undefined) {
      const hasAny =
        meta.dartsAtDoubleBed !== undefined ||
        meta.dartsHitOnDoubleBed !== undefined ||
        meta.checkoutDoubleHit !== undefined ||
        meta.checkoutDartsOnDouble !== undefined ||
        (meta.doublesHitNotes !== undefined && meta.doublesHitNotes.trim().length > 0);
      if (hasAny && (wasBust || scoreAfter > 40)) {
        throw new Error("Double tracking is only used when you finish on a double or land on 1–40.");
      }
    }

    if (meta?.doublesHitNotes !== undefined && meta.doublesHitNotes.length > 120) {
      throw new Error("Doubles note is too long (max 120 characters).");
    }

    let dartsHitPersist: number | undefined = meta?.dartsHitOnDoubleBed;
    if (!wasBust && scoreAfter === 0 && meta?.checkoutDoubleHit && dartsHitPersist === undefined) {
      dartsHitPersist = Math.min(meta.checkoutDartsOnDouble ?? 1, meta.dartsAtDoubleBed ?? 1);
    }

    await ctx.db.insert("turns", {
      gameId: args.gameId,
      ownerId,
      participantId: args.participantId,
      playerName: expectedParticipant.playerName,
      team: expectedParticipant.team,
      legNumber: game.legNumber ?? 1,
      darts: args.darts,
      turnTotal,
      wasBust,
      scoreBefore,
      scoreAfter,
      dartsAtDoubleBed: meta?.dartsAtDoubleBed,
      dartsHitOnDoubleBed: dartsHitPersist,
      checkoutDoubleHit: meta?.checkoutDoubleHit,
      checkoutDartsOnDouble: meta?.checkoutDartsOnDouble,
      doublesHitNotes: meta?.doublesHitNotes,
      createdAt: Date.now(),
    });

    const turnsAfter = await ctx.db
      .query("turns")
      .withIndex("by_game", (q) => q.eq("gameId", args.gameId))
      .collect();
    const { legsWonA, legsWonB } = countLegWinsFromTurns(turnsAfter);

    await upsertPlayerTurnStats(
      ctx,
      ownerId,
      expectedParticipant.playerName,
      pointsScored,
      args.darts.length,
      wasBust,
    );
    await upsertTeamTurnStats(ctx, ownerId, teamKey, pointsScored, wasBust);

    const nextPatch: {
      teamAScore?: number;
      teamBScore?: number;
      turnIndex: number;
      isFinished?: boolean;
      winnerTeam?: TeamSide;
      matchCompleted?: boolean;
      matchEndedAt?: number;
    } = { turnIndex: game.turnIndex + 1 };

    if (expectedParticipant.team === "A") nextPatch.teamAScore = scoreAfter;
    else nextPatch.teamBScore = scoreAfter;

    let winnerTeam: TeamSide | null = null;
    let matchJustCompleted = false;
    if (!wasBust && scoreAfter === 0) {
      winnerTeam = expectedParticipant.team;
      nextPatch.isFinished = true;
      nextPatch.winnerTeam = winnerTeam;
      const target = game.legsToWin;
      if (target !== undefined && winnerTeam !== null) {
        const legsForWinner = winnerTeam === "A" ? legsWonA : legsWonB;
        if (legsForWinner >= target) {
          matchJustCompleted = true;
          nextPatch.matchCompleted = true;
          nextPatch.matchEndedAt = Date.now();
        }
      }
    }

    await ctx.db.patch(args.gameId, nextPatch);

    const countStatWinOnThisCheckout =
      winnerTeam !== null && (game.legsToWin === undefined || matchJustCompleted);

    if (winnerTeam && countStatWinOnThisCheckout) {
      const winningPlayers = participants.filter((p) => p.team === winnerTeam);
      const losingPlayers = participants.filter((p) => p.team !== winnerTeam);
      const winningTeamKey = toTeamKey(winningPlayers.map((p) => p.playerName));
      const losingTeamKey = toTeamKey(losingPlayers.map((p) => p.playerName));

      const winningTeamStats = await ctx.db
        .query("teamStats")
        .withIndex("by_owner_team", (q) =>
          q.eq("ownerId", ownerId).eq("teamKey", winningTeamKey),
        )
        .unique();
      if (winningTeamStats) {
        await ctx.db.patch(winningTeamStats._id, { gamesWon: winningTeamStats.gamesWon + 1 });
      }

      const losingTeamStats = await ctx.db
        .query("teamStats")
        .withIndex("by_owner_team", (q) =>
          q.eq("ownerId", ownerId).eq("teamKey", losingTeamKey),
        )
        .unique();
      if (!losingTeamStats) {
        await upsertTeamGameResult(ctx, ownerId, losingTeamKey, false);
      }

      for (const player of winningPlayers) {
        const playerStats = await ctx.db
          .query("playerStats")
          .withIndex("by_owner_player", (q) =>
            q.eq("ownerId", ownerId).eq("playerName", player.playerName),
          )
          .unique();
        if (playerStats) {
          await ctx.db.patch(playerStats._id, { gamesWon: playerStats.gamesWon + 1 });
        } else {
          await upsertPlayerGameResult(ctx, ownerId, player.playerName, true);
        }
      }
    }

    return { scoreAfter, wasBust, isWin: winnerTeam !== null, winnerTeam };
}

export const submitTurn = mutation({
  args: {
    gameId: v.id("games"),
    participantId: v.id("gameParticipants"),
    darts: v.array(v.number()),
  },
  handler: async (ctx, args) => {
    return performTurn(ctx, args);
  },
});

export const submitTurnTotal = mutation({
  args: {
    gameId: v.id("games"),
    participantId: v.id("gameParticipants"),
    turnTotal: v.number(),
    dartsAtDoubleBed: v.optional(v.number()),
    dartsHitOnDoubleBed: v.optional(v.number()),
    checkoutDoubleHit: v.optional(v.boolean()),
    checkoutDartsOnDouble: v.optional(v.number()),
    doublesHitNotes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const turnTotal = Math.floor(args.turnTotal);
    if (turnTotal < 0 || turnTotal > 180) {
      throw new Error("Turn total must be between 0 and 180.");
    }
    const darts = toDartsFromTotal(turnTotal);
    const dartMeta: TurnDartMeta | undefined =
      args.dartsAtDoubleBed !== undefined ||
      args.dartsHitOnDoubleBed !== undefined ||
      args.checkoutDoubleHit !== undefined ||
      args.checkoutDartsOnDouble !== undefined ||
      args.doublesHitNotes !== undefined
        ? {
            dartsAtDoubleBed: args.dartsAtDoubleBed,
            dartsHitOnDoubleBed: args.dartsHitOnDoubleBed,
            checkoutDoubleHit: args.checkoutDoubleHit,
            checkoutDartsOnDouble: args.checkoutDartsOnDouble,
            doublesHitNotes: args.doublesHitNotes,
          }
        : undefined;
    return performTurn(ctx, {
      gameId: args.gameId,
      participantId: args.participantId,
      darts,
      dartMeta,
    });
  },
});

export const undoLastTurn = mutation({
  args: { gameId: v.id("games") },
  handler: async (ctx, args) => {
    const ownerId = await requireUserId(ctx);
    const game = await ctx.db.get(args.gameId);
    if (!game || game.ownerId !== ownerId) throw new Error("Game not found.");

    const turns = await ctx.db
      .query("turns")
      .withIndex("by_game", (q) => q.eq("gameId", args.gameId))
      .collect();
    turns.sort((a, b) => b.createdAt - a.createdAt);
    const latest = turns[0];
    if (!latest) throw new Error("No turns to undo.");

    if ((latest.legNumber ?? 1) !== (game.legNumber ?? 1)) {
      throw new Error("Undo is only available for the current leg.");
    }

    const wasCheckoutWin = !latest.wasBust && latest.scoreAfter === 0;
    const hadStatIncrementForThisTurn =
      wasCheckoutWin && (game.legsToWin === undefined || game.matchCompleted === true);

    await ctx.db.delete(latest._id);

    const patch: {
      teamAScore?: number;
      teamBScore?: number;
      turnIndex: number;
      isFinished: boolean;
      winnerTeam?: TeamSide;
      matchCompleted?: boolean;
      matchEndedAt?: number;
    } = {
      turnIndex: Math.max(game.turnIndex - 1, 0),
      isFinished: false,
      winnerTeam: undefined,
    };

    if (game.matchCompleted) {
      patch.matchCompleted = false;
      patch.matchEndedAt = undefined;
    }

    if (latest.team === "A") patch.teamAScore = latest.scoreBefore;
    else patch.teamBScore = latest.scoreBefore;

    await ctx.db.patch(args.gameId, patch);

    if (hadStatIncrementForThisTurn) {
      const participants = await ctx.db
        .query("gameParticipants")
        .withIndex("by_game", (q) => q.eq("gameId", args.gameId))
        .collect();
      participants.sort((a, b) => a.order - b.order);
      const winningPlayers = participants.filter((p) => p.team === latest.team);
      const winningTeamKey = toTeamKey(winningPlayers.map((p) => p.playerName));

      const winningTeamStats = await ctx.db
        .query("teamStats")
        .withIndex("by_owner_team", (q) =>
          q.eq("ownerId", ownerId).eq("teamKey", winningTeamKey),
        )
        .unique();
      if (winningTeamStats && winningTeamStats.gamesWon > 0) {
        await ctx.db.patch(winningTeamStats._id, { gamesWon: winningTeamStats.gamesWon - 1 });
      }

      for (const player of winningPlayers) {
        const playerStats = await ctx.db
          .query("playerStats")
          .withIndex("by_owner_player", (q) =>
            q.eq("ownerId", ownerId).eq("playerName", player.playerName),
          )
          .unique();
        if (playerStats && playerStats.gamesWon > 0) {
          await ctx.db.patch(playerStats._id, { gamesWon: playerStats.gamesWon - 1 });
        }
      }
    }
  },
});

export const startNextLeg = mutation({
  args: {
    gameId: v.id("games"),
    teamAStarterIndex: v.optional(v.number()),
    teamBStarterIndex: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const ownerId = await requireUserId(ctx);
    const game = await ctx.db.get(args.gameId);
    if (!game || game.ownerId !== ownerId) throw new Error("Game not found.");
    if (game.matchCompleted) throw new Error("This game has already ended.");
    if (!game.isFinished) throw new Error("Finish the current leg first.");

    const participants = await ctx.db
      .query("gameParticipants")
      .withIndex("by_game", (q) => q.eq("gameId", args.gameId))
      .collect();
    participants.sort((a, b) => a.order - b.order);

    const teamACount = participants.filter((participant) => participant.team === "A").length;
    const teamBCount = participants.filter((participant) => participant.team === "B").length;

    const nextAStarter =
      args.teamAStarterIndex ??
      (teamACount > 1 ? ((game.teamAStarterIndex ?? 0) === 0 ? 1 : 0) : 0);
    const nextBStarter =
      args.teamBStarterIndex ??
      (teamBCount > 1 ? ((game.teamBStarterIndex ?? 0) === 0 ? 1 : 0) : 0);

    const prevStarts = game.startsFirstTeam ?? "A";
    const nextStartsFirst = prevStarts === "A" ? ("B" as const) : ("A" as const);

    await ctx.db.patch(args.gameId, {
      teamAScore: game.startScore,
      teamBScore: game.startScore,
      teamAStarterIndex: clampStarterIndex(nextAStarter, teamACount),
      teamBStarterIndex: clampStarterIndex(nextBStarter, teamBCount),
      legNumber: (game.legNumber ?? 1) + 1,
      turnIndex: 0,
      isFinished: false,
      winnerTeam: undefined,
      startsFirstTeam: nextStartsFirst === "A" ? undefined : "B",
    });
  },
});

/** Cycle which teammate leads the rotation for that team (2v2). */
export const toggleTeamStarterIndex = mutation({
  args: {
    gameId: v.id("games"),
    team: v.union(v.literal("A"), v.literal("B")),
  },
  handler: async (ctx, args) => {
    const ownerId = await requireUserId(ctx);
    const game = await ctx.db.get(args.gameId);
    if (!game || game.ownerId !== ownerId) throw new Error("Game not found.");
    if (game.matchCompleted) throw new Error("This game has already ended.");
    if (!game.isFinished && game.turnIndex > 0) {
      throw new Error("Switch teammates only before the first throw, or after a leg ends.");
    }

    const participants = await ctx.db
      .query("gameParticipants")
      .withIndex("by_game", (q) => q.eq("gameId", args.gameId))
      .collect();
    participants.sort((a, b) => a.order - b.order);
    const teamACount = participants.filter((p) => p.team === "A").length;
    const teamBCount = participants.filter((p) => p.team === "B").length;

    if (args.team === "A") {
      if (teamACount < 2) throw new Error("Teammate order only applies with two players on this team.");
      const cur = game.teamAStarterIndex ?? 0;
      const next = (cur + 1) % teamACount;
      await ctx.db.patch(args.gameId, { teamAStarterIndex: clampStarterIndex(next, teamACount) });
    } else {
      if (teamBCount < 2) throw new Error("Teammate order only applies with two players on this team.");
      const cur = game.teamBStarterIndex ?? 0;
      const next = (cur + 1) % teamBCount;
      await ctx.db.patch(args.gameId, { teamBStarterIndex: clampStarterIndex(next, teamBCount) });
    }
  },
});

export const endGame = mutation({
  args: { gameId: v.id("games") },
  handler: async (ctx, args) => {
    const ownerId = await requireUserId(ctx);
    const game = await ctx.db.get(args.gameId);
    if (!game || game.ownerId !== ownerId) throw new Error("Game not found.");
    if (game.matchCompleted) return;

    let winnerTeam: TeamSide | undefined = game.winnerTeam;
    if (!winnerTeam) {
      if (game.teamAScore < game.teamBScore) winnerTeam = "A";
      else if (game.teamBScore < game.teamAScore) winnerTeam = "B";
    }

    await ctx.db.patch(args.gameId, {
      matchCompleted: true,
      matchEndedAt: Date.now(),
      winnerTeam,
      isFinished: true,
    });
  },
});

export const listGames = query({
  args: {},
  handler: async (ctx) => {
    const ownerId = await requireUserId(ctx);
    const games = await ctx.db
      .query("games")
      .withIndex("by_owner", (q) => q.eq("ownerId", ownerId))
      .collect();
    games.sort((a, b) => b.createdAt - a.createdAt);

    return Promise.all(
      games.map(async (game) => {
        const { turnOrder, teamA, teamB } = await buildGameSummary(ctx, game._id, game);
        const activeParticipant =
          turnOrder[game.turnIndex % Math.max(turnOrder.length, 1)] ?? null;

        return { ...game, teamA, teamB, activeParticipant };
      }),
    );
  },
});

export const listGameHistory = query({
  args: {},
  handler: async (ctx) => {
    const ownerId = await requireUserId(ctx);
    const games = await ctx.db
      .query("games")
      .withIndex("by_owner", (q) => q.eq("ownerId", ownerId))
      .collect();
    games.sort((a, b) => b.createdAt - a.createdAt);

    return Promise.all(
      games.map(async (game) => {
        const { teamA, teamB } = await buildGameSummary(ctx, game._id, game);
        const turns = await ctx.db
          .query("turns")
          .withIndex("by_game", (q) => q.eq("gameId", game._id))
          .collect();
        const { legsWonA, legsWonB } = countLegWinsFromTurns(turns);
        return {
          ...game,
          teamA,
          teamB,
          turnsPlayed: turns.length,
          endedAt: turns.length > 0 ? Math.max(...turns.map((turn) => turn.createdAt)) : null,
          legsWonA,
          legsWonB,
        };
      }),
    );
  },
});

export const getGameDetails = query({
  args: { gameId: v.id("games") },
  handler: async (ctx, args) => {
    const ownerId = await requireUserId(ctx);
    const game = await ctx.db.get(args.gameId);
    if (!game || game.ownerId !== ownerId) return null;

    const participants = await ctx.db
      .query("gameParticipants")
      .withIndex("by_game", (q) => q.eq("gameId", args.gameId))
      .collect();
    participants.sort((a, b) => a.order - b.order);
    const turnOrder = getTurnOrder(participants, game);
    const activeParticipant = turnOrder[game.turnIndex % Math.max(turnOrder.length, 1)] ?? null;
    const teamA = participants.filter((participant) => participant.team === "A");
    const teamB = participants.filter((participant) => participant.team === "B");

    const turns = await ctx.db
      .query("turns")
      .withIndex("by_game", (q) => q.eq("gameId", args.gameId))
      .collect();
    turns.sort((a, b) => b.createdAt - a.createdAt);

    const { legsWonA, legsWonB } = countLegWinsFromTurns(turns);

    return { game, participants, turns, activeParticipant, teamA, teamB, legsWonA, legsWonB };
  },
});

export const getStats = query({
  args: {},
  handler: async (ctx) => {
    const ownerId = await requireUserId(ctx);
    const playerStats = await ctx.db
      .query("playerStats")
      .withIndex("by_owner", (q) => q.eq("ownerId", ownerId))
      .collect();
    playerStats.sort((a, b) => b.gamesWon - a.gamesWon || b.pointsScored - a.pointsScored);

    const teamStats = await ctx.db
      .query("teamStats")
      .withIndex("by_owner", (q) => q.eq("ownerId", ownerId))
      .collect();
    teamStats.sort((a, b) => b.gamesWon - a.gamesWon || b.pointsScored - a.pointsScored);

    return { playerStats, teamStats };
  },
});

import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { authTables } from "@convex-dev/auth/server";

export default defineSchema({
  ...authTables,

  friends: defineTable({
    ownerId: v.string(),
    name: v.string(),
    createdAt: v.number(),
  })
    .index("by_owner", ["ownerId"])
    .index("by_owner_name", ["ownerId", "name"]),

  games: defineTable({
    ownerId: v.string(),
    format: v.union(v.literal("1v1"), v.literal("2v2")),
    startScore: v.union(v.literal(301), v.literal(501)),
    teamAScore: v.number(),
    teamBScore: v.number(),
    teamAStarterIndex: v.optional(v.number()),
    teamBStarterIndex: v.optional(v.number()),
    /** Which team throws first this leg (default A). */
    startsFirstTeam: v.optional(v.union(v.literal("A"), v.literal("B"))),
    legNumber: v.optional(v.number()),
    /** First team to reach this many legs wins the match. Omitted = play until someone ends the game. */
    legsToWin: v.optional(v.number()),
    matchCompleted: v.optional(v.boolean()),
    matchEndedAt: v.optional(v.number()),
    turnIndex: v.number(),
    isFinished: v.boolean(),
    winnerTeam: v.optional(v.union(v.literal("A"), v.literal("B"))),
    createdAt: v.number(),
  }).index("by_owner", ["ownerId"]),

  gameParticipants: defineTable({
    gameId: v.id("games"),
    ownerId: v.string(),
    playerName: v.string(),
    team: v.union(v.literal("A"), v.literal("B")),
    order: v.number(),
  })
    .index("by_game", ["gameId"])
    .index("by_owner_player", ["ownerId", "playerName"]),

  turns: defineTable({
    gameId: v.id("games"),
    ownerId: v.string(),
    participantId: v.id("gameParticipants"),
    playerName: v.string(),
    team: v.union(v.literal("A"), v.literal("B")),
    legNumber: v.optional(v.number()),
    darts: v.array(v.number()),
    turnTotal: v.number(),
    wasBust: v.boolean(),
    scoreBefore: v.number(),
    scoreAfter: v.number(),
    /** Darts aimed at a double bed this turn (0–3), optional unless checkout rules apply. */
    dartsAtDoubleBed: v.optional(v.number()),
    /** Of those at-double darts, how many hit a double (≤ dartsAtDoubleBed). Checkout wins need ≥1. */
    dartsHitOnDoubleBed: v.optional(v.number()),
    /** True when the leg was finished by hitting a double. */
    checkoutDoubleHit: v.optional(v.boolean()),
    /** Darts that counted toward the winning double (1–3). */
    checkoutDartsOnDouble: v.optional(v.number()),
    /** Free text, e.g. "D16, D8". */
    doublesHitNotes: v.optional(v.string()),
    createdAt: v.number(),
  }).index("by_game", ["gameId"]),

  playerStats: defineTable({
    ownerId: v.string(),
    playerName: v.string(),
    gamesPlayed: v.number(),
    gamesWon: v.number(),
    turnsPlayed: v.number(),
    dartsThrown: v.number(),
    pointsScored: v.number(),
    busts: v.number(),
    highestTurn: v.number(),
  })
    .index("by_owner", ["ownerId"])
    .index("by_owner_player", ["ownerId", "playerName"]),

  teamStats: defineTable({
    ownerId: v.string(),
    teamKey: v.string(),
    gamesPlayed: v.number(),
    gamesWon: v.number(),
    turnsPlayed: v.number(),
    pointsScored: v.number(),
    busts: v.number(),
    highestTurn: v.number(),
  })
    .index("by_owner", ["ownerId"])
    .index("by_owner_team", ["ownerId", "teamKey"]),
});

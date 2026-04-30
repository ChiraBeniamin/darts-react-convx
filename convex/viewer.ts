import { query } from "./_generated/server";

/** Email for header badge / “Me” name seeding (from auth identity). */
export const getViewerEmail = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity?.email) return null;
    return identity.email;
  },
});

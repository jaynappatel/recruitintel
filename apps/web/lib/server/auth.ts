import { betterAuth } from "better-auth";

import { getAuthDatabasePool } from "./auth-database";
import { buildAuthOptions } from "./auth-options";

export const auth = betterAuth(buildAuthOptions(getAuthDatabasePool()));

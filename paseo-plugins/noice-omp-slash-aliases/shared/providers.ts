import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

/** Providers that run OMP (`omp` and custom ones that extend it); only the daemon can read Paseo's config. */
export const ompProviders = defineRpc({
  name: "providers.omp",
  input: z.object({}),
  output: z.object({ providers: z.array(z.string()) }),
});

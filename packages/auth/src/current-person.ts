import type { PersonId } from "@rat-stack/database";
import { Context } from "effect";

export class CurrentPerson extends Context.Service<CurrentPerson, PersonId>()(
  "@rat-stack/auth/CurrentPerson"
) {}

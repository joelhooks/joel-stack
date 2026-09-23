import { createFileRoute, useSearch } from "@tanstack/react-router";
import { Schema } from "effect";

import { ReadFeature } from "../features/read/read-feature.js";

const ReadSearch = Schema.Struct({ id: Schema.optional(Schema.String) });

const ReadRoute = () => {
  const { id } = useSearch({ from: "/read" });

  return <ReadFeature id={id ?? ""} />;
};

export const Route = createFileRoute("/read")({
  component: ReadRoute,
  validateSearch: Schema.decodeUnknownSync(ReadSearch),
});

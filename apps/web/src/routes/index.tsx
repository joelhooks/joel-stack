import { createFileRoute } from "@tanstack/react-router";

import { SearchFeature } from "../features/search/search-feature.js";

export const Route = createFileRoute("/")({
  component: SearchFeature,
});

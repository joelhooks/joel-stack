import { originToken } from "./bundled-content.generated.js";

const escapeAttribute = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");

export const renderStaticDocument = (origin: string, documentHtml: string) =>
  documentHtml.replaceAll(originToken, escapeAttribute(origin));

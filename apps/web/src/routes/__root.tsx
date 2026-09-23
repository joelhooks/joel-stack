import { RegistryProvider } from "@effect/atom-react";
import {
  appleTouchIconPngBase64,
  faviconIcoBase64,
  ratSvg,
} from "@rat-stack/mischief/rat-icons";
import {
  HeadContent,
  Outlet,
  Scripts,
  createRootRoute,
} from "@tanstack/react-router";
import type { ReactNode } from "react";

import { DevtoolsOverlay } from "#devtools-overlay";

import { ClientOnly } from "../features/shared/client-only.js";

import "@rat-stack/mischief/rat.css";
import "../styles.css";

const Document = (props: Readonly<{ children: ReactNode }>) => (
  <html lang="en">
    <head>
      <HeadContent />
    </head>
    <body>
      {props.children}
      <Scripts />
    </body>
  </html>
);

const RootComponent = () => (
  <Document>
    <RegistryProvider>
      <header>
        <a href="/">🐀 Rat Stack</a> · Law and skills
      </header>
      <Outlet />
      <ClientOnly fallback={<></>}>
        <DevtoolsOverlay />
      </ClientOnly>
    </RegistryProvider>
  </Document>
);

export const Route = createRootRoute({
  component: RootComponent,
  head: () => ({
    links: [
      {
        href: `data:image/x-icon;base64,${faviconIcoBase64}`,
        rel: "icon",
        sizes: "48x48",
      },
      {
        href: `data:image/svg+xml,${encodeURIComponent(ratSvg)}`,
        rel: "icon",
        type: "image/svg+xml",
      },
      {
        href: `data:image/png;base64,${appleTouchIconPngBase64}`,
        rel: "apple-touch-icon",
      },
    ],
    meta: [
      { charSet: "utf-8" },
      { content: "width=device-width, initial-scale=1", name: "viewport" },
      { title: "rat-stack docs" },
      {
        content: "Search and read rat-stack's law and skills.",
        name: "description",
      },
    ],
  }),
});

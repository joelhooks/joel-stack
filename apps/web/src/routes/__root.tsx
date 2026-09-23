import { RegistryProvider } from "@effect/atom-react";
import {
  HeadContent,
  Outlet,
  Scripts,
  createRootRoute,
} from "@tanstack/react-router";
import type { ReactNode } from "react";

import { DevtoolsOverlay } from "#devtools-overlay";

import { ClientOnly } from "../features/shared/client-only.js";

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
      <header className="site-header">
        <a className="brand" href="/">
          rat-stack
        </a>
        <span>Law and skills</span>
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

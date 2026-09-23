import type { ReactElement } from "react";
import { useEffect, useState } from "react";

export const ClientOnly = (
  props: Readonly<{ children: ReactElement; fallback: ReactElement }>
) => {
  const [clientReady, setClientReady] = useState(false);

  useEffect(() => {
    setClientReady(true);
  }, []);

  return clientReady ? props.children : props.fallback;
};

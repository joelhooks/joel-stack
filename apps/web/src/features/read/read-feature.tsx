import { useAtomValue } from "@effect/atom-react";
import { ResourceNotFound } from "@rat-stack/core/contracts";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult";

import { readDoc } from "../../client/docs.js";
import { ClientOnly } from "../shared/client-only.js";

const LoadingDocument = () => (
  <main className="page">
    <p className="status">Loading the document…</p>
  </main>
);

const ReadDocument = (props: Readonly<{ id: string }>) => {
  const result = useAtomValue(readDoc(props.id));

  if (AsyncResult.isInitial(result)) {
    return <LoadingDocument />;
  }

  if (AsyncResult.isFailure(result)) {
    const error = AsyncResult.error(result);

    if (Option.isSome(error) && Schema.is(ResourceNotFound)(error.value)) {
      return (
        <main className="page">
          <p className="eyebrow">Document not found</p>
          <p className="status error" role="alert">
            {error.value.message}
          </p>
          <a href="/">Back to search</a>
        </main>
      );
    }

    return (
      <main className="page">
        <p className="status error" role="alert">
          The document could not be loaded. Try again in a moment.
        </p>
        <a href="/">Back to search</a>
      </main>
    );
  }

  const document = result.value;

  return (
    <main className="page">
      <a className="back-link" href="/">
        ← Back to search
      </a>
      <p className="eyebrow">
        {document.kind} · {document.routePath}
      </p>
      <h1>{document.title}</h1>
      <p className="lede">{document.description}</p>
      <pre className="document-text">{document.text}</pre>
    </main>
  );
};

export const ReadFeature = (props: Readonly<{ id: string }>) => {
  if (props.id.length === 0) {
    return (
      <main className="page">
        <p className="status error" role="alert">
          No document was selected.
        </p>
        <a href="/">Back to search</a>
      </main>
    );
  }

  return (
    <ClientOnly fallback={<LoadingDocument />}>
      <ReadDocument id={props.id} />
    </ClientOnly>
  );
};

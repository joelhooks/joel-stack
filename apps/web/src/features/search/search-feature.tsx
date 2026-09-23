import { useAtomValue } from "@effect/atom-react";
import * as Schema from "effect/Schema";
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult";
import type { FormEvent } from "react";
import { useState } from "react";

import { searchDocs } from "../../client/docs.js";

const SearchResults = (props: Readonly<{ query: string }>) => {
  const results = useAtomValue(searchDocs(props.query));

  const resultsContent = () => {
    if (AsyncResult.isInitial(results)) {
      return <p className="status">Searching the docs…</p>;
    }

    if (AsyncResult.isFailure(results)) {
      return (
        <p className="status error" role="alert">
          Search failed. Try again in a moment.
        </p>
      );
    }

    return (
      <>
        <p className="result-count">
          {results.value.total}{" "}
          {results.value.total === 1 ? "result" : "results"}
        </p>
        <ul className="result-list">
          {results.value.matches.map((match) => (
            <li className="result-card" key={match.id}>
              <div className="result-meta">
                <span>{match.kind}</span>
                <span>{match.routePath}</span>
              </div>
              <h2>
                <a href={`/read?id=${encodeURIComponent(match.id)}`}>
                  {match.title}
                </a>
              </h2>
              <p>{match.description}</p>
              <p className="excerpt">{match.excerpt}</p>
            </li>
          ))}
        </ul>
      </>
    );
  };

  return (
    <section aria-busy={results.waiting} aria-live="polite">
      {resultsContent()}
    </section>
  );
};

export const SearchFeature = () => {
  const [query, setQuery] = useState<string | null>(null);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextQuery = new FormData(event.currentTarget).get("query");

    if (Schema.is(Schema.String)(nextQuery) && nextQuery.trim().length > 0) {
      setQuery(nextQuery.trim());
    }
  };

  return (
    <main className="page">
      <p className="eyebrow">Reference docs</p>
      <h1>Find the rule or skill you need.</h1>
      <p className="lede">
        Search rat-stack's law and skills. Open a result to read the exact
        source.
      </p>
      <form className="search-form" onSubmit={submit}>
        <label className="visually-hidden" htmlFor="docs-query">
          Search the docs
        </label>
        <input
          autoComplete="off"
          defaultValue="capability"
          id="docs-query"
          name="query"
          placeholder="Try ‘capability’ or ‘Effect’"
        />
        <button type="submit">Search</button>
      </form>
      {query === null ? (
        <section aria-live="polite">
          <p className="status">Search the docs to see matching resources.</p>
        </section>
      ) : (
        <SearchResults query={query} />
      )}
    </main>
  );
};

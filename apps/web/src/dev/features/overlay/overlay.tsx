import {
  RegistryContext,
  RegistryProvider,
  useAtom,
  useAtomMount,
  useAtomRefresh,
  useAtomValue,
} from "@effect/atom-react";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult";
import type * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry";
import type { FormEvent, ReactNode } from "react";
import { useContext, useEffect, useState } from "react";

import {
  actors,
  contracts,
  describeContract,
  devtoolsKeys,
  dispatchCall,
  recentCalls,
  reportAtoms,
  runAsPerson,
} from "../../client/devtools.js";

import "./overlay.css";

type Tab = "calls" | "contracts" | "machines" | "session";

const tabs: readonly Tab[] = ["calls", "contracts", "machines", "session"];

const CallRow = Schema.Struct({
  as: Schema.Json,
  capability: Schema.String,
  durationMs: Schema.Int,
  index: Schema.Int,
  outcome: Schema.Struct({ _tag: Schema.String }),
});

const TestPersonResult = Schema.Struct({
  ok: Schema.Literal(true),
  value: Schema.Struct({ cookie: Schema.String, personId: Schema.String }),
});

const decodeCallRow = Schema.decodeUnknownOption(CallRow);

const decodeTestPerson = Schema.decodeUnknownOption(TestPersonResult);

const decodeJsonInput = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Json)
);

const pretty = (value: Schema.Json) => JSON.stringify(value, null, 2);

const Loaded = <A, E>(
  props: Readonly<{
    result: AsyncResult.AsyncResult<A, E>;
    children: (value: A) => ReactNode;
  }>
) => {
  if (AsyncResult.isInitial(props.result)) {
    return <p>Loading…</p>;
  }

  if (AsyncResult.isFailure(props.result)) {
    return <p className="rat-failed">The devtools server did not answer.</p>;
  }

  return <>{props.children(props.result.value)}</>;
};

const CallsTab = () => {
  const result = useAtomValue(recentCalls);
  const refresh = useAtomRefresh(recentCalls);

  return (
    <>
      <button onClick={refresh} type="button">
        Refresh
      </button>
      <Loaded result={result}>
        {({ entries, nextIndex }) => (
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>capability</th>
                <th>outcome</th>
                <th>ms</th>
                <th>as</th>
              </tr>
            </thead>
            <tbody>
              {entries.toReversed().flatMap((entry) =>
                Option.match(decodeCallRow(entry), {
                  onNone: () => [],
                  onSome: (row) => [
                    <tr key={row.index}>
                      <td>{row.index}</td>
                      <td>{row.capability}</td>
                      <td
                        className={
                          Predicate.isTagged(row.outcome, "Succeeded")
                            ? "rat-ok"
                            : "rat-failed"
                        }
                      >
                        {row.outcome._tag}
                      </td>
                      <td>{row.durationMs}</td>
                      <td>{row.as === null ? "" : pretty(row.as)}</td>
                    </tr>,
                  ],
                })
              )}
              {nextIndex === 0 ? (
                <tr>
                  <td colSpan={5}>No calls yet. Use the app, then refresh.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        )}
      </Loaded>
    </>
  );
};

const Dispatch = (props: Readonly<{ name: string }>) => {
  const description = useAtomValue(describeContract(props.name));
  const person = useAtomValue(runAsPerson);
  const [result, dispatch] = useAtom(dispatchCall);
  const [input, setInput] = useState("{}");
  const parsed = decodeJsonInput(input);

  const run = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (Option.isNone(parsed)) {
      return;
    }

    dispatch({
      payload:
        person === null
          ? { capability: props.name, input: parsed.value }
          : { as: person, capability: props.name, input: parsed.value },
      reactivityKeys: devtoolsKeys,
    });
  };

  return (
    <form onSubmit={run}>
      <Loaded result={description}>
        {(described) => <pre>{pretty(described.input)}</pre>}
      </Loaded>
      <textarea
        aria-label="Input as JSON"
        onChange={(event) => {
          setInput(event.currentTarget.value);
        }}
        rows={5}
        value={input}
      />
      <button disabled={Option.isNone(parsed)} type="submit">
        Run {props.name}
        {person === null ? "" : " as the selected person"}
      </button>
      {AsyncResult.isSuccess(result) ? (
        <pre className={result.value.result.ok ? "rat-ok" : "rat-failed"}>
          {pretty(
            result.value.result.ok
              ? result.value.result.value
              : result.value.result.error
          )}
        </pre>
      ) : null}
    </form>
  );
};

const ContractsTab = () => {
  const result = useAtomValue(contracts);
  const [selected, setSelected] = useState<string | null>(null);

  return (
    <Loaded result={result}>
      {(listed) => (
        <>
          <p>
            {listed.contracts.map((contract) => (
              <button
                aria-pressed={contract.name === selected}
                key={contract.name}
                onClick={() => {
                  setSelected(contract.name);
                }}
                title={contract.description}
                type="button"
              >
                {contract.name}
              </button>
            ))}
          </p>
          {selected === null ? (
            <p>Pick a contract to see its input schema and run it.</p>
          ) : (
            <Dispatch key={selected} name={selected} />
          )}
        </>
      )}
    </Loaded>
  );
};

const MachinesTab = () => {
  const result = useAtomValue(actors);
  const refresh = useAtomRefresh(actors);

  return (
    <>
      <button onClick={refresh} type="button">
        Refresh
      </button>
      <Loaded result={result}>
        {(listed) => (
          <table>
            <thead>
              <tr>
                <th>machine</th>
                <th>state</th>
                <th>status</th>
                <th>transitions</th>
              </tr>
            </thead>
            <tbody>
              {listed.actors.map((actor) => (
                <tr key={actor.actorId}>
                  <td>{actor.machine}</td>
                  <td>{pretty(actor.state)}</td>
                  <td>{actor.status}</td>
                  <td>{actor.transitions}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Loaded>
    </>
  );
};

const SessionTab = () => {
  const [person, setPerson] = useAtom(runAsPerson);
  const [result, dispatch] = useAtom(dispatchCall);
  const [name, setName] = useState("ada");

  const signedIn = AsyncResult.isSuccess(result)
    ? decodeTestPerson(result.value.result)
    : Option.none();

  const signIn = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    dispatch({
      payload: { capability: "rat_test_person", input: { name } },
      reactivityKeys: devtoolsKeys,
    });
  };

  return (
    <>
      <form onSubmit={signIn}>
        <input
          aria-label="Test person name"
          onChange={(event) => {
            setName(event.currentTarget.value);
          }}
          value={name}
        />
        <button type="submit">Sign in {name}@rat.test</button>
      </form>
      {Option.match(signedIn, {
        onNone: () => null,
        onSome: ({ value }) => (
          <>
            <pre>{pretty(value)}</pre>
            <button
              onClick={() => {
                setPerson(value.personId);
              }}
              type="button"
            >
              Run contracts as this person
            </button>
          </>
        ),
      })}
      <p>
        {person === null
          ? "Contracts run as the dev server's default person."
          : `Contracts run as ${person}.`}
      </p>
      {person === null ? null : (
        <button
          onClick={() => {
            setPerson(null);
          }}
          type="button"
        >
          Use the default person
        </button>
      )}
    </>
  );
};

const Reporter = (props: Readonly<{ registry: AtomRegistry.AtomRegistry }>) => {
  useAtomMount(reportAtoms(props.registry));

  return null;
};

const Panel = () => {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("calls");

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "k") {
        event.preventDefault();
        setOpen((value) => !value);
      }

      if (event.key === "Escape") {
        setOpen(false);
      }
    };

    window.addEventListener("keydown", onKey);

    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  return (
    <>
      <button
        aria-expanded={open}
        aria-label="Rat devtools (⌘K)"
        className="rat-trigger"
        onClick={() => {
          setOpen((value) => !value);
        }}
        title="Rat devtools (⌘K)"
        type="button"
      >
        🐀
      </button>
      {open ? (
        <section aria-label="Rat devtools" className="rat-panel">
          <header>
            <nav>
              {tabs.map((name) => (
                <button
                  aria-pressed={name === tab}
                  key={name}
                  onClick={() => {
                    setTab(name);
                  }}
                  type="button"
                >
                  {name}
                </button>
              ))}
            </nav>
            <span>🐀</span>
          </header>
          <div className="rat-body">
            {tab === "calls" ? <CallsTab /> : null}
            {tab === "contracts" ? <ContractsTab /> : null}
            {tab === "machines" ? <MachinesTab /> : null}
            {tab === "session" ? <SessionTab /> : null}
          </div>
        </section>
      ) : null}
    </>
  );
};

export const DevtoolsOverlay = () => {
  const appRegistry = useContext(RegistryContext);

  return (
    <RegistryProvider>
      <Reporter registry={appRegistry} />
      <Panel />
    </RegistryProvider>
  );
};

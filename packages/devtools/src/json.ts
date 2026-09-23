import type { PlainSchema } from "@rat-stack/capability";
import { Effect, Predicate, Schema } from "effect";

export const ROOT = "root";

const STRING_LIMIT = 120;

const ARRAY_LIMIT = 10;

const DEPTH_LIMIT = 4;

export const SideSchema = Schema.TaggedUnion({
  Absent: {},
  Present: { value: Schema.Json },
});

export type Side = typeof SideSchema.Type;

export const ChangeSchema = Schema.Struct({
  after: SideSchema,
  before: SideSchema,
  path: Schema.String,
});

export type Change = typeof ChangeSchema.Type;

export class PathNotFound extends Schema.TaggedError<PathNotFound>()(
  "PathNotFound",
  {
    available: Schema.Array(Schema.String),
    path: Schema.String,
    resolved: Schema.String,
  }
) {}

const isJsonArray = (value: Schema.Json): value is readonly Schema.Json[] =>
  Array.isArray(value);

const isJsonObject = (value: Schema.Json): value is Schema.JsonObject =>
  value !== null && !isJsonArray(value) && Predicate.isObject(value);

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Handler values arrive erased across the heterogeneous capability list; the schema encodes them before anything reads them.
export const toJson = (schema: PlainSchema, value: unknown) =>
  Schema.encodeUnknownEffect(schema)(value).pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(Schema.Json)),
    Effect.orElseSucceed((): Schema.Json => ({
      _unencodable: Predicate.isString(value) ? value : "value",
    }))
  );

const summarizeAt = (value: Schema.Json, depth: number): Schema.Json => {
  if (Predicate.isString(value) && value.length > STRING_LIMIT) {
    return {
      _summary: "string",
      head: value.slice(0, STRING_LIMIT),
      length: value.length,
    };
  }

  if (isJsonArray(value)) {
    const first = value.at(0);
    const last = value.at(-1);

    return value.length > ARRAY_LIMIT &&
      first !== undefined &&
      last !== undefined
      ? {
          _summary: "array",
          length: value.length,
          sample: [summarizeAt(first, depth + 1), summarizeAt(last, depth + 1)],
        }
      : value.map((item) => summarizeAt(item, depth + 1));
  }

  if (isJsonObject(value)) {
    const keys = Object.keys(value).toSorted();
    const tag = value._tag;

    if (depth >= DEPTH_LIMIT) {
      return tag === undefined
        ? { _summary: "record", keys }
        : { _summary: "record", _tag: tag, keys };
    }

    return Object.fromEntries(
      keys.flatMap((key) => {
        const field = value[key];

        return field === undefined
          ? []
          : [[key, summarizeAt(field, depth + 1)]];
      })
    );
  }

  return value;
};

export const summarize = (value: Schema.Json): Schema.Json =>
  summarizeAt(value, 0);

const childOf = (
  value: Schema.Json,
  segment: string
): Schema.Json | undefined => {
  if (isJsonArray(value)) {
    return /^\d+$/u.test(segment) ? value.at(Number(segment)) : undefined;
  }

  return isJsonObject(value) ? value[segment] : undefined;
};

const keysOf = (value: Schema.Json): readonly string[] => {
  if (isJsonArray(value)) {
    return value.map((_, index) => String(index));
  }

  return isJsonObject(value) ? Object.keys(value).toSorted() : [];
};

export const readPath = (
  value: Schema.Json,
  path: string
): Effect.Effect<Schema.Json, PathNotFound> => {
  const [head, ...segments] = path.split(".");

  if (head !== ROOT) {
    return Effect.fail(
      new PathNotFound({ available: [ROOT], path, resolved: "" })
    );
  }

  let current = value;
  let resolved = ROOT;

  for (const segment of segments) {
    const next = childOf(current, segment);

    if (next === undefined) {
      return Effect.fail(
        new PathNotFound({ available: keysOf(current), path, resolved })
      );
    }

    current = next;
    resolved = `${resolved}.${segment}`;
  }

  return Effect.succeed(current);
};

const present = (value: Schema.Json | undefined): Side =>
  value === undefined
    ? SideSchema.cases.Absent.make({})
    : SideSchema.cases.Present.make({ value: summarize(value) });

const isContainer = (value: Schema.Json) =>
  isJsonArray(value) || isJsonObject(value);

export const diff = (
  before: Schema.Json | undefined,
  after: Schema.Json | undefined,
  path: string = ROOT
): readonly Change[] => {
  if (
    before !== undefined &&
    after !== undefined &&
    isContainer(before) &&
    isContainer(after) &&
    isJsonArray(before) === isJsonArray(after)
  ) {
    const keys = [...new Set([...keysOf(before), ...keysOf(after)])];

    return keys.flatMap((key) =>
      diff(childOf(before, key), childOf(after, key), `${path}.${key}`)
    );
  }

  return JSON.stringify(before) === JSON.stringify(after)
    ? []
    : [{ after: present(after), before: present(before), path }];
};

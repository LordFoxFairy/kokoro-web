import { z, ZodError } from "zod";

const DEFAULT_MAXIMUM_BYTES = 4 * 1024;
const DEFAULT_MAXIMUM_PARAMETERS = 8;

function invalidQuery(): never {
  throw new ZodError([]);
}

/** Parse a bounded, canonical query: every key must be declared and occur once. */
export function strictQuery<Shape extends z.ZodRawShape>(
  request: Request,
  shape: Shape,
  limits: Readonly<{ maximumBytes?: number; maximumParameters?: number }> = {},
): z.infer<z.ZodObject<Shape>> {
  const url = new URL(request.url);
  const maximumBytes = limits.maximumBytes ?? DEFAULT_MAXIMUM_BYTES;
  const maximumParameters = limits.maximumParameters ?? DEFAULT_MAXIMUM_PARAMETERS;
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes <= 0 ||
      !Number.isSafeInteger(maximumParameters) || maximumParameters <= 0 ||
      Buffer.byteLength(url.search, "utf8") > maximumBytes) invalidQuery();

  const allowed = new Set(Object.keys(shape));
  const values: Record<string, string> = {};
  let count = 0;
  for (const [key, value] of url.searchParams) {
    count += 1;
    if (count > maximumParameters || !allowed.has(key) || Object.hasOwn(values, key)) invalidQuery();
    values[key] = value;
  }
  return z.object(shape).strict().parse(values);
}

// * Helps create url params object from window.location.search string

import { z } from "zod";

// * with zod schema for type safety (also runtime type safety)
export function create_url_params<
  V_Request_params extends z.ZodType<any, z.ZodTypeDef, any>
>(url_scheme: V_Request_params): Partial<z.infer<V_Request_params>> {
  const url_params = new URLSearchParams(window.location.search);
  const param_record: Record<string, unknown> = {};
  try {
    url_params.forEach((value, key, _parent) => {
      if (value !== undefined) param_record[key] = JSON.parse(value);
    });
    url_scheme.parse(param_record);
  } catch (e) {
    // console.warn(e);
  }
  return param_record;
}

// * Helps create url search string (window.location.search) from any object using zod schema for type safety
export function create_search_params<
  V_Request_params extends z.ZodType<any, z.ZodTypeDef, any>
>(args: { scheme: V_Request_params; params: z.infer<V_Request_params> }) {
  const url_params = new URLSearchParams();

  Object.entries(args.params).forEach(([key, val]) => {
    if (val === undefined) {
      url_params.delete(key);
    } else {
      url_params.set(key, JSON.stringify(val));
    }
  });
  return "?" + decodeURIComponent(url_params.toString());
}

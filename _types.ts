import { z } from "zod";
import { Lifetime_duration } from "./cache";

export type Change_state_history = "push" | "replace";

export type Use_dash_url_state<U_data> = {
  is_loading: Record<string, boolean>;
  data: U_data;
};

export type Api_value<U_api_request = any, V_deps extends any[] = any[]> = {
  api: (request: U_api_request, curr_data: any) => Promise<any>;
  deps: V_deps;
  fetch_on_mount?: boolean; // def true
  react_on_deps_change?: boolean; // def true
  on_success?: (
    url_params: U_api_request,
    change_state: (
      arg:
        | Partial<U_api_request>
        | ((prev: U_api_request) => Partial<U_api_request>),
      history_type?: Change_state_history
    ) => void,
    current_data: any
  ) => void;
  on_error?: (e: any) => void;
  reset_interval?: number;
  cache_lifetime?: Lifetime_duration;
};

export type Change_state_callback<
  V_Request_params extends z.ZodType<any, z.ZodTypeDef, any>
> = (
  new_state:
    | Partial<z.infer<V_Request_params>>
    | ((
        prev_state: z.infer<V_Request_params>
      ) => Partial<z.infer<V_Request_params>>),
  history?: Change_state_history
) => void;

export type Api_callback<U_api_request = any, V_deps extends any[] = any[]> = {
  [k in string]: Api_value<U_api_request, V_deps>;
};

export type Get_data_map<U_input extends Api_callback> = {
  [K in keyof U_input]?: U_input[K] extends {
    api: (...args: any[]) => Promise<infer Api_output>;
    on_error?: (e: any) => void;
    deps: any;
  }
    ? Api_output
    : any;
};

export type Get_loading_map<U_input extends Api_callback> = {
  [K in keyof U_input]: boolean;
};

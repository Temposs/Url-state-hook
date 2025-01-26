/* eslint-disable indent */
import { useCallback, useEffect, useMemo, useRef } from "react";
import { useLocation, useNavigate } from "react-router";
import { z } from "zod";
import {
  Api_callback,
  Change_state_callback,
  Get_data_map,
  Get_loading_map,
  Use_dash_url_state,
} from "./_types";
import { cloneDeep, isEqual } from "lodash";
import { hashCode } from "./numeric_hash";
import { cache_signal, Get_from_memo_res, Lifetime_duration } from "./cache";

export function useUrlState<
  V_Request_params extends z.ZodType<any, z.ZodTypeDef, any>,
  U_data extends Api_callback<
    z.infer<V_Request_params>,
    Array<keyof z.infer<V_Request_params>>
  >
>({ apis, url_scheme }: { apis?: U_data; url_scheme: V_Request_params }) {
  // * Global cache
  const navigation = useNavigate();

  const location = useLocation();
  // * Previous url search and pathname string used for handling browser history events
  const prev_url_search = useRef<string>(
    decodeURIComponent(window.location.search)
  );
  const prev_url_pathname = useRef<string>(window.location.pathname);

  // * Checks if parent component was unmounted
  const is_unmounted = useRef(false);
  // * Checks if parent component was mounted
  const is_mounted = useRef(false);
  // * Checks if history was changed during a fetch phase
  const history_change_durring_fetch = useRef(0);

  // * Intervals used for refetching data after certain time passed
  const intervals = useRef<NodeJS.Timeout[]>([]);
  // * Interval queue used for handling all running requests triggred by intervals
  // * Component updates only when all requests are resolved (race conditions)
  const interval_queue = useRef<
    Record<string, { pending: false; data?: any } | { pending: true }>
  >({});

  const apis_hash_map = useMemo(() => {
    if (!apis) return;
    const map: Record<string, number> = {};
    Object.entries(apis).forEach(([key, val]) => {
      map[key] = hashCode(key + val.deps.join(""));
    });
    return map;
  }, [apis]);

  const create_cache_key = useCallback(
    (api_key: string, param_record: Record<string, any>) => {
      try {
        if (!apis) return;
        let key = api_key;
        let param_value: any;
        const api_val = apis[api_key as keyof U_data];
        if (!api_val) return;
        (api_val.deps as string[])
          .sort((a, b) => a.localeCompare(b))
          .forEach((d) => {
            param_value = param_record[String(d)];
            if (!param_value) return;
            key += `${String(d)}:${JSON.stringify(param_value)}`;
          });
        return key;
      } catch (e) {
        console.error("Probably JSON stringify");
        return undefined;
      }
    },
    [apis]
  );

  const get_cached_data = useCallback(
    (arg: { apis_to_fetch: string[]; param_record: Record<string, any> }) => {
      const { apis_to_fetch, param_record } = arg;
      const cached_data: Record<string, any> = {};
      if (!apis) return;
      let cache_res: Get_from_memo_res;
      apis_to_fetch.forEach((api_key) => {
        const key = create_cache_key(api_key, param_record);
        if (!key) return;
        cache_res = cache_signal.value.get_from_memo(key);
        if (!cache_res) return;
        cached_data[api_key] = cache_res.value;
      });
      if (Object.keys(cached_data).length) return cached_data;
      return undefined;
    },
    [apis]
  );

  // * creates params object from location search string with zod runtime type safety
  const create_url_params = useCallback(
    (location_search: string) => {
      const url_params = new URLSearchParams(location_search);
      const param_record: Record<string, any> = {};
      //* on same route/page
      if (prev_url_pathname.current !== window.location.pathname) {
        return param_record;
      }
      try {
        url_params.forEach((value, key, _parent) => {
          if (value !== undefined) param_record[key] = JSON.parse(value);
        });
        url_scheme.parse(param_record);
      } catch (e) {
        console.error(e);
      }
      return param_record;
    },
    [url_scheme]
  );

  // * Serves as the storage of parsed url params
  const curr_url_params = useRef<Record<string, any>>(
    create_url_params(window.location.search)
  );

  const url_state_init = useMemo(() => {
    const api_keys = Object.keys(apis || {});
    // * Setting a default state (loading & cached data)
    const cached_result = get_cached_data({
      apis_to_fetch: api_keys,
      param_record: curr_url_params.current,
    });
    const cached_keys = Object.keys(cached_result || {});
    const is_loading: Record<string, boolean> = {};
    api_keys.forEach((api_key) => {
      const val = apis?.[api_key];
      if (apis?.[api_key].cache_lifetime === "no-lifetime") return;
      is_loading[api_key] = Boolean(
        val?.fetch_on_mount !== false && !cached_keys.includes(api_key)
      );
    });
    return {
      is_loading,
      data: {
        ...cached_result,
      },
    };
  }, []);

  const url_state =
    useRef<Use_dash_url_state<Record<string, any>>>(url_state_init);

  // * function responsible for fetching fresh data (using Promise.allSettled)
  const fetch_new_data = useCallback(
    async (apis_to_fetch: string[]) => {
      const param_record = curr_url_params.current;
      if (!apis) return;
      const queue: Promise<any>[] = [];
      const apis_copy = cloneDeep(apis_to_fetch);
      (apis_to_fetch as string[]).forEach((api_key, index) => {
        const val = apis[api_key];
        try {
          const promise = val.api(param_record, url_state.current.data);
          queue.push(promise);
        } catch (e) {
          apis_copy.splice(index, 1);
          val.on_error?.(e);
          url_state.current.is_loading[api_key] = false;
        }
      });
      const results = await Promise.allSettled(queue);
      if (is_unmounted.current) return;

      apis_copy.forEach((api_key, index) => {
        const val = apis[api_key];
        const curr_res = results[index];

        switch (curr_res.status) {
          case "rejected":
            setTimeout(() => {
              val?.on_error?.(curr_res.reason);
              console.error(
                `Error with requesting ${api_key} api ${curr_res.reason}`
              );
            });
            break;
          case "fulfilled":
            url_state.current.data[api_key] = curr_res.value;
            set_cached_data({
              api_key,
              param_record,
              value: curr_res.value,
              cache_lifetime: val.cache_lifetime,
            });
            setTimeout(() => {
              if (is_unmounted.current) return;
              val?.on_success?.(
                curr_url_params.current,
                change_state,
                url_state.current.data
              );
            });
            break;
        }
        url_state.current.is_loading[api_key] = false;
      });

      if (history_change_durring_fetch.current) {
        --history_change_durring_fetch.current;
        return;
      }

      location.pathname = window.location.pathname;
      location.search = decodeURIComponent(window.location.search);
      navigation(location, {
        replace: true,
        state: location.state,
      });
    },
    [apis, navigation, location]
  );

  useEffect(() => {
    is_unmounted.current = false;
    // * initial api call
    handle_cached_result(url_state.current.data);

    // * Setting intervall callbacks
    apis_reset_setup();
    is_mounted.current = true;
    const intervals_copy = cloneDeep(intervals.current);
    return () => {
      // * cleaning intervals
      intervals_copy.forEach((interval) => {
        clearInterval(interval);
      });
      is_unmounted.current = true;
    };
  }, []);

  // * return array of apis keys that should refetch
  const will_fetch = useCallback(
    (changed_deps: string[]) => {
      const apis_to_fetch: string[] = [];

      if (!apis) return { apis_to_fetch };
      Object.keys(apis).forEach((key) => {
        const val = apis[key];
        let apis_will_fetch = false;
        if (val.react_on_deps_change !== false) {
          apis_will_fetch = changed_deps.some((cd) => val.deps.includes(cd));
        }
        if (!val.deps.length) {
          apis_will_fetch = true;
        }
        if (!is_mounted.current && val.fetch_on_mount !== false) {
          apis_will_fetch = true;
        }
        if (apis_will_fetch) {
          apis_to_fetch.push(key);
        }
      });
      return { apis_to_fetch };
    },
    [apis]
  );

  /**
   *
   * @param new_state definition of a new state
   * @param history defines if state change should be memoized in the browser history
   */
  const change_state: Change_state_callback<V_Request_params> = useCallback(
    (new_state, history = "push") => {
      try {
        const url_params = new URLSearchParams(window.location.search);

        let new_state_value: Partial<z.infer<V_Request_params>> = {};
        let changed_deps: string[] = [];
        if (typeof new_state === "function") {
          new_state_value = new_state(curr_url_params.current);
          changed_deps = Object.keys(new_state_value);
        } else {
          new_state_value = new_state;
          changed_deps = Object.keys(new_state);
        }

        // ? setting new state to url
        Object.entries(new_state_value).forEach(([key, value]) => {
          if (typeof value === "undefined") {
            url_params.delete(key);
            return;
          }
          url_params.set(key, JSON.stringify(value));
        });

        const parsed_url_params = url_params.toString();
        const { search } = window.location;
        const { apis_to_fetch } = will_fetch(changed_deps);

        if (search === "?" + parsed_url_params) return;
        const cached_result = get_cached_data({
          apis_to_fetch: apis_to_fetch,
          param_record: create_url_params(parsed_url_params),
        });

        url_state.current.data = {
          ...url_state.current.data,
          ...cached_result,
        };
        prev_url_search.current = decodeURIComponent("?" + parsed_url_params);
        curr_url_params.current = create_url_params(parsed_url_params);

        handle_cached_result(cached_result, apis_to_fetch);
        navigation(
          {
            pathname: window.location.pathname,
            search: decodeURIComponent(parsed_url_params),
          },
          { replace: history === "replace", state: location.state }
        );
      } catch (e) {
        console.error(e);
      }
    },
    [apis, url_scheme, navigation, will_fetch]
  );

  const handle_cached_result = useCallback(
    (cached_result?: Record<string, any>, apis_to_include?: string[]) => {
      const cached_api_keys = Object.keys(cached_result || {});
      let missing_keys = Object.keys(apis || {}).filter((ak) => {
        if (is_mounted.current) return !cached_api_keys.includes(ak);
        return (
          !cached_api_keys.includes(ak) && apis?.[ak].fetch_on_mount !== false
        );
      });
      if (apis_to_include) {
        missing_keys = missing_keys.filter((mk) =>
          apis_to_include.includes(mk)
        );
      }
      if (missing_keys.length) {
        missing_keys.forEach((mk) => {
          url_state.current.is_loading[mk] = true;
        });
        fetch_new_data(missing_keys);
      }
      if (!apis) return;
      if (is_unmounted.current) return;
      setTimeout(() => {
        if (is_unmounted.current) return;
        cached_api_keys.forEach((cak) => {
          apis[cak].on_success?.(
            curr_url_params.current,
            change_state,
            url_state.current.data
          );
        });
      });
    },
    [change_state, apis, fetch_new_data]
  );

  const handle_browser_history_change = useCallback(() => {
    if (is_unmounted.current) return;
    //* Skip this function state wasn't changed from the browser history
    const decoded_search = decodeURIComponent(window.location.search);
    //* Not a history change
    if (decoded_search === prev_url_search.current) return;
    const new_url_params = create_url_params(window.location.search);

    // const loading_keys = Object.keys(url_state.current.is_loading);
    const loading_keys: string[] = [];
    const loaded_keys: string[] = [];
    Object.keys(url_state.current.is_loading).forEach((k) => {
      if (url_state.current.is_loading[k]) {
        loading_keys.push(k);
        return;
      }
      loaded_keys.push(k);
    });

    if (!apis) {
      curr_url_params.current = new_url_params;
      return;
    }
    const api_keys = Object.keys(apis);
    const cached_result = get_cached_data({
      apis_to_fetch: api_keys,
      param_record: new_url_params,
    });
    if (cached_result) {
      url_state.current.data = {
        ...url_state.current.data,
        ...cached_result,
      };
    }

    //* on same route/page
    if (prev_url_pathname.current !== window.location.pathname) return;

    if (loading_keys.length) {
      ++history_change_durring_fetch.current;
    }

    const cached_keys = Object.keys(cached_result || {});
    const keys_to_include: string[] = [];
    loading_keys.forEach((lk) => {
      if (!cached_keys.includes(lk)) {
        // check if deps changed
        if (
          apis[lk].deps.reduce((changed, dk) => {
            changed ||= isEqual(
              curr_url_params.current[dk as string],
              new_url_params[dk as string]
            );
            return changed;
          }, false)
        ) {
          keys_to_include.push(lk);
        }
        return;
      }
      keys_to_include.push(lk);
      url_state.current.is_loading[lk] = false;
    });
    loaded_keys.forEach((lk) => {
      if (cached_keys.includes(lk)) return;
      if (apis[lk].cache_lifetime === "no-lifetime") return;
      url_state.current.is_loading[lk] = true;
      keys_to_include.push(lk);
    });

    setTimeout(() => {
      handle_cached_result(cached_result, keys_to_include);
    });
    curr_url_params.current = new_url_params;
    prev_url_search.current = decoded_search;
  }, [apis, create_url_params, get_cached_data, handle_cached_result]);

  handle_browser_history_change();

  // * function responsible for setting apis reset intervals
  function apis_reset_setup() {
    if (!apis) return;
    Object.keys(apis).forEach((key) => {
      const val = apis[key];
      if (!val.reset_interval) return;
      intervals.current.push(
        setInterval(() => {
          const param_record = create_url_params(window.location.search);
          interval_queue.current[key] = { pending: true };

          if (!url_state.current.is_loading[key]) {
            url_state.current.is_loading[key] = true;
            navigation(
              {
                search: decodeURIComponent(window.location.search),
                pathname: location.pathname,
              },
              { state: location.state, replace: true }
            );
          }
          val
            .api(param_record, url_state.current.data)
            .then((res) => {
              interval_queue.current[key] = {
                pending: false,
                data: res,
              };
            })
            .catch((e) => {
              interval_queue.current[key] = {
                pending: false,
              };
              val.on_error?.(e);
            })
            .finally(() => {
              // * checks if there're still some intervals in the pending state
              if (
                Object.values(interval_queue.current).some((v) => v.pending)
              ) {
                return;
              }
              if (is_unmounted.current) return;
              Object.keys(interval_queue.current).forEach((k) => {
                const value = interval_queue.current[k];
                if (!value.pending) {
                  url_state.current.data[k] = value.data;
                  url_state.current.is_loading[k] = false;
                  set_cached_data({
                    api_key: k,
                    value: value.data,
                    param_record,
                    cache_lifetime: apis[k].cache_lifetime,
                  });
                }
              });
              navigation(
                {
                  search: decodeURIComponent(window.location.search),
                  pathname: location.pathname,
                },
                { state: location.state, replace: true }
              );
            });
        }, val.reset_interval)
      );
    });
  }

  const set_cached_data = useCallback(
    (arg: {
      param_record: Record<string, any>;
      api_key: string;
      value: any;
      cache_lifetime?: Lifetime_duration;
    }) => {
      const { api_key, param_record, value } = arg;
      const key = create_cache_key(api_key, param_record);
      if (!key) return;

      return cache_signal.value.add({
        key,
        value,
        lifetime: arg.cache_lifetime || "5min",
        del_hash: apis_hash_map?.[api_key],
      });
    },
    [apis, apis_hash_map]
  );

  const delete_cache = useCallback(
    (apis_to_delete: U_data extends never ? never : (keyof U_data)[]) => {
      if (!apis_hash_map || !apis) return;
      apis_to_delete.forEach((atd) => {
        cache_signal.value.delete_from_memo(apis_hash_map[atd]);
      });
    },
    [apis]
  );

  // * Triggers any api remotely in a parent component without need to change state
  const call_api = useCallback(
    (apis_to_fetch: U_data extends never ? never : (keyof U_data)[]) => {
      const cached_result = get_cached_data({
        apis_to_fetch,
        param_record: curr_url_params.current,
      });
      const cached_api_keys = Object.keys(cached_result || {});
      const missing_keys = apis_to_fetch.filter((ak) => {
        if (is_mounted.current) return !cached_api_keys.includes(ak);
        return (
          !cached_api_keys.includes(ak) && apis?.[ak].fetch_on_mount === false
        );
      });
      url_state.current.data = {
        ...url_state.current.data,
        ...cached_result,
      };
      if (missing_keys.length) {
        missing_keys.forEach((mk) => {
          url_state.current.is_loading[mk] = true;
        });
        fetch_new_data(missing_keys);
      }
    },
    [fetch_new_data, apis, get_cached_data]
  );

  return {
    data: url_state.current.data as Get_data_map<U_data>,
    is_loading: url_state.current.is_loading as Get_loading_map<U_data>,
    change_state,
    call_api,
    delete_cache,
    get_cached_data: get_cached_data as <U extends (keyof U_data)[]>(arg: {
      apis_to_fetch: U;
      param_record: Partial<z.TypeOf<V_Request_params>>;
    }) =>
      | { [key in U[number]]?: Awaited<ReturnType<U_data[key]["api"]>> }
      | undefined,
    url_params: curr_url_params.current as z.infer<V_Request_params>,
  };
}

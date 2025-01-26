# URL state hook

## Description

This hook fetches using Promise.all function. It can store and update state in the url string (query params). Fetched results are store in cache. This version of hook use preact-signals to put cache into global context but it's also possible to use different tool e.i React context

```js
const {
  change_state,
  data,
  url_params,
  is_loading,
  call_api,
  delete_cache,
  get_cached_data,
} = useUrlState({
  apis: {
    gaugets: {
      api: async ({ date_range }) => {
        return fetcher.current.getMonitoringGauges(date_range);
      },
      fetch_on_mount: false,
      on_error(e) {
        onError({ msg: `${e}` });
      },
      deps: ["date_range"],
    },
    alarm: {
      api: async ({ alarm_id }) => {
        if (!alarm_id) return;
        return _1lvl.fetcher.getAlarm(alarm_id);
      },
      deps: ["alarm_id"],
      fetch_on_mount: true,
      on_error(e) {
        onError({ msg: `${e}` });
      },
    },
    gauge_type: {
      api: async () => {
        const r = await user_fetcher.current.get_user_preference(
          gauge_type_key
        );
        return gauge_type_options.find((go) => go.keyword === r);
      },
      deps: [],
      fetch_on_mount: true,
    },
  },
  url_scheme: _1lvl.schema,
});
```

## Hook paramaters:

- `apis`: with this property you can define arbitrary async processes. (mostly api fetch).

- `url_schema`: zod schema that defines the url state type and (query params). The shape of the this state should extend from the `Record<string | number, any>` type.

## Hook output:

- `change_state`: you are able to change url-state using this function

- `Is_loading`: indicates the loading/pending state of you custom apis

- `data`: object that contains data returned from your custom apis

- `url_params`: current url-state (parsed query params)
- `delete_cache`: function to quickly delete all items in cache created by current instance of useUrlState hook
- `get_cached_data`: function to get data from cache

### Custom api parameters:

- `api`: async a callback with hook contolled input and output

- `on_error`: a callback that runs in case of a api failure

- `on_success`: a callback that runs in case of a api success

- `reset_interval`: interval of repetitive api call

- `deps`: list of url-state properties which changes triggers api call

- `fetch_on_mount`: if false api is not called in the first render

- `react_on_deps_change`: if false api doesn’t react on deps changes

- cache_lifetime: you can customize lifetime by setting this property

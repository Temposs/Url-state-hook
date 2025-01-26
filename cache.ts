import { signal } from "@preact/signals-react";

type Cache_item = {
  key: string;
  value: any;
  lifetime: number;
  del_hash?: number | string;
};
type Cache_memory = Array<Cache_item>;
export type Lifetime_duration =
  | "5min"
  | "10min"
  | "30min"
  | "1h"
  | "8h"
  | "24h"
  | "no-lifetime";

const lifetime_map: Record<Lifetime_duration, number> = {
  "5min": 300_000,
  "10min": 600_000,
  "30min": 1_800_000,
  "1h": 3_600_000,
  "8h": 28_800_000,
  "24h": 86_400_000,
  "no-lifetime": NaN,
};

export type Get_from_memo_res = Cache_item | undefined;

class My_cache {
  private memory: Cache_memory;
  private max_stored_items = 100;

  constructor() {
    this.memory = [];
  }

  add(obj: {
    key: string;
    value: any;
    lifetime: Lifetime_duration;
    del_hash?: Cache_item["del_hash"];
  }) {
    const found_index = this.find_index_in_memo(obj.key);
    if (found_index !== -1) {
      this.memory.splice(found_index, 1, {
        lifetime: this.memory[found_index].lifetime,
        key: this.memory[found_index].key,
        value: obj.value,
        del_hash: obj.del_hash,
      });
      return;
    }
    if (obj.lifetime === "no-lifetime") return;

    this.memory.push({
      key: obj.key,
      value: obj.value,
      lifetime: this.get_lifetime_time(obj.lifetime),
      del_hash: obj.del_hash,
    });
  }

  get_from_memo(key: string): Get_from_memo_res {
    this.clear_memo();
    return this.memory.find((m) => m.key === key);
  }

  delete_from_memo(del_hash: number | string) {
    this.memory = this.memory.filter((mi) => mi.del_hash === del_hash);
  }

  private get_lifetime_time(lifetime?: Lifetime_duration) {
    return new Date().getTime() + lifetime_map[lifetime || "5min"];
  }

  private clear_memo() {
    const curr_time = new Date().getTime();
    const found_indexes: Array<number> = [];
    this.memory.forEach((m, i) => {
      if (m.lifetime > curr_time) {
        found_indexes.push(i);
      }
    });
    let new_memo: Cache_memory = [];
    found_indexes.forEach((index) => new_memo.push(this.memory[index]));
    if (new_memo.length > this.max_stored_items) {
      new_memo.sort((a, b) => a.lifetime - b.lifetime);
      new_memo = new_memo.slice(0, this.max_stored_items - 1);
    }
    this.memory = new_memo;
  }

  private find_index_in_memo(key: string) {
    return this.memory.findIndex((m) => m.key === key);
  }
}

export const cache_signal = signal<My_cache>(new My_cache());

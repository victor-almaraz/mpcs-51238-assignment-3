'use client';

import { useEffect, useRef } from 'react';
import { registerCommands } from '@/lib/commands/registry';

/**
 * Registers `list` ({ id, label, group, keys?, run, enabled? }) while the
 * component is mounted. Each render's closures are used when a command runs,
 * so commands always act on current state; the set of IDs is registered once.
 */
export default function useCommands(list) {
  const latest = useRef(list);
  useEffect(() => {
    latest.current = list;
  });
  const ids = list.map((c) => c.id).join('|');
  useEffect(() => {
    const proxies = ids.split('|').map((id) => {
      const current = () => latest.current.find((c) => c.id === id);
      const first = current();
      return {
        id,
        get label() {
          return current()?.label ?? first.label;
        },
        group: first.group,
        keys: first.keys ?? '',
        run: () => current()?.run(),
        enabled: () => {
          const c = current();
          return c ? (c.enabled ? c.enabled() : true) : false;
        },
      };
    });
    return registerCommands(proxies);
  }, [ids]);
}

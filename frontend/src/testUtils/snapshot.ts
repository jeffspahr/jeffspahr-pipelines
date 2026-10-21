/** Normalize React `useId()` values (e.g. `_r_abc_`, `:r1:`) for stable snapshots under StrictMode. */
export const normalizeReactUseIdAttrs = (fragment: DocumentFragment) => {
  const idMap = new Map<string, string>();
  let nextId = 0;

  // Also matches ids derived from a useId() prefix, such as `_r_0_-row-1`.
  const reactUseIdPrefix = /^(_r_[A-Za-z0-9]+_|:r[a-zA-Z0-9]*:)(.*)$/;

  const mapToken = (token: string): string => {
    const match = reactUseIdPrefix.exec(token);
    if (!match) {
      return token;
    }
    const [, useId, suffix] = match;
    if (!idMap.has(useId)) {
      idMap.set(useId, `react-use-id-${nextId++}`);
    }
    return idMap.get(useId)! + suffix;
  };

  const mapAttrValue = (value: string): string => value.split(/\s+/).map(mapToken).join(' ');

  (
    [
      'id',
      'aria-controls',
      'aria-labelledby',
      'for',
      'aria-describedby',
      'list',
      'headers',
    ] as const
  ).forEach((attr) => {
    fragment.querySelectorAll(`[${attr}]`).forEach((el) => {
      const v = el.getAttribute(attr);
      if (!v) {
        return;
      }
      el.setAttribute(attr, mapAttrValue(v));
    });
  });
};

export const normalizeRechartsIds = (fragment: DocumentFragment) => {
  const idMap = new Map<string, string>();
  let nextId = 0;
  fragment.querySelectorAll('[id^="recharts"]').forEach((el) => {
    const oldId = el.getAttribute('id');
    if (!oldId) {
      return;
    }
    if (!idMap.has(oldId)) {
      idMap.set(oldId, `recharts-id-${nextId++}`);
    }
    el.setAttribute('id', idMap.get(oldId)!);
  });
};

export const stableSnapshotFragment = (fragment: DocumentFragment) => {
  normalizeReactUseIdAttrs(fragment);
  normalizeRechartsIds(fragment);
  return fragment;
};
